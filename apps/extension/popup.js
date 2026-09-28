// Kosh extension popup: show the current tab, save it (with an optional note), and manage settings.
const $ = (id) => document.getElementById(id);

let tab = null;
// One query for the active tab feeds both the title/url display and the selection prefill.
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([t]) => {
  tab = t;
  $("title").textContent = t?.title || "This page";
  $("url").textContent = t?.url || "";
  if (!t?.id) return;
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => String(window.getSelection() || "") });
    if (result && result.trim()) $("note").value = result.trim();
  } catch {
    /* some pages (chrome://, store) can't be scripted — ignore */
  }
});

async function loadSettings() {
  const { apiUrl, apiKey } = await chrome.storage.sync.get(["apiUrl", "apiKey"]);
  $("apiUrl").value = apiUrl || "";
  $("apiKey").value = apiKey || "";
  if (!apiUrl || !apiKey) $("settings").open = true; // first run → nudge to configure
}
loadSettings();

$("saveSettings").addEventListener("click", async () => {
  await chrome.storage.sync.set({ apiUrl: $("apiUrl").value.trim(), apiKey: $("apiKey").value.trim() });
  const m = $("msg"); m.textContent = "Settings saved."; m.className = "msg ok";
});

$("open").addEventListener("click", async () => {
  const { apiUrl } = await chrome.storage.sync.get(["apiUrl"]);
  const base = (apiUrl || "").replace(/\/api\/?$/, "");
  if (base) chrome.tabs.create({ url: base });
});

$("save").addEventListener("click", () => {
  if (!tab?.url) return;
  const m = $("msg"); m.textContent = "Saving…"; m.className = "msg";
  chrome.runtime.sendMessage({ type: "kosh-save", url: tab.url, note: $("note").value.trim() || undefined }, (r) => {
    if (r?.ok) { m.textContent = r.duplicate ? "Already in Kosh ✓" : "Saved ✓"; m.className = "msg ok"; setTimeout(() => window.close(), 900); }
    else { m.textContent = r?.error || "Save failed"; m.className = "msg err"; }
  });
});
