# Sift

Take back a LinkedIn worth your time.

Clean up LinkedIn: filter feed by keywords, hide ads & spam, mute or unfollow inline, and search your rules.

## Features

### Feed (`/feed/`)
- **Hide Ads** (Promoted posts)
- **Hide Suggested** posts
- **Hide Recommended** posts and LinkedIn Learning promotions
- **Hide Strangers** (non-connection posts)
- **Hide Sidebar** (LinkedIn News + footer)
- **Unfollow** — inline button on each post, opens LinkedIn's menu to unfollow the author
- **Keyboard shortcut** — Shift+J to pause/resume all feed filters

### Job Search (`/jobs/search-results/`)
- **Reposted** detection (card text + detail panel scan)
- **Applied** detection (leaf node matching, excludes "Applied Materials" etc.)
- **No Sponsor** detection (25+ keyword patterns in job descriptions)
- **Unpaid** detection (volunteer/unpaid keyword scan)
- **Skip Company** list (exact match, case-insensitive, batch paste)
- **Skip Title Keyword** list (substring match)
- **Auto-Scan** — click-through scan with detail panel fingerprint detection
- **Dim / Hide filtered cards** toggle
- Badge persistence across LinkedIn DOM re-renders

### Popup
- **Controls** — toggles grouped by page (Feed / Jobs), skip-list editing with search
- **Stats** — real-time counters (ads hidden, jobs flagged, etc.) with Today + All Time
- **Data** — export settings as JSON, import to restore, reset to defaults

## Install

1. Download or clone this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the folder
5. Visit LinkedIn — Sift activates automatically on feed and job search pages

## Design

Cream/rose brand palette with EB Garamond typography. All settings persist across sessions via `chrome.storage.local`.

## Privacy

Sift runs entirely in your browser. No data is collected or sent anywhere. See [privacy.html](privacy.html) for the full policy.

## Feedback

[Shape Sift](https://kunli.co/sift)
