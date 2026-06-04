import { DEFAULT_STATUS } from "../config.js";
import { statusClassName, toLabelCase } from "../utils/text.js";

export function setStatusPillState(statusPill, status) {
  if (!statusPill) return;
  const normalized = (status || DEFAULT_STATUS).toLowerCase();
  statusPill.textContent = toLabelCase(normalized);
  statusPill.className = "job-card__status-pill " + statusClassName(normalized);
}
