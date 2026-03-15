// Hide Promoted (ad) posts in the LinkedIn feed
(function () {
  "use strict";

  function isPromoted(article) {
    const elements = article.querySelectorAll("*");
    for (const el of elements) {
      if (el.children.length === 0 && el.textContent.trim() === "Promoted") {
        return true;
      }
    }
    return false;
  }

  function hidePromotedPosts() {
    const main = document.querySelector('main[role="main"]') || document.querySelector("main");
    if (!main) return;
    const articles = main.querySelectorAll("article");
    for (const article of articles) {
      if (article.dataset.promotedChecked) continue;
      article.dataset.promotedChecked = "1";
      if (isPromoted(article)) {
        article.style.display = "none";
      }
    }
  }

  // Initial scan
  hidePromotedPosts();

  // Observe DOM changes for dynamically loaded posts (infinite scroll)
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(hidePromotedPosts, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
