/* JobLens — background service worker (context menus) */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lj-mute-person",
    title: 'Mute person "%s"',
    contexts: ["selection"],
    documentUrlPatterns: ["https://www.linkedin.com/*"],
  });
  chrome.contextMenus.create({
    id: "lj-mute-keyword",
    title: 'Mute keyword "%s"',
    contexts: ["selection"],
    documentUrlPatterns: ["https://www.linkedin.com/*"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const text = (info.selectionText || "").trim();
  if (!text || !tab?.id) return;

  const action =
    info.menuItemId === "lj-mute-person" ? "mutePerson" :
    info.menuItemId === "lj-mute-keyword" ? "muteKeyword" :
    null;
  if (!action) return;

  chrome.tabs.sendMessage(tab.id, { type: "lj-context-menu", action, text });
});
