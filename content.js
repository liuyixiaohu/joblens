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

  // Badge 显示名和颜色
  const BADGE_DISPLAY = {
    reposted: "Reposted", applied: "Applied", noSponsor: "No Sponsor",
    skippedCompany: "Skipped Co.", skippedTitle: "Skipped Title",
    unpaid: "Unpaid",
  };
  const BADGE_COLORS = {
    reposted: "#D9797B", applied: "#D9797B", noSponsor: "#D9797B",
    skippedCompany: "#D9797B", skippedTitle: "#D9797B",
    unpaid: "#D9797B",
  };
  // 边框颜色优先级（第一个匹配的 reason 决定边框色）
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

  // 内存中存储已标记的职位，用于在 LinkedIn 替换 DOM 元素后恢复标签
  // key = jobId（从卡片链接提取），避免同名不同公司的职位互相污染
  const labeledJobs = new Map(); // jobKey → Set<reason>

  // 自动扫描状态
  let scannedCards = new WeakSet();
  let scanning = false;
  let scanAbort = false;
  let cardsDimmed = false;
  const SCAN_DELAY_MS = 1500;

  // UI 元素引用（在 createUI 中设置）
  let ui = {};
  let hasSeenIntro = false;
  let panelPosition = null;

  // 只在搜索结果页激活（/jobs/search/ 和 /jobs/search-results/）
  function isSearchPage() {
    return /\/jobs\/search/.test(location.href);
  }

  // ==================== 存储 ====================
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

  // ==================== DOM 工具函数 ====================
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

  // ==================== 卡片检测（核心） ====================
  // 返回每张卡片的 scope 元素（可能是 display:contents，包含完整文本用于检测）
  // Badge 显示使用 getVisibleEl() 找可见子元素
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

  // 找到卡片的可见子元素（用于 badge/border 显示）
  // display:contents 元素无尺寸，需要找第一个有 layout box 的后代
  function getVisibleEl(card) {
    if (getComputedStyle(card).display !== "contents") return card;
    for (const child of card.children) {
      const d = getComputedStyle(child).display;
      if (d !== "contents" && d !== "none") return child;
    }
    // 嵌套 display:contents 再深一层
    for (const child of card.children) {
      for (const gc of child.children) {
        const d = getComputedStyle(gc).display;
        if (d !== "contents" && d !== "none") return gc;
      }
    }
    return card;
  }

  // ==================== 从卡片提取 jobId ====================
  // LinkedIn 有两种链接格式：
  //   1. /jobs/view/12345  （旧版/详情页）
  //   2. /jobs/search-results/?currentJobId=12345  （搜索结果页）
  function getCardJobId(card) {
    const links = card.querySelectorAll("a");
    for (const link of links) {
      // 格式1: /jobs/view/12345
      const viewMatch = link.href.match(/\/jobs\/view\/(\d+)/);
      if (viewMatch) return viewMatch[1];
      // 格式2: ?currentJobId=12345
      try {
        const u = new URL(link.href);
        const id = u.searchParams.get("currentJobId");
        if (id) return id;
      } catch {}
    }
    return null;
  }

  // ==================== 从卡片提取唯一 key（优先用 jobId） ====================
  function getJobKey(card) {
    const id = getCardJobId(card);
    if (id) return "id:" + id;
    // 备选方案：title + company（极少情况下卡片无链接）
    return getJobTitle(card) + "|" + getCompanyName(card);
  }

  // ==================== 从卡片提取职位标题 ====================
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

  // ==================== 从卡片提取公司名称 ====================
  function getCompanyName(card) {
    const lines = getCardTextLines(card);
    if (lines.length >= 3) {
      if (lines[0].includes("(Verified")) return lines[2] || "";
      return lines[1] || "";
    }
    return lines.length >= 2 ? lines[1] : "";
  }

  // 过滤掉我们插入的 badge 文本，避免干扰标题/公司检测
  const BADGE_TEXTS = new Set(Object.values(BADGE_DISPLAY));
  function getCardTextLines(card) {
    return card.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "·" && l !== "·" && !BADGE_TEXTS.has(l));
  }

  // ==================== 从卡片文本判断是否 Reposted ====================
  function cardHasRepostedText(card) {
    return card.textContent.toLowerCase().includes("reposted");
  }

  // ==================== 从卡片文本判断是否已 Applied ====================
  // 直接查找 leaf DOM 元素 textContent === "Applied"
  // 避免 innerText 因 CSS 将多个兄弟元素拼成一行（"Applied · 1 week ago · Easy Apply"）
  // 也自然排除 "Applied Materials" 等公司名（textContent 不等于 "Applied"）
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

  // ==================== 从详情面板判断是否 Reposted ====================
  function detailPanelHasReposted() {
    // 目标 leaf 元素（LinkedIn 用 <strong> 或 <span> 包裹 "Reposted X ago"）
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

  // ==================== 判断是否跳过公司 ====================
  function isSkippedCompany(card) {
    const name = getCompanyName(card).toLowerCase();
    if (!name) return false;
    return skippedCompanies.some((b) => name === b.toLowerCase());
  }

  // ==================== 判断是否跳过标题关键词 ====================
  function isSkippedTitle(card) {
    if (skippedTitleKeywords.length === 0) return false;
    const title = getJobTitle(card).toLowerCase();
    if (!title) return false;
    return skippedTitleKeywords.some((kw) => title.includes(kw.toLowerCase()));
  }

  // ==================== 提取详情面板 "About the job" 文本（公共函数） ====================
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

  // ==================== 获取当前详情面板的文本指纹 ====================
  function getDetailFingerprint() {
    const titleLink = document.querySelector('a[href*="/jobs/view/"]');
    if (titleLink) {
      const text = titleLink.textContent.trim();
      if (text.length > 3) return text;
    }
    const text = getDetailText();
    return text ? text.trim().substring(0, 200) : "";
  }

  // ==================== 标记卡片（支持多标签） ====================
  function labelCard(card, reason) {
    const existing = card.dataset.ljReasons ? card.dataset.ljReasons.split(",") : [];
    if (existing.includes(reason)) return false;

    existing.push(reason);
    card.dataset.ljReasons = existing.join(",");

    card.dataset.ljFiltered = getBorderReason(existing);

    // 存到内存 Map，即使 DOM 元素被替换也能恢复
    const key = getJobKey(card);
    if (key) {
      if (!labeledJobs.has(key)) labeledJobs.set(key, new Set());
      labeledJobs.get(key).add(reason);
    }

    applyBadges(card);
    return true;
  }

  // 清除卡片上的 badge DOM 和 inline style（scope 元素 + visible 元素都清）
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

  // ==================== Badge DOM 元素（支持多个，垂直排列） ====================
  // Badge 和 border 插入到可见子元素（getVisibleEl），避免 display:contents 导致不可见
  function applyBadges(card) {
    const reasons = card.dataset.ljReasons ? card.dataset.ljReasons.split(",") : [];
    if (reasons.length === 0) return;

    const target = getVisibleEl(card);

    // 已有正确 badge → 跳过
    const existing = target.querySelector(".lj-badges");
    if (existing && existing.dataset.r === card.dataset.ljReasons) return;

    clearBadges(card);

    // 在可见元素上设置 border + position（inline style）
    target.style.position = "relative";
    target.style.overflow = "visible";
    target.style.borderLeft = "3px solid " + (BADGE_COLORS[getBorderReason(reasons)] || "#D9797B");

    const container = document.createElement("div");
    container.className = "lj-badges";
    container.dataset.r = card.dataset.ljReasons;

    reasons.forEach(reason => {
      const badge = document.createElement("span");
      badge.className = "lj-badge";
      badge.textContent = BADGE_DISPLAY[reason] || reason;
      badge.style.background = BADGE_COLORS[reason];
      container.appendChild(badge);
    });

    target.insertBefore(container, target.firstChild);

    // 淡化模式开启时，自动淡化新标记的卡片
    if (cardsDimmed) target.classList.add("lj-card-dimmed");
  }

  // 检查所有已标记的卡片，恢复丢失的 badge
  function refreshBadges() {
    // 1. data 属性还在但 badge DOM 丢失 → 重新插入
    document.querySelectorAll("[data-lj-reasons]").forEach(card => {
      const target = getVisibleEl(card);
      const existing = target.querySelector(".lj-badges");
      if (!existing || existing.dataset.r !== card.dataset.ljReasons) {
        applyBadges(card);
      }
    });

    // 2. data 属性也丢失（DOM 元素被整体替换）→ 从内存 Map 恢复
    if (labeledJobs.size > 0) {
      getJobCards().forEach(card => {
        if (card.dataset.ljReasons) return; // 已有属性，跳过
        const key = getJobKey(card);
        const reasons = labeledJobs.get(key);
        if (!reasons || reasons.size === 0) return;
        // 恢复所有 reason
        const arr = [...reasons];
        card.dataset.ljReasons = arr.join(",");
        card.dataset.ljFiltered = getBorderReason(arr);
        applyBadges(card);
        processedCards.add(card); // 防止 filterJobCards 再次重复标记
      });
    }
  }

  // ==================== 获取当前活跃的卡片 ====================
  function getActiveCard() {
    const cards = getJobCards();
    if (cards.length === 0) return null;

    // 优先用 URL 中的 jobId 精确匹配（兼容两种链接格式）
    const urlMatch = location.href.match(/currentJobId=(\d+)/);
    if (urlMatch) {
      const jobId = urlMatch[1];
      for (const card of cards) {
        if (getCardJobId(card) === jobId) return card;
      }
    }

    // 标题匹配备选方案：
    //   1. 精确匹配（标题完全相同）优先
    //   2. 子字符串匹配中，优先选与详情标题长度最接近的（避免超长标题误匹配）
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
          // 精确匹配最优先
          if (cardTitle === detailTitle) { exactMatch = card; break; }
          // 子字符串匹配：选长度差最小的（而非最长的，避免超集标题误匹配）
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

  // ==================== 过滤列表中的卡片（检查所有条件，不提前退出） ====================
  function filterJobCards() {
    const cards = getJobCards();
    cards.forEach((card) => {
      // Applied 检查不受 processedCards 限制（LinkedIn 渐进渲染，文字可能晚于 DOM 出现）
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

  // ==================== 检查详情面板内容，标记到指定卡片 ====================
  // 扫描路径直接传入卡片引用（100% 准确），被动检测路径用 getActiveCard()
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

  // ==================== 被动检测详情面板（用户手动点击卡片时触发） ====================
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

  // ==================== 点击卡片（多重策略） ====================
  // 优先级：div[role="button"] > 卡片链接 > 可见子元素 > 卡片本身
  // display:contents 元素无布局盒，直接 click() 可能无效
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

  // ==================== 提示消息 ====================
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

  // ==================== 注入 CSS ====================
  function injectStyles() {
    if (document.getElementById("lj-filter-styles")) return;
    // 通过 <link> 标签加载 EB Garamond（避免 @import 被 CSP 拦截）
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
      // 面板（磨砂奶油色）
      "#lj-filter-panel{position:fixed;top:70px;left:20px;z-index:99999;background:rgba(250,247,242,0.82);-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);color:#1F2328;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #E4DDD2;font-family:'EB Garamond',Garamond,'Times New Roman',serif;font-size:13px;width:280px;transition:width 0.2s}",
      "#lj-filter-panel.collapsed{width:auto}",
      "#lj-filter-panel.collapsed .lj-body{display:none}",
      ".lj-header{background:rgba(243,239,231,0.7);padding:10px 14px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none}",
      ".lj-header:active{cursor:grabbing}",
      "#lj-filter-panel.collapsed .lj-header{border-radius:12px}",
      ".lj-header h3{margin:0;font-size:14px;font-weight:600;color:#1F2328}",
      ".lj-body{padding:12px 14px;max-height:70vh;overflow-y:auto}",
      // 扫描按钮
      ".lj-scan-btn{position:relative;overflow:hidden;background:#1F2328;color:#FAF7F2;border:none;border-radius:6px;padding:7px 0;cursor:pointer;font-weight:600;font-size:12px;font-family:'EB Garamond',Garamond,serif;width:100%;margin-top:12px;transition:opacity 0.2s}",
      ".lj-scan-progress{position:absolute;bottom:0;left:0;height:2px;background:rgba(255,255,255,0.4);transition:width 0.3s}",
      ".lj-scan-btn:hover{opacity:0.8}",
      ".lj-scan-btn.scanning{background:#D9797B;color:#fff}",
      ".lj-scan-btn.scan-done{background:#5a8a6e;color:#fff}",
      // 分区
      ".lj-section{margin-bottom:12px;border-top:1px solid #E4DDD2;padding-top:10px}",
      ".lj-section:first-of-type{border-top:none;padding-top:0}",
      ".lj-label{font-size:11px;color:#5A636B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600}",
      ".lj-label-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}",
      ".lj-label-row .lj-label{margin-bottom:0}",
      ".lj-copy-btn{background:none;border:1px solid #E4DDD2;color:#5A636B;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:10px;line-height:1.4;font-family:'EB Garamond',Garamond,serif}",
      ".lj-copy-btn:hover{color:#1F2328;border-color:#1F2328}",
      // 列表
      ".lj-list{margin-bottom:8px}",
      ".lj-list-toggle{background:none;border:none;color:#5A636B;cursor:pointer;font-size:11px;font-family:'EB Garamond',Garamond,serif;padding:3px 0;width:100%;text-align:center}",
      ".lj-list-toggle:hover{color:#1F2328}",
      ".lj-list::-webkit-scrollbar{width:4px}",
      ".lj-list::-webkit-scrollbar-thumb{background:#E4DDD2;border-radius:4px}",
      ".lj-item{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#F3EFE7;border-radius:6px;margin-bottom:3px}",
      ".lj-item span{color:#1F2328;font-size:12px}",
      ".lj-x{background:none;border:none;color:#D9797B;cursor:pointer;font-size:16px;padding:0 2px;line-height:1}",
      ".lj-x:hover{color:#9a6868}",
      // 输入框 + 按钮
      ".lj-add{display:flex;gap:6px}",
      ".lj-add input{flex:1;background:#fff;border:1px solid #E4DDD2;border-radius:6px;color:#1F2328;padding:6px 10px;font-size:12px;font-family:'EB Garamond',Garamond,serif;outline:none}",
      ".lj-add input:focus{border-color:#5A636B}",
      ".lj-add button{background:#1F2328;color:#FAF7F2;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-weight:600;font-size:12px;font-family:'EB Garamond',Garamond,serif;white-space:nowrap}",
      ".lj-add button:hover{opacity:0.8}",
      ".lj-toggle{background:none;border:none;color:#5A636B;cursor:pointer;font-size:18px;padding:0;line-height:1}",
      ".lj-empty{color:#8A939B;font-size:11px;padding:4px 0;font-style:italic}",
      // 快速跳过按钮
      ".lj-quick-skip{margin-top:8px;padding-top:8px;border-top:1px solid #E4DDD2}",
      ".lj-quick-skip-btn{background:#F3EFE7;color:#9a6868;border:1px solid #E4DDD2;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;font-family:'EB Garamond',Garamond,serif;width:100%;text-align:center}",
      ".lj-quick-skip-btn:hover{background:#E4DDD2}",
      // 底部链接
      ".lj-feedback{display:block;text-align:center;margin-top:10px;font-size:11px;color:#8A939B;text-decoration:none;letter-spacing:0.3px}",
      ".lj-feedback:hover{color:#5A636B}",
      // 开关行
      ".lj-switch-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0}",
      ".lj-switch-row span{font-size:12px;color:#1F2328}",
      ".lj-switch{position:relative;width:36px;height:20px;cursor:pointer}",
      ".lj-switch input{opacity:0;width:0;height:0}",
      ".lj-switch .slider{position:absolute;inset:0;background:#E4DDD2;border-radius:10px;transition:background 0.2s}",
      ".lj-switch .slider::before{content:'';position:absolute;width:16px;height:16px;left:2px;top:2px;background:#fff;border-radius:50%;transition:transform 0.2s}",
      ".lj-switch input:checked+.slider{background:#5a8a6e}",
      ".lj-switch input:checked+.slider::before{transform:translateX(16px)}",
      // 淡化后的卡片样式
      ".lj-card-dimmed{opacity:0.35 !important;transition:opacity 0.2s}",
      ".lj-card-dimmed:hover{opacity:0.7 !important}",
      // 卡片边框（品牌玫瑰色）
      "[data-lj-filtered]{border-left:3px solid #D9797B !important;position:relative !important;overflow:visible !important}",
      // 徽章容器
      ".lj-badges{position:absolute !important;left:0 !important;bottom:4px !important;z-index:10 !important;display:flex !important;flex-direction:column !important;gap:2px !important;pointer-events:none !important}",
      ".lj-badge{font-size:9px !important;font-weight:700 !important;padding:1px 6px !important;border-radius:8px !important;color:#fff !important;white-space:nowrap !important;line-height:1.4 !important;letter-spacing:0.3px !important}",
      // 窄屏适配
      "@media(max-width:600px){#lj-filter-panel{width:200px;font-size:12px}.lj-header h3{font-size:13px}.lj-body{padding:10px 12px}}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ==================== UI 面板 ====================
  function createUI() {
    if (document.getElementById("lj-filter-panel")) return;
    injectStyles();

    const panel = el("div", { id: "lj-filter-panel" });

    // 恢复上次拖动位置
    if (panelPosition) {
      panel.style.left = panelPosition.left + "px";
      panel.style.top = panelPosition.top + "px";
    }

    const togBtn = el("button", { className: "lj-toggle", textContent: "\u2212" });
    const header = el("div", { className: "lj-header" }, [
      el("h3", { textContent: "JobLens" }),
      togBtn
    ]);

    // ---- 拖动 + 点击（区分：移动 >4px 算拖动，否则算点击折叠） ----
    let dragState = null;
    header.addEventListener("mousedown", (e) => {
      if (e.target === togBtn) return; // 切换按钮不参与拖动
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
        // 保存拖动位置
        const rect = panel.getBoundingClientRect();
        panelPosition = { left: rect.left, top: rect.top };
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

    // ---- 批量添加（支持逗号/换行分隔的粘贴） ----
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

    // ---- 赞助检测开关 ----
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

    // ---- 淡化标记卡片开关 ----
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

  // ==================== 渲染跳过列表 ====================
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

    // 从多标签中移除该 reason
    document.querySelectorAll("[data-lj-reasons]").forEach((card) => {
      const reasons = card.dataset.ljReasons.split(",");
      const idx = reasons.indexOf(reason);
      if (idx === -1) return;
      reasons.splice(idx, 1);
      // 同步清理内存 Map
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

  // ==================== 自动扫描 ====================
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

        // 直接用卡片引用检测，不经过 getActiveCard()（避免匹配错误）
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

    // 扫描结束后立即 + 延迟恢复所有丢失的 badge
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
      // 进度条
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

  // ==================== 初始化 ====================
  async function init() {
    if (!isSearchPage()) return;
    await loadSettings();
    createUI();
    filterJobCards();
    checkDetailPanel();

    // 首次使用提示
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

  // ==================== 键盘快捷键（Ctrl/Cmd + Shift + J） ====================
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

  // ==================== 统一观察器（合并 DOM 变化处理 + 单页路由检测） ====================
  let filterTimer = null;
  let detailTimer = null;
  let badgeTimer = null;
  let lastUrl = location.href;

  new MutationObserver(() => {
    const onSearch = isSearchPage();

    // 单页路由变化
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (onSearch && !scanning) {
        // 搜索页路由变化 → 重置状态并重新初始化
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
        // 离开搜索页 → 移除面板
        const panel = document.getElementById("lj-filter-panel");
        if (panel) panel.remove();
      }
    }

    // 非搜索页不执行过滤逻辑
    if (!onSearch) return;

    // 卡片过滤（200ms 防抖）
    clearTimeout(filterTimer);
    filterTimer = setTimeout(filterJobCards, 200);

    // 详情面板检测（600ms 防抖）
    clearTimeout(detailTimer);
    detailTimer = setTimeout(checkDetailPanel, 600);

    // Badge 恢复（独立 1s 防抖，避免频繁 DOM 查询）
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(refreshBadges, 1000);
  }).observe(document.body, { childList: true, subtree: true });
})();
