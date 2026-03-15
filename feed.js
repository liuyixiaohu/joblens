// JobLens Feed: hide ads, sidebar, muted people & keywords
(function () {
  "use strict";

  // === Storage ===
  const DEFAULTS = {
    hidePromoted: true,
    hideSuggested: true,
    hideRecommended: true,
    hideNonConnections: false,
    forceRecent: false,
    hideSidebar: true,
    mutedPeople: [],
    mutedKeywords: [],
  };
  let settings = { ...DEFAULTS };

  function loadSettings(cb) {
    chrome.storage.local.get(DEFAULTS, (s) => { settings = s; cb(s); });
  }

  function saveList(key) {
    chrome.storage.local.set({ [key]: settings[key] });
  }

  function saveSetting(key, value) {
    settings[key] = value;
    chrome.storage.local.set({ [key]: value });
  }

  // === Name extraction from feed posts ===

  // Post author: from "Open control menu for post by NAME"
  function getPostAuthor(article) {
    const btn = article.querySelector('button[aria-label*="control menu for post by"]');
    if (!btn) return null;
    const match = btn.getAttribute("aria-label").match(/post by (.+)/i);
    return match ? match[1].trim() : null;
  }

  // Interaction person: from header text like "Jane likes this" / "John commented on this"
  function getInteractor(article) {
    const header = article.querySelector(".update-components-header");
    if (!header) return null;
    const text = header.textContent.trim();
    // Patterns: "Name likes this", "Name commented on this", "Name reposted this", "Name loves this"
    const match = text.match(/^(.+?)\s+(likes?|commented|reposted|loves?|celebrates?|supports?|finds? funny)\b/i);
    return match ? match[1].trim() : null;
  }

  // === Filtering logic ===

  function hasLeafText(article, text) {
    const els = article.querySelectorAll("*");
    for (const el of els) {
      if (el.children.length === 0 && el.textContent.trim() === text) {
        return true;
      }
    }
    return false;
  }

  function isMutedByPerson(article) {
    if (settings.mutedPeople.length === 0) return false;
    const author = getPostAuthor(article);
    const interactor = getInteractor(article);
    const lowerList = settings.mutedPeople.map((n) => n.toLowerCase());
    if (author && lowerList.includes(author.toLowerCase())) return true;
    if (interactor && lowerList.includes(interactor.toLowerCase())) return true;
    return false;
  }

  function isMutedByKeyword(article) {
    if (settings.mutedKeywords.length === 0) return false;
    const text = article.innerText.toLowerCase();
    return settings.mutedKeywords.some((kw) => text.includes(kw.toLowerCase()));
  }

  // Scan and tag all posts
  function scanPosts() {
    const main = document.querySelector('main[role="main"]') || document.querySelector("main");
    if (!main) return;
    const articles = main.querySelectorAll('[role="article"]');
    for (const article of articles) {
      // Tag promoted & suggested (once, stable labels)
      if (!article.dataset.ljTypeChecked) {
        article.dataset.ljTypeChecked = "1";
        if (hasLeafText(article, "Promoted")) article.dataset.ljPromoted = "true";
        if (hasLeafText(article, "Suggested")) article.dataset.ljSuggested = "true";
        if (hasLeafText(article, "Recommended for you") || hasLeafText(article, "Jobs recommended for you")) {
          article.dataset.ljRecommended = "true";
        }
        // Non-connection: has Follow button and no interaction header
        const hasFollow = !!article.querySelector('button[aria-label*="Follow"]');
        const hasHeader = !!article.querySelector(".update-components-header");
        if (hasFollow && !hasHeader) {
          article.dataset.ljNonConnection = "true";
        }
      }
      // Tag muted (re-check on every scan since lists can change)
      if (isMutedByPerson(article) || isMutedByKeyword(article)) {
        article.dataset.ljMuted = "true";
      } else {
        delete article.dataset.ljMuted;
      }
    }
  }

  // === Force Recent sort ===

  function switchToRecent() {
    // Open the sort dropdown, then click "Recent"
    const svg = document.querySelector('[aria-label="Sort order dropdown button"]');
    const sortBtn = svg && svg.closest("button");
    if (!sortBtn) return;
    // Already on Recent? Skip
    if (sortBtn.textContent.replace(/\s+/g, " ").includes("Recent")) return;
    sortBtn.click();
    setTimeout(() => {
      const items = document.querySelectorAll(".artdeco-dropdown__item");
      for (const item of items) {
        if (item.textContent.trim() === "Recent") { item.click(); break; }
      }
    }, 200);
  }

  // === Mute button injection on posts ===

  function makeMuteBtn(name) {
    const btn = document.createElement("button");
    btn.className = "lj-mute-btn";
    btn.title = "Mute " + name;
    btn.textContent = "Mute";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      addMutedPerson(name);
    });
    return btn;
  }

  function injectMuteButtons() {
    const main = document.querySelector('main[role="main"]') || document.querySelector("main");
    if (!main) return;
    const articles = main.querySelectorAll('[role="article"]');
    for (const article of articles) {
      if (article.dataset.ljMuteBtnAdded) continue;
      article.dataset.ljMuteBtnAdded = "1";

      // Mute button next to post author name
      const author = getPostAuthor(article);
      if (author) {
        const actorTitle = article.querySelector(".update-components-actor__title");
        if (actorTitle) {
          actorTitle.style.display = "flex";
          actorTitle.style.alignItems = "center";
          actorTitle.style.gap = "6px";
          actorTitle.appendChild(makeMuteBtn(author));
        }
      }

      // Mute button next to interactor name
      const interactor = getInteractor(article);
      if (interactor) {
        const header = article.querySelector(".update-components-header");
        if (header) {
          header.style.display = "flex";
          header.style.alignItems = "center";
          header.style.gap = "6px";
          header.appendChild(makeMuteBtn(interactor));
        }
      }
    }
  }

  function addMutedPerson(name) {
    if (settings.mutedPeople.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    settings.mutedPeople.push(name);
    saveList("mutedPeople");
    renderPeopleList();
    scanPosts();
    showToast("Muted " + name);
  }

  function removeMutedPerson(name) {
    settings.mutedPeople = settings.mutedPeople.filter((n) => n.toLowerCase() !== name.toLowerCase());
    saveList("mutedPeople");
    renderPeopleList();
    scanPosts();
  }

  function addMutedKeyword(raw) {
    const items = raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    let added = 0;
    for (const kw of items) {
      if (!settings.mutedKeywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
        settings.mutedKeywords.push(kw);
        added++;
      }
    }
    if (added > 0) {
      saveList("mutedKeywords");
      renderKeywordList();
      scanPosts();
      if (added > 1) showToast("Added " + added + " keywords");
    }
  }

  function removeMutedKeyword(kw) {
    settings.mutedKeywords = settings.mutedKeywords.filter((k) => k.toLowerCase() !== kw.toLowerCase());
    saveList("mutedKeywords");
    renderKeywordList();
    scanPosts();
  }

  // === Toast notification ===
  function showToast(msg) {
    let toast = document.getElementById("lj-feed-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "lj-feed-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 1800);
  }

  // === Load EB Garamond font ===
  function loadFont() {
    if (document.querySelector('link[href*="EB+Garamond"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }

  // === Panel UI ===
  let ui = {};

  function createPanel() {
    loadFont();

    const panel = document.createElement("div");
    panel.id = "lj-feed-panel";

    // Header
    const header = document.createElement("div");
    header.className = "lj-feed-header";
    const title = document.createElement("span");
    title.textContent = "JobLens";
    const icon = document.createElement("span");
    icon.className = "lj-collapse-icon";
    icon.textContent = "▾";
    header.appendChild(title);
    header.appendChild(icon);

    // Body
    const body = document.createElement("div");
    body.className = "lj-feed-body";

    // --- Toggle section ---
    const toggleSection = document.createElement("div");
    toggleSection.className = "lj-feed-section";
    toggleSection.appendChild(createToggle("Hide Ads", settings.hidePromoted, (checked) => {
      saveSetting("hidePromoted", checked);
      document.body.classList.toggle("lj-hide-promoted", checked);
    }));
    toggleSection.appendChild(createToggle("Hide Suggested", settings.hideSuggested, (checked) => {
      saveSetting("hideSuggested", checked);
      document.body.classList.toggle("lj-hide-suggested", checked);
    }));
    toggleSection.appendChild(createToggle("Hide Recommended", settings.hideRecommended, (checked) => {
      saveSetting("hideRecommended", checked);
      document.body.classList.toggle("lj-hide-recommended", checked);
    }));
    toggleSection.appendChild(createToggle("Hide Strangers", settings.hideNonConnections, (checked) => {
      saveSetting("hideNonConnections", checked);
      document.body.classList.toggle("lj-hide-non-connections", checked);
    }));
    toggleSection.appendChild(createToggle("Force Recent", settings.forceRecent, (checked) => {
      saveSetting("forceRecent", checked);
      if (checked) switchToRecent();
    }));
    toggleSection.appendChild(createToggle("Hide Sidebar", settings.hideSidebar, (checked) => {
      saveSetting("hideSidebar", checked);
      document.body.classList.toggle("lj-hide-sidebar", checked);
    }));

    // --- Muted People section ---
    const peopleSection = document.createElement("div");
    peopleSection.className = "lj-feed-section";

    const peopleLabelRow = document.createElement("div");
    peopleLabelRow.className = "lj-label-row";
    const peopleLabel = document.createElement("span");
    peopleLabel.className = "lj-label";
    peopleLabel.textContent = "Muted People";
    const peopleCopyBtn = document.createElement("button");
    peopleCopyBtn.className = "lj-copy-btn";
    peopleCopyBtn.textContent = "Copy";
    peopleCopyBtn.addEventListener("click", () => copyList(settings.mutedPeople, "people"));
    peopleLabelRow.appendChild(peopleLabel);
    peopleLabelRow.appendChild(peopleCopyBtn);

    ui.peopleList = document.createElement("div");
    ui.peopleList.className = "lj-list";

    const peopleInput = document.createElement("input");
    peopleInput.type = "text";
    peopleInput.placeholder = "Name...";
    const peopleAddBtn = document.createElement("button");
    peopleAddBtn.textContent = "Add";
    peopleAddBtn.addEventListener("click", () => {
      const raw = peopleInput.value.trim();
      if (!raw) return;
      addMutedPerson(raw);
      peopleInput.value = "";
    });
    peopleInput.addEventListener("keypress", (e) => { if (e.key === "Enter") peopleAddBtn.click(); });

    const peopleAddRow = document.createElement("div");
    peopleAddRow.className = "lj-add";
    peopleAddRow.appendChild(peopleInput);
    peopleAddRow.appendChild(peopleAddBtn);

    peopleSection.appendChild(peopleLabelRow);
    peopleSection.appendChild(ui.peopleList);
    peopleSection.appendChild(peopleAddRow);

    // --- Muted Keywords section ---
    const keywordSection = document.createElement("div");
    keywordSection.className = "lj-feed-section";

    const kwLabelRow = document.createElement("div");
    kwLabelRow.className = "lj-label-row";
    const kwLabel = document.createElement("span");
    kwLabel.className = "lj-label";
    kwLabel.textContent = "Muted Keywords";
    const kwCopyBtn = document.createElement("button");
    kwCopyBtn.className = "lj-copy-btn";
    kwCopyBtn.textContent = "Copy";
    kwCopyBtn.addEventListener("click", () => copyList(settings.mutedKeywords, "keywords"));
    kwLabelRow.appendChild(kwLabel);
    kwLabelRow.appendChild(kwCopyBtn);

    ui.keywordList = document.createElement("div");
    ui.keywordList.className = "lj-list";

    const kwInput = document.createElement("input");
    kwInput.type = "text";
    kwInput.placeholder = "Keyword...";
    const kwAddBtn = document.createElement("button");
    kwAddBtn.textContent = "Add";
    kwAddBtn.addEventListener("click", () => {
      const raw = kwInput.value.trim();
      if (!raw) return;
      addMutedKeyword(raw);
      kwInput.value = "";
    });
    kwInput.addEventListener("keypress", (e) => { if (e.key === "Enter") kwAddBtn.click(); });

    const kwAddRow = document.createElement("div");
    kwAddRow.className = "lj-add";
    kwAddRow.appendChild(kwInput);
    kwAddRow.appendChild(kwAddBtn);

    keywordSection.appendChild(kwLabelRow);
    keywordSection.appendChild(ui.keywordList);
    keywordSection.appendChild(kwAddRow);

    // --- Feedback link ---
    const feedbackLink = document.createElement("a");
    feedbackLink.className = "lj-feedback";
    feedbackLink.textContent = "Shape JobLens \u2192";
    feedbackLink.href = "https://kunli.co/joblens";
    feedbackLink.target = "_blank";

    // Assemble
    body.appendChild(toggleSection);
    body.appendChild(peopleSection);
    body.appendChild(keywordSection);
    body.appendChild(feedbackLink);

    // Collapse/expand
    header.addEventListener("click", () => {
      body.classList.toggle("collapsed");
      icon.textContent = body.classList.contains("collapsed") ? "▸" : "▾";
    });

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Render initial lists
    renderPeopleList();
    renderKeywordList();
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

  // === List rendering (mirrors content.js pattern) ===

  const LIST_COLLAPSE_THRESHOLD = 5;

  function renderPeopleList() {
    renderList(ui.peopleList, settings.mutedPeople, removeMutedPerson);
  }

  function renderKeywordList() {
    renderList(ui.keywordList, settings.mutedKeywords, removeMutedKeyword);
  }

  function renderList(container, items, onRemove) {
    if (!container) return;
    container.innerHTML = "";
    const collapsed = items.length > LIST_COLLAPSE_THRESHOLD;
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "lj-list-item";
      if (collapsed && i >= LIST_COLLAPSE_THRESHOLD) row.style.display = "none";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = item;
      const removeBtn = document.createElement("button");
      removeBtn.className = "lj-x";
      removeBtn.textContent = "\u00d7";
      removeBtn.addEventListener("click", () => onRemove(item));
      row.appendChild(nameSpan);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
    // Expand/collapse toggle
    if (collapsed) {
      const toggle = document.createElement("button");
      toggle.className = "lj-list-toggle";
      toggle.textContent = "Show all " + items.length + " items";
      let expanded = false;
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        container.querySelectorAll(".lj-list-item").forEach((el, i) => {
          if (i >= LIST_COLLAPSE_THRESHOLD) el.style.display = expanded ? "" : "none";
        });
        toggle.textContent = expanded ? "Show less" : "Show all " + items.length + " items";
      });
      container.appendChild(toggle);
    }
  }

  function copyList(list, label) {
    navigator.clipboard.writeText(list.join(", ")).then(() => {
      showToast("Copied " + list.length + " " + label);
    }).catch(() => {
      showToast("Copy failed");
    });
  }

  // === Init ===
  loadSettings(() => {
    // Apply saved toggle states
    if (settings.hidePromoted) document.body.classList.add("lj-hide-promoted");
    if (settings.hideSuggested) document.body.classList.add("lj-hide-suggested");
    if (settings.hideRecommended) document.body.classList.add("lj-hide-recommended");
    if (settings.hideNonConnections) document.body.classList.add("lj-hide-non-connections");
    if (settings.hideSidebar) document.body.classList.add("lj-hide-sidebar");

    // Initial scan
    scanPosts();
    injectMuteButtons();

    // Create panel
    createPanel();

    // Switch to Recent sort if enabled
    if (settings.forceRecent) switchToRecent();

    // Observe for new posts (infinite scroll)
    let debounceTimer = null;
    new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanPosts();
        injectMuteButtons();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
