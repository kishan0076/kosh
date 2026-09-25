import { Router, type Request } from "express";
import { getStore } from "../db/index.js";
import { ah, badRequest } from "../errors.js";
import { requireUser, requireWrite } from "../auth/middleware.js";
import { signState, verifyState } from "../auth/jwt.js";
import { config } from "../config.js";
import {
  GithubAuthError,
  exchangeGithubCode,
  getGithubIdentity,
  githubAuthorizeUrl,
  githubConnectScopes,
  githubOAuthConfigured,
} from "../integrations/github.js";
import { githubGrantPatch } from "../integrations/githubToken.js";

/**
 * "Connect GitHub" — a one-click OAuth flow that replaces pasting a Personal Access Token. The
 * consented token is stored (encrypted) on the user like the PAT path, so publishing and the GitHub
 * module work identically whichever way you connected. This is ADDITIVE account linking for an
 * already-signed-in user (it never creates a session and has no login allowlist) — distinct from the
 * `/auth/github` *login* flow.
 */
export const githubAuthRouter: Router = Router();

const OAUTH_PURPOSE = "github-connect";
const nowIso = () => new Date().toISOString();

// Which app pages may be returned to after consent (prevents an open-redirect via a crafted `from`).
const RETURN_PATHS = new Set(["github", "publish", "settings"]);
const returnPathOf = (v: unknown): string => (typeof v === "string" && RETURN_PATHS.has(v) ? v : "publish");

function requireConfigured(): void {
  if (!githubOAuthConfigured()) {
    throw badRequest("NOT_CONFIGURED", "GitHub Connect isn't configured on the server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or paste a token instead.");
  }
}

/** Whether the connect button can be offered, plus the scopes it will request (for the UI copy). */
githubAuthRouter.get(
  "/github/config",
  ah(async (req, res) => {
    requireUser(req);
    res.json({ oauth: githubOAuthConfigured(), scopes: githubConnectScopes().split(" ") });
  }),
);

/** Start consent — redirects the browser to GitHub. State binds the flow to the user (CSRF) and
 *  records which module to return to (`github` module / `publish` page). */
githubAuthRouter.get(
  "/github/auth",
  ah(async (req, res) => {
    const uid = requireUser(req);
    requireConfigured();
    const from = returnPathOf(req.query.from);
    if (req.query.client === "mobile") {
      // Native app: it can't navigate its WebView through GitHub, so it asks (over its authenticated
      // Bearer channel) for the authorize URL, opens it in the system browser, and the callback returns
      // via the kosh:// deep link. The state carries client=mobile so the callback knows to do that.
      const state = await signState(uid, OAUTH_PURPOSE, from, { client: "mobile" });
      res.json({ url: githubAuthorizeUrl(state, config.github.connectRedirectUri) });
      return;
    }
    const state = await signState(uid, OAUTH_PURPOSE, from);
    res.redirect(githubAuthorizeUrl(state, config.github.connectRedirectUri));
  }),
);

/** OAuth redirect target. Every path redirects back to the web app (this is a browser navigation). */
githubAuthRouter.get(
  "/github/auth/callback",
  ah(async (req: Request, res) => {
    let returnPath = "publish"; // resolved from the signed state once verified
    let mobile = false; // a flow started by the native app returns to it via the deep link
    const back = (params: Record<string, string>) =>
      res.redirect(
        mobile
          ? `${config.mobileScheme}://connected?${new URLSearchParams({ provider: "github", ...params })}`
          : `${config.appUrl}/${returnPath}?${new URLSearchParams(params)}`,
      );
    try {
      const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
      if (error) return back({ github_error: error });
      if (!code || !state) return back({ github_error: "missing_code" });

      const verified = await verifyState(state, OAUTH_PURPOSE);
      if (!verified) return back({ github_error: "state_mismatch" });
      mobile = verified.client === "mobile";
      // Web: the session cookie riding this top-level GET must match the user the state was minted for
      // (CSRF). Mobile: the flow ran in the system browser (no app cookie there); the state was minted
      // over the app's authenticated Bearer channel and is short-lived, so its bound uid is the identity.
      const uid = mobile ? verified.uid : (req.userId ?? null);
      if (!uid || verified.uid !== uid) return back({ github_error: "state_mismatch" });
      returnPath = returnPathOf(verified.from);

      const grant = await exchangeGithubCode(code, config.github.connectRedirectUri);
      const identity = await getGithubIdentity(grant.accessToken);

      await getStore().users.updateById(uid, {
        ...githubGrantPatch(grant), // token + (when the app issues them) refresh token & expiries
        githubLogin: identity.login,
        githubName: identity.name ?? "",
        githubAvatarUrl: identity.avatarUrl ?? "",
        githubTokenSource: "oauth",
        githubConnectedAt: nowIso(),
      });
      return back({ github_connected: identity.login });
    } catch (err) {
      if (err instanceof GithubAuthError) return back({ github_error: "exchange_failed" });
      return back({ github_error: "connect_failed" });
    }
  }),
);

/** Disconnect: forget the stored token + connection metadata. */
githubAuthRouter.post(
  "/github/disconnect",
  ah(async (req, res) => {
    const uid = requireWrite(req);
    await getStore().users.updateById(uid, {
      githubToken: "",
      githubLogin: "",
      githubName: "",
      githubAvatarUrl: "",
      githubScopes: "",
      githubTokenSource: undefined,
      githubConnectedAt: "",
      githubRefreshToken: undefined,
      githubTokenExpiresAt: undefined,
      githubRefreshTokenExpiresAt: undefined,
    });
    res.json({ connected: false });
  }),
);
