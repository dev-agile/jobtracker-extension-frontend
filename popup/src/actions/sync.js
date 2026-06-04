import { sendMessage } from "../api/messaging.js";
import { applyFilters } from "../filters.js";
import { setAllJobs } from "../state.js";
import { hideBanner, showBanner } from "../ui/banner.js";
import { setLoading } from "../ui/loading.js";

export async function syncJobs() {
  hideBanner();
  setLoading(true);

  try {
    const response = await sendMessage({ type: "SYNC_JOBS" });
    setAllJobs((response && response.jobs) || []);
    applyFilters();

    if (response && response.error) {
      showBanner(
        response.error + " — showing latest available data",
        "error"
      );
    } else {
      showBanner("Synced with server", "info");
    }
  } catch (err) {
    console.error("Sync failed", err);
    showBanner(
      (err && err.message) || "Sync failed, showing cached data",
      "error"
    );
  } finally {
    setLoading(false);
  }
}
