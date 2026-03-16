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

  // Profile page badge removed — no useful info to display here

  // === Storage Change Listener ===
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.hideProfileSidebar) {
      settings.hideProfileSidebar = changes.hideProfileSidebar.newValue;
      document.body.classList.toggle("lj-hide-profile-sidebar", changes.hideProfileSidebar.newValue);
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
    });
  }

  boot();
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isProfilePage()) {
        if (!initialized) boot();
      } else {
        // Left the profile page — reset so boot() runs again when returning
        initialized = false;
      }
    }
  }, 1000);
})();
