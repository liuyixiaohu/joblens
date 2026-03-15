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
  let feedPanelPosition = null;

  function loadSettings(cb) {
    chrome.storage.local.get({ ...DEFAULTS, feedPanelPosition: null }, (s) => {
      feedPanelPosition = s.feedPanelPosition;
      delete s.feedPanelPosition;
      settings = s;
      cb(s);
    });
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

  // === Scroll nudge: trigger LinkedIn's infinite scroll to fill gaps ===
  let nudgeTimer = null;
  function nudgeScroll() {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      window.scrollBy(0, 1);
      requestAnimationFrame(() => window.scrollBy(0, -1));
    }, 400);            // wait for collapse animation to finish
  }

  // === Filtering logic ===

  // Cached lowercase Sets for O(1) mute lookups (rebuilt when lists change)
  let mutedPeopleSet = new Set();
  let mutedKeywordsLower = [];

  function rebuildMuteCache() {
    mutedPeopleSet = new Set(settings.mutedPeople.map((n) => n.toLowerCase()));
    mutedKeywordsLower = settings.mutedKeywords.map((k) => k.toLowerCase());
  }

  // Single-pass leaf text detection: one querySelectorAll("*") instead of 5
  const POST_TYPE_LABELS = new Set([
    "Promoted", "Suggested", "Recommended for you",
    "Jobs recommended for you", "Popular course on LinkedIn Learning",
  ]);

  function detectPostLabels(article) {
    const found = new Set();
    for (const el of article.querySelectorAll("*")) {
      if (el.children.length > 0) continue;
      const t = el.textContent.trim();
      if (POST_TYPE_LABELS.has(t)) found.add(t);
    }
    return found;
  }

  function isMutedByPerson(article) {
    if (mutedPeopleSet.size === 0) return false;
    const author = getPostAuthor(article);
    const interactor = getInteractor(article);
    if (author && mutedPeopleSet.has(author.toLowerCase())) return true;
    if (interactor && mutedPeopleSet.has(interactor.toLowerCase())) return true;
    return false;
  }

  // WeakMap cache for lowercase innerText (posts don't change content between scans)
  const articleTextCache = new WeakMap();

  function isMutedByKeyword(article) {
    if (mutedKeywordsLower.length === 0) return false;
    let text = articleTextCache.get(article);
    if (text === undefined) {
      text = article.innerText.toLowerCase();
      articleTextCache.set(article, text);
    }
    return mutedKeywordsLower.some((kw) => text.includes(kw));
  }

  // Scan and tag all posts
  function scanPosts() {
    const main = document.querySelector('main[role="main"]') || document.querySelector("main");
    if (!main) return;
    const articles = main.querySelectorAll('[role="article"]');
    for (const article of articles) {
      // Tag post type (once per post — labels are stable)
      if (!article.dataset.ljTypeChecked) {
        article.dataset.ljTypeChecked = "1";
        const labels = detectPostLabels(article);
        if (labels.has("Promoted")) article.dataset.ljPromoted = "true";
        if (labels.has("Suggested")) article.dataset.ljSuggested = "true";
        if (labels.has("Recommended for you") || labels.has("Jobs recommended for you") || labels.has("Popular course on LinkedIn Learning")) {
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
    rebuildMuteCache();
    renderPeopleList();
    scanPosts();
    nudgeScroll();
    showToast("Muted " + name);
  }

  function removeMutedPerson(name) {
    settings.mutedPeople = settings.mutedPeople.filter((n) => n.toLowerCase() !== name.toLowerCase());
    saveList("mutedPeople");
    rebuildMuteCache();
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
      rebuildMuteCache();
      renderKeywordList();
      scanPosts();
      nudgeScroll();
      if (added > 1) showToast("Added " + added + " keywords");
    }
  }

  function removeMutedKeyword(kw) {
    settings.mutedKeywords = settings.mutedKeywords.filter((k) => k.toLowerCase() !== kw.toLowerCase());
    saveList("mutedKeywords");
    rebuildMuteCache();
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
  let ui = {};

  function createPanel() {
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
      if (checked) nudgeScroll();
    }));
    toggleSection.appendChild(createToggle("Hide Suggested", settings.hideSuggested, (checked) => {
      saveSetting("hideSuggested", checked);
      document.body.classList.toggle("lj-hide-suggested", checked);
      if (checked) nudgeScroll();
    }));
    toggleSection.appendChild(createToggle("Hide Recommended", settings.hideRecommended, (checked) => {
      saveSetting("hideRecommended", checked);
      document.body.classList.toggle("lj-hide-recommended", checked);
      if (checked) nudgeScroll();
    }));
    toggleSection.appendChild(createToggle("Hide Strangers", settings.hideNonConnections, (checked) => {
      saveSetting("hideNonConnections", checked);
      document.body.classList.toggle("lj-hide-non-connections", checked);
      if (checked) nudgeScroll();
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
        feedPanelPosition = clampPanelPosition(panel);
        chrome.storage.local.set({ feedPanelPosition });
      } else if (dragState && !dragState.dragged) {
        body.classList.toggle("collapsed");
        icon.textContent = body.classList.contains("collapsed") ? "▸" : "▾";
      }
      dragState = null;
    });

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Restore last drag position (must be in DOM for getBoundingClientRect to work)
    if (feedPanelPosition) {
      panel.style.left = feedPanelPosition.left + "px";
      panel.style.top = feedPanelPosition.top + "px";
      clampPanelPosition(panel);
    }

    // Keep panel in viewport on window resize
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const p = document.getElementById("lj-feed-panel");
        if (!p) return;
        feedPanelPosition = clampPanelPosition(p);
        chrome.storage.local.set({ feedPanelPosition });
      }, 150);
    });

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
    // Build mute lookup caches
    rebuildMuteCache();

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

    // Observe only <main> for new posts (infinite scroll)
    // Narrower scope avoids self-triggered loops from panel/toast DOM changes
    const mainEl = document.querySelector('main[role="main"]') || document.querySelector("main");
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanPosts();
        injectMuteButtons();
        nudgeScroll();
      }, 300);
    });
    if (mainEl) {
      observer.observe(mainEl, { childList: true, subtree: true });
    } else {
      // Fallback: wait for main to appear, then observe it
      const bodyObs = new MutationObserver(() => {
        const m = document.querySelector('main[role="main"]') || document.querySelector("main");
        if (m) {
          bodyObs.disconnect();
          observer.observe(m, { childList: true, subtree: true });
        }
      });
      bodyObs.observe(document.body, { childList: true, subtree: true });
    }
  });
})();
