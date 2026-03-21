(() => {
  // src/shared/defaults.js
  var SIFT_DEFAULTS = {
    // Feed page
    hidePromoted: true,
    hideSuggested: true,
    hideRecommended: true,
    hideNonConnections: false,
    hideSidebar: true,
    // Jobs page
    sponsorCheckEnabled: true,
    unpaidCheckEnabled: true,
    dimFiltered: false,
    hideFiltered: false,
    skippedCompanies: [],
    skippedTitleKeywords: []
  };
  var SIFT_STATS_DEFAULTS = {
    stats: {
      today: "",
      adsHidden: 0,
      suggestedHidden: 0,
      recommendedHidden: 0,
      strangersHidden: 0,
      jobsFlagged: 0,
      jobsScanned: 0
    },
    statsAllTime: {
      adsHidden: 0,
      suggestedHidden: 0,
      recommendedHidden: 0,
      strangersHidden: 0,
      jobsFlagged: 0,
      jobsScanned: 0
    }
  };

  // src/feed.js
  if (chrome.runtime?.id) {
    let isFeedPage = function() {
      const p = location.pathname;
      return p === "/" || p.startsWith("/feed");
    }, updateFeedDoc = function() {
      for (const iframe of document.querySelectorAll("iframe")) {
        if (iframe.offsetWidth < MIN_FEED_IFRAME_WIDTH) continue;
        try {
          const doc = iframe.contentDocument;
          if (doc && doc.body) {
            feedDoc = doc;
            return;
          }
        } catch (e) {
        }
      }
      feedDoc = document;
    }, loadSettings = function(cb) {
      chrome.storage.local.get({ ...DEFAULTS }, (s) => {
        settings = s;
        cb(s);
      });
    }, nudgeScroll = function() {
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => {
        window.scrollBy(0, 1);
        requestAnimationFrame(() => window.scrollBy(0, -1));
      }, SCROLL_NUDGE_DELAY_MS);
    }, detectPostLabels = function(article) {
      const found = /* @__PURE__ */ new Set();
      for (const el of article.querySelectorAll("span, a, p")) {
        if (el.children.length > 0) continue;
        const t = el.textContent.trim();
        if (POST_TYPE_LABELS.has(t)) {
          found.add(t);
          if (found.size === POST_TYPE_LABELS.size) break;
        }
      }
      return found;
    }, incrementStat = function(key) {
      pendingStats[key] = (pendingStats[key] || 0) + 1;
    }, flushStats = function() {
      const batch = pendingStats;
      pendingStats = {};
      if (Object.keys(batch).length === 0) return;
      const statsDefaults = SIFT_STATS_DEFAULTS;
      chrome.storage.local.get(statsDefaults, (data) => {
        const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        if (data.stats.today !== today) {
          data.stats = { today, adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 };
        }
        for (const [key, count] of Object.entries(batch)) {
          data.stats[key] = (data.stats[key] || 0) + count;
          data.statsAllTime[key] = (data.statsAllTime[key] || 0) + count;
        }
        chrome.storage.local.set(data);
      });
    }, feedMain = function() {
      return feedDoc.querySelector('main[role="main"]') || feedDoc.querySelector("main");
    }, scanPosts = function() {
      if (feedDoc !== document && !feedDoc.defaultView) updateFeedDoc();
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
    }, makeUnfollowBtn = function(article) {
      const btn = feedDoc.createElement("button");
      btn.className = "lj-unfollow-btn";
      btn.title = "Unfollow \u2014 refresh page to clear remaining posts";
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
    }, watchForUnfollowConfirmation = function(article) {
      let checks = 0;
      const interval = setInterval(() => {
        if (++checks > UNFOLLOW_MAX_CHECKS || !article.isConnected) {
          clearInterval(interval);
          return;
        }
        if (article.textContent.includes("You unfollowed")) {
          clearInterval(interval);
          setTimeout(() => {
            article.style.maxHeight = "0";
            article.style.overflow = "hidden";
            article.style.opacity = "0";
            article.style.padding = "0";
            article.style.margin = "0";
            article.style.transition = "max-height 0.3s, opacity 0.2s, padding 0.3s, margin 0.3s";
          }, UNFOLLOW_COLLAPSE_DELAY_MS);
        }
      }, UNFOLLOW_CHECK_INTERVAL_MS);
    }, injectUnfollowButtons = function() {
      const main = feedMain();
      if (!main) return;
      for (const article of main.querySelectorAll('[role="article"]')) {
        if (article.dataset.ljUnfollowAdded) continue;
        article.dataset.ljUnfollowAdded = "1";
        const header = article.querySelector(".update-components-header");
        if (header) {
          const lastText = header.querySelector("span:last-of-type") || header.querySelector("a");
          if (lastText) lastText.insertAdjacentElement("afterend", makeUnfollowBtn(article));
        } else {
          const actor = article.querySelector(".update-components-actor__title");
          if (actor) {
            Object.assign(actor.style, { display: "flex", alignItems: "center", gap: "6px" });
            actor.appendChild(makeUnfollowBtn(article));
          }
        }
      }
    }, toggleFeedPause = function() {
      feedPaused = !feedPaused;
      if (feedPaused) {
        feedDoc.body.classList.remove(
          "lj-hide-promoted",
          "lj-hide-suggested",
          "lj-hide-recommended",
          "lj-hide-non-connections",
          "lj-hide-sidebar"
        );
        showToast("Filters paused (Shift+J to resume)");
      } else {
        applyBodyClasses();
        scanPosts();
        showToast("Filters resumed");
      }
    }, showToast = function(msg, onUndo) {
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
      toastTimer = setTimeout(() => toast.classList.remove("visible"), onUndo ? 5e3 : 1800);
    }, createMiniBadge = function() {
      if (feedDoc.getElementById("lj-mini-badge")) return;
      const badge = feedDoc.createElement("div");
      badge.id = "lj-mini-badge";
      badge.style.cursor = "pointer";
      feedDoc.body.appendChild(badge);
      const tip = feedDoc.createElement("div");
      tip.id = "lj-badge-tip";
      feedDoc.body.appendChild(tip);
      badge.addEventListener("click", () => {
        tip.classList.toggle("visible");
        if (tip.classList.contains("visible")) updateBreakdown();
      });
      feedDoc.addEventListener("click", (e) => {
        if (!badge.contains(e.target) && !tip.contains(e.target)) {
          tip.classList.remove("visible");
        }
      });
      updateBadgeCount();
    }, updateBreakdown = function() {
      const tip = feedDoc.getElementById("lj-badge-tip");
      if (!tip) return;
      const counts = {
        Ads: feedDoc.querySelectorAll('[data-lj-promoted="true"]').length,
        Suggested: feedDoc.querySelectorAll('[data-lj-suggested="true"]').length,
        Recommended: feedDoc.querySelectorAll('[data-lj-recommended="true"]').length,
        Strangers: feedDoc.querySelectorAll('[data-lj-non-connection="true"]').length
      };
      const lines = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => v + " " + k);
      tip.textContent = lines.length > 0 ? lines.join("\n") : "Nothing filtered yet";
    }, updateBadgeCount = function() {
      const badge = feedDoc.getElementById("lj-mini-badge");
      if (!badge) return;
      const count = feedDoc.querySelectorAll('[data-lj-promoted="true"], [data-lj-suggested="true"], [data-lj-recommended="true"], [data-lj-non-connection="true"]').length;
      badge.textContent = count > 0 ? "\u{1F50D} " + count + " filtered" : "\u{1F50D} Sift";
      const tip = feedDoc.getElementById("lj-badge-tip");
      if (tip && tip.classList.contains("visible")) updateBreakdown();
    }, applyBodyClasses = function() {
      feedDoc.body.classList.toggle("lj-hide-promoted", settings.hidePromoted);
      feedDoc.body.classList.toggle("lj-hide-suggested", settings.hideSuggested);
      feedDoc.body.classList.toggle("lj-hide-recommended", settings.hideRecommended);
      feedDoc.body.classList.toggle("lj-hide-non-connections", settings.hideNonConnections);
      feedDoc.body.classList.toggle("lj-hide-sidebar", settings.hideSidebar);
    }, hideSidebarElements = function() {
      feedDoc.querySelectorAll(SIDEBAR_SELECTOR_ALL).forEach((node) => {
        node.style.display = "none";
      });
    }, enforceSidebarHidden = function() {
      if (sidebarInterval) clearInterval(sidebarInterval);
      hideSidebarElements();
      let ticks = 0;
      sidebarInterval = setInterval(() => {
        hideSidebarElements();
        if (++ticks >= SIDEBAR_POLL_MAX_TICKS) clearInterval(sidebarInterval);
      }, SIDEBAR_POLL_INTERVAL_MS);
    }, injectSidebarStyle = function() {
      if (feedDoc.getElementById("lj-sidebar-style")) return;
      const s = feedDoc.createElement("style");
      s.id = "lj-sidebar-style";
      s.textContent = SIDEBAR_SELECTOR_ALL + "{display:none!important}";
      feedDoc.head.appendChild(s);
    }, cleanupSidebarOverrides = function() {
      if (sidebarInterval) {
        clearInterval(sidebarInterval);
        sidebarInterval = null;
      }
      const injected = feedDoc.getElementById("lj-sidebar-style");
      if (injected) injected.remove();
      feedDoc.querySelectorAll(SIDEBAR_SELECTOR_ALL).forEach((node) => {
        node.style.removeProperty("display");
      });
    }, injectFeedCssIntoIframe = function() {
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
        } catch (e) {
        }
      }
    }, setupObserver = function() {
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
        }, OBSERVER_DEBOUNCE_MS);
      });
      if (mainEl) {
        feedObserver.observe(mainEl, { childList: true, subtree: true });
      } else {
        let retries = 0;
        mainPollInterval = setInterval(() => {
          updateFeedDoc();
          const m = feedMain();
          if (m) {
            clearInterval(mainPollInterval);
            feedObserver.observe(m, { childList: true, subtree: true });
            applyFeed();
          }
          if (++retries >= MAIN_POLL_MAX_RETRIES) clearInterval(mainPollInterval);
        }, MAIN_POLL_INTERVAL_MS);
      }
    }, applyShell = function() {
      updateFeedDoc();
      injectFeedCssIntoIframe();
      applyBodyClasses();
      if (settings.hideSidebar) {
        injectSidebarStyle();
        enforceSidebarHidden();
      }
      createMiniBadge();
    }, applyFeed = function() {
      scanPosts();
      injectUnfollowButtons();
      updateBadgeCount();
    }, reapply = function() {
      applyShell();
      applyFeed();
      setupObserver();
    }, boot = function() {
      if (initialized || booting || !isFeedPage()) return;
      booting = true;
      loadSettings(() => {
        initialized = true;
        booting = false;
        reapply();
        startIframeCheck();
      });
    }, startIframeCheck = function() {
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
        if (++ticks >= IFRAME_POLL_MAX_TICKS) clearInterval(iframeCheckInterval);
      }, IFRAME_POLL_INTERVAL_MS);
    };
    "use strict";
    const MIN_FEED_IFRAME_WIDTH = 500;
    const OBSERVER_DEBOUNCE_MS = 300;
    const MAIN_POLL_INTERVAL_MS = 1500;
    const MAIN_POLL_MAX_RETRIES = 20;
    const IFRAME_POLL_INTERVAL_MS = 1e3;
    const IFRAME_POLL_MAX_TICKS = 20;
    const SIDEBAR_POLL_INTERVAL_MS = 2e3;
    const SIDEBAR_POLL_MAX_TICKS = 15;
    const SPA_POLL_INTERVAL_MS = 1e3;
    const UNFOLLOW_CHECK_INTERVAL_MS = 500;
    const UNFOLLOW_MAX_CHECKS = 20;
    const UNFOLLOW_COLLAPSE_DELAY_MS = 1200;
    const SCROLL_NUDGE_DELAY_MS = 400;
    let initialized = false;
    let feedDoc = document;
    const DEFAULTS = SIFT_DEFAULTS;
    const SETTING_KEYS = /* @__PURE__ */ new Set(["hidePromoted", "hideSuggested", "hideRecommended", "hideNonConnections", "hideSidebar"]);
    let settings = { ...DEFAULTS };
    let nudgeTimer = null;
    const POST_TYPE_LABELS = /* @__PURE__ */ new Set([
      "Promoted",
      "Suggested",
      "Recommended for you",
      "Jobs recommended for you",
      "Popular course on LinkedIn Learning"
    ]);
    let pendingStats = {};
    let feedPaused = false;
    document.addEventListener("keydown", (e) => {
      if (e.key === "J" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
        e.preventDefault();
        toggleFeedPause();
      }
    });
    let toastTimer = null;
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
    const SIDEBAR_SELECTORS = [
      'aside[aria-label="LinkedIn News"]',
      '[role="complementary"][aria-label="LinkedIn News"]',
      'footer[aria-label="LinkedIn Footer Content"]',
      '[role="contentinfo"][aria-label="LinkedIn Footer Content"]'
    ];
    const SIDEBAR_SELECTOR_ALL = SIDEBAR_SELECTORS.join(",");
    let sidebarInterval = null;
    let feedObserver = null;
    let mainPollInterval = null;
    let booting = false;
    let iframeCheckInterval = null;
    boot();
    let lastUrl = location.href;
    const urlPollInterval = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        if (isFeedPage()) {
          if (!initialized && !booting) {
            boot();
          } else if (initialized) {
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
    }, SPA_POLL_INTERVAL_MS);
  }
})();
