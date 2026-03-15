// JobLens Profile: hide sidebar ads & recommendations
(function () {
  "use strict";

  // === Storage ===
  const DEFAULTS = {
    hideProfileSidebar: true,
  };
  let settings = { ...DEFAULTS };
  let profilePanelPosition = null;

  function loadSettings(cb) {
    chrome.storage.local.get({ ...DEFAULTS, profilePanelPosition: null }, (s) => {
      profilePanelPosition = s.profilePanelPosition;
      delete s.profilePanelPosition;
      settings = s;
      cb(s);
    });
  }

  function saveSetting(key, value) {
    settings[key] = value;
    chrome.storage.local.set({ [key]: value });
  }

  // === Panel Position Clamping ===
  function clampPanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 10;
    const MIN_VISIBLE = 60;

    let left = rect.left;
    let top = rect.top;

    if (left + MIN_VISIBLE > vw) left = vw - MIN_VISIBLE;
    if (left < MARGIN - rect.width + MIN_VISIBLE) left = MARGIN;
    if (top < MARGIN) top = MARGIN;
    if (top > vh - 40) top = vh - 50;

    panel.style.left = left + "px";
    panel.style.top = top + "px";
    return { left, top };
  }

  // === Panel UI ===
  function createPanel() {

    const panel = document.createElement("div");
    panel.id = "lj-profile-panel";

    // Header
    const header = document.createElement("div");
    header.className = "lj-profile-header";
    const title = document.createElement("span");
    title.textContent = "JobLens";
    const icon = document.createElement("span");
    icon.className = "lj-collapse-icon";
    icon.textContent = "\u25BE"; // ▾
    header.appendChild(title);
    header.appendChild(icon);

    // Body
    const body = document.createElement("div");
    body.className = "lj-profile-body";

    // Toggle: Hide Sidebar
    body.appendChild(createToggle("Hide Sidebar", settings.hideProfileSidebar, (checked) => {
      saveSetting("hideProfileSidebar", checked);
      document.body.classList.toggle("lj-hide-profile-sidebar", checked);
    }));

    // Feedback link
    const feedbackLink = document.createElement("a");
    feedbackLink.className = "lj-feedback";
    feedbackLink.textContent = "Shape JobLens \u2192";
    feedbackLink.href = "https://kunli.co/joblens";
    feedbackLink.target = "_blank";
    body.appendChild(feedbackLink);

    // ---- Drag + click (>4px movement = drag, otherwise = toggle collapse) ----
    let dragState = null;
    header.addEventListener("mousedown", (e) => {
      const rect = panel.getBoundingClientRect();
      dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top, dragged: false };
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!dragState.dragged && Math.abs(dx) + Math.abs(dy) > 4) dragState.dragged = true;
      if (dragState.dragged) {
        panel.style.left = (dragState.origLeft + dx) + "px";
        panel.style.top = (dragState.origTop + dy) + "px";
      }
    });
    document.addEventListener("mouseup", () => {
      if (dragState && dragState.dragged) {
        profilePanelPosition = clampPanelPosition(panel);
        chrome.storage.local.set({ profilePanelPosition });
      } else if (dragState && !dragState.dragged) {
        body.classList.toggle("collapsed");
        icon.textContent = body.classList.contains("collapsed") ? "\u25B8" : "\u25BE"; // ▸ : ▾
      }
      dragState = null;
    });

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Restore last drag position (must be in DOM for getBoundingClientRect to work)
    if (profilePanelPosition) {
      panel.style.left = profilePanelPosition.left + "px";
      panel.style.top = profilePanelPosition.top + "px";
      clampPanelPosition(panel);
    }

    // Keep panel in viewport on window resize
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const p = document.getElementById("lj-profile-panel");
        if (!p) return;
        profilePanelPosition = clampPanelPosition(p);
        chrome.storage.local.set({ profilePanelPosition });
      }, 150);
    });
  }

  function createToggle(labelText, checked, onChange) {
    const row = document.createElement("div");
    row.className = "lj-switch-row";
    const span = document.createElement("span");
    span.textContent = labelText;
    const label = document.createElement("label");
    label.className = "lj-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const slider = document.createElement("span");
    slider.className = "slider";
    label.appendChild(input);
    label.appendChild(slider);
    row.appendChild(span);
    row.appendChild(label);
    return row;
  }

  // === Init ===
  loadSettings(() => {
    // Apply saved state
    if (settings.hideProfileSidebar) {
      document.body.classList.add("lj-hide-profile-sidebar");
    }

    // Create panel
    createPanel();
  });
})();
