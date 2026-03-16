// JobLens Profile: hide sidebar ads & recommendations
(function () {
  "use strict";

  function isProfilePage() {
    return location.pathname.startsWith("/in/");
  }

  let initialized = false;

  // === Storage ===
  const DEFAULTS = {
    hideProfileSidebar: true,
  };
  let settings = { ...DEFAULTS };

  function loadSettings(cb) {
    chrome.storage.local.get({ ...DEFAULTS }, (s) => {
      settings = s;
      cb(s);
    });
  }

  // === Mini Badge ===
  function createMiniBadge() {
    if (document.getElementById("lj-mini-badge")) return;

    const badge = document.createElement("div");
    badge.id = "lj-mini-badge";
    badge.textContent = settings.hideProfileSidebar ? "\uD83D\uDD0D Sidebar hidden" : "\uD83D\uDD0D JobLens";

    // Inject styles
    const style = document.createElement("style");
    style.textContent = `
      #lj-mini-badge {
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        background: rgba(250, 247, 242, 0.92); backdrop-filter: blur(12px);
        border: 1px solid #E4DDD2; border-radius: 20px; padding: 6px 14px;
        font-family: "EB Garamond", serif; font-size: 13px; color: #1F2328;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06); user-select: none;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(badge);
  }

  // === Storage Change Listener ===
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.hideProfileSidebar) {
      settings.hideProfileSidebar = changes.hideProfileSidebar.newValue;
      document.body.classList.toggle("lj-hide-profile-sidebar", changes.hideProfileSidebar.newValue);
      // Update badge text
      const badge = document.getElementById("lj-mini-badge");
      if (badge) {
        badge.textContent = changes.hideProfileSidebar.newValue ? "\uD83D\uDD0D Sidebar hidden" : "\uD83D\uDD0D JobLens";
      }
    }
  });

  // === Init ===
  function boot() {
    if (initialized || !isProfilePage()) return;
    initialized = true;

    loadSettings(() => {
      if (settings.hideProfileSidebar) {
        document.body.classList.add("lj-hide-profile-sidebar");
      }
      createMiniBadge();
    });
  }

  boot();
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isProfilePage() && !initialized) boot();
    }
  }, 1000);
})();
