(() => {
  // src/background.js
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === "updateBadge") {
      const tabId = sender.tab?.id;
      if (!tabId) return;
      const text = msg.count > 0 ? String(msg.count) : "";
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#D9797B", tabId });
    }
  });
})();
