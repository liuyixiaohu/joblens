# Testing Checklist

## Setup
- [ ] Load extension via `chrome://extensions/` → Load unpacked
- [ ] Navigate to `linkedin.com/jobs/search/` — panel appears

## Panel UI
- [ ] Panel renders at top-left with frosted glass style
- [ ] Click header → collapses/expands
- [ ] Drag header → repositions panel
- [ ] EB Garamond font loads correctly
- [ ] All toggles work (Detect No Sponsor, Detect Unpaid, Dim filtered cards)

## Badge Detection (no scan)
- [ ] "Reposted" text in card → red Reposted badge
- [ ] "Applied" text in card → red Applied badge (leaf node match)
- [ ] "Applied Materials" company → does NOT trigger Applied badge
- [ ] Click a job with "does not sponsor" in description → No Sponsor badge
- [ ] Click a job with "unpaid internship" in description → Unpaid badge

## Skip Lists
- [ ] Add a company → badge appears on matching cards
- [ ] Add a title keyword → badge appears on matching cards
- [ ] Batch paste (comma-separated) → multiple items added
- [ ] Remove item (x button) → badge removed from cards
- [ ] Copy button → copies list to clipboard
- [ ] 5+ items → expand/collapse toggle appears
- [ ] "Skip Current Company" button → adds active job's company

## Auto-Scan
- [ ] Click "Scan Jobs" → button turns red, shows progress (Scanning 1/N...)
- [ ] Click again during scan → aborts scan
- [ ] Scan completes → button turns green "Scan complete — X flagged"
- [ ] Badges persist after scan (not lost to DOM re-renders)
- [ ] Scanning does not reset when URL changes (currentJobId parameter)

## Dim Mode
- [ ] Toggle on → flagged cards dim to 0.35 opacity
- [ ] Hover dimmed card → opacity rises to 0.7
- [ ] Toggle off → cards return to full opacity

## Storage Persistence
- [ ] Add companies → refresh page → companies still listed
- [ ] Toggle off No Sponsor → refresh → toggle still off
- [ ] Skip keywords persist across sessions

## Edge Cases
- [ ] Navigate away from /jobs/ and back → panel re-creates
- [ ] Scroll to load more cards → new cards get scanned
- [ ] Multiple badges on one card → vertical badge stack, correct border priority
- [ ] Card with no links (rare) → graceful fallback to title+company key
