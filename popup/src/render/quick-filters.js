import { QUICK_FILTER_OPTIONS } from "../config.js";
import { quickFiltersEl, statusFilterEl } from "../dom.js";
import {
  applyFilters,
  updateQuickFilterHighlight,
} from "../filters.js";

export function renderQuickFilters() {
  if (!quickFiltersEl) return;
  quickFiltersEl.innerHTML = "";

  QUICK_FILTER_OPTIONS.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-filter-chip";
    btn.dataset.status = option.value;
    btn.textContent = option.label;
    btn.addEventListener("click", () => {
      statusFilterEl.value = option.value;
      updateQuickFilterHighlight();
      applyFilters();
    });
    quickFiltersEl.appendChild(btn);
  });

  updateQuickFilterHighlight();
}
