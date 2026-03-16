// JobLens Feed: hide ads, sidebar, muted people & keywords
(function () {
  "use strict";

  function isFeedPage() {
    const p = location.pathname;
    return p === "/" || p.startsWith("/feed");
  }

  let initialized = false;

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

  // === Mini status badge ===
  function createMiniBadge() {
    const badge = document.createElement("div");
    badge.id = "lj-mini-badge";
    document.body.appendChild(badge);
    updateBadgeCount();
  }

  function updateBadgeCount() {
    const badge = document.getElementById("lj-mini-badge");
    if (!badge) return;
    const count = document.querySelectorAll('[data-lj-promoted="true"], [data-lj-suggested="true"], [data-lj-recommended="true"], [data-lj-non-connection="true"], [data-lj-muted="true"]').length;
    badge.textContent = count > 0 ? "\uD83D\uDD0D " + count + " filtered" : "\uD83D\uDD0D JobLens";
    badge.style.display = count > 0 ? "" : "";
  }

  // === Listen for settings changes from Popup ===
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // Re-read all settings and re-apply
    loadSettings((s) => {
      document.body.classList.toggle("lj-hide-promoted", s.hidePromoted);
      document.body.classList.toggle("lj-hide-suggested", s.hideSuggested);
      document.body.classList.toggle("lj-hide-recommended", s.hideRecommended);
      document.body.classList.toggle("lj-hide-non-connections", s.hideNonConnections);
      document.body.classList.toggle("lj-hide-sidebar", s.hideSidebar);
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
      document.querySelectorAll(sel).forEach(node => {
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

  // === Init ===
  function boot() {
    if (initialized || !isFeedPage()) return;
    initialized = true;

    loadSettings(() => {
      // Build mute lookup caches
      rebuildMuteCache();

      // Apply saved toggle states
      if (settings.hidePromoted) document.body.classList.add("lj-hide-promoted");
      if (settings.hideSuggested) document.body.classList.add("lj-hide-suggested");
      if (settings.hideRecommended) document.body.classList.add("lj-hide-recommended");
      if (settings.hideNonConnections) document.body.classList.add("lj-hide-non-connections");
      if (settings.hideSidebar) document.body.classList.add("lj-hide-sidebar");

      // Actively hide sidebar elements via JS (CSS class alone may not survive SPA navigation)
      // Also inject inline <style> as backup in case external CSS didn't survive SPA nav
      if (settings.hideSidebar) {
        if (!document.getElementById("lj-sidebar-style")) {
          const s = document.createElement("style");
          s.id = "lj-sidebar-style";
          s.textContent = SIDEBAR_SELECTORS.map(sel => sel + "{display:none!important}").join("\n");
          document.head.appendChild(s);
        }
        enforceSidebarHidden();
      }

      // Initial scan
      scanPosts();
      injectMuteButtons();

      // Create mini badge
      createMiniBadge();

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
          updateBadgeCount();
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
  }

  // Boot immediately if on feed page, otherwise poll for SPA navigation
  boot();
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isFeedPage()) {
        if (!initialized) {
          boot();
        } else {
          // Already initialized but navigated back to feed — re-enforce sidebar
          if (settings.hideSidebar) {
            document.body.classList.add("lj-hide-sidebar");
            enforceSidebarHidden();
          }
        }
      } else {
        // Left the feed page — reset so boot() runs again when returning
        initialized = false;
        if (sidebarInterval) clearInterval(sidebarInterval);
      }
    }
  }, 1000);
})();
