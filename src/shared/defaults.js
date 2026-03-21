// Sift — shared default settings (single source of truth)

export const SIFT_DEFAULTS = {
  // Feed page
  hidePromoted: true,
  hideSuggested: true,
  hideRecommended: true,
  hideNonConnections: false,
  hideSidebar: true,
  // Jobs page
  sponsorCheckEnabled: true,
  unpaidCheckEnabled: true,
  dimFiltered: false,
  hideFiltered: false,
  skippedCompanies: [],
  skippedTitleKeywords: [],
};

export const SIFT_STATS_DEFAULTS = {
  stats: {
    today: "",
    adsHidden: 0,
    suggestedHidden: 0,
    recommendedHidden: 0,
    strangersHidden: 0,
    jobsFlagged: 0,
    jobsScanned: 0,
  },
  statsAllTime: {
    adsHidden: 0,
    suggestedHidden: 0,
    recommendedHidden: 0,
    strangersHidden: 0,
    jobsFlagged: 0,
    jobsScanned: 0,
  },
};
