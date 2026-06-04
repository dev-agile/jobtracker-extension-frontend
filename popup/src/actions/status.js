import { sendMessage } from "../api/messaging.js";
import { applyFilters } from "../filters.js";
import { allJobs } from "../state.js";
import { showBanner } from "../ui/banner.js";
import { setStatusPillState } from "../ui/status-pill.js";

export async function handleStatusChange(jobId, selectEl, statusPill) {
  const status = selectEl.value;
  selectEl.disabled = true;

  try {
    const response = await sendMessage({
      type: "UPDATE_STATUS",
      payload: { jobId, status },
    });
    if (response && response.error) {
      throw new Error(response.error);
    }

    setStatusPillState(statusPill, status);
    const idx = allJobs.findIndex((j) => j.id === jobId);
    if (idx >= 0) {
      allJobs[idx] = { ...allJobs[idx], status };
    }
    applyFilters();
    showBanner("Status updated", "info");
  } catch (err) {
    showBanner(
      err && err.message ? err.message : "Failed to update status",
      "error"
    );
  } finally {
    selectEl.disabled = false;
  }
}
