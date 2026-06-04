import { totalCountEl, visibleCountEl } from "../dom.js";
import { allJobs } from "../state.js";

export function updateCounts(visibleJobs) {
  if (totalCountEl) totalCountEl.textContent = String(allJobs.length);
  if (visibleCountEl) visibleCountEl.textContent = String(visibleJobs.length);
}
