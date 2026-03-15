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

  // UI element references (set in createUI)
  let ui = {};
  let hasSeenIntro = false;
  let panelPosition = null;

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
      panelPosition: null,
    });
    skippedCompanies = data.skippedCompanies;
    skippedTitleKeywords = data.skippedTitleKeywords;
    sponsorCheckEnabled = data.sponsorCheckEnabled;
    unpaidCheckEnabled = data.unpaidCheckEnabled;
    hasSeenIntro = data.hasSeenIntro;
    panelPosition = data.panelPosition;
  }

  function saveValue(key, value) {
    chrome.storage.local.set({ [key]: value });
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
    for (const el of card.querySelectorAll("*")) {
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
    // Target leaf elements (LinkedIn wraps "Reposted X ago" in <strong> or <span>)
    const candidates = document.querySelectorAll(
      "strong, span, p, div:not(#lj-filter-panel):not(.lj-badges)"
    );
    for (const node of candidates) {
      if (node.children.length > 0) continue;
      const t = node.textContent.trim();
      if (t.length > 0 && t.length < 80 && t.toLowerCase().startsWith("reposted")) {
        if (!node.closest("#lj-filter-panel") && !node.closest(".lj-badges")) return true;
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
        while (sibling) {
          text += " " + sibling.textContent;
          sibling = sibling.nextElementSibling;
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

  // ==================== Filter Job Cards (check all conditions, no early exit) ====================
  function filterJobCards() {
    const cards = getJobCards();
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
      // Panel (frosted cream)
      "#lj-filter-panel{position:fixed;top:70px;left:20px;z-index:99999;background:rgba(250,247,242,0.82);-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);color:#1F2328;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #E4DDD2;font-family:'EB Garamond',Garamond,'Times New Roman',serif;font-size:13px;width:clamp(200px,20vw,280px);transition:width 0.2s}",
      "#lj-filter-panel.collapsed{width:auto}",
      "#lj-filter-panel.collapsed .lj-body{display:none}",
      ".lj-header{background:rgba(243,239,231,0.7);padding:10px 14px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none}",
      ".lj-header:active{cursor:grabbing}",
      "#lj-filter-panel.collapsed .lj-header{border-radius:12px}",
      ".lj-header h3{margin:0;font-size:14px;font-weight:600;color:#1F2328}",
      ".lj-body{padding:12px 14px;max-height:clamp(200px,55vh,70vh);overflow-y:auto}",
      // Scan button
      ".lj-scan-btn{position:relative;overflow:hidden;background:#1F2328;color:#FAF7F2;border:none;border-radius:6px;padding:7px 0;cursor:pointer;font-weight:600;font-size:12px;font-family:'EB Garamond',Garamond,serif;width:100%;margin-top:12px;transition:opacity 0.2s}",
      ".lj-scan-progress{position:absolute;bottom:0;left:0;height:2px;background:rgba(255,255,255,0.4);transition:width 0.3s}",
      ".lj-scan-btn:hover{opacity:0.8}",
      ".lj-scan-btn.scanning{background:#D9797B;color:#fff}",
      ".lj-scan-btn.scan-done{background:#5a8a6e;color:#fff}",
      // Sections
      ".lj-section{margin-bottom:12px;border-top:1px solid #E4DDD2;padding-top:10px}",
      ".lj-section:first-of-type{border-top:none;padding-top:0}",
      ".lj-label{font-size:11px;color:#5A636B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600}",
      ".lj-label-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}",
      ".lj-label-row .lj-label{margin-bottom:0}",
      ".lj-copy-btn{background:none;border:1px solid #E4DDD2;color:#5A636B;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:10px;line-height:1.4;font-family:'EB Garamond',Garamond,serif}",
      ".lj-copy-btn:hover{color:#1F2328;border-color:#1F2328}",
      // Lists
      ".lj-list{margin-bottom:8px}",
      ".lj-list-toggle{background:none;border:none;color:#5A636B;cursor:pointer;font-size:11px;font-family:'EB Garamond',Garamond,serif;padding:3px 0;width:100%;text-align:center}",
      ".lj-list-toggle:hover{color:#1F2328}",
      ".lj-list::-webkit-scrollbar{width:4px}",
      ".lj-list::-webkit-scrollbar-thumb{background:#E4DDD2;border-radius:4px}",
      ".lj-item{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#F3EFE7;border-radius:6px;margin-bottom:3px}",
      ".lj-item span{color:#1F2328;font-size:12px}",
      ".lj-x{background:none;border:none;color:#D9797B;cursor:pointer;font-size:16px;padding:0 2px;line-height:1}",
      ".lj-x:hover{color:#9a6868}",
      // Input + button
      ".lj-add{display:flex;gap:6px}",
      ".lj-add input{flex:1;background:#fff;border:1px solid #E4DDD2;border-radius:6px;color:#1F2328;padding:6px 10px;font-size:12px;font-family:'EB Garamond',Garamond,serif;outline:none}",
      ".lj-add input:focus{border-color:#5A636B}",
      ".lj-add button{background:#1F2328;color:#FAF7F2;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:600;font-size:12px;font-family:'EB Garamond',Garamond,serif;white-space:nowrap}",
      ".lj-add button:hover{opacity:0.8}",
      ".lj-toggle{background:none;border:none;color:#5A636B;cursor:pointer;font-size:18px;padding:0;line-height:1}",
      ".lj-empty{color:#8A939B;font-size:11px;padding:4px 0;font-style:italic}",
      // Quick skip button
      ".lj-quick-skip{margin-top:8px;padding-top:8px;border-top:1px solid #E4DDD2}",
      ".lj-quick-skip-btn{background:#F3EFE7;color:#9a6868;border:1px solid #E4DDD2;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;font-family:'EB Garamond',Garamond,serif;width:100%;text-align:center}",
      ".lj-quick-skip-btn:hover{background:#E4DDD2}",
      // Footer link
      ".lj-feedback{display:block;text-align:center;margin-top:10px;font-size:11px;color:#8A939B;text-decoration:none;letter-spacing:0.3px}",
      ".lj-feedback:hover{color:#5A636B}",
      // Toggle switch row
      ".lj-switch-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0}",
      ".lj-switch-row span{font-size:12px;color:#1F2328}",
      ".lj-switch{position:relative;width:36px;height:20px;cursor:pointer}",
      ".lj-switch input{opacity:0;width:0;height:0}",
      ".lj-switch .slider{position:absolute;inset:0;background:#E4DDD2;border-radius:10px;transition:background 0.2s}",
      ".lj-switch .slider::before{content:'';position:absolute;width:16px;height:16px;left:2px;top:2px;background:#fff;border-radius:50%;transition:transform 0.2s}",
      ".lj-switch input:checked+.slider{background:#5a8a6e}",
      ".lj-switch input:checked+.slider::before{transform:translateX(16px)}",
      // Dimmed card styles
      ".lj-card-dimmed{opacity:0.35 !important;transition:opacity 0.2s}",
      ".lj-card-dimmed:hover{opacity:0.7 !important}",
      // Card border (brand rose)
      "[data-lj-filtered]{border-left:3px solid #D9797B !important;position:relative !important;overflow:visible !important}",
      // Badge container
      ".lj-badges{position:absolute !important;left:0 !important;bottom:4px !important;z-index:10 !important;display:flex !important;flex-direction:column !important;gap:2px !important;pointer-events:none !important}",
      ".lj-badge{font-size:9px !important;font-weight:700 !important;padding:1px 6px !important;border-radius:8px !important;color:#fff !important;white-space:nowrap !important;line-height:1.4 !important;letter-spacing:0.3px !important}",
      // Responsive breakpoints
      "@media(max-width:1024px){#lj-filter-panel{font-size:12.5px}.lj-header h3{font-size:13.5px}}",
      "@media(max-width:768px){#lj-filter-panel{font-size:12px}.lj-header h3{font-size:13px}.lj-body{padding:10px 12px;max-height:clamp(200px,50vh,60vh)}.lj-add button{padding:6px 8px;font-size:11px}}",
      "@media(max-width:600px){#lj-filter-panel{font-size:11.5px}.lj-header h3{font-size:12px}.lj-body{padding:8px 10px;max-height:clamp(180px,45vh,50vh)}}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ==================== Panel Position Clamping ====================
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

  // ==================== UI Panel ====================
  function createUI() {
    if (document.getElementById("lj-filter-panel")) return;
    injectStyles();

    const panel = el("div", { id: "lj-filter-panel" });

    const togBtn = el("button", { className: "lj-toggle", textContent: "\u2212" });
    const header = el("div", { className: "lj-header" }, [
      el("h3", { textContent: "JobLens" }),
      togBtn
    ]);

    // ---- Drag + click (>4px movement = drag, otherwise = toggle collapse) ----
    let dragState = null;
    header.addEventListener("mousedown", (e) => {
      if (e.target === togBtn) return; // toggle button excluded from drag
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
        // Save drag position (clamp ensures panel stays within viewport)
        panelPosition = clampPanelPosition(panel);
        saveValue("panelPosition", panelPosition);
      } else if (dragState && !dragState.dragged) {
        panel.classList.toggle("collapsed");
        togBtn.textContent = panel.classList.contains("collapsed") ? "+" : "\u2212";
      }
      dragState = null;
    });

    const body = el("div", { className: "lj-body" });

    ui.scanBtn = el("button", {
      className: "lj-scan-btn",
      id: "lj-scan-btn",
      textContent: "Scan Jobs",
      onClick: () => { if (scanning) { scanAbort = true; } else { autoScanCards(); } }
    });

    // ---- Batch add (supports comma/newline-separated paste) ----
    function batchAdd(raw, list, storageKey) {
      const items = raw.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      let added = 0;
      items.forEach(name => {
        if (!list.some(c => c.toLowerCase() === name.toLowerCase())) {
          list.push(name);
          added++;
        }
      });
      if (added > 0) {
        saveValue(storageKey, list);
        renderLists();
        refilterAll();
        if (added > 1) showToast("Added " + added + " items");
      }
    }

    function copyList(list, label) {
      navigator.clipboard.writeText(list.join(", ")).then(() => {
        showToast("Copied " + list.length + " " + label);
      }).catch(() => {
        showToast("Copy failed — try again");
      });
    }

    ui.companyList = el("div", { className: "lj-list" });
    const companyInput = el("input", { type: "text", placeholder: "Company name..." });
    const companyAddBtn = el("button", { textContent: "Add", onClick: () => {
      const raw = companyInput.value.trim();
      if (!raw) return;
      batchAdd(raw, skippedCompanies, "skippedCompanies");
      companyInput.value = "";
    }});
    companyInput.addEventListener("keypress", (e) => { if (e.key === "Enter") companyAddBtn.click(); });
    const companyCopyBtn = el("button", {
      className: "lj-copy-btn",
      textContent: "Copy",
      onClick: () => copyList(skippedCompanies, "companies")
    });

    const skipCurrentBtn = el("button", {
      className: "lj-quick-skip-btn",
      textContent: "Skip Current Company",
      onClick: skipCurrentCompany
    });

    const companySection = el("div", { className: "lj-section" }, [
      el("div", { className: "lj-label-row" }, [
        el("span", { className: "lj-label", textContent: "Skipped Companies" }),
        companyCopyBtn,
      ]),
      ui.companyList,
      el("div", { className: "lj-add" }, [companyInput, companyAddBtn]),
      el("div", { className: "lj-quick-skip" }, [skipCurrentBtn]),
    ]);

    ui.titleList = el("div", { className: "lj-list" });
    const titleInput = el("input", { type: "text", placeholder: "Keyword..." });
    const titleAddBtn = el("button", { textContent: "Add", onClick: () => {
      const raw = titleInput.value.trim();
      if (!raw) return;
      batchAdd(raw, skippedTitleKeywords, "skippedTitleKeywords");
      titleInput.value = "";
    }});
    titleInput.addEventListener("keypress", (e) => { if (e.key === "Enter") titleAddBtn.click(); });
    const titleCopyBtn = el("button", {
      className: "lj-copy-btn",
      textContent: "Copy",
      onClick: () => copyList(skippedTitleKeywords, "keywords")
    });

    const titleSection = el("div", { className: "lj-section" }, [
      el("div", { className: "lj-label-row" }, [
        el("span", { className: "lj-label", textContent: "Skipped Title Keywords" }),
        titleCopyBtn,
      ]),
      ui.titleList,
      el("div", { className: "lj-add" }, [titleInput, titleAddBtn]),
    ]);

    // ---- Sponsor detection toggle ----
    function makeSwitch(label, checked, onChange) {
      const input = el("input", { type: "checkbox" });
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      const slider = el("span", { className: "slider" });
      const lbl = el("label", { className: "lj-switch" }, [input, slider]);
      return el("div", { className: "lj-switch-row" }, [
        el("span", { textContent: label }), lbl
      ]);
    }

    const sponsorSwitch = makeSwitch("Detect No Sponsor", sponsorCheckEnabled, (on) => {
      sponsorCheckEnabled = on;
      saveValue("sponsorCheckEnabled", on);
    });

    const unpaidSwitch = makeSwitch("Detect Unpaid", unpaidCheckEnabled, (on) => {
      unpaidCheckEnabled = on;
      saveValue("unpaidCheckEnabled", on);
    });

    // ---- Dim filtered cards toggle ----
    function toggleDimCards(on) {
      cardsDimmed = on;
      document.querySelectorAll("[data-lj-filtered]").forEach(card => {
        const vis = getVisibleEl(card);
        if (on) vis.classList.add("lj-card-dimmed");
        else vis.classList.remove("lj-card-dimmed");
      });
    }
    const dimSwitch = makeSwitch("Dim filtered cards", false, toggleDimCards);

    const switchSection = el("div", { className: "lj-section" }, [
      el("div", { className: "lj-label", textContent: "Options" }),
      sponsorSwitch,
      unpaidSwitch,
      dimSwitch,
    ]);

    const feedbackLink = el("a", {
      className: "lj-feedback",
      textContent: "Shape JobLens \u2192",
      href: "https://kunli.co/joblens",
      target: "_blank",
    });

    body.appendChild(companySection);
    body.appendChild(titleSection);
    body.appendChild(switchSection);
    body.appendChild(ui.scanBtn);
    body.appendChild(feedbackLink);
    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // Restore last drag position (must be in DOM for getBoundingClientRect to work)
    if (panelPosition) {
      panel.style.left = panelPosition.left + "px";
      panel.style.top = panelPosition.top + "px";
      clampPanelPosition(panel);
    }

    // Listen for window resize (ensures panel stays visible on monitor switch/window resize)
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const p = document.getElementById("lj-filter-panel");
        if (!p) return;
        panelPosition = clampPanelPosition(p);
        saveValue("panelPosition", panelPosition);
      }, 150);
    });

    renderLists();
  }

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
    renderLists();
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

  // ==================== Render Skip Lists ====================
  function renderLists() {
    renderList(ui.companyList, skippedCompanies, "company");
    renderList(ui.titleList, skippedTitleKeywords, "title");
  }

  const LIST_COLLAPSE_LIMIT = 5;

  function renderList(container, items, type) {
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (items.length === 0) {
      const hint = type === "company" ? "Add a company to start skipping" : "Add a keyword to filter titles";
      container.appendChild(el("div", { className: "lj-empty", textContent: hint }));
      return;
    }

    const expanded = container._ljExpanded || false;
    const showAll = expanded || items.length <= LIST_COLLAPSE_LIMIT;
    const visible = showAll ? items : items.slice(0, LIST_COLLAPSE_LIMIT);

    visible.forEach((name, i) => {
      const removeBtn = el("button", {
        className: "lj-x",
        textContent: "\u00d7",
        onClick: (e) => {
          e.stopPropagation();
          removeFromList(type, i);
        }
      });
      const item = el("div", { className: "lj-item" }, [
        el("span", { textContent: name }),
        removeBtn
      ]);
      container.appendChild(item);
    });

    if (items.length > LIST_COLLAPSE_LIMIT) {
      const hidden = items.length - LIST_COLLAPSE_LIMIT;
      const toggleBtn = el("button", {
        className: "lj-list-toggle",
        textContent: expanded ? "Show less" : "+" + hidden + " more...",
        onClick: () => {
          container._ljExpanded = !expanded;
          renderList(container, items, type);
        }
      });
      container.appendChild(toggleBtn);
    }
  }

  function removeFromList(type, index) {
    const list = type === "company" ? skippedCompanies : skippedTitleKeywords;
    const key = type === "company" ? "skippedCompanies" : "skippedTitleKeywords";
    const reason = type === "company" ? "skippedCompany" : "skippedTitle";
    list.splice(index, 1);
    saveValue(key, list);
    renderLists();

    // Remove this reason from multi-label cards
    document.querySelectorAll("[data-lj-reasons]").forEach((card) => {
      const reasons = card.dataset.ljReasons.split(",");
      const idx = reasons.indexOf(reason);
      if (idx === -1) return;
      reasons.splice(idx, 1);
      // Sync cleanup of memory Map
      const jobKey = getJobKey(card);
      if (jobKey && labeledJobs.has(jobKey)) labeledJobs.get(jobKey).delete(reason);
      if (reasons.length === 0) {
        delete card.dataset.ljReasons;
        delete card.dataset.ljFiltered;
        if (jobKey) labeledJobs.delete(jobKey);
        clearBadges(card);
      } else {
        card.dataset.ljReasons = reasons.join(",");
        card.dataset.ljFiltered = getBorderReason(reasons);
        applyBadges(card);
      }
      processedCards.delete(card);
    });
    filterJobCards();
  }

  // ==================== Auto-Scan ====================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function waitForDetailChange(oldFingerprint, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = setInterval(() => {
        const current = getDetailFingerprint();
        if ((current && current !== oldFingerprint) || Date.now() - start > timeoutMs) {
          clearInterval(poll);
          resolve();
        }
      }, 300);
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
      updateScanButton("Scanning 0/" + total + "...", 0);

      for (let i = 0; i < toScan.length; i++) {
        if (scanAbort) break;
        const card = toScan[i];
        if (card.dataset.ljReasons) continue;

        updateScanButton("Scanning " + (i + 1) + "/" + total + "...", ((i + 1) / total) * 100);

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
    } catch (err) {
      console.error("[JobLens] Scan error:", err);
      showToast("Scan error: " + err.message);
    }

    scanning = false;
    scanAbort = false;

    // Restore all lost badges immediately + with delays after scan completes
    refreshBadges();
    setTimeout(refreshBadges, 1000);
    setTimeout(refreshBadges, 3000);

    const flagged = getJobCards().filter(c => c.dataset.ljReasons).length;
    showScanDone(flagged);
  }

  function updateScanButton(text, progress) {
    const btn = ui.scanBtn;
    if (!btn) return;
    btn.classList.remove("scan-done");
    if (scanning && !scanAbort) {
      btn.textContent = text || "Stop Scan";
      btn.classList.add("scanning");
      // Progress bar
      let bar = btn.querySelector(".lj-scan-progress");
      if (!bar) {
        bar = document.createElement("div");
        bar.className = "lj-scan-progress";
        btn.appendChild(bar);
      }
      bar.style.width = (progress || 0) + "%";
    } else {
      btn.textContent = "Scan Jobs";
      btn.classList.remove("scanning");
      const bar = btn.querySelector(".lj-scan-progress");
      if (bar) bar.remove();
    }
  }

  function showScanDone(flagged) {
    const btn = ui.scanBtn;
    if (!btn) return;
    btn.classList.remove("scanning");
    btn.classList.add("scan-done");
    const bar = btn.querySelector(".lj-scan-progress");
    if (bar) bar.remove();
    btn.textContent = flagged === 0
      ? "Scan complete \u2014 all clear"
      : "Scan complete \u2014 " + flagged + " flagged";
  }

  // ==================== Initialization ====================
  async function init() {
    if (!isSearchPage()) return;
    await loadSettings();
    createUI();
    filterJobCards();
    checkDetailPanel();

    // First-use hint
    if (!hasSeenIntro) {
      showToast("Click Scan Jobs to filter all visible listings");
      hasSeenIntro = true;
      saveValue("hasSeenIntro", true);
    }
  }

  if (document.readyState === "complete") {
    setTimeout(init, 1500);
  } else {
    window.addEventListener("load", () => setTimeout(init, 1500));
  }

  // ==================== Keyboard Shortcut (Ctrl/Cmd + Shift + J) ====================
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "J" || e.key === "j")) {
      e.preventDefault();
      const panel = document.getElementById("lj-filter-panel");
      if (panel) {
        panel.classList.toggle("collapsed");
        const togBtn = panel.querySelector(".lj-toggle");
        if (togBtn) togBtn.textContent = panel.classList.contains("collapsed") ? "+" : "\u2212";
      }
    }
  });

  // ==================== Unified Observer (DOM mutation handling + SPA route detection) ====================
  let filterTimer = null;
  let detailTimer = null;
  let badgeTimer = null;
  let lastUrl = location.href;

  new MutationObserver(() => {
    const onSearch = isSearchPage();

    // SPA route change
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (onSearch && !scanning) {
        // Search page route change → reset state and re-initialize
        processedCards = new WeakSet();
        scannedCards = new WeakSet();
        labeledJobs.clear();
        scanAbort = false;
        lastDetailText = "";
        setTimeout(() => {
          if (!document.getElementById("lj-filter-panel")) init();
          else filterJobCards();
        }, 2000);
      } else if (!onSearch) {
        // Left search page → remove panel
        const panel = document.getElementById("lj-filter-panel");
        if (panel) panel.remove();
      }
    }

    // Skip filtering logic on non-search pages
    if (!onSearch) return;

    // Card filtering (200ms debounce)
    clearTimeout(filterTimer);
    filterTimer = setTimeout(filterJobCards, 200);

    // Detail panel detection (600ms debounce)
    clearTimeout(detailTimer);
    detailTimer = setTimeout(checkDetailPanel, 600);

    // Badge restoration (independent 1s debounce to avoid frequent DOM queries)
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(refreshBadges, 1000);
  }).observe(document.body, { childList: true, subtree: true });
})();
