# Changelog

## v2.0

### Removed
- **Mute by keyword** — removed in favor of Unfollow (simpler, more effective)
- **Mute by person** — replaced by one-click Unfollow button
- **Force Recent** sort toggle
- **Context menu** ("Mute keyword" right-click option)

### New
- **Unfollow button** on feed posts — appears on hover, opens LinkedIn's `...` menu to unfollow
  - On interaction posts ("X reposted this"), placed inline after header text
  - On direct posts, placed next to author name
- **Auto-hide unfollow confirmation** — LinkedIn's "You unfollowed X" card collapses automatically
- **Keyboard shortcut** — Shift+J to pause/resume all feed filters

### Changed
- Popup section titles renamed: "Feed Page" / "Jobs Page"
- `contextMenus` permission removed (no longer needed)
- Description updated for Chrome Web Store v2.0

---

## v1.4

### New: Extension Popup Control Center
- Centralized popup with 3 tabs: Controls, Stats, Data
- **Controls tab**: All toggles grouped by page (Feed / Jobs / Profile), skip lists — full editing
- **Stats tab**: Real-time counters (ads hidden, jobs flagged, etc.) with Today + All Time views
- **Data tab**: Export all settings as JSON backup, import to restore, reset to defaults
- Settings sync via `chrome.storage.onChanged` — changes in popup apply to pages instantly, no reload needed

### Architecture Change
- Page floating panels replaced with **mini status badges** (bottom-right corner)
- Feed badge: shows "🔍 N filtered" count
- Jobs badge: shows "🔍 N flagged" count with inline Scan button
- Profile badge: shows "🔍 Sidebar hidden" status

---

## v1.3

### UX
- Smooth collapse animation for filtered feed posts (replaces instant `display:none` removal)
- Scroll nudge after filtering to trigger LinkedIn's infinite scroll and fill visual gaps
- Draggable panels on feed and profile pages (position persists via chrome.storage.local)

### Performance
- MutationObserver in content.js narrowed from `document.body` to `.jobs-search-results-list` / `<main>`
- SPA route detection replaced with History API interception (zero DOM overhead)
- `waitForDetailChange()` polling replaced with MutationObserver (300ms interval → event-driven)
- `detailPanelHasReposted()` selector scoped to detail panel with narrower element targets
- `getDetailText()` sibling traversal capped at 15 iterations
- `refreshBadges()` reduced from 3 calls to 2 (0s + 2s)
- `filterJobCards()` early-exit when no new cards to process

---

## v1.2

### Feed Page
- Control panel with toggle switches: Hide Ads, Suggested, Recommended, Strangers, Hide Sidebar
- Hide LinkedIn Learning promotions ("Popular course on LinkedIn Learning")
- Hide non-connection (stranger) posts from feed
- Hide LinkedIn News sidebar and footer
- Persistent settings via chrome.storage.local

### Profile Page
- Hide right sidebar on `/in/*` pages (ads, "People you may know", "More profiles for you", etc.)
- Separate frosted-glass control panel with Hide Sidebar toggle

### Performance
- Single-pass DOM scanning (5x → 1x traversal per post for label detection)
- MutationObserver narrowed from document.body to `<main>` element
- Font loading moved from JS runtime to CSS @import (loads at document_start)
- Targeted selectors in cardHasAppliedText() instead of querySelectorAll("*")

---

## v1.1

### Bug Fixes
- Fixed floating panel becoming invisible when switching from external monitor to MacBook screen
- Panel position is now clamped to viewport on restore, after drag, and on window resize

### Improvements
- Responsive panel layout: width and font size adapt to screen size using `clamp()` and multi-breakpoint media queries
- Panel body max-height scales with viewport for better usability on smaller screens

### Cleanup
- Removed Tampermonkey userscript (`joblens.user.js`) — project is now Chrome Extension only

---

## v1.0

Initial public release.

### Detection
- Reposted detection (card text + detail panel scan)
- Applied detection (card text leaf node matching)
- No Sponsor detection (detail panel keyword scan, toggle, default on)
- Unpaid detection (detail panel keyword scan, toggle, default on)
- Skipped Company list (exact match, case-insensitive)
- Skipped Title Keyword list (substring match)

### Auto-Scan
- Click-through scan with detail panel fingerprint change detection
- Scan path passes card reference directly (bypasses getActiveCard)
- Badge persistence via labeledJobs Map (survives LinkedIn DOM replacement)
- refreshBadges() recovers lost badges on re-render

### UI
- Frosted glass panel (cream/rose brand palette, EB Garamond font)
- Draggable panel (header drag, click to collapse)
- Multi-badge support (vertical badge stack, border priority)
- Dim filtered cards mode (opacity 0.35, hover 0.7)
- Copy/import for skip lists (comma-separated, batch paste)
- List collapse: 5+ items show expand/collapse toggle
- "Skip Current Company" quick action button

### Technical
- jobId extraction supports both `/jobs/view/` and `?currentJobId=` URL formats
- Title matching: exact match preferred, then closest length difference
- clickCard fallback chain for `display:contents` cards
- Trusted Types compatibility
- Single MutationObserver (DOM changes + SPA route detection)
