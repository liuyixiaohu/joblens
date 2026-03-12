# Changelog

## v5.0
- Renamed to **JobLens**
- Brand redesign: EB Garamond font, cream/rose color palette (kunli.co brand guidelines)
- Frosted glass panel with drag support
- Feedback link in panel footer

## v4.5
- Copy/import for skip lists (comma-separated, batch paste)
- List collapse: 5+ items show expand/collapse toggle
- "Skip Current Company" button rename

## v4.4
- Draggable panel (header drag, click to collapse)
- Frosted glass background (backdrop-filter blur)

## v4.3
- "Collapse filtered cards" → "Dim filtered cards" (opacity 0.35, hover 0.7)

## v4.2
- Unpaid detection changed to red badge (same behavior as other filters)
- Added "Detect Unpaid" toggle (default on)
- Skipped Company matching changed to exact match (case-insensitive)

## v4.1
- Added Unpaid detection (keyword scan in detail panel)
- Added UNPAID_KEYWORDS list
- Yellow badge for Unpaid, SKIP_REASONS for scan/collapse distinction

## v4.0
- All badge colors unified to red (#ef5350)
- Removed Viewed detection (auto-scan triggers false positives)
- Added "Detect No Sponsor" toggle (default on, persistent)
- Added "Collapse filtered cards" toggle

## v3.12
- Applied and No Sponsor badges changed to red
- Added Viewed detection (yellow badge, card text)
- Updated BORDER_PRIORITY with viewed

## v3.11
- Fixed jobId extraction: support `/jobs/search-results/?currentJobId=` URL format
- Fixed title matching: prefer exact match, then closest length difference
- Fixed clickCard: fallback chain for `display:contents` cards
- Scan path optimization: bypass getActiveCard(), pass card reference directly

## v3.10
- Badge persistence via labeledJobs Map (survives DOM replacement)
- refreshBadges() recovers lost badges on LinkedIn re-render

## v3.9
- Multi-badge support (vertical badge stack per card)
- BORDER_PRIORITY for border color when multiple reasons exist

## v3.0–3.8
- Reposted detection (card text + detail panel scan)
- Applied detection (card text)
- No Sponsor detection (detail panel keyword scan)
- Skipped Company / Skipped Title keyword lists
- Auto-scan with click-through
- Trusted Types compatibility
- Panel UI with add/remove lists
