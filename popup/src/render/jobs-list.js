import { emptyState, jobsContainer } from "../dom.js";
import { updateCounts } from "../ui/counts.js";
import { renderJobCard } from "./job-card.js";

export function renderJobs(jobs) {
  jobsContainer.innerHTML = "";
  updateCounts(jobs);

  if (!jobs.length) {
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  jobs.forEach((job) => {
    jobsContainer.appendChild(renderJobCard(job));
  });
}
