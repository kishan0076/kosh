# Kosh browser extension (MV3)

One-click capture from the browser into your Kosh vault — the real place bookmarking happens, mid-read.

## What it does
- Toolbar popup: save the current tab (with an optional note), pre-filled with any text you've highlighted.
- Right-click menu: **Save this page to Kosh** and **Save selection to Kosh** (the selection becomes the note).
- Talks only to *your* Kosh API using an API key you create in Kosh → Settings → API keys (needs the `write` scope). Nothing is sent anywhere else.

## Install (unpacked, for development)
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `apps/extension` folder.
3. Click the Kosh icon → **Settings** and set:
   - **API URL** — e.g. `https://your-kosh.example/api` (the same value as the web app's `VITE_API_URL`).
   - **API key** — create one in Kosh → Settings → API keys (`write` scope), paste it here.
4. Save. Now the toolbar button and right-click menu save into your vault; captures land in your **Inbox**.

## Notes
- No build step — plain MV3 JS/HTML, so it loads unpacked as-is. For the Chrome Web Store, zip this folder (add PNG icons first).
- Firefox: the same MV3 manifest loads via `about:debugging` → *Load Temporary Add-on*.
- Saves use `source: "bookmarklet"` and the tag `clipped`, so an Automation rule can file them automatically.
