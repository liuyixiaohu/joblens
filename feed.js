// Sift Feed: filter posts, hide sidebar, mute people/keywords, SPA/iframe-aware
(function () {
  "use strict";

  // After extension reload/update, old content scripts lose chrome API access.
  // Bail out silently to avoid "Cannot read properties of undefined" errors.
  if (!chrome.runtime?.id) return;

  // Load EB Garamond font (non-blocking <link> instead of CSS @import)
  if (!document.querySelector('link[href*="EB+Garamond"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }

  function isFeedPage() {
    const p = location.pathname;
    return p === "/" || p.startsWith("/feed");
  }

  let initialized = false;

  // LinkedIn SPA navigation may render the feed inside a same-origin iframe.
  // Content scripts only run in the top frame, so we detect the iframe and
  // redirect all DOM queries to the correct document via `feedDoc`.
  let feedDoc = document;
  const MIN_FEED_IFRAME_WIDTH = 500;

  function updateFeedDoc() {
    for (const iframe of document.querySelectorAll("iframe")) {
      if (iframe.offsetWidth < MIN_FEED_IFRAME_WIDTH) continue;
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) { feedDoc = doc; return; }
      } catch (e) {}
    }
    feedDoc = document;
  }

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
  const SETTING_KEYS = new Set(Object.keys(DEFAULTS));
  let settings = { ...DEFAULTS };

  function loadSettings(cb) {
    chrome.storage.local.get({ ...DEFAULTS }, (s) => {
      settings = s;
      cb(s);
    });
  }

  function saveList(key) {
    chrome.storage.local.set({ [key]: settings[key] });
  }

  // === Name extraction from feed posts ===

  // Post author: from "Open control menu for post by NAME"
  function getPostAuthor(article) {
    const btn = article.querySelector('button[aria-label*="control menu for post by"]');
    if (!btn) return null;
    const match = btn.getAttribute("aria-label").match(/post by (.+)/i);
    return match ? match[1].trim() : null;
  }

  // Interaction person: "Jane likes this" / "John commented on this"
  function getInteractor(article) {
    const header = article.querySelector(".update-components-header");
    if (!header) return null;
    const text = header.textContent.trim();
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
    }, 400);
  }

  // === Filtering logic ===

  let mutedPeopleSet = new Set();
  let mutedKeywordsLower = [];

  function rebuildMuteCache() {
    mutedPeopleSet = new Set(settings.mutedPeople.map((n) => n.toLowerCase()));
    mutedKeywordsLower = settings.mutedKeywords.map((k) => k.toLowerCase());
  }

  const POST_TYPE_LABELS = new Set([
    "Promoted", "Suggested", "Recommended for you",
    "Jobs recommended for you", "Popular course on LinkedIn Learning",
  ]);

  function detectPostLabels(article) {
    const found = new Set();
    for (const el of article.querySelectorAll("span, a, p")) {
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
    return (author && mutedPeopleSet.has(author.toLowerCase())) ||
           (interactor && mutedPeopleSet.has(interactor.toLowerCase())) || false;
  }

  // textContent avoids layout reflow (unlike innerText). Cache may go stale
  // if LinkedIn expands "see more" — acceptable tradeoff for scan perf.
  const articleTextCache = new WeakMap();

  function isMutedByKeyword(article) {
    if (mutedKeywordsLower.length === 0) return false;
    let text = articleTextCache.get(article);
    if (text === undefined) {
      text = article.textContent.toLowerCase();
      articleTextCache.set(article, text);
    }
    return mutedKeywordsLower.some((kw) => text.includes(kw));
  }

  // === Stats counter (batched to avoid per-post storage I/O) ===
  let pendingStats = {};

  function incrementStat(key) {
    pendingStats[key] = (pendingStats[key] || 0) + 1;
  }

  function flushStats() {
    const batch = pendingStats;
    pendingStats = {};
    if (Object.keys(batch).length === 0) return;
    chrome.storage.local.get({
      stats: { today: "", adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 },
      statsAllTime: { adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 },
    }, (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.stats.today !== today) {
        data.stats = { today, adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 };
      }
      for (const [key, count] of Object.entries(batch)) {
        data.stats[key] = (data.stats[key] || 0) + count;
        data.statsAllTime[key] = (data.statsAllTime[key] || 0) + count;
      }
      chrome.storage.local.set(data);
    });
  }

  function feedMain() {
    return feedDoc.querySelector('main[role="main"]') || feedDoc.querySelector("main");
  }

  // Scan and tag all posts, then flush stats in a single storage write
  function scanPosts() {
    const main = feedMain();
    if (!main) return;
    const articles = main.querySelectorAll('[role="article"]');
    for (const article of articles) {
      if (!article.dataset.ljTypeChecked) {
        article.dataset.ljTypeChecked = "1";
        const labels = detectPostLabels(article);
        if (labels.has("Promoted")) {
          article.dataset.ljPromoted = "true";
          if (settings.hidePromoted) incrementStat("adsHidden");
        }
        if (labels.has("Suggested")) {
          article.dataset.ljSuggested = "true";
          if (settings.hideSuggested) incrementStat("suggestedHidden");
        }
        if (labels.has("Recommended for you") || labels.has("Jobs recommended for you") || labels.has("Popular course on LinkedIn Learning")) {
          article.dataset.ljRecommended = "true";
          if (settings.hideRecommended) incrementStat("recommendedHidden");
        }
        const hasFollow = !!article.querySelector('button[aria-label*="Follow"]');
        const hasHeader = !!article.querySelector(".update-components-header");
        if (hasFollow && !hasHeader) {
          article.dataset.ljNonConnection = "true";
          if (settings.hideNonConnections) incrementStat("strangersHidden");
        }
      }
      const wasMuted = article.dataset.ljMuted === "true";
      if (isMutedByPerson(article) || isMutedByKeyword(article)) {
        if (!wasMuted) incrementStat("postsMuted");
        article.dataset.ljMuted = "true";
      } else {
        delete article.dataset.ljMuted;
      }
    }
    flushStats();
  }

  // === Force Recent sort ===

  function switchToRecent() {
    const svg = feedDoc.querySelector('[aria-label="Sort order dropdown button"]');
    const sortBtn = svg && svg.closest("button");
    if (!sortBtn) return;
    if (sortBtn.textContent.replace(/\s+/g, " ").includes("Recent")) return;
    sortBtn.click();
    setTimeout(() => {
      const items = feedDoc.querySelectorAll(".artdeco-dropdown__item");
      for (const item of items) {
        if (item.textContent.trim() === "Recent") { item.click(); break; }
      }
    }, 200);
  }

  // === Mute button injection on posts ===

  function makeMuteBtn(name, article) {
    const btn = feedDoc.createElement("button");
    btn.className = "lj-mute-btn";
    btn.title = "Mute " + name;
    btn.textContent = "Mute";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      addMutedPerson(name, article);
    });
    return btn;
  }

  function injectMuteBtnInto(container, name, article) {
    if (!container) return;
    Object.assign(container.style, { display: "flex", alignItems: "center", gap: "6px" });
    container.appendChild(makeMuteBtn(name, article));
  }

  function injectMuteButtons() {
    const main = feedMain();
    if (!main) return;
    for (const article of main.querySelectorAll('[role="article"]')) {
      if (article.dataset.ljMuteBtnAdded) continue;
      article.dataset.ljMuteBtnAdded = "1";
      const author = getPostAuthor(article);
      if (author) injectMuteBtnInto(article.querySelector(".update-components-actor__title"), author, article);
      const interactor = getInteractor(article);
      if (interactor) injectMuteBtnInto(article.querySelector(".update-components-header"), interactor, article);
    }
  }

  // Open the post's "..." menu so the user can click Unfollow themselves
  function openPostMenu(article) {
    if (!article) return;
    // Temporarily un-hide the post so the menu can render
    const wasMuted = article.dataset.ljMuted;
    article.dataset.ljMuted = "paused";
    article.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      const menuBtn = article.querySelector('button[aria-label*="control menu"]');
      if (menuBtn) menuBtn.click();
      // Re-hide after user has had time to interact with the dropdown
      setTimeout(() => {
        if (article.dataset.ljMuted === "paused") article.dataset.ljMuted = wasMuted || "true";
      }, 8000);
    }, 300);
  }

  function addMutedPerson(name, article) {
    if (settings.mutedPeople.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    settings.mutedPeople.push(name);
    saveList("mutedPeople");
    rebuildMuteCache();
    scanPosts();
    nudgeScroll();
    showToast(
      "Muted " + name,
      () => removeMutedPerson(name),
      article ? () => openPostMenu(article) : null,
    );
  }

  function removeMutedPerson(name) {
    settings.mutedPeople = settings.mutedPeople.filter((n) => n.toLowerCase() !== name.toLowerCase());
    saveList("mutedPeople");
    rebuildMuteCache();
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
      scanPosts();
      nudgeScroll();
      showToast(added === 1 ? "Added keyword" : "Added " + added + " keywords");
    }
  }

  function removeMutedKeyword(kw) {
    settings.mutedKeywords = settings.mutedKeywords.filter((k) => k.toLowerCase() !== kw.toLowerCase());
    saveList("mutedKeywords");
    rebuildMuteCache();
    scanPosts();
  }

  // === Context menu message handler ===
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "lj-context-menu" || !isFeedPage()) return;
    if (msg.action === "mutePerson") addMutedPerson(msg.text);
    else if (msg.action === "muteKeyword") addMutedKeyword(msg.text);
  });

  // === Keyboard shortcut: Shift+J to pause/resume feed filters ===
  let feedPaused = false;

  function toggleFeedPause() {
    feedPaused = !feedPaused;
    if (feedPaused) {
      feedDoc.body.classList.remove(
        "lj-hide-promoted", "lj-hide-suggested",
        "lj-hide-recommended", "lj-hide-non-connections", "lj-hide-sidebar"
      );
      // Un-mute all posts temporarily
      for (const el of feedDoc.querySelectorAll('[data-lj-muted="true"]')) {
        el.dataset.ljMuted = "paused";
      }
      showToast("Filters paused (Shift+J to resume)");
    } else {
      applyBodyClasses();
      for (const el of feedDoc.querySelectorAll('[data-lj-muted="paused"]')) {
        el.dataset.ljMuted = "true";
      }
      scanPosts();
      showToast("Filters resumed");
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "J" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Don't trigger when typing in inputs
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      e.preventDefault();
      toggleFeedPause();
    }
  });

  // === Toast notification (with optional undo action) ===
  let toastTimer = null;

  function showToast(msg, onUndo, onUnfollow) {
    let toast = feedDoc.getElementById("lj-feed-toast");
    if (!toast) {
      toast = feedDoc.createElement("div");
      toast.id = "lj-feed-toast";
      feedDoc.body.appendChild(toast);
    }
    clearTimeout(toastTimer);
    toast.innerHTML = "";
    toast.appendChild(feedDoc.createTextNode(msg));
    if (onUndo) {
      const btn = feedDoc.createElement("button");
      btn.id = "lj-toast-undo";
      btn.textContent = "Undo";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onUndo();
        toast.classList.remove("visible");
      });
      toast.appendChild(btn);
    }
    if (onUnfollow) {
      const btn = feedDoc.createElement("button");
      btn.id = "lj-toast-unfollow";
      btn.textContent = "Unfollow";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onUnfollow();
        toast.classList.remove("visible");
      });
      toast.appendChild(btn);
    }
    const hasActions = onUndo || onUnfollow;
    toast.classList.add("visible");
    toastTimer = setTimeout(() => toast.classList.remove("visible"), hasActions ? 5000 : 1800);
  }

  // === Mini status badge (clickable with breakdown) ===
  function createMiniBadge() {
    if (feedDoc.getElementById("lj-mini-badge")) return;
    const badge = feedDoc.createElement("div");
    badge.id = "lj-mini-badge";
    badge.style.cursor = "pointer";
    feedDoc.body.appendChild(badge);

    // Breakdown tooltip
    const tip = feedDoc.createElement("div");
    tip.id = "lj-badge-tip";
    feedDoc.body.appendChild(tip);

    badge.addEventListener("click", () => {
      tip.classList.toggle("visible");
      if (tip.classList.contains("visible")) updateBreakdown();
    });

    // Close on click outside
    feedDoc.addEventListener("click", (e) => {
      if (!badge.contains(e.target) && !tip.contains(e.target)) {
        tip.classList.remove("visible");
      }
    });

    updateBadgeCount();
  }

  function updateBreakdown() {
    const tip = feedDoc.getElementById("lj-badge-tip");
    if (!tip) return;
    const counts = {
      Ads: feedDoc.querySelectorAll('[data-lj-promoted="true"]').length,
      Suggested: feedDoc.querySelectorAll('[data-lj-suggested="true"]').length,
      Recommended: feedDoc.querySelectorAll('[data-lj-recommended="true"]').length,
      Strangers: feedDoc.querySelectorAll('[data-lj-non-connection="true"]').length,
      Muted: feedDoc.querySelectorAll('[data-lj-muted="true"]').length,
    };
    const lines = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => v + " " + k);
    tip.textContent = lines.length > 0 ? lines.join("\n") : "Nothing filtered yet";
  }

  function updateBadgeCount() {
    const badge = feedDoc.getElementById("lj-mini-badge");
    if (!badge) return;
    const count = feedDoc.querySelectorAll('[data-lj-promoted="true"], [data-lj-suggested="true"], [data-lj-recommended="true"], [data-lj-non-connection="true"], [data-lj-muted="true"]').length;
    badge.textContent = count > 0 ? "\uD83D\uDD0D " + count + " filtered" : "\uD83D\uDD0D Sift";
    // Also update breakdown if visible
    const tip = feedDoc.getElementById("lj-badge-tip");
    if (tip && tip.classList.contains("visible")) updateBreakdown();
  }

  function applyBodyClasses() {
    feedDoc.body.classList.toggle("lj-hide-promoted", settings.hidePromoted);
    feedDoc.body.classList.toggle("lj-hide-suggested", settings.hideSuggested);
    feedDoc.body.classList.toggle("lj-hide-recommended", settings.hideRecommended);
    feedDoc.body.classList.toggle("lj-hide-non-connections", settings.hideNonConnections);
    feedDoc.body.classList.toggle("lj-hide-sidebar", settings.hideSidebar);
  }

  // Only re-scan when actual settings change, not stats writes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!Object.keys(changes).some((k) => SETTING_KEYS.has(k))) return;
    loadSettings((s) => {
      applyBodyClasses();
      if (s.hideSidebar) enforceSidebarHidden();
      else cleanupSidebarOverrides();
      rebuildMuteCache();
      scanPosts();
      updateBadgeCount();
      if (s.forceRecent) switchToRecent();
    });
  });

  // === Sidebar enforcement ===
  // CSS body class is the primary mechanism; JS polling is the fallback
  // for async rendering after SPA navigation.
  const SIDEBAR_SELECTORS = [
    'aside[aria-label="LinkedIn News"]',
    '[role="complementary"][aria-label="LinkedIn News"]',
    'footer[aria-label="LinkedIn Footer Content"]',
    '[role="contentinfo"][aria-label="LinkedIn Footer Content"]',
  ];
  const SIDEBAR_SELECTOR_ALL = SIDEBAR_SELECTORS.join(",");
  let sidebarInterval = null;

  function hideSidebarElements() {
    feedDoc.querySelectorAll(SIDEBAR_SELECTOR_ALL).forEach((node) => {
      node.style.display = "none";
    });
  }

  function enforceSidebarHidden() {
    if (sidebarInterval) clearInterval(sidebarInterval);
    hideSidebarElements();
    let ticks = 0;
    sidebarInterval = setInterval(() => {
      hideSidebarElements();
      if (++ticks >= 15) clearInterval(sidebarInterval);
    }, 2000);
  }

  function injectSidebarStyle() {
    if (feedDoc.getElementById("lj-sidebar-style")) return;
    const s = feedDoc.createElement("style");
    s.id = "lj-sidebar-style";
    s.textContent = SIDEBAR_SELECTOR_ALL + "{display:none!important}";
    feedDoc.head.appendChild(s);
  }

  // Remove JS-injected sidebar overrides so the CSS toggle can work
  function cleanupSidebarOverrides() {
    if (sidebarInterval) { clearInterval(sidebarInterval); sidebarInterval = null; }
    const injected = feedDoc.getElementById("lj-sidebar-style");
    if (injected) injected.remove();
    feedDoc.querySelectorAll(SIDEBAR_SELECTOR_ALL).forEach((node) => {
      node.style.removeProperty("display");
    });
  }

  // === Inject feed.css into iframe (extension CSS doesn't load there) ===
  function injectFeedCssIntoIframe() {
    if (feedDoc === document) return;
    if (feedDoc.getElementById("lj-feed-css")) return;
    for (const sheet of document.styleSheets) {
      try {
        if (!sheet.href || !sheet.href.includes("feed.css")) continue;
        const rules = [...sheet.cssRules].map((r) => r.cssText).join("\n");
        const style = feedDoc.createElement("style");
        style.id = "lj-feed-css";
        style.textContent = rules;
        feedDoc.head.appendChild(style);
        return;
      } catch (e) {}
    }
  }

  // === MutationObserver on <main> for infinite scroll ===
  let feedObserver = null;
  let mainPollInterval = null;

  function setupObserver() {
    if (feedObserver) feedObserver.disconnect();
    if (mainPollInterval) clearInterval(mainPollInterval);

    const mainEl = feedMain();
    let debounceTimer = null;
    feedObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanPosts();
        injectMuteButtons();
        updateBadgeCount();
        nudgeScroll();
      }, 300);
    });

    if (mainEl) {
      feedObserver.observe(mainEl, { childList: true, subtree: true });
    } else {
      // Poll for <main> to appear — avoids body MutationObserver which
      // freezes LinkedIn due to heavy DOM activity (see project memory).
      let retries = 0;
      mainPollInterval = setInterval(() => {
        const m = feedMain();
        if (m) {
          clearInterval(mainPollInterval);
          feedObserver.observe(m, { childList: true, subtree: true });
          scanPosts();
          injectMuteButtons();
          updateBadgeCount();
        }
        if (++retries >= 15) clearInterval(mainPollInterval);
      }, 2000);
    }
  }

  // === Re-apply all features (used after iframe detection or SPA navigation) ===
  function reapply() {
    updateFeedDoc();
    injectFeedCssIntoIframe();
    applyBodyClasses();
    if (settings.hideSidebar) { injectSidebarStyle(); enforceSidebarHidden(); }
    scanPosts();
    injectMuteButtons();
    createMiniBadge();
    updateBadgeCount();
    setupObserver();
    if (settings.forceRecent) switchToRecent();
  }

  // === Init ===
  function boot() {
    if (initialized || !isFeedPage()) return;
    initialized = true;

    loadSettings(() => {
      rebuildMuteCache();
      reapply();
      // Iframe may not be ready yet on initial load — poll for it
      startIframeCheck();
    });
  }

  // === Periodic iframe detection ===
  // After SPA navigation, the iframe may take a moment to load content.
  let iframeCheckInterval = null;

  function startIframeCheck() {
    if (iframeCheckInterval) clearInterval(iframeCheckInterval);
    let ticks = 0;
    iframeCheckInterval = setInterval(() => {
      const prevDoc = feedDoc;
      updateFeedDoc();
      if (feedDoc !== prevDoc) {
        reapply();
        clearInterval(iframeCheckInterval);
        return;
      }
      if (++ticks >= 10) clearInterval(iframeCheckInterval);
    }, 1000);
  }

  // Boot immediately if on feed page
  boot();

  // SPA navigation detector — URL polling because LinkedIn intercepts
  // pushState/popstate and doesn't fire standard navigation events.
  let lastUrl = location.href;
  const urlPollInterval = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isFeedPage()) {
        if (!initialized) {
          boot();
        } else {
          reapply();
          startIframeCheck();
        }
      } else {
        initialized = false;
        feedDoc = document;
        if (sidebarInterval) clearInterval(sidebarInterval);
        if (iframeCheckInterval) clearInterval(iframeCheckInterval);
        if (mainPollInterval) clearInterval(mainPollInterval);
        if (feedObserver) feedObserver.disconnect();
      }
    }
  }, 1000);
})();
