# Changelog

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
- Feedback link (kunli.co/joblens)

### Technical
- jobId extraction supports both `/jobs/view/` and `?currentJobId=` URL formats
- Title matching: exact match preferred, then closest length difference
- clickCard fallback chain for `display:contents` cards
- Trusted Types compatibility
- Single MutationObserver (DOM changes + SPA route detection)
