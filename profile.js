// JobLens Profile: hide sidebar ads & recommendations
(function () {
  "use strict";

  // === Storage ===
  const DEFAULTS = {
    hideProfileSidebar: true,
  };
  let settings = { ...DEFAULTS };

  function loadSettings(cb) {
    chrome.storage.local.get(DEFAULTS, (s) => { settings = s; cb(s); });
  }

  function saveSetting(key, value) {
    settings[key] = value;
    chrome.storage.local.set({ [key]: value });
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

    // Collapse/expand
    header.addEventListener("click", () => {
      body.classList.toggle("collapsed");
      icon.textContent = body.classList.contains("collapsed") ? "\u25B8" : "\u25BE"; // ▸ : ▾
    });

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
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
