import {
  POSTED_DATE_PATTERNS,
  POSTED_JUNK_RE,
  POSTED_PREFIX_RE,
  POSTED_REJECT_MAX_LEN,
  POSTED_TRIM_MAX_LEN,
} from "../config.js";
import { getAppliedTimestamp } from "./job-fields.js";

export function appliedDateMs(job) {
  const raw = getAppliedTimestamp(job);
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function sortJobsByAppliedDesc(jobs) {
  return jobs.slice().sort((a, b) => appliedDateMs(b) - appliedDateMs(a));
}

function stripPostedPrefix(raw) {
  return String(raw || "").trim().replace(POSTED_PREFIX_RE, "").trim();
}

export function extractPostedDate(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";

  const value = stripPostedPrefix(text);

  for (const pattern of POSTED_DATE_PATTERNS) {
    const match = value.match(pattern);
    if (match) return match[0];
  }

  if (value.length > POSTED_REJECT_MAX_LEN || POSTED_JUNK_RE.test(value)) {
    return "";
  }

  return value.length <= POSTED_REJECT_MAX_LEN ? value : "";
}

export function formatDate(iso) {
  if (!iso) return "Date unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return String(iso).replace("T", " ").replace("Z", "");
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPostedLine(raw) {
  const dateOnly = extractPostedDate(raw);
  if (dateOnly) return `Posted ${formatDate(dateOnly)}`;

  const trimmed = stripPostedPrefix(raw);
  if (
    trimmed &&
    trimmed.length <= POSTED_TRIM_MAX_LEN &&
    !POSTED_JUNK_RE.test(trimmed)
  ) {
    return `Posted ${formatDate(trimmed)}`;
  }

  return "Posted Date unknown";
}

export function formatAppliedLine(raw) {
  const ts = String(raw || "").trim();
  if (!ts) return "Applied Date unknown";
  return `Applied ${formatDate(ts)}`;
}
