import { api } from "@/data/api";
import { driveApi } from "@/data/driveApi";
import { isNative, openExternal } from "@/lib/native";

/** Start a "Connect GitHub" / "Connect Google" OAuth flow from wherever the button lives.
 *  Web: navigate to the API's redirecting start route (the callback lands back on the web app).
 *  Native: the WebView can't leave the bundle, so ask the API (over the Bearer channel) for the
 *  authorize URL, open it in the system browser, and let the kosh://connected deep link finish it. */
export async function startConnect(provider: "github" | "google", from: string): Promise<void> {
  if (!isNative) {
    window.location.href = provider === "github" ? api.githubConnectUrl(from) : driveApi.connectUrl(from);
    return;
  }
  const { url } = provider === "github" ? await api.githubConnectStart(from) : await driveApi.connectStart(from);
  await openExternal(url);
}
