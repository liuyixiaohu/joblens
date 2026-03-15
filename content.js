(function () {
  "use strict";

  const NO_SPONSOR_KEYWORDS = [
    "does not sponsor", "do not sponsor", "not sponsor",
    "no sponsorship", "unable to sponsor", "will not sponsor",
    "cannot sponsor", "won't sponsor", "can't sponsor",
    "doesn't sponsor", "not able to sponsor", "without sponsorship",
    "sponsorship is not available", "not offer sponsorship",
    "not provide sponsorship", "sponsorship not available",
    "not eligible for sponsorship", "no visa sponsorship",
    "not offering sponsorship", "unable to provide sponsorship",
    "we are unable to sponsor", "we do not offer sponsorship",
    "must be authorized to work", "must have authorization to work",
    "without the need for sponsorship", "without requiring sponsorship",
  ];
  function keywordsToRegex(keywords) {
    return new RegExp(keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  }
  const NO_SPONSOR_RE = keywordsToRegex(NO_SPONSOR_KEYWORDS);

  const UNPAID_KEYWORDS = [
    "unpaid", "unpaid internship", "unpaid position",
    "no compensation", "without compensation", "uncompensated",
    "volunteer position", "volunteer opportunity", "volunteer role",
    "pro bono", "this is a volunteer",
  ];
  const UNPAID_RE = keywordsToRegex(UNPAID_KEYWORDS);

  // Badge display names and colors
  const BADGE_DISPLAY = {
    reposted: "Reposted", applied: "Applied", noSponsor: "No Sponsor",
    skippedCompany: "Skipped Co.", skippedTitle: "Skipped Title",
    unpaid: "Unpaid",
  };
  const BADGE_COLOR = "#D9797B";
  // Border color priority (first matching reason determines border color)
  const BORDER_PRIORITY = ["noSponsor", "reposted", "skippedCompany", "skippedTitle", "applied", "unpaid"];

  function getBorderReason(reasons) {
    for (const r of BORDER_PRIORITY) {
      if (reasons.includes(r)) return r;
    }
    return reasons[0];
  }

  let skippedCompanies = [];
  let skippedTitleKeywords = [];
  let sponsorCheckEnabled = true;
  let unpaidCheckEnabled = true;
  let processedCards = new WeakSet();
  let lastDetailText = "";

  // In-memory store of labeled jobs, used to restore badges after LinkedIn replaces DOM elements
  // key = jobId (extracted from card link) to avoid cross-contamination between same-named jobs
  const labeledJobs = new Map(); // jobKey → Set<reason>

  // Auto-scan state
  let scannedCards = new WeakSet();
  let scanning = false;
  let scanAbort = false;
  let cardsDimmed = false;
  const SCAN_DELAY_MS = 1500;

  let hasSeenIntro = false;

  // Only activate on search results pages (/jobs/search/ and /jobs/search-results/)
  function isSearchPage() {
    return /\/jobs\/search/.test(location.href);
  }

  // ==================== Storage ====================
  async function loadSettings() {
    const data = await chrome.storage.local.get({
      skippedCompanies: [],
      skippedTitleKeywords: [],
      sponsorCheckEnabled: true,
      unpaidCheckEnabled: true,
      hasSeenIntro: false,
      dimFiltered: true,
    });
    skippedCompanies = data.skippedCompanies;
    skippedTitleKeywords = data.skippedTitleKeywords;
    sponsorCheckEnabled = data.sponsorCheckEnabled;
    unpaidCheckEnabled = data.unpaidCheckEnabled;
    hasSeenIntro = data.hasSeenIntro;
    cardsDimmed = data.dimFiltered;
  }

  function saveValue(key, value) {
    chrome.storage.local.set({ [key]: value });
  }

  // ==================== Stats ====================
  function incrementStat(key, amount = 1) {
    chrome.storage.local.get({ stats: { today: "", adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 }, statsAllTime: { adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 } }, (data) => {
      const today = new Date().toISOString().slice(0, 10);
      if (data.stats.today !== today) {
        data.stats = { today, adsHidden: 0, suggestedHidden: 0, recommendedHidden: 0, postsMuted: 0, strangersHidden: 0, jobsFlagged: 0, jobsScanned: 0 };
      }
      data.stats[key] = (data.stats[key] || 0) + amount;
      data.statsAllTime[key] = (data.statsAllTime[key] || 0) + amount;
      chrome.storage.local.set(data);
    });
  }

  // ==================== DOM Utilities ====================
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'className') e.className = v;
        else if (k === 'textContent') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
        else e.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(child => {
        if (typeof child === 'string') e.appendChild(document.createTextNode(child));
        else if (child) e.appendChild(child);
      });
    }
    return e;
  }

  // ==================== Card Detection (Core) ====================
  // Returns each card's scope element (may be display:contents, contains full text for detection)
  // Badge display uses getVisibleEl() to find a visible child element
  function getJobCards() {
    const dismissBtns = document.querySelectorAll('button[aria-label*="Dismiss"]');
    if (dismissBtns.length < 2) return [];

    const cards = [];
    const seen = new WeakSet();

    dismissBtns.forEach((btn) => {
      let e = btn.parentElement;
      for (let i = 0; i < 12; i++) {
        if (!e || !e.parentElement) break;
        const parentDismissCount =
          e.parentElement.querySelectorAll('button[aria-label*="Dismiss"]').length;
        if (parentDismissCount > 1) {
          if (!seen.has(e)) {
            seen.add(e);
            cards.push(e);
          }
          break;
        }
        e = e.parentElement;
      }
    });

    return cards;
  }

  // Find the card's visible child element (for badge/border display)
  // display:contents elements have no dimensions — find the first descendant with a layout box
  function getVisibleEl(card) {
    if (getComputedStyle(card).display !== "contents") return card;
    for (const child of card.children) {
      const d = getComputedStyle(child).display;
      if (d !== "contents" && d !== "none") return child;
    }
    // Nested display:contents — go one level deeper
    for (const child of card.children) {
      for (const gc of child.children) {
        const d = getComputedStyle(gc).display;
        if (d !== "contents" && d !== "none") return gc;
      }
    }
    return card;
  }

  // ==================== Extract jobId from Card ====================
  // LinkedIn uses two link formats:
  //   1. /jobs/view/12345  (legacy/detail page)
  //   2. /jobs/search-results/?currentJobId=12345  (search results page)
  function getCardJobId(card) {
    const links = card.querySelectorAll("a");
    for (const link of links) {
      // Format 1: /jobs/view/12345
      const viewMatch = link.href.match(/\/jobs\/view\/(\d+)/);
      if (viewMatch) return viewMatch[1];
      // Format 2: ?currentJobId=12345
      try {
        const u = new URL(link.href);
        const id = u.searchParams.get("currentJobId");
        if (id) return id;
      } catch {}
    }
    return null;
  }

  // ==================== Extract Unique Key from Card (prefer jobId) ====================
  function getJobKey(card) {
    const id = getCardJobId(card);
    if (id) return "id:" + id;
    // Fallback: title + company (rare case where card has no link)
    return getJobTitle(card) + "|" + getCompanyName(card);
  }

  // ==================== Extract Job Title from Card ====================
  function getJobTitle(card) {
    const dismiss = card.querySelector('button[aria-label*="Dismiss"]');
    if (dismiss) {
      const label = dismiss.getAttribute("aria-label") || "";
      const match = label.match(/^Dismiss\s+(.+?)\s+job$/);
      if (match) return match[1];
    }
    const lines = getCardTextLines(card);
    return lines[1] || lines[0] || "";
  }

  // ==================== Extract Company Name from Card ====================
  function getCompanyName(card) {
    const lines = getCardTextLines(card);
    if (lines.length >= 3) {
      if (lines[0].includes("(Verified")) return lines[2] || "";
      return lines[1] || "";
    }
    return lines.length >= 2 ? lines[1] : "";
  }

  // Filter out injected badge text to avoid interfering with title/company detection
  const BADGE_TEXTS = new Set(Object.values(BADGE_DISPLAY));
  function getCardTextLines(card) {
    return card.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "·" && l !== "·" && !BADGE_TEXTS.has(l));
  }

  // ==================== Check if Card Text Indicates Reposted ====================
  function cardHasRepostedText(card) {
    return card.textContent.toLowerCase().includes("reposted");
  }

  // ==================== Check if Card Text Indicates Applied ====================
  // Searches leaf DOM elements for textContent === "Applied"
  // Avoids innerText which CSS can merge siblings into one line ("Applied · 1 week ago · Easy Apply")
  // Also naturally excludes company names like "Applied Materials" (textContent !== "Applied")
  function cardHasAppliedText(card) {
    // Use targeted selectors instead of querySelectorAll("*")
    // LinkedIn renders "Applied" as a leaf <span> or <li> inside job card metadata
    for (const el of card.querySelectorAll("span, li, time")) {
      if (el.children.length === 0 &&
          el.textContent.trim() === "Applied" &&
          !el.closest(".lj-badges")) {
        return true;
      }
    }
    return false;
  }

  // ==================== Check Detail Panel for Reposted ====================
  function detailPanelHasReposted() {
    // "Reposted" appears near the top of the detail panel in a <strong> or <span>
    // Narrow scope to job detail container to avoid scanning the entire document
    const detail =
      document.querySelector(".jobs-search__job-details") ||
      document.querySelector(".jobs-details") ||
      document.querySelector("article");
    if (!detail) return false;
    const candidates = detail.querySelectorAll("strong, span");
    for (const node of candidates) {
      if (node.children.length > 0) continue;
      const t = node.textContent.trim();
      if (t.length > 0 && t.length < 80 && t.toLowerCase().startsWith("reposted")) {
        if (!node.closest(".lj-badges")) return true;
      }
    }
    return false;
  }

  // ==================== Check if Company is Skipped ====================
  function isSkippedCompany(card) {
    const name = getCompanyName(card).toLowerCase();
    if (!name) return false;
    return skippedCompanies.some((b) => name === b.toLowerCase());
  }

  // ==================== Check if Title Keyword is Skipped ====================
  function isSkippedTitle(card) {
    if (skippedTitleKeywords.length === 0) return false;
    const title = getJobTitle(card).toLowerCase();
    if (!title) return false;
    return skippedTitleKeywords.some((kw) => title.includes(kw.toLowerCase()));
  }

  // ==================== Extract Detail Panel "About the job" Text ====================
  function getDetailText() {
    const headings = document.querySelectorAll("h2");
    for (const h of headings) {
      if (h.textContent.includes("About the job")) {
        const wrapper = h.parentElement;
        let text = "";
        let sibling = wrapper?.nextElementSibling;
        let sibCount = 0;
        const MAX_SIBLINGS = 15;
        while (sibling && sibCount < MAX_SIBLINGS) {
          text += " " + sibling.textContent;
          sibling = sibling.nextElementSibling;
          sibCount++;
          if (sibling && sibling.querySelector && sibling.querySelector("h2")) break;
        }
        if (text.length > 0) return text;
      }
    }
    const article = document.querySelector("article");
    return article ? article.textContent : "";
  }

  function detailHasNoSponsorship() { return NO_SPONSOR_RE.test(getDetailText()); }
  function detailHasUnpaid() { return UNPAID_RE.test(getDetailText()); }

  // ==================== Get Detail Panel Text Fingerprint ====================
  function getDetailFingerprint() {
    const titleLink = document.querySelector('a[href*="/jobs/view/"]');
    if (titleLink) {
      const text = titleLink.textContent.trim();
      if (text.length > 3) return text;
    }
    const text = getDetailText();
    return text ? text.trim().substring(0, 200) : "";
  }

  // ==================== Label Card (supports multiple badges) ====================
  function labelCard(card, reason) {
    const existing = card.dataset.ljReasons ? card.dataset.ljReasons.split(",") : [];
    if (existing.includes(reason)) return false;

    existing.push(reason);
    card.dataset.ljReasons = existing.join(",");

    card.dataset.ljFiltered = getBorderReason(existing);

    // Store in memory Map so badges can be restored even after DOM replacement
    const key = getJobKey(card);
    if (key) {
      if (!labeledJobs.has(key)) labeledJobs.set(key, new Set());
      labeledJobs.get(key).add(reason);
    }

    applyBadges(card);
    incrementStat("jobsFlagged");
    updateBadgeCount();
    return true;
  }

  // Clear badge DOM and inline styles from card (both scope and visible elements)
  function clearBadges(card) {
    const target = getVisibleEl(card);
    card.querySelectorAll(".lj-badges").forEach(b => b.remove());
    if (target !== card) {
      target.querySelectorAll(".lj-badges").forEach(b => b.remove());
      target.style.borderLeft = "";
      target.style.position = "";
      target.style.overflow = "";
    }
  }

  // ==================== Badge DOM Elements (multiple, stacked vertically) ====================
  // Badges and borders are inserted into visible child (getVisibleEl) to avoid display:contents invisibility
  function applyBadges(card) {
    const reasons = card.dataset.ljReasons ? card.dataset.ljReasons.split(",") : [];
    if (reasons.length === 0) return;

    const target = getVisibleEl(card);

    // Already has correct badges → skip
    const existing = target.querySelector(".lj-badges");
    if (existing && existing.dataset.r === card.dataset.ljReasons) return;

    clearBadges(card);

    // Set border + position on visible element (inline style)
    target.style.position = "relative";
    target.style.overflow = "visible";
    target.style.borderLeft = "3px solid " + (BADGE_COLOR);

    const container = document.createElement("div");
    container.className = "lj-badges";
    container.dataset.r = card.dataset.ljReasons;

    reasons.forEach(reason => {
      const badge = document.createElement("span");
      badge.className = "lj-badge";
      badge.textContent = BADGE_DISPLAY[reason] || reason;
      badge.style.background = BADGE_COLOR;
      container.appendChild(badge);
    });

    target.insertBefore(container, target.firstChild);

    // Auto-dim newly labeled cards when dim mode is enabled
    if (cardsDimmed) target.classList.add("lj-card-dimmed");
  }

  // Check all labeled cards and restore missing badges
  function refreshBadges() {
    // 1. data attribute present but badge DOM missing → re-insert
    document.querySelectorAll("[data-lj-reasons]").forEach(card => {
      const target = getVisibleEl(card);
      const existing = target.querySelector(".lj-badges");
      if (!existing || existing.dataset.r !== card.dataset.ljReasons) {
        applyBadges(card);
      }
    });

    // 2. data attribute also lost (DOM element fully replaced) → restore from memory Map
    if (labeledJobs.size > 0) {
      getJobCards().forEach(card => {
        if (card.dataset.ljReasons) return; // already has attribute, skip
        const key = getJobKey(card);
        const reasons = labeledJobs.get(key);
        if (!reasons || reasons.size === 0) return;
        // Restore all reasons
        const arr = [...reasons];
        card.dataset.ljReasons = arr.join(",");
        card.dataset.ljFiltered = getBorderReason(arr);
        applyBadges(card);
        processedCards.add(card); // prevent filterJobCards from re-labeling
      });
    }
  }

  // ==================== Get Currently Active Card ====================
  function getActiveCard() {
    const cards = getJobCards();
    if (cards.length === 0) return null;

    // Prefer exact match via jobId in URL (supports both link formats)
    const urlMatch = location.href.match(/currentJobId=(\d+)/);
    if (urlMatch) {
      const jobId = urlMatch[1];
      for (const card of cards) {
        if (getCardJobId(card) === jobId) return card;
      }
    }

    // Title matching fallback:
    //   1. Exact match (identical titles) preferred
    //   2. Among substring matches, prefer the closest length to detail title (avoid superset title mismatch)
    const detailLink = document.querySelector('a[href*="/jobs/view/"]');
    if (detailLink) {
      const detailTitle = detailLink.textContent.trim().toLowerCase();
      if (detailTitle) {
        let exactMatch = null;
        let bestCard = null;
        let bestDiff = Infinity;
        for (const card of cards) {
          const cardTitle = getJobTitle(card).toLowerCase();
          if (!cardTitle) continue;
          // Exact match takes priority
          if (cardTitle === detailTitle) { exactMatch = card; break; }
          // Substring match: pick smallest length diff (not longest, to avoid superset mismatch)
          if (detailTitle.includes(cardTitle) || cardTitle.includes(detailTitle)) {
            const diff = Math.abs(cardTitle.length - detailTitle.length);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestCard = card;
            }
          }
        }
        if (exactMatch) return exactMatch;
        if (bestCard) return bestCard;
      }
    }

    return null;
  }

  // ==================== Filter Job Cards (check all conditions) ====================
  function filterJobCards() {
    const cards = getJobCards();
    // Early exit: skip if all cards are already processed (no new unprocessed cards)
    const hasNew = cards.some(c => !processedCards.has(c));
    if (!hasNew && cards.length > 0) {
      // Still check for late-rendered "Applied" text (LinkedIn progressive render)
      let foundNew = false;
      for (const card of cards) {
        if (!card.dataset.ljReasons?.includes("applied") && cardHasAppliedText(card)) {
          labelCard(card, "applied");
          foundNew = true;
        }
      }
      if (!foundNew) return;
    }
    cards.forEach((card) => {
      // Applied check bypasses processedCards (LinkedIn progressive render: text may appear after DOM)
      if (!card.dataset.ljReasons?.includes("applied")) {
        if (cardHasAppliedText(card)) labelCard(card, "applied");
      }

      if (processedCards.has(card)) return;
      processedCards.add(card);

      if (cardHasRepostedText(card)) labelCard(card, "reposted");
      if (isSkippedCompany(card)) labelCard(card, "skippedCompany");
      if (isSkippedTitle(card)) labelCard(card, "skippedTitle");
    });
  }

  // ==================== Check Detail Panel Content, Label Specified Card ====================
  // Scan path passes card reference directly (100% accurate); passive detection uses getActiveCard()
  function checkDetailForCard(card) {
    let labeled = false;
    if (detailPanelHasReposted()) {
      labeled = labelCard(card, "reposted") || labeled;
    }
    if (sponsorCheckEnabled && detailHasNoSponsorship()) {
      labeled = labelCard(card, "noSponsor") || labeled;
    }
    if (unpaidCheckEnabled && detailHasUnpaid()) {
      labeled = labelCard(card, "unpaid") || labeled;
    }
    return labeled;
  }

  // ==================== Passive Detail Panel Detection (triggered when user clicks a card) ====================
  function checkDetailPanel() {
    const fingerprint = getDetailFingerprint();
    if (!fingerprint || fingerprint === lastDetailText) return;
    lastDetailText = fingerprint;

    const activeCard = getActiveCard();
    if (!activeCard) return;

    const labeled = checkDetailForCard(activeCard);
    if (labeled && !scanning) {
      const reasons = (activeCard.dataset.ljReasons || "").split(",");
      showToast("Flagged: " + reasons.map(r => BADGE_DISPLAY[r] || r).join(", "));
    }
  }

  // ==================== Click Card (multi-strategy) ====================
  // Priority: div[role="button"] > card link > visible child > card itself
  // display:contents elements have no layout box, so direct click() may not work
  function clickCard(card) {
    if (!card) return;
    const roleBtn = card.querySelector('div[role="button"]');
    const link = card.querySelector("a");
    const visible = getVisibleEl(card);
    const target = roleBtn || link || (visible !== card ? visible : card);
    target.click();
    target.focus();
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
    }));
    target.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
    }));
  }

  // ==================== Toast Notifications ====================
  function showToast(message) {
    const existing = document.getElementById("lj-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "lj-toast";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed", bottom: "30px", left: "50%",
      transform: "translateX(-50%)", background: "#1F2328",
      color: "#FAF7F2", padding: "10px 24px", borderRadius: "8px",
      fontFamily: "'EB Garamond',Garamond,serif",
      fontSize: "14px", fontWeight: "600", zIndex: "99999",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)", transition: "opacity 0.3s",
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ==================== Inject CSS ====================
  function injectStyles() {
    if (document.getElementById("lj-filter-styles")) return;
    // Load EB Garamond via <link> tag (avoids @import being blocked by CSP)
    if (!document.getElementById("lj-font-link")) {
      const link = document.createElement("link");
      link.id = "lj-font-link";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
    }
    const style = document.createElement("style");
    style.id = "lj-filter-styles";
    style.textContent = [
      // Dimmed card styles
      ".lj-card-dimmed{opacity:0.35 !important;transition:opacity 0.2s}",
      ".lj-card-dimmed:hover{opacity:0.7 !important}",
      // Card border (brand rose)
      "[data-lj-filtered]{border-left:3px solid #D9797B !important;position:relative !important;overflow:visible !important}",
      // Badge container
      ".lj-badges{position:absolute !important;left:0 !important;bottom:4px !important;z-index:10 !important;display:flex !important;flex-direction:column !important;gap:2px !important;pointer-events:none !important}",
      ".lj-badge{font-size:9px !important;font-weight:700 !important;padding:1px 6px !important;border-radius:8px !important;color:#fff !important;white-space:nowrap !important;line-height:1.4 !important;letter-spacing:0.3px !important}",
      // Mini badge container
      "#lj-mini-container{position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;gap:8px;align-items:center}",
      "#lj-mini-badge{background:rgba(250,247,242,0.92);backdrop-filter:blur(12px);border:1px solid #E4DDD2;border-radius:20px;padding:6px 14px;font-family:'EB Garamond',serif;font-size:13px;color:#1F2328;box-shadow:0 2px 8px rgba(0,0,0,0.06);user-select:none}",
      "#lj-mini-scan{background:#1F2328;color:#FAF7F2;border:none;border-radius:16px;padding:6px 14px;font-family:'EB Garamond',serif;font-size:13px;cursor:pointer}",
      "#lj-mini-scan:hover{opacity:0.8}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ==================== Mini Badge ====================
  function createMiniBadge() {
    if (document.getElementById("lj-mini-container")) return;

    const badge = document.createElement("div");
    badge.id = "lj-mini-badge";

    const scanBtn = document.createElement("button");
    scanBtn.id = "lj-mini-scan";
    scanBtn.textContent = "Scan";
    scanBtn.onclick = () => {
      if (scanning) { scanAbort = true; } else { autoScanCards(); }
    };

    const container = document.createElement("div");
    container.id = "lj-mini-container";
    container.appendChild(badge);
    container.appendChild(scanBtn);
    document.body.appendChild(container);
    updateBadgeCount();
  }

  function updateBadgeCount() {
    const badge = document.getElementById("lj-mini-badge");
    if (!badge) return;
    const count = labeledJobs ? labeledJobs.size : 0;
    badge.textContent = count > 0 ? "\uD83D\uDD0D " + count + " flagged" : "\uD83D\uDD0D JobLens";
  }

  function updateScanButton(text) {
    const btn = document.getElementById("lj-mini-scan");
    if (!btn) return;
    btn.textContent = text || "Scan";
  }

  // ==================== Skip Current Company ====================
  function skipCurrentCompany() {
    const activeCard = getActiveCard();
    if (!activeCard) { showToast("No active job selected"); return; }
    const name = getCompanyName(activeCard);
    if (!name) { showToast("Could not detect company name"); return; }
    if (skippedCompanies.some((c) => c.toLowerCase() === name.toLowerCase())) {
      showToast("\u201C" + name + "\u201D already skipped"); return;
    }
    skippedCompanies.push(name);
    saveValue("skippedCompanies", skippedCompanies);
    refilterAll();
    showToast("Skipped: " + name);
  }

  function refilterAll() {
    const cards = getJobCards();
    cards.forEach((card) => {
      if (isSkippedCompany(card)) labelCard(card, "skippedCompany");
      if (isSkippedTitle(card)) labelCard(card, "skippedTitle");
    });
  }

  // ==================== Auto-Scan ====================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function waitForDetailChange(oldFingerprint, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const detailContainer =
        document.querySelector(".jobs-search__job-details") ||
        document.querySelector("main") ||
        document.body;

      let settled = false;
      function settle() {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      }

      const observer = new MutationObserver(() => {
        const current = getDetailFingerprint();
        if (current && current !== oldFingerprint) settle();
      });

      observer.observe(detailContainer, { childList: true, subtree: true, characterData: true });

      const timeout = setTimeout(settle, timeoutMs);

      // Check once immediately in case the change already happened
      const current = getDetailFingerprint();
      if (current && current !== oldFingerprint) settle();
    });
  }

  async function autoScanCards() {
    if (scanning) { scanAbort = true; return; }
    scanning = true;
    scanAbort = false;

    try {
      const cards = getJobCards();
      const toScan = cards.filter(c => !scannedCards.has(c) && !c.dataset.ljReasons);
      const total = toScan.length;
      updateScanButton("0/" + total + "...");

      for (let i = 0; i < toScan.length; i++) {
        if (scanAbort) break;
        const card = toScan[i];
        if (card.dataset.ljReasons) continue;

        updateScanButton((i + 1) + "/" + total + "...");

        const oldFp = getDetailFingerprint();
        clickCard(card);

        await waitForDetailChange(oldFp);
        await sleep(500);

        // Detect using card reference directly, bypassing getActiveCard() (avoids mismatch)
        checkDetailForCard(card);
        scannedCards.add(card);

        if (i < toScan.length - 1 && !scanAbort) {
          await sleep(SCAN_DELAY_MS);
        }
      }

      incrementStat("jobsScanned", total);
    } catch (err) {
      console.error("[JobLens] Scan error:", err);
      showToast("Scan error: " + err.message);
    }

    scanning = false;
    scanAbort = false;

    // Restore all lost badges immediately + one delayed pass after scan completes
    refreshBadges();
    setTimeout(refreshBadges, 2000);

    const flagged = getJobCards().filter(c => c.dataset.ljReasons).length;
    const doneText = flagged === 0 ? "All clear" : flagged + " flagged";
    updateScanButton(doneText);
    updateBadgeCount();
    showToast("Scan complete \u2014 " + doneText);
  }

  // ==================== Storage Change Listener ====================
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // Re-read settings
    chrome.storage.local.get({
      skippedCompanies: [], skippedTitleKeywords: [],
      sponsorCheckEnabled: true, unpaidCheckEnabled: true, dimFiltered: true
    }, (data) => {
      skippedCompanies = data.skippedCompanies;
      skippedTitleKeywords = data.skippedTitleKeywords;
      sponsorCheckEnabled = data.sponsorCheckEnabled;
      unpaidCheckEnabled = data.unpaidCheckEnabled;
      // Re-apply dim mode
      cardsDimmed = data.dimFiltered;
      document.body.classList.toggle("lj-dim-filtered", data.dimFiltered);
      // Re-apply dim to individual cards
      document.querySelectorAll("[data-lj-filtered]").forEach(card => {
        const vis = getVisibleEl(card);
        if (data.dimFiltered) vis.classList.add("lj-card-dimmed");
        else vis.classList.remove("lj-card-dimmed");
      });
      filterJobCards();
    });
  });

  // ==================== Initialization ====================
  async function init() {
    if (!isSearchPage()) return;
    await loadSettings();
    injectStyles();
    createMiniBadge();
    filterJobCards();
    checkDetailPanel();

    // Apply dim mode on init
    if (cardsDimmed) {
      document.querySelectorAll("[data-lj-filtered]").forEach(card => {
        const vis = getVisibleEl(card);
        vis.classList.add("lj-card-dimmed");
      });
    }

    // First-use hint
    if (!hasSeenIntro) {
      showToast("Click Scan to filter all visible listings");
      hasSeenIntro = true;
      saveValue("hasSeenIntro", true);
    }
  }

  if (document.readyState === "complete") {
    setTimeout(init, 1500);
  } else {
    window.addEventListener("load", () => setTimeout(init, 1500));
  }

  // ==================== SPA Route Detection (lightweight, no MutationObserver on body) ====================
  let lastUrl = location.href;

  function handleRouteChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const onSearch = isSearchPage();
    if (onSearch && !scanning) {
      // Search page route change → reset state and re-initialize
      processedCards = new WeakSet();
      scannedCards = new WeakSet();
      labeledJobs.clear();
      scanAbort = false;
      lastDetailText = "";
      setTimeout(() => {
        if (!document.getElementById("lj-mini-container")) init();
        else filterJobCards();
        // Re-attach the narrowed observer for the new page
        attachJobsObserver();
      }, 2000);
    } else if (!onSearch) {
      // Left search page → remove mini badge
      const container = document.getElementById("lj-mini-container");
      if (container) container.remove();
    }
  }

  // Detect SPA navigation via History API and popstate
  window.addEventListener("popstate", handleRouteChange);
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    handleRouteChange();
  };
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    handleRouteChange();
  };

  // ==================== Narrowed Jobs Observer (DOM mutations in jobs container only) ====================
  let filterTimer = null;
  let detailTimer = null;
  let badgeTimer = null;
  let jobsObserver = null;

  function onJobsMutation() {
    if (!isSearchPage()) return;

    // Card filtering (200ms debounce)
    clearTimeout(filterTimer);
    filterTimer = setTimeout(filterJobCards, 200);

    // Detail panel detection (600ms debounce)
    clearTimeout(detailTimer);
    detailTimer = setTimeout(checkDetailPanel, 600);

    // Badge restoration (independent 1s debounce to avoid frequent DOM queries)
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(refreshBadges, 1000);
  }

  function attachJobsObserver() {
    // Disconnect previous observer if any
    if (jobsObserver) jobsObserver.disconnect();

    jobsObserver = new MutationObserver(onJobsMutation);

    // Narrow target: jobs list container → <main> → fallback to body
    const container =
      document.querySelector(".jobs-search-results-list") ||
      document.querySelector("main") ||
      document.body;

    jobsObserver.observe(container, { childList: true, subtree: true });

    // If we attached to a narrow container, also watch <main> for the detail
    // panel which lives outside the results list but inside <main>
    if (container.classList.contains("jobs-search-results-list")) {
      const main = document.querySelector("main");
      if (main && main !== container) {
        jobsObserver.observe(main, { childList: true, subtree: true });
      }
    }
  }

  // Attach observer — use a bootstrap watcher if <main> isn't ready yet
  if (document.querySelector("main") || document.querySelector(".jobs-search-results-list")) {
    attachJobsObserver();
  } else {
    // Fallback: wait for main to appear, then attach narrowed observer
    const bootObs = new MutationObserver(() => {
      if (document.querySelector("main") || document.querySelector(".jobs-search-results-list")) {
        bootObs.disconnect();
        attachJobsObserver();
      }
    });
    bootObs.observe(document.body, { childList: true, subtree: true });
  }
})();
