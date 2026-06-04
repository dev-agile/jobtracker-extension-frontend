/**
 * Popup entry — auth gate, then load local cache, sync server, wire controls.
 * See popup/README.md for folder layout.
 */

import { bootstrapAuth, initAuthView } from "./auth/auth-view.js";
import { loadLocalJobs } from "./actions/local.js";
import { syncJobs } from "./actions/sync.js";
import {
  clearFiltersBtn,
  clearLocalBtn,
  clearSearchBtn,
  refreshBtn,
  searchInput,
  statusFilterEl,
} from "./dom.js";
import { applyFilters, setRenderJobsList } from "./filters.js";
import { renderJobs } from "./render/jobs-list.js";
import { renderQuickFilters } from "./render/quick-filters.js";
import { setAllJobs } from "./state.js";
import { showBanner } from "./ui/banner.js";
import { setLoading } from "./ui/loading.js";

setRenderJobsList(renderJobs);

function startApp() {
  renderQuickFilters();
  setLoading(true);
  loadLocalJobs().finally(() => {
    setLoading(false);
    syncJobs();
  });
}

function init() {
  initAuthView({ onAuthed: () => startApp() });

  bootstrapAuth().then((user) => {
    if (user) startApp();
  });

  searchInput.addEventListener("input", applyFilters);
  statusFilterEl.addEventListener("change", applyFilters);
  refreshBtn.addEventListener("click", syncJobs);

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      applyFilters();
      searchInput.focus();
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      searchInput.value = "";
      statusFilterEl.value = "all";
      applyFilters();
    });
  }

  if (clearLocalBtn) {
    clearLocalBtn.addEventListener("click", () => {
      chrome.storage.local.set({ jobs: [], outbox: [] }, () => {
        setAllJobs([]);
        renderJobs([]);
        showBanner("Local cache cleared", "info");
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
