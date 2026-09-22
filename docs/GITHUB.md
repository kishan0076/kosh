# GitHub in Kosh

Kosh has three GitHub surfaces that all use the same OAuth App:

1. **Login** — sign in to Kosh with GitHub (`/auth/github`).
2. **Connect GitHub** — one-click account linking that stores a token so you can publish
   and manage repos (`/github/auth`). Replaces pasting a Personal Access Token.
3. **The GitHub module** (`/github`) — a full repository manager: list, create, edit,
   delete, push, and browse commits / branches / releases / issues / PRs / Actions.

There's also a **Publish** page (`/publish`) for turning a local project folder into a new
repo in one commit, and a **local-folder scan** (Chromium only) that checks a folder on your
computer for a `.git` repo and a `.gitignore`.

---

## 1. Create a GitHub OAuth App

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
(for an org: **Org settings → Developer settings → OAuth Apps**).

- **Application name:** Kosh (anything)
- **Homepage URL:** your web app URL, e.g. `http://localhost:5173`
- **Authorization callback URL:** add **both** of these (OAuth Apps accept up to 10 —
  add the first when creating, then **Add another** for the second):

  ```
  <API_URL>/api/auth/github/callback      ← login
  <API_URL>/api/github/auth/callback      ← Connect GitHub (repo manager + publish)
  ```

  Locally that's `http://localhost:8787/api/auth/github/callback` and
  `http://localhost:8787/api/github/auth/callback`. In production, swap in your public API
  host. The host **and path prefix** must match, which is why both paths are registered.

Copy the **Client ID** and generate a **Client secret**.

> A GitHub *App* (as opposed to an OAuth App) also works, but the flow here is written for a
> classic OAuth App. Fine-grained tokens differ in how scopes appear; see §4.

## 2. Configure the server

In your API `.env`:

```bash
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<client secret>
# Optional — only if your connect callback isn't <API_URL>/api/github/auth/callback:
# GITHUB_CONNECT_REDIRECT_URI=https://api.example.com/api/github/auth/callback
APP_URL=https://app.example.com     # where the browser is sent back after OAuth
API_URL=https://api.example.com     # used to build the default callback URLs
```

Restart the API. The web app shows **Connect GitHub** buttons on the GitHub module, the
Publish page, and in **Settings → GitHub connection** whenever `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET` are set.

## 3. Scopes

The **Connect** flow requests:

```
repo read:user delete_repo workflow
```

- `repo` — read/write repositories (create, push, edit, read private repos)
- `delete_repo` — delete repositories (guarded by a type-to-confirm dialog)
- `workflow` — read/manage Actions workflow files
- `read:user` — your profile (to label the connected account)

The **login** flow requests only `read:user repo`. Connecting later upgrades the stored
token to the full set above.

Tokens are stored **encrypted at rest** (`ENCRYPTION_KEY`) on the user record and are never
returned to the browser.

## 4. Personal Access Token fallback

If you don't want to run an OAuth App, users can paste a token instead
(Publish page → "paste a token", or **Settings → GitHub connection**). Create one at
**github.com/settings/tokens** with the `repo` scope (add `delete_repo` and `workflow` to use
those features). Fine-grained tokens work too — they need *Contents: write*,
*Administration: write* (create/delete), and *Workflows: write*.

## 5. Security notes

- **CSRF:** both OAuth flows carry a `state` value. Login uses a random nonce echoed via a
  short-lived cookie; Connect uses a signed, user-bound token. Return paths are allow-listed
  (`github`, `publish`, `settings`) so a crafted `from` can't open-redirect.
- **Secret scanning:** publishing and pushing scan text files for credentials and block the
  push unless you explicitly confirm.
- **Destructive actions:** deleting a repo requires typing `owner/repo` to confirm.

## 6. Local-folder scan (Chromium only)

The Publish page can scan a folder **on your computer** (via the File System Access API) to
check for a `.git` repo and a `.gitignore`. A missing `.gitignore` can be written directly to
the folder, tailored to the detected stacks. A browser can't run `git init`, so a missing
`.git` is surfaced with a copyable command and a nudge to publish. This works in Chrome / Edge
and other Chromium browsers; Firefox and Safari show a fallback note and can still publish via
the folder picker.

## 7. Sandbox caveat

In Anthropic's hosted sandbox the outbound proxy **blocks `api.github.com`**, so live GitHub
calls (listing repos, creating, pushing) will fail there with a typed error the UI surfaces
gracefully. Everything degrades cleanly, but to exercise the real flows run the API somewhere
with open outbound access to `github.com` and `api.github.com`.
