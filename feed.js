// JobLens Feed: hide ads, sidebar, muted people & keywords
(function () {
  "use strict";

  function isFeedPage() {
    const p = location.pathname;
    return p === "/" || p.startsWith("/feed");
  }

  let initialized = false;

  // === Iframe-aware document access ===
  // LinkedIn SPA navigation may render feed inside a same-origin iframe.
  // Content scripts only run in the top frame, so we reach into the iframe.
  let feedDoc = document;

  function findFeedDoc() {
    for (const iframe of document.querySelectorAll("iframe")) {
      if (iframe.offsetWidth < 500) continue;
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) {
          feedDoc = doc;
          return;
        }
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

  // === Stats counter ===
  function incrementStat(key) {
    chrome.storage.local.get({ stats: { today: "", adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 }, statsAllTime: { adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 } }, (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.stats.today !== today) {
        data.stats = { today, adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 };
      }
      data.stats[key] = (data.stats[key] || 0) + 1;
      data.statsAllTime[key] = (data.statsAllTime[key] || 0) + 1;
      chrome.storage.local.set(data);
    });
  }

  // Helper: find the <main> element in the active feed document
  function feedMain() {
    return feedDoc.querySelector('main[role="main"]') || feedDoc.querySelector("main");
  }

  // Scan and tag all posts
  function scanPosts() {
    const main = feedMain();
    if (!main) return;
    const articles = main.querySelectorAll('[role="article"]');
    for (const article of articles) {
      // Tag post type (once per post — labels are stable)
      if (!article.dataset.ljTypeChecked) {
        article.dataset.ljTypeChecked = "1";
        const labels = detectPostLabels(article);
        if (labels.has("Promoted")) {
          article.dataset.ljPromoted = "true";
          incrementStat("adsHidden");
        }
        if (labels.has("Suggested")) {
          article.dataset.ljSuggested = "true";
          incrementStat("suggestedHidden");
        }
        if (labels.has("Recommended for you") || labels.has("Jobs recommended for you") || labels.has("Popular course on LinkedIn Learning")) {
          article.dataset.ljRecommended = "true";
          incrementStat("recommendedHidden");
        }
        // Non-connection: has Follow button and no interaction header
        const hasFollow = !!article.querySelector('button[aria-label*="Follow"]');
        const hasHeader = !!article.querySelector(".update-components-header");
        if (hasFollow && !hasHeader) {
          article.dataset.ljNonConnection = "true";
          incrementStat("strangersHidden");
        }
      }
      // Tag muted (re-check on every scan since lists can change)
      const wasMuted = article.dataset.ljMuted === "true";
      if (isMutedByPerson(article) || isMutedByKeyword(article)) {
        if (!wasMuted) incrementStat("postsMuted");
        article.dataset.ljMuted = "true";
      } else {
        delete article.dataset.ljMuted;
      }
    }
  }

  // === Force Recent sort ===

  function switchToRecent() {
    // Open the sort dropdown, then click "Recent"
    const svg = feedDoc.querySelector('[aria-label="Sort order dropdown button"]');
    const sortBtn = svg && svg.closest("button");
    if (!sortBtn) return;
    // Already on Recent? Skip
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

  function makeMuteBtn(name) {
    const btn = feedDoc.createElement("button");
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
    const main = feedMain();
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
    scanPosts();
    nudgeScroll();
    showToast("Muted " + name);
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
      if (added > 1) showToast("Added " + added + " keywords");
    }
  }

  function removeMutedKeyword(kw) {
    settings.mutedKeywords = settings.mutedKeywords.filter((k) => k.toLowerCase() !== kw.toLowerCase());
    saveList("mutedKeywords");
    rebuildMuteCache();
    scanPosts();
  }

  // === Toast notification ===
  function showToast(msg) {
    let toast = feedDoc.getElementById("lj-feed-toast");
    if (!toast) {
      toast = feedDoc.createElement("div");
      toast.id = "lj-feed-toast";
      feedDoc.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 1800);
  }

  // === Mini status badge ===
  function createMiniBadge() {
    if (feedDoc.getElementById("lj-mini-badge")) return;
    const badge = feedDoc.createElement("div");
    badge.id = "lj-mini-badge";
    feedDoc.body.appendChild(badge);
    updateBadgeCount();
  }

  function updateBadgeCount() {
    const badge = feedDoc.getElementById("lj-mini-badge");
    if (!badge) return;
    const count = feedDoc.querySelectorAll('[data-lj-promoted="true"], [data-lj-suggested="true"], [data-lj-recommended="true"], [data-lj-non-connection="true"], [data-lj-muted="true"]').length;
    badge.textContent = count > 0 ? "\uD83D\uDD0D " + count + " filtered" : "\uD83D\uDD0D JobLens";
  }

  // === Apply body classes to the feed document ===
  function applyBodyClasses() {
    feedDoc.body.classList.toggle("lj-hide-promoted", settings.hidePromoted);
    feedDoc.body.classList.toggle("lj-hide-suggested", settings.hideSuggested);
    feedDoc.body.classList.toggle("lj-hide-recommended", settings.hideRecommended);
    feedDoc.body.classList.toggle("lj-hide-non-connections", settings.hideNonConnections);
    feedDoc.body.classList.toggle("lj-hide-sidebar", settings.hideSidebar);
  }

  // === Listen for settings changes from Popup ===
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // Re-read all settings and re-apply
    loadSettings((s) => {
      applyBodyClasses();
      if (s.hideSidebar) enforceSidebarHidden();
      rebuildMuteCache();
      scanPosts();
      updateBadgeCount();
      if (s.forceRecent) switchToRecent();
    });
  });

  // === Sidebar enforcement via JS (complement to CSS for SPA navigation) ===
  const SIDEBAR_SELECTORS = [
    'aside[aria-label="LinkedIn News"]',
    '[role="complementary"][aria-label="LinkedIn News"]',
    'footer[aria-label="LinkedIn Footer Content"]',
    '[role="contentinfo"][aria-label="LinkedIn Footer Content"]',
  ];
  let sidebarInterval = null;

  function hideSidebarElements() {
    let hidden = 0;
    SIDEBAR_SELECTORS.forEach(sel => {
      feedDoc.querySelectorAll(sel).forEach(node => {
        if (node.style.display !== "none") {
          node.style.display = "none";
          hidden++;
        }
      });
    });
    return hidden;
  }

  function enforceSidebarHidden() {
    // Clear any previous enforcement interval
    if (sidebarInterval) clearInterval(sidebarInterval);
    // Poll every 2s for 30s — lightweight alternative to body MutationObserver
    // LinkedIn renders sidebar asynchronously after SPA navigation
    hideSidebarElements();
    let ticks = 0;
    sidebarInterval = setInterval(() => {
      hideSidebarElements();
      ticks++;
      if (ticks >= 15) clearInterval(sidebarInterval); // stop after 30s
    }, 2000);
  }

  // === Inject inline <style> into feedDoc for sidebar hiding ===
  function injectSidebarStyle() {
    if (!feedDoc.getElementById("lj-sidebar-style")) {
      const s = feedDoc.createElement("style");
      s.id = "lj-sidebar-style";
      s.textContent = SIDEBAR_SELECTORS.map(sel => sel + "{display:none!important}").join("\n");
      feedDoc.head.appendChild(s);
    }
  }

  // === Inject feed.css into iframe (it won't have extension CSS) ===
  function injectFeedCssIntoIframe() {
    if (feedDoc === document) return; // not in iframe
    if (feedDoc.getElementById("lj-feed-css")) return; // already injected
    // Copy all feed.css rules from the top frame's extension stylesheet
    for (const sheet of document.styleSheets) {
      try {
        if (!sheet.href || !sheet.href.includes("feed.css")) continue;
        const rules = [...sheet.cssRules].map(r => r.cssText).join("\n");
        const style = feedDoc.createElement("style");
        style.id = "lj-feed-css";
        style.textContent = rules;
        feedDoc.head.appendChild(style);
        return;
      } catch (e) {}
    }
  }

  // === Set up MutationObserver on the feed's <main> element ===
  let feedObserver = null;

  function setupObserver() {
    // Disconnect previous observer if any
    if (feedObserver) feedObserver.disconnect();

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
      // Fallback: wait for main to appear, then observe it
      const target = feedDoc === document ? document.body : feedDoc.body;
      if (!target) return;
      const bodyObs = new MutationObserver(() => {
        const m = feedMain();
        if (m) {
          bodyObs.disconnect();
          feedObserver.observe(m, { childList: true, subtree: true });
        }
      });
      bodyObs.observe(target, { childList: true, subtree: true });
    }
  }

  // === Init ===
  function boot() {
    if (initialized || !isFeedPage()) return;
    initialized = true;

    loadSettings(() => {
      // Build mute lookup caches
      rebuildMuteCache();

      // Find the active feed document (top frame or iframe)
      findFeedDoc();

      // If feed is in an iframe, inject our CSS into it
      injectFeedCssIntoIframe();

      // Apply saved toggle states
      applyBodyClasses();

      // Sidebar hiding: inline style + JS enforcement
      if (settings.hideSidebar) {
        injectSidebarStyle();
        enforceSidebarHidden();
      }

      // Initial scan
      scanPosts();
      injectMuteButtons();

      // Create mini badge
      createMiniBadge();

      // Switch to Recent sort if enabled
      if (settings.forceRecent) switchToRecent();

      // Observe feed's <main> for new posts (infinite scroll)
      setupObserver();
    });
  }

  // === Periodic iframe detection ===
  // After SPA navigation, the iframe may take a moment to load content.
  // This polls for iframe content and re-applies features when found.
  let iframeCheckInterval = null;

  function startIframeCheck() {
    if (iframeCheckInterval) clearInterval(iframeCheckInterval);
    let ticks = 0;
    iframeCheckInterval = setInterval(() => {
      const prevDoc = feedDoc;
      findFeedDoc();
      if (feedDoc !== prevDoc) {
        // Iframe appeared or changed — re-apply everything
        injectFeedCssIntoIframe();
        applyBodyClasses();
        if (settings.hideSidebar) {
          injectSidebarStyle();
          enforceSidebarHidden();
        }
        scanPosts();
        injectMuteButtons();
        createMiniBadge();
        updateBadgeCount();
        setupObserver();
        if (settings.forceRecent) switchToRecent();
        clearInterval(iframeCheckInterval);
      }
      ticks++;
      if (ticks >= 10) clearInterval(iframeCheckInterval); // stop after 10s
    }, 1000);
  }

  // Boot immediately if on feed page, otherwise poll for SPA navigation
  boot();
  // After initial boot, also check for iframe (content may not be ready yet)
  if (initialized) startIframeCheck();

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isFeedPage()) {
        if (!initialized) {
          boot();
          startIframeCheck();
        } else {
          // Already initialized but navigated back to feed — re-apply
          findFeedDoc();
          injectFeedCssIntoIframe();
          applyBodyClasses();
          if (settings.hideSidebar) {
            injectSidebarStyle();
            enforceSidebarHidden();
          }
          startIframeCheck();
        }
      } else {
        // Left the feed page — reset so boot() runs again when returning
        initialized = false;
        feedDoc = document;
        if (sidebarInterval) clearInterval(sidebarInterval);
        if (iframeCheckInterval) clearInterval(iframeCheckInterval);
        if (feedObserver) feedObserver.disconnect();
      }
    }
  }, 1000);
})();
