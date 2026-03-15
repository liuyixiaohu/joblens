# JobLens

Smart LinkedIn job filter — flags Reposted, Applied, No Sponsor, Unpaid jobs, and lets you skip companies & title keywords.

## Features

- **Reposted** detection (card text + detail panel scan)
- **Applied** detection (leaf node matching, excludes "Applied Materials" etc.)
- **No Sponsor** detection (25+ keyword patterns in job descriptions)
- **Unpaid** detection (volunteer/unpaid keyword scan)
- **Skip Company** list (exact match, case-insensitive, batch paste)
- **Skip Title Keyword** list (substring match)
- **Auto-Scan** — click-through scan with detail panel fingerprint detection
- **Dim filtered cards** toggle (opacity 0.35, hover 0.7)
- Badge persistence across LinkedIn DOM re-renders

## Install

### Chrome Extension (recommended)

1. Download or clone this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `joblens` folder
5. Go to [LinkedIn Jobs](https://www.linkedin.com/jobs/) — the panel appears on the left

## Usage

- The JobLens panel appears on the left side of LinkedIn job pages
- **Click the header** to collapse/expand; **drag the header** to reposition
- Add companies or keywords to skip lists (supports comma-separated batch paste)
- Toggle No Sponsor / Unpaid detection on or off
- Click **Scan Jobs** to auto-scan all visible listings
- Click **Skip Current Company** to quickly block the company of the active job

## Design

Frosted glass panel with cream/rose brand palette and EB Garamond typography.

## Privacy

JobLens runs entirely in your browser. No data is collected or sent anywhere. See [privacy.html](privacy.html) for the full policy.

## Feedback

[Shape JobLens](https://kunli.co/joblens)
