import { STATUS_OPTIONS } from "../config.js";
import { getJobStatus } from "../utils/job-fields.js";
import { setStatusPillState } from "../ui/status-pill.js";

export function renderStatusSelect(selectEl, job, statusPill, onStatusChange) {
  STATUS_OPTIONS.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    selectEl.appendChild(opt);
  });

  const currentStatus = getJobStatus(job);
  selectEl.value = currentStatus;
  setStatusPillState(statusPill, currentStatus);

  if (!job.id) {
    selectEl.disabled = true;
    selectEl.title = "Waiting for server sync";
    return;
  }

  selectEl.addEventListener("change", () => {
    onStatusChange(job.id, selectEl, statusPill);
  });
}
