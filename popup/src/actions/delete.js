import { sendMessage } from "../api/messaging.js";
import { applyFilters } from "../filters.js";
import { allJobs, setAllJobs } from "../state.js";
import { showBanner } from "../ui/banner.js";
import { getAppliedTimestamp } from "../utils/job-fields.js";

export async function handleDeleteJob(job, deleteBtn) {
  const shouldDelete = window.confirm(
    "Delete this job from the extension list?"
  );
  if (!shouldDelete) return;

  if (deleteBtn) deleteBtn.disabled = true;
  const previousJobs = allJobs.slice();

  setAllJobs(
    allJobs.filter((item) => {
      if (job.id) return item.id !== job.id;
      return !(
        item.url === job.url &&
        getAppliedTimestamp(item) === getAppliedTimestamp(job)
      );
    })
  );
  applyFilters();

  try {
    const response = await sendMessage({
      type: "DELETE_JOB",
      payload: {
        jobId: job.id,
        url: job.url,
        appliedAt: getAppliedTimestamp(job),
      },
    });

    if (response && response.error) {
      throw new Error(response.error);
    }

    showBanner("Job deleted", "info");
  } catch (err) {
    setAllJobs(previousJobs);
    applyFilters();
    showBanner(
      err && err.message ? err.message : "Failed to delete job",
      "error"
    );
    if (deleteBtn) deleteBtn.disabled = false;
  }
}
