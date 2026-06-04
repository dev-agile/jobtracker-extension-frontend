import { applyFilters } from "../filters.js";
import { setAllJobs } from "../state.js";

export async function loadLocalJobs() {
  try {
    const jobs = await new Promise((resolve) => {
      chrome.storage.local.get({ jobs: [] }, (res) => {
        resolve(res.jobs || []);
      });
    });
    setAllJobs(jobs);
    applyFilters();
  } catch (err) {
    console.error("Failed to load local jobs", err);
  }
}
