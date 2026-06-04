import { quickFiltersEl, searchInput, statusFilterEl } from "./dom.js";
import { allJobs } from "./state.js";
import { sortJobsByAppliedDesc } from "./utils/dates.js";
import { buildSearchHaystack, getJobStatus } from "./utils/job-fields.js";

let renderJobsList = () => {};

/** Wired from main.js to avoid import cycles (filters ↔ jobs-list ↔ job-card). */
export function setRenderJobsList(fn) {
  renderJobsList = fn;
}

export function updateQuickFilterHighlight() {
  if (!quickFiltersEl) return;
  const activeStatus = statusFilterEl.value;
  quickFiltersEl
    .querySelectorAll(".quick-filter-chip")
    .forEach((chip) =>
      chip.classList.toggle("is-active", chip.dataset.status === activeStatus)
    );
}

export function applyFilters() {
  const search = searchInput.value.trim().toLowerCase();
  const statusFilter = statusFilterEl.value;

  const filtered = allJobs.filter((job) => {
    const matchesStatus =
      statusFilter === "all" || getJobStatus(job) === statusFilter;
    const matchesSearch = !search || buildSearchHaystack(job).includes(search);
    return matchesStatus && matchesSearch;
  });

  renderJobsList(sortJobsByAppliedDesc(filtered));
  updateQuickFilterHighlight();
}
