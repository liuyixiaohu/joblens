// Sift Feed: filter posts, hide sidebar, unfollow, SPA/iframe-aware
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
    hideSidebar: true,
  };
  const SETTING_KEYS = new Set(Object.keys(DEFAULTS));
  let settings = { ...DEFAULTS };

  function loadSettings(cb) {
    chrome.storage.local.get({ ...DEFAULTS }, (s) => {
      settings = s;
      cb(s);
    });
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
      stats: { today: "", adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 },
      statsAllTime: { adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 },
    }, (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.stats.today !== today) {
        data.stats = { today, adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 };
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
    }
    flushStats();
  }

  // === Unfollow button injection on posts ===

  function makeUnfollowBtn(article) {
    const btn = feedDoc.createElement("button");
    btn.className = "lj-unfollow-btn";
    btn.title = "Open menu to unfollow";
    btn.textContent = "Unfollow";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const menuBtn = article.querySelector('button[aria-label*="control menu"]');
      if (menuBtn) {
        menuBtn.click();
        watchForUnfollowConfirmation(article);
      }
    });
    return btn;
  }

  // After user clicks Unfollow from LinkedIn's dropdown menu, LinkedIn shows
  // an inline confirmation card ("You unfollowed X"). Auto-collapse it after
  // a brief moment so it doesn't clutter the feed.
  function watchForUnfollowConfirmation(article) {
    let checks = 0;
    const interval = setInterval(() => {
      if (++checks > 20) { clearInterval(interval); return; }
      // LinkedIn replaces the post content with "You unfollowed ..."
      if (article.textContent.includes("You unfollowed")) {
        clearInterval(interval);
        setTimeout(() => {
          article.style.maxHeight = "0";
          article.style.overflow = "hidden";
          article.style.opacity = "0";
          article.style.padding = "0";
          article.style.margin = "0";
          article.style.transition = "max-height 0.3s, opacity 0.2s, padding 0.3s, margin 0.3s";
        }, 1200);
      }
    }, 500);
  }

  function injectUnfollowButtons() {
    const main = feedMain();
    if (!main) return;
    for (const article of main.querySelectorAll('[role="article"]')) {
      if (article.dataset.ljUnfollowAdded) continue;
      article.dataset.ljUnfollowAdded = "1";
      const header = article.querySelector(".update-components-header");
      if (header) {
        // Interaction post ("X likes this") — the ... menu unfollows the
        // interactor, so place the button right after the name link.
        // Append after all text content (e.g. "Paras Dhillon reposted this [Unfollow]")
        const lastText = header.querySelector("span:last-of-type") || header.querySelector("a");
        if (lastText) lastText.insertAdjacentElement("afterend", makeUnfollowBtn(article));
      } else {
        // Direct post — the ... menu unfollows the author.
        const actor = article.querySelector(".update-components-actor__title");
        if (actor) {
          Object.assign(actor.style, { display: "flex", alignItems: "center", gap: "6px" });
          actor.appendChild(makeUnfollowBtn(article));
        }
      }
    }
  }

  // === Keyboard shortcut: Shift+J to pause/resume feed filters ===
  let feedPaused = false;

  function toggleFeedPause() {
    feedPaused = !feedPaused;
    if (feedPaused) {
      feedDoc.body.classList.remove(
        "lj-hide-promoted", "lj-hide-suggested",
        "lj-hide-recommended", "lj-hide-non-connections", "lj-hide-sidebar"
      );
      showToast("Filters paused (Shift+J to resume)");
    } else {
      applyBodyClasses();
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

  function showToast(msg, onUndo) {
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
    toast.classList.add("visible");
    toastTimer = setTimeout(() => toast.classList.remove("visible"), onUndo ? 5000 : 1800);
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
    };
    const lines = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => v + " " + k);
    tip.textContent = lines.length > 0 ? lines.join("\n") : "Nothing filtered yet";
  }

  function updateBadgeCount() {
    const badge = feedDoc.getElementById("lj-mini-badge");
    if (!badge) return;
    const count = feedDoc.querySelectorAll('[data-lj-promoted="true"], [data-lj-suggested="true"], [data-lj-recommended="true"], [data-lj-non-connection="true"]').length;
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
      scanPosts();
      updateBadgeCount();
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
        injectUnfollowButtons();
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
          injectUnfollowButtons();
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
    injectUnfollowButtons();
    createMiniBadge();
    updateBadgeCount();
    setupObserver();
  }

  // === Init ===
  function boot() {
    if (initialized || !isFeedPage()) return;
    initialized = true;

    loadSettings(() => {
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
