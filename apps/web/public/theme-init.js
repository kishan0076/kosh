// No-flash theme init: apply the saved/system theme before first paint.
// External (not inline) so the production CSP can keep script-src 'self'.
(function () {
  try {
    var saved = localStorage.getItem("kosh.theme");
    var isDark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "system" || !saved) {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {}
})();
