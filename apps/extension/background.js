// Kosh browser extension — background service worker (MV3).
// Adds right-click "Save to Kosh" actions (page + selected text). The popup handles one-click save
// and settings. Everything talks to the user's own Kosh API with an API key they paste in the popup.

const CONTEXT_PAGE = "kosh-save-page";
const CONTEXT_SELECTION = "kosh-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: CONTEXT_PAGE, title: "Save this page to Kosh", contexts: ["page", "link"] });
  chrome.contextMenus.create({ id: CONTEXT_SELECTION, title: "Save selection to Kosh", contexts: ["selection"] });
});

async function getSettings() {
  const { apiUrl, apiKey } = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
  return { apiUrl: (apiUrl || "").replace(/\/$/, ""), apiKey: apiKey || "" };
}

/** Save a URL (optionally with a highlighted note) to the vault. Returns { ok, duplicate?, error? }. */
async function saveToKosh(url, note) {
  const { apiUrl, apiKey } = await getSettings();
  if (!apiUrl || !apiKey) return { ok: false, error: "Set your Kosh API URL and key in the extension popup first." };
  try {
    const res = await fetch(`${apiUrl}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, note: note || undefined, source: "bookmarklet", tags: ["clipped"] }),
    });
    if (!res.ok) {
      let msg = `Save failed (${res.status})`;
      try { msg = (await res.json())?.error?.message || msg; } catch {}
      return { ok: false, error: msg };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, duplicate: !!body.duplicate };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// Brief badge feedback on the toolbar icon.
function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url) return;
  const note = info.menuItemId === CONTEXT_SELECTION ? info.selectionText : undefined;
  const r = await saveToKosh(url, note);
  flashBadge(r.ok ? (r.duplicate ? "•" : "✓") : "!", r.ok ? "#16a34a" : "#dc2626");
});

// The popup calls this to save the active tab.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "kosh-save") {
    saveToKosh(msg.url, msg.note).then(sendResponse);
    return true; // async response
  }
});
