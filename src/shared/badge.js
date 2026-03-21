// Sift — extension icon badge helper

/**
 * Send filtered/flagged count to the service worker for icon badge display.
 * Fire-and-forget — silently ignores errors (e.g., service worker inactive).
 */
export function sendBadgeCount(count) {
  try {
    chrome.runtime.sendMessage({ type: "updateBadge", count });
  } catch (e) {
    // Service worker may be inactive after extension update
  }
}
