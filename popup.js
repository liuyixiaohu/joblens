(function () {
  "use strict";

  // === Defaults ===

  const CONTROLS_DEFAULTS = {
    hidePromoted: true,
    hideSuggested: true,
    hideRecommended: true,
    hideNonConnections: false,
    hideSidebar: true,
    sponsorCheckEnabled: true,
    unpaidCheckEnabled: true,
    dimFiltered: false,
    hideFiltered: false,
    skippedCompanies: [],
    skippedTitleKeywords: [],
  };

  const STATS_DEFAULTS = {
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

  const STAT_LABELS = {
    adsHidden: "Ads Hidden",
    suggestedHidden: "Suggested Hidden",
    recommendedHidden: "Recommended Hidden",
    strangersHidden: "Strangers Hidden",
    jobsFlagged: "Jobs Flagged",
    jobsScanned: "Jobs Scanned",
  };

  // === Tab switching ===

  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabBtns.forEach(function (b) { b.classList.remove("active"); });
      tabContents.forEach(function (c) { c.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // === Toast ===

  let toastEl = null;
  let toastTimer = null;

  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("visible");
    }, 1800);
  }

  // === Helper: create toggle row ===

  function createToggle(label, checked, onChange) {
    var row = document.createElement("div");
    row.className = "toggle-row";

    var span = document.createElement("span");
    span.className = "toggle-label";
    span.textContent = label;

    var switchLabel = document.createElement("label");
    switchLabel.className = "toggle-switch";

    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", function () {
      onChange(input.checked);
    });

    var slider = document.createElement("span");
    slider.className = "toggle-slider";

    switchLabel.appendChild(input);
    switchLabel.appendChild(slider);
    row.appendChild(span);
    row.appendChild(switchLabel);
    return row;
  }

  // === Helper: create list section ===

  var LIST_COLLAPSE_THRESHOLD = 5;

  function createListSection(container, label, items, onRemove) {
    var section = document.createElement("div");
    section.className = "list-section";

    // Header
    var header = document.createElement("div");
    header.className = "list-header";
    var labelEl = document.createElement("span");
    labelEl.className = "list-label";
    labelEl.textContent = label;
    var countEl = document.createElement("span");
    countEl.className = "list-count";
    countEl.textContent = items.length > 0 ? items.length + " items" : "";
    header.appendChild(labelEl);
    header.appendChild(countEl);

    // Search input
    var searchRow = document.createElement("div");
    searchRow.className = "list-search-row";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search to find & remove\u2026";
    searchInput.className = "list-search-input";
    searchRow.appendChild(searchInput);

    // List container
    var listEl = document.createElement("div");
    listEl.className = "list-items";

    // "Show all" toggle — lives outside the scrollable list
    var toggleBtn = document.createElement("button");
    toggleBtn.className = "list-toggle-btn";
    toggleBtn.style.display = "none";

    section.appendChild(header);
    section.appendChild(searchRow);
    section.appendChild(listEl);
    section.appendChild(toggleBtn);
    container.appendChild(section);

    var expanded = false;
    var currentFilter = "";

    function renderItems(currentItems) {
      listEl.innerHTML = "";
      countEl.textContent = currentItems.length > 0 ? currentItems.length + " items" : "";

      // Hide search when list is small
      searchRow.style.display = currentItems.length > LIST_COLLAPSE_THRESHOLD ? "" : "none";

      if (currentItems.length === 0) {
        var empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "None added yet";
        listEl.appendChild(empty);
        toggleBtn.style.display = "none";
        return;
      }

      var filtered = currentFilter
        ? currentItems.filter(function (item) { return item.toLowerCase().includes(currentFilter); })
        : currentItems;

      var isCollapsed = !currentFilter && !expanded && filtered.length > LIST_COLLAPSE_THRESHOLD;

      filtered.forEach(function (item, i) {
        var row = document.createElement("div");
        row.className = "list-item";
        if (isCollapsed && i >= LIST_COLLAPSE_THRESHOLD) row.style.display = "none";

        var nameSpan = document.createElement("span");
        nameSpan.textContent = item;
        nameSpan.title = item;

        var removeBtn = document.createElement("button");
        removeBtn.className = "list-item-remove";
        removeBtn.textContent = "\u00d7";
        removeBtn.addEventListener("click", function () {
          onRemove(item);
        });

        row.appendChild(nameSpan);
        row.appendChild(removeBtn);
        listEl.appendChild(row);
      });

      // Show/hide toggle button
      if (!currentFilter && currentItems.length > LIST_COLLAPSE_THRESHOLD) {
        toggleBtn.style.display = "";
        toggleBtn.textContent = expanded ? "Show less" : "Show all " + currentItems.length + " items";
      } else {
        toggleBtn.style.display = "none";
      }
    }

    // State for re-render
    var latestItems = items;

    toggleBtn.addEventListener("click", function () {
      expanded = !expanded;
      renderItems(latestItems);
    });

    searchInput.addEventListener("input", function () {
      currentFilter = searchInput.value.trim().toLowerCase();
      expanded = false;
      renderItems(latestItems);
    });

    function render(newItems) {
      latestItems = newItems;
      renderItems(newItems);
    }

    return render;
  }

  // === Controls Tab ===

  function buildControlsTab(settings) {
    var container = document.getElementById("tab-controls");
    container.innerHTML = "";

    // --- Feed Controls ---
    var feedGroup = document.createElement("div");
    feedGroup.className = "section-group";
    var feedTitle = document.createElement("div");
    feedTitle.className = "section-title";
    feedTitle.textContent = "Feed Page";
    feedGroup.appendChild(feedTitle);

    feedGroup.appendChild(createToggle("Hide Ads", settings.hidePromoted, function (v) {
      chrome.storage.local.set({ hidePromoted: v });
    }));
    feedGroup.appendChild(createToggle("Hide Suggested", settings.hideSuggested, function (v) {
      chrome.storage.local.set({ hideSuggested: v });
    }));
    feedGroup.appendChild(createToggle("Hide Recommended", settings.hideRecommended, function (v) {
      chrome.storage.local.set({ hideRecommended: v });
    }));
    feedGroup.appendChild(createToggle("Hide Strangers", settings.hideNonConnections, function (v) {
      chrome.storage.local.set({ hideNonConnections: v });
    }));
    feedGroup.appendChild(createToggle("Hide Sidebar", settings.hideSidebar, function (v) {
      chrome.storage.local.set({ hideSidebar: v });
    }));

    container.appendChild(feedGroup);

    // --- Jobs Controls ---
    var jobsGroup = document.createElement("div");
    jobsGroup.className = "section-group";
    var jobsTitle = document.createElement("div");
    jobsTitle.className = "section-title";
    jobsTitle.textContent = "Jobs Page";
    jobsGroup.appendChild(jobsTitle);

    jobsGroup.appendChild(createToggle("Detect No Sponsor", settings.sponsorCheckEnabled, function (v) {
      chrome.storage.local.set({ sponsorCheckEnabled: v });
    }));
    jobsGroup.appendChild(createToggle("Detect Unpaid", settings.unpaidCheckEnabled, function (v) {
      chrome.storage.local.set({ unpaidCheckEnabled: v });
    }));
    jobsGroup.appendChild(createToggle("Dim Filtered Cards", settings.dimFiltered, function (v) {
      chrome.storage.local.set({ dimFiltered: v });
    }));
    jobsGroup.appendChild(createToggle("Hide Filtered Cards", settings.hideFiltered, function (v) {
      chrome.storage.local.set({ hideFiltered: v });
    }));

    // Skipped Companies list
    var renderCompanies = createListSection(jobsGroup, "Skipped Companies", settings.skippedCompanies, function (company) {
      settings.skippedCompanies = settings.skippedCompanies.filter(function (c) {
        return c.toLowerCase() !== company.toLowerCase();
      });
      chrome.storage.local.set({ skippedCompanies: settings.skippedCompanies });
      renderCompanies(settings.skippedCompanies);
    });
    renderCompanies(settings.skippedCompanies);

    // Skipped Title Keywords list
    var renderTitleKw = createListSection(jobsGroup, "Skipped Title Keywords", settings.skippedTitleKeywords, function (kw) {
      settings.skippedTitleKeywords = settings.skippedTitleKeywords.filter(function (k) {
        return k.toLowerCase() !== kw.toLowerCase();
      });
      chrome.storage.local.set({ skippedTitleKeywords: settings.skippedTitleKeywords });
      renderTitleKw(settings.skippedTitleKeywords);
    });
    renderTitleKw(settings.skippedTitleKeywords);

    container.appendChild(jobsGroup);

  }

  // === Stats Tab ===

  function getTodayString() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function buildStatsTab(stats, statsAllTime) {
    var container = document.getElementById("tab-stats");
    container.innerHTML = "";

    var today = getTodayString();

    // Reset daily stats if date changed
    if (stats.today !== today) {
      stats = Object.assign({}, STATS_DEFAULTS.stats, { today: today });
      chrome.storage.local.set({ stats: stats });
    }

    // Today section
    var todaySection = document.createElement("div");
    todaySection.className = "stats-section";
    var todayTitle = document.createElement("div");
    todayTitle.className = "stats-section-title";
    todayTitle.textContent = "Today";
    todaySection.appendChild(todayTitle);

    var todayGrid = document.createElement("div");
    todayGrid.className = "stats-grid";
    Object.keys(STAT_LABELS).forEach(function (key) {
      todayGrid.appendChild(createStatCard(stats[key] || 0, STAT_LABELS[key]));
    });
    todaySection.appendChild(todayGrid);
    container.appendChild(todaySection);

    // All Time section
    var allTimeSection = document.createElement("div");
    allTimeSection.className = "stats-section";
    var allTimeTitle = document.createElement("div");
    allTimeTitle.className = "stats-section-title";
    allTimeTitle.textContent = "All Time";
    allTimeSection.appendChild(allTimeTitle);

    var allTimeGrid = document.createElement("div");
    allTimeGrid.className = "stats-grid";
    Object.keys(STAT_LABELS).forEach(function (key) {
      allTimeGrid.appendChild(createStatCard(statsAllTime[key] || 0, STAT_LABELS[key]));
    });
    allTimeSection.appendChild(allTimeGrid);
    container.appendChild(allTimeSection);

    // Reset Stats button
    var resetRow = document.createElement("div");
    resetRow.style.cssText = "text-align:center;margin-top:12px;";
    var resetBtn = document.createElement("button");
    resetBtn.className = "data-btn data-btn-reset";
    resetBtn.textContent = "Reset Stats";
    resetBtn.style.cssText = "font-size:12px;padding:4px 14px;";
    resetBtn.addEventListener("click", function () {
      if (!confirm("Reset all stats to zero?")) return;
      chrome.storage.local.set(STATS_DEFAULTS, function () {
        buildStatsTab(STATS_DEFAULTS.stats, STATS_DEFAULTS.statsAllTime);
        showToast("Stats reset");
      });
    });
    resetRow.appendChild(resetBtn);
    container.appendChild(resetRow);
  }

  function createStatCard(number, label) {
    var card = document.createElement("div");
    card.className = "stat-card";
    var numEl = document.createElement("div");
    numEl.className = "stat-number";
    numEl.textContent = formatNumber(number);
    var labelEl = document.createElement("div");
    labelEl.className = "stat-label";
    labelEl.textContent = label;
    card.appendChild(numEl);
    card.appendChild(labelEl);
    return card;
  }

  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  var statsInterval = null;

  function startStatsRefresh() {
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(function () {
      chrome.storage.local.get(STATS_DEFAULTS, function (data) {
        buildStatsTab(data.stats, data.statsAllTime);
      });
    }, 2000);
  }

  function stopStatsRefresh() {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
  }

  // === Data Tab ===

  function buildDataTab() {
    var container = document.getElementById("tab-data");
    container.innerHTML = "";

    var section = document.createElement("div");
    section.className = "data-section";

    // Export
    var exportBtn = document.createElement("button");
    exportBtn.className = "data-btn data-btn-export";
    exportBtn.textContent = "Export Backup";
    exportBtn.addEventListener("click", function () {
      chrome.storage.local.get(null, function (data) {
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "sift-backup-" + getTodayString() + ".json";
        a.click();
        URL.revokeObjectURL(url);
        showToast("Backup exported");
      });
    });

    var exportDesc = document.createElement("div");
    exportDesc.className = "data-description";
    exportDesc.textContent = "Download all settings and stats as JSON";

    // Import
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json";
    fileInput.className = "data-file-input";

    var importBtn = document.createElement("button");
    importBtn.className = "data-btn data-btn-import";
    importBtn.textContent = "Import Backup";
    importBtn.addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          chrome.storage.local.set(data, function () {
            showToast("Backup imported successfully");
            // Reload the controls tab to reflect new settings
            loadAndBuild();
          });
        } catch (err) {
          showToast("Invalid JSON file");
        }
      };
      reader.readAsText(file);
      fileInput.value = "";
    });

    var importDesc = document.createElement("div");
    importDesc.className = "data-description";
    importDesc.textContent = "Restore from a previously exported backup";

    // Reset
    var resetBtn = document.createElement("button");
    resetBtn.className = "data-btn data-btn-reset";
    resetBtn.textContent = "Reset All Data";
    resetBtn.addEventListener("click", function () {
      if (confirm("Are you sure you want to reset all Sift settings and stats? This cannot be undone.")) {
        chrome.storage.local.clear(function () {
          showToast("All data cleared");
          loadAndBuild();
        });
      }
    });

    var resetDesc = document.createElement("div");
    resetDesc.className = "data-description";
    resetDesc.textContent = "Clear all settings, lists, and stats";

    section.appendChild(exportBtn);
    section.appendChild(exportDesc);
    section.appendChild(importBtn);
    section.appendChild(fileInput);
    section.appendChild(importDesc);
    section.appendChild(resetBtn);
    section.appendChild(resetDesc);

    container.appendChild(section);
  }

  // === Init ===

  function loadAndBuild() {
    var allKeys = Object.assign({}, CONTROLS_DEFAULTS, STATS_DEFAULTS);
    chrome.storage.local.get(allKeys, function (data) {
      buildControlsTab(data);
      buildStatsTab(data.stats, data.statsAllTime);
      buildDataTab();
      startStatsRefresh();
    });
  }

  // Auto-fill version from manifest
  document.getElementById("popup-version").textContent = "v" + chrome.runtime.getManifest().version;

  loadAndBuild();

  // Stop stats refresh when popup closes
  window.addEventListener("unload", stopStatsRefresh);
})();
