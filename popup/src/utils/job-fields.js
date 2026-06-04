import {
  DEFAULT_STATUS,
  JOB_APPLIED_KEYS,
  JOB_CARD_FACT_FIELDS,
  JOB_CARD_SELECTORS,
  JOB_POSTED_KEYS,
  JOB_SEARCH_FIELDS,
} from "../config.js";
import { shouldHideText } from "./text.js";

export function pickJobField(job, keys) {
  if (!job || typeof job !== "object") return "";
  for (const key of keys) {
    const value = job[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function getPostedTimestamp(job) {
  return pickJobField(job, JOB_POSTED_KEYS);
}

export function getAppliedTimestamp(job) {
  return pickJobField(job, JOB_APPLIED_KEYS);
}

export function getJobStatus(job) {
  return (job.status || DEFAULT_STATUS).toLowerCase();
}

export function buildSearchHaystack(job) {
  const parts = JOB_SEARCH_FIELDS.map((key) => String(job[key] || ""));
  if (Array.isArray(job.skills)) {
    parts.push(job.skills.join(" "));
  }
  return parts.join(" ").toLowerCase();
}

export function getCompanyName(job) {
  const fromJob = (job.company || "").trim();
  if (fromJob) return fromJob;
  try {
    if (!job.url) return "";
    const host = new URL(job.url).hostname.replace(/^www\./, "");
    return host;
  } catch (_) {
    return "";
  }
}

export function getFactItems(job) {
  return JOB_CARD_FACT_FIELDS.map((field) => ({
    label: field.label,
    value: job[field.key],
  })).filter(
    (item) => (item.value || "").trim() && !shouldHideText(item.value)
  );
}

export function queryCard(node, selectorKey) {
  return node.querySelector(JOB_CARD_SELECTORS[selectorKey]);
}
