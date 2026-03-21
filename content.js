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

  // src/shared/matching.js
  function keywordsToRegex(keywords) {
    return new RegExp(
      keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
      "i"
    );
  }

  // src/content.js
  if (chrome.runtime?.id && !window.__ljContentLoaded) {
    let getBorderReason = function(reasons) {
      for (const r of BORDER_PRIORITY) {
        if (reasons.includes(r)) return r;
      }
      return reasons[0];
    }, isSearchPage = function() {
      return /\/jobs\/search-results\//.test(location.href);
    }, saveValue = function(key, value) {
      chrome.storage.local.set({ [key]: value });
    }, incrementStat = function(key, amount = 1) {
      pendingStats[key] = (pendingStats[key] || 0) + amount;
      if (!flushTimer) {
        flushTimer = setTimeout(flushStats, 500);
      }
    }, flushStats = function() {
      flushTimer = null;
      const batch = pendingStats;
      pendingStats = {};
      if (Object.keys(batch).length === 0) return;
      chrome.storage.local.get({ stats: {}, statsAllTime: {} }, (d) => {
        const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        if (d.stats.today !== today) d.stats = { today };
        for (const [key, count] of Object.entries(batch)) {
          d.stats[key] = (d.stats[key] || 0) + count;
          d.statsAllTime[key] = (d.statsAllTime[key] || 0) + count;
        }
        chrome.storage.local.set({ stats: d.stats, statsAllTime: d.statsAllTime });
      });
    }, el = function(tag, attrs, children) {
      const e = document.createElement(tag);
      if (attrs) {
        Object.entries(attrs).forEach(([k, v]) => {
          if (k === "className") e.className = v;
          else if (k === "textContent") e.textContent = v;
          else if (k.startsWith("on") && k.length > 2 && k[2] === k[2].toUpperCase()) e.addEventListener(k.slice(2).toLowerCase(), v);
          else e.setAttribute(k, v);
        });
      }
      if (children) {
        (Array.isArray(children) ? children : [children]).forEach((child) => {
          if (typeof child === "string") e.appendChild(document.createTextNode(child));
          else if (child) e.appendChild(child);
        });
      }
      return e;
    }, getJobCards = function() {
      const dismissBtns = document.querySelectorAll('button[aria-label*="Dismiss"]');
      if (dismissBtns.length < 2) return [];
      const cards = [];
      const seen = /* @__PURE__ */ new WeakSet();
      dismissBtns.forEach((btn) => {
        let e = btn.parentElement;
        for (let i = 0; i < 12; i++) {
          if (!e || !e.parentElement) break;
          const parentDismissCount = e.parentElement.querySelectorAll('button[aria-label*="Dismiss"]').length;
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
    }, getVisibleEl = function(card) {
      if (getComputedStyle(card).display !== "contents") return card;
      for (const child of card.children) {
        const d = getComputedStyle(child).display;
        if (d !== "contents" && d !== "none") return child;
      }
      for (const child of card.children) {
        for (const gc of child.children) {
          const d = getComputedStyle(gc).display;
          if (d !== "contents" && d !== "none") return gc;
        }
      }
      return card;
    }, getLastVisibleEl = function(card) {
      if (getComputedStyle(card).display !== "contents") return card;
      const children = [...card.children];
      for (let i = children.length - 1; i >= 0; i--) {
        const d = getComputedStyle(children[i]).display;
        if (d !== "contents" && d !== "none") return children[i];
      }
      return getVisibleEl(card);
    }, getCardJobId = function(card) {
      const links = card.querySelectorAll("a");
      for (const link of links) {
        const viewMatch = link.href.match(/\/jobs\/view\/(\d+)/);
        if (viewMatch) return viewMatch[1];
        try {
          const u = new URL(link.href);
          const id = u.searchParams.get("currentJobId");
          if (id) return id;
        } catch {
        }
      }
      return null;
    }, getJobKey = function(card) {
      const id = getCardJobId(card);
      if (id) return "id:" + id;
      return getJobTitle(card) + "|" + getCompanyName(card);
    }, getJobTitle = function(card) {
      const dismiss = card.querySelector('button[aria-label*="Dismiss"]');
      if (dismiss) {
        const label = dismiss.getAttribute("aria-label") || "";
        const match = label.match(/^Dismiss\s+(.+?)\s+job$/);
        if (match) return match[1];
      }
      const lines = getCardTextLines(card);
      return lines[1] || lines[0] || "";
    }, getCompanyName = function(card) {
      const lines = getCardTextLines(card);
      if (lines.length >= 3) {
        if (lines[0].includes("(Verified")) return lines[2] || "";
        return lines[1] || "";
      }
      return lines.length >= 2 ? lines[1] : "";
    }, getCardTextLines = function(card) {
      return card.innerText.split("\n").map((l) => l.trim()).filter((l) => l && l !== "\xB7" && !BADGE_TEXTS.has(l));
    }, cardHasRepostedText = function(card) {
      return card.textContent.toLowerCase().includes("reposted");
    }, cardHasAppliedText = function(card) {
      for (const el2 of card.querySelectorAll("span, li, time, p")) {
        if (el2.children.length === 0 && el2.textContent.trim() === "Applied" && !el2.closest(".lj-badges")) {
          return true;
        }
      }
      return false;
    }, detailPanelHasReposted = function() {
      const detail = document.querySelector(".jobs-details") || document.querySelector("article") || document.body;
      const candidates = detail.querySelectorAll("strong, span");
      for (const node of candidates) {
        if (node.children.length > 0) continue;
        const t = node.textContent.trim();
        if (t.length > 0 && t.length < 80 && t.toLowerCase().startsWith("reposted")) {
          if (!node.closest("#lj-filter-panel") && !node.closest(".lj-badges")) return true;
        }
      }
      return false;
    }, isSkippedCompany = function(card) {
      const name = getCompanyName(card).toLowerCase();
      if (!name) return false;
      return skippedCompanies.some((b) => name === b.toLowerCase());
    }, isSkippedTitle = function(card) {
      if (skippedTitleKeywords.length === 0) return false;
      const title = getJobTitle(card).toLowerCase();
      if (!title) return false;
      return skippedTitleKeywords.some((kw) => title.includes(kw.toLowerCase()));
    }, getDetailText = function() {
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
    }, detailHasNoSponsorship = function() {
      return NO_SPONSOR_RE.test(getDetailText());
    }, detailHasUnpaid = function() {
      return UNPAID_RE.test(getDetailText());
    }, getDetailFingerprint = function() {
      const titleLink = document.querySelector('a[href*="/jobs/view/"]');
      if (titleLink) {
        const text2 = titleLink.textContent.trim();
        if (text2.length > 3) return text2;
      }
      const text = getDetailText();
      return text ? text.trim().substring(0, 200) : "";
    }, labelCard = function(card, reason) {
      const existing = card.dataset.ljReasons ? card.dataset.ljReasons.split(",") : [];
      if (existing.includes(reason)) return false;
      existing.push(reason);
      card.dataset.ljReasons = existing.join(",");
      card.dataset.ljFiltered = getBorderReason(existing);
      const key = getJobKey(card);
      if (key) {
        if (!labeledJobs.has(key)) labeledJobs.set(key, /* @__PURE__ */ new Set());
        labeledJobs.get(key).add(reason);
      }
      applyBadges(card);
      incrementStat("jobsFlagged");
      return true;
    }, clearBadges = function(card) {
      const target = getVisibleEl(card);
      const badgeTarget = getLastVisibleEl(card);
      card.querySelectorAll(".lj-badges").forEach((b) => b.remove());
      for (const el2 of [target, badgeTarget]) {
        if (el2 !== card) {
          el2.querySelectorAll(".lj-badges").forEach((b) => b.remove());
          el2.style.borderLeft = "";
          el2.style.position = "";
          el2.style.overflow = "";
        }
      }
    }, applyBadges = function(card) {
      const reasons = card.dataset.ljReasons ? card.dataset.ljReasons.split(",") : [];
      if (reasons.length === 0) return;
      const target = getVisibleEl(card);
      const badgeTarget = getLastVisibleEl(card);
      const existing = badgeTarget.querySelector(".lj-badges");
      if (existing && existing.dataset.r === card.dataset.ljReasons) return;
      clearBadges(card);
      target.style.position = "relative";
      target.style.overflow = "visible";
      target.style.borderLeft = "3px solid " + BADGE_COLOR;
      if (badgeTarget !== target) {
        badgeTarget.style.position = "relative";
        badgeTarget.style.overflow = "visible";
        badgeTarget.style.borderLeft = "3px solid " + BADGE_COLOR;
      }
      const container = document.createElement("div");
      container.className = "lj-badges";
      container.dataset.r = card.dataset.ljReasons;
      reasons.forEach((reason) => {
        const badge = document.createElement("span");
        badge.className = "lj-badge";
        badge.textContent = BADGE_DISPLAY[reason] || reason;
        badge.style.background = BADGE_COLOR;
        container.appendChild(badge);
      });
      badgeTarget.appendChild(container);
      if (cardsHidden) target.classList.add("lj-card-hidden");
      else if (cardsDimmed) target.classList.add("lj-card-dimmed");
    }, refreshBadges = function() {
      document.querySelectorAll("[data-lj-reasons]").forEach((card) => {
        const badgeTarget = getLastVisibleEl(card);
        const existing = badgeTarget.querySelector(".lj-badges");
        if (!existing || existing.dataset.r !== card.dataset.ljReasons) {
          applyBadges(card);
        }
      });
      if (labeledJobs.size > 0) {
        getJobCards().forEach((card) => {
          if (card.dataset.ljReasons) return;
          const key = getJobKey(card);
          const reasons = labeledJobs.get(key);
          if (!reasons || reasons.size === 0) return;
          const arr = [...reasons];
          card.dataset.ljReasons = arr.join(",");
          card.dataset.ljFiltered = getBorderReason(arr);
          applyBadges(card);
          processedCards.add(card);
        });
      }
    }, getActiveCard = function() {
      const cards = getJobCards();
      if (cards.length === 0) return null;
      const urlMatch = location.href.match(/currentJobId=(\d+)/);
      if (urlMatch) {
        const jobId = urlMatch[1];
        for (const card of cards) {
          if (getCardJobId(card) === jobId) return card;
        }
      }
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
            if (cardTitle === detailTitle) {
              exactMatch = card;
              break;
            }
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
    }, filterJobCards = function() {
      const cards = getJobCards();
      cards.forEach((card) => {
        if (!card.dataset.ljReasons?.includes("applied") && cardHasAppliedText(card)) {
          labelCard(card, "applied");
        }
        if (!card.dataset.ljReasons?.includes("skippedCompany") && isSkippedCompany(card)) {
          labelCard(card, "skippedCompany");
        }
        if (!card.dataset.ljReasons?.includes("skippedTitle") && isSkippedTitle(card)) {
          labelCard(card, "skippedTitle");
        }
        if (processedCards.has(card)) return;
        processedCards.add(card);
        if (cardHasRepostedText(card)) labelCard(card, "reposted");
      });
    }, checkDetailForCard = function(card) {
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
    }, checkDetailPanel = function() {
      const fingerprint = getDetailFingerprint();
      if (!fingerprint || fingerprint === lastDetailText) return;
      const activeCard = getActiveCard();
      if (!activeCard) return;
      lastDetailText = fingerprint;
      const labeled = checkDetailForCard(activeCard);
      if (labeled && !scanning) {
        const reasons = (activeCard.dataset.ljReasons || "").split(",");
        showToast("Flagged: " + reasons.map((r) => BADGE_DISPLAY[r] || r).join(", "));
      }
    }, clickCard = function(card) {
      if (!card) return;
      const roleBtn = card.querySelector('div[role="button"]');
      const link = card.querySelector("a");
      const visible = getVisibleEl(card);
      const target = roleBtn || link || (visible !== card ? visible : card);
      target.click();
      target.focus();
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true
      }));
      target.dispatchEvent(new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true
      }));
    }, showToast = function(message) {
      const existing = document.getElementById("lj-toast");
      if (existing) existing.remove();
      const toast = document.createElement("div");
      toast.id = "lj-toast";
      toast.textContent = message;
      Object.assign(toast.style, {
        position: "fixed",
        bottom: "30px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#1F2328",
        color: "#FAF7F2",
        padding: "10px 24px",
        borderRadius: "8px",
        fontFamily: "'EB Garamond',Garamond,serif",
        fontSize: "14px",
        fontWeight: "600",
        zIndex: "99999",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        transition: "opacity 0.3s"
      });
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
      }, 2e3);
    }, injectStyles = function() {
      if (document.getElementById("lj-filter-styles")) return;
      if (!document.getElementById("lj-font-link") && !document.querySelector('link[href*="EB+Garamond"]')) {
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
        // Recent item display (replaces full list in floating panel)
        ".lj-recent{display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px;color:#5A636B}",
        ".lj-recent-hint{font-style:italic;color:#8A939B}",
        ".lj-recent-count{color:#8A939B;flex-shrink:0}",
        ".lj-recent-last{color:#1F2328;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}",
        ".lj-x{background:none;border:none;color:#D9797B;cursor:pointer;font-size:16px;padding:0 2px;line-height:1;flex-shrink:0}",
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
        // Dimmed / hidden card styles
        ".lj-card-dimmed{opacity:0.35 !important;transition:opacity 0.2s}",
        ".lj-card-hidden{display:none !important}",
        ".lj-card-dimmed:hover{opacity:0.7 !important}",
        // Card border (brand rose)
        "[data-lj-filtered]{border-left:3px solid #D9797B !important;position:relative !important;overflow:visible !important}",
        // Badge container
        ".lj-badges{position:absolute !important;left:0 !important;bottom:4px !important;z-index:10 !important;display:flex !important;flex-direction:column !important;gap:2px !important;pointer-events:none !important}",
        ".lj-badge{font-size:9px !important;font-weight:700 !important;padding:1px 6px !important;border-radius:8px !important;color:#fff !important;white-space:nowrap !important;line-height:1.4 !important;letter-spacing:0.3px !important}",
        // Responsive breakpoints
        "@media(max-width:1024px){#lj-filter-panel{font-size:12.5px}.lj-header h3{font-size:13.5px}}",
        "@media(max-width:768px){#lj-filter-panel{font-size:12px}.lj-header h3{font-size:13px}.lj-body{padding:10px 12px;max-height:clamp(200px,50vh,60vh)}.lj-add button{padding:6px 8px;font-size:11px}}",
        "@media(max-width:600px){#lj-filter-panel{font-size:11.5px}.lj-header h3{font-size:12px}.lj-body{padding:8px 10px;max-height:clamp(180px,45vh,50vh)}}"
      ].join("\n");
      document.head.appendChild(style);
    }, clampPanelPosition = function(panel) {
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
    }, createUI = function() {
      if (document.getElementById("lj-filter-panel")) return;
      injectStyles();
      const panel = el("div", { id: "lj-filter-panel" });
      const togBtn = el("button", { className: "lj-toggle", textContent: "\u2212" });
      const header = el("div", { className: "lj-header" }, [
        el("h3", { textContent: "Sift" }),
        togBtn
      ]);
      let dragState = null;
      header.addEventListener("mousedown", (e) => {
        if (e.target === togBtn) return;
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
          panel.style.left = dragState.origLeft + dx + "px";
          panel.style.top = dragState.origTop + dy + "px";
        }
      });
      document.addEventListener("mouseup", () => {
        if (dragState && dragState.dragged) {
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
        onClick: () => {
          if (scanning) {
            scanAbort = true;
          } else {
            autoScanCards();
          }
        }
      });
      function batchAdd(raw, list, storageKey) {
        const items = raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
        let added = 0;
        items.forEach((name) => {
          if (!list.some((c) => c.toLowerCase() === name.toLowerCase())) {
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
      ui.companyRecent = el("div", { className: "lj-recent" });
      const companyInput = el("input", { type: "text", placeholder: "Company name..." });
      const companyAddBtn = el("button", { textContent: "Add", onClick: () => {
        const raw = companyInput.value.trim();
        if (!raw) return;
        batchAdd(raw, skippedCompanies, "skippedCompanies");
        companyInput.value = "";
      } });
      companyInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") companyAddBtn.click();
      });
      const skipCurrentBtn = el("button", {
        className: "lj-quick-skip-btn",
        textContent: "Skip Current Company",
        onClick: skipCurrentCompany
      });
      const companySection = el("div", { className: "lj-section" }, [
        el("span", { className: "lj-label", textContent: "Skipped Companies" }),
        ui.companyRecent,
        el("div", { className: "lj-add" }, [companyInput, companyAddBtn]),
        el("div", { className: "lj-quick-skip" }, [skipCurrentBtn])
      ]);
      ui.titleRecent = el("div", { className: "lj-recent" });
      const titleInput = el("input", { type: "text", placeholder: "Keyword..." });
      const titleAddBtn = el("button", { textContent: "Add", onClick: () => {
        const raw = titleInput.value.trim();
        if (!raw) return;
        batchAdd(raw, skippedTitleKeywords, "skippedTitleKeywords");
        titleInput.value = "";
      } });
      titleInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") titleAddBtn.click();
      });
      const titleSection = el("div", { className: "lj-section" }, [
        el("span", { className: "lj-label", textContent: "Skipped Title Keywords" }),
        ui.titleRecent,
        el("div", { className: "lj-add" }, [titleInput, titleAddBtn])
      ]);
      const feedbackLink = el("a", {
        className: "lj-feedback",
        textContent: "Shape Sift \u2192",
        href: "https://kunli.co/joblens",
        target: "_blank"
      });
      body.appendChild(companySection);
      body.appendChild(titleSection);
      body.appendChild(ui.scanBtn);
      body.appendChild(feedbackLink);
      panel.appendChild(header);
      panel.appendChild(body);
      document.body.appendChild(panel);
      if (panelPosition) {
        panel.style.left = panelPosition.left + "px";
        panel.style.top = panelPosition.top + "px";
        clampPanelPosition(panel);
      }
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
    }, skipCurrentCompany = function() {
      const activeCard = getActiveCard();
      if (!activeCard) {
        showToast("No active job selected");
        return;
      }
      const name = getCompanyName(activeCard);
      if (!name) {
        showToast("Could not detect company name");
        return;
      }
      if (skippedCompanies.some((c) => c.toLowerCase() === name.toLowerCase())) {
        showToast("\u201C" + name + "\u201D already skipped");
        return;
      }
      skippedCompanies.push(name);
      saveValue("skippedCompanies", skippedCompanies);
      renderLists();
      refilterAll();
      showToast("Skipped: " + name);
    }, refilterAll = function() {
      const cards = getJobCards();
      cards.forEach((card) => {
        if (isSkippedCompany(card)) labelCard(card, "skippedCompany");
        if (isSkippedTitle(card)) labelCard(card, "skippedTitle");
      });
    }, renderLists = function() {
      renderRecent(ui.companyRecent, skippedCompanies, "company");
      renderRecent(ui.titleRecent, skippedTitleKeywords, "title");
    }, renderRecent = function(container, items, type) {
      if (!container) return;
      while (container.firstChild) container.removeChild(container.firstChild);
      if (items.length === 0) {
        container.appendChild(el("span", { className: "lj-recent-hint", textContent: "None yet" }));
        return;
      }
      const last = items[items.length - 1];
      const lastIdx = items.length - 1;
      const countText = items.length + " total";
      const removeBtn = el("button", {
        className: "lj-x",
        textContent: "\xD7",
        title: "Remove \u201C" + last + "\u201D",
        onClick: (e) => {
          e.stopPropagation();
          removeFromList(type, lastIdx);
        }
      });
      container.appendChild(el("span", { className: "lj-recent-count", textContent: countText }));
      container.appendChild(el("span", { className: "lj-recent-last", textContent: "Last: " + last }));
      container.appendChild(removeBtn);
    }, removeFromList = function(type, index) {
      const list = type === "company" ? skippedCompanies : skippedTitleKeywords;
      const key = type === "company" ? "skippedCompanies" : "skippedTitleKeywords";
      const reason = type === "company" ? "skippedCompany" : "skippedTitle";
      list.splice(index, 1);
      saveValue(key, list);
      renderLists();
      document.querySelectorAll("[data-lj-reasons]").forEach((card) => {
        const reasons = card.dataset.ljReasons.split(",");
        const idx = reasons.indexOf(reason);
        if (idx === -1) return;
        reasons.splice(idx, 1);
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
    }, sleep = function(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }, waitForDetailChange = function(oldFingerprint, timeoutMs = 5e3) {
      return new Promise((resolve) => {
        const detailContainer = document.querySelector("main") || document.body;
        let settled = false;
        function settle() {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timeout);
          resolve();
        }
        const observer = new MutationObserver(() => {
          const current2 = getDetailFingerprint();
          if (current2 && current2 !== oldFingerprint) settle();
        });
        observer.observe(detailContainer, { childList: true, subtree: true, characterData: true });
        const timeout = setTimeout(settle, timeoutMs);
        const current = getDetailFingerprint();
        if (current && current !== oldFingerprint) settle();
      });
    }, updateScanButton = function(text, progress) {
      const btn = ui.scanBtn;
      if (!btn) return;
      btn.classList.remove("scan-done");
      if (scanning && !scanAbort) {
        btn.textContent = text || "Stop Scan";
        btn.classList.add("scanning");
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
    }, showScanDone = function(flagged) {
      const btn = ui.scanBtn;
      if (!btn) return;
      btn.classList.remove("scanning");
      btn.classList.add("scan-done");
      const bar = btn.querySelector(".lj-scan-progress");
      if (bar) bar.remove();
      btn.textContent = flagged === 0 ? "Scan complete \u2014 all clear" : "Scan complete \u2014 " + flagged + " flagged";
    }, handleRouteChange = function() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      const onSearch = isSearchPage();
      if (onSearch && !scanning) {
        processedCards = /* @__PURE__ */ new WeakSet();
        scannedCards = /* @__PURE__ */ new WeakSet();
        labeledJobs.clear();
        scanAbort = false;
        lastDetailText = "";
        setTimeout(() => {
          if (!document.getElementById("lj-filter-panel")) init();
          else filterJobCards();
          attachJobsObserver();
        }, 2e3);
      } else if (!onSearch) {
        const panel = document.getElementById("lj-filter-panel");
        if (panel) panel.remove();
      }
    }, onJobsMutation = function() {
      if (!isSearchPage()) return;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(filterJobCards, 200);
      clearTimeout(detailTimer);
      detailTimer = setTimeout(checkDetailPanel, 600);
      clearTimeout(badgeTimer);
      badgeTimer = setTimeout(refreshBadges, 1e3);
    }, attachJobsObserver = function() {
      if (jobsObserver) jobsObserver.disconnect();
      jobsObserver = new MutationObserver(onJobsMutation);
      const container = document.querySelector(".jobs-search-results-list") || document.querySelector("main");
      if (!container) return;
      jobsObserver.observe(container, { childList: true, subtree: true });
      if (container.classList.contains("jobs-search-results-list")) {
        const main = document.querySelector("main");
        if (main && main !== container) {
          jobsObserver.observe(main, { childList: true, subtree: true });
        }
      }
    };
    window.__ljContentLoaded = true;
    const NO_SPONSOR_KEYWORDS = [
      "does not sponsor",
      "do not sponsor",
      "not sponsor",
      "no sponsorship",
      "unable to sponsor",
      "will not sponsor",
      "cannot sponsor",
      "won't sponsor",
      "can't sponsor",
      "doesn't sponsor",
      "not able to sponsor",
      "without sponsorship",
      "sponsorship is not available",
      "not offer sponsorship",
      "not provide sponsorship",
      "sponsorship not available",
      "not eligible for sponsorship",
      "no visa sponsorship",
      "not offering sponsorship",
      "unable to provide sponsorship",
      "we are unable to sponsor",
      "we do not offer sponsorship",
      "must be authorized to work",
      "must have authorization to work",
      "without the need for sponsorship",
      "without requiring sponsorship"
    ];
    const NO_SPONSOR_RE = keywordsToRegex(NO_SPONSOR_KEYWORDS);
    const UNPAID_KEYWORDS = [
      "unpaid",
      "unpaid internship",
      "unpaid position",
      "no compensation",
      "without compensation",
      "uncompensated",
      "volunteer position",
      "volunteer opportunity",
      "volunteer role",
      "pro bono",
      "this is a volunteer"
    ];
    const UNPAID_RE = keywordsToRegex(UNPAID_KEYWORDS);
    const BADGE_DISPLAY = {
      reposted: "Reposted",
      applied: "Applied",
      noSponsor: "No Sponsor",
      skippedCompany: "Skipped Co.",
      skippedTitle: "Skipped Title",
      unpaid: "Unpaid"
    };
    const BADGE_COLOR = "#D9797B";
    const BORDER_PRIORITY = ["noSponsor", "reposted", "skippedCompany", "skippedTitle", "applied", "unpaid"];
    let skippedCompanies = [];
    let skippedTitleKeywords = [];
    let sponsorCheckEnabled = true;
    let unpaidCheckEnabled = true;
    let processedCards = /* @__PURE__ */ new WeakSet();
    let lastDetailText = "";
    const labeledJobs = /* @__PURE__ */ new Map();
    let scannedCards = /* @__PURE__ */ new WeakSet();
    let scanning = false;
    let scanAbort = false;
    let cardsDimmed = false;
    let cardsHidden = false;
    const SCAN_DELAY_MS = 1500;
    let ui = {};
    let hasSeenIntro = false;
    let panelPosition = null;
    const _defaults = SIFT_DEFAULTS;
    async function loadSettings() {
      const data = await chrome.storage.local.get({
        skippedCompanies: _defaults.skippedCompanies || [],
        skippedTitleKeywords: _defaults.skippedTitleKeywords || [],
        sponsorCheckEnabled: _defaults.sponsorCheckEnabled ?? true,
        unpaidCheckEnabled: _defaults.unpaidCheckEnabled ?? true,
        hasSeenIntro: false,
        panelPosition: null,
        dimFiltered: _defaults.dimFiltered ?? false,
        hideFiltered: _defaults.hideFiltered ?? false
      });
      skippedCompanies = data.skippedCompanies;
      skippedTitleKeywords = data.skippedTitleKeywords;
      sponsorCheckEnabled = data.sponsorCheckEnabled;
      unpaidCheckEnabled = data.unpaidCheckEnabled;
      hasSeenIntro = data.hasSeenIntro;
      panelPosition = data.panelPosition;
      cardsDimmed = data.dimFiltered;
      cardsHidden = data.hideFiltered;
    }
    let pendingStats = {};
    let flushTimer = null;
    const BADGE_TEXTS = new Set(Object.values(BADGE_DISPLAY));
    async function autoScanCards() {
      if (scanning) {
        scanAbort = true;
        return;
      }
      scanning = true;
      scanAbort = false;
      try {
        const cards = getJobCards();
        const toScan = cards.filter((c) => !scannedCards.has(c) && !c.dataset.ljReasons);
        const total2 = toScan.length;
        updateScanButton("Scanning 0/" + total2 + "...", 0);
        for (let i = 0; i < toScan.length; i++) {
          if (scanAbort) break;
          const card = toScan[i];
          if (card.dataset.ljReasons) continue;
          updateScanButton("Scanning " + (i + 1) + "/" + total2 + "...", (i + 1) / total2 * 100);
          const oldFp = getDetailFingerprint();
          clickCard(card);
          await waitForDetailChange(oldFp);
          await sleep(500);
          checkDetailForCard(card);
          scannedCards.add(card);
          if (i < toScan.length - 1 && !scanAbort) {
            await sleep(SCAN_DELAY_MS);
          }
        }
      } catch (err) {
        console.error("[Sift] Scan error:", err);
        showToast("Scan error: " + err.message);
      }
      scanning = false;
      scanAbort = false;
      setTimeout(refreshBadges, 500);
      const flagged = getJobCards().filter((c) => c.dataset.ljReasons).length;
      showScanDone(flagged);
      let total = 0;
      try {
        total = getJobCards().filter((c) => scannedCards.has(c)).length;
      } catch (_) {
      }
      if (total > 0) incrementStat("jobsScanned", total);
    }
    async function init() {
      if (!isSearchPage()) return;
      await loadSettings();
      createUI();
      filterJobCards();
      checkDetailPanel();
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
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        const panel = document.getElementById("lj-filter-panel");
        if (panel) {
          panel.classList.toggle("collapsed");
          const togBtn = panel.querySelector(".lj-toggle");
          if (togBtn) togBtn.textContent = panel.classList.contains("collapsed") ? "+" : "\u2212";
        }
      }
    });
    let lastUrl = location.href;
    window.addEventListener("popstate", handleRouteChange);
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function() {
      origPushState.apply(this, arguments);
      handleRouteChange();
    };
    history.replaceState = function() {
      origReplaceState.apply(this, arguments);
      handleRouteChange();
    };
    setInterval(() => {
      if (location.href !== lastUrl) handleRouteChange();
    }, 1e3);
    let filterTimer = null;
    let detailTimer = null;
    let badgeTimer = null;
    let jobsObserver = null;
    if (document.querySelector("main") || document.querySelector(".jobs-search-results-list")) {
      attachJobsObserver();
    } else {
      let bootTicks = 0;
      const bootPoll = setInterval(() => {
        if (document.querySelector("main") || document.querySelector(".jobs-search-results-list")) {
          clearInterval(bootPoll);
          attachJobsObserver();
        } else if (++bootTicks >= 15) {
          clearInterval(bootPoll);
        }
      }, 500);
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const settingKeys = [
        "skippedCompanies",
        "skippedTitleKeywords",
        "sponsorCheckEnabled",
        "unpaidCheckEnabled",
        "dimFiltered",
        "hideFiltered"
      ];
      const hasSettingChange = settingKeys.some((k) => k in changes);
      if (!hasSettingChange) return;
      chrome.storage.local.get({
        skippedCompanies: [],
        skippedTitleKeywords: [],
        sponsorCheckEnabled: true,
        unpaidCheckEnabled: true,
        dimFiltered: false,
        hideFiltered: false
      }, (data) => {
        skippedCompanies = data.skippedCompanies;
        skippedTitleKeywords = data.skippedTitleKeywords;
        sponsorCheckEnabled = data.sponsorCheckEnabled;
        unpaidCheckEnabled = data.unpaidCheckEnabled;
        cardsDimmed = data.dimFiltered;
        cardsHidden = data.hideFiltered;
        renderLists();
        processedCards = /* @__PURE__ */ new WeakSet();
        filterJobCards();
      });
    });
  }
})();
