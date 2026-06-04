/** Popup constants — edit when adding fields, filters, or card sections */

export const BANNER_HIDE_MS = 3200;
export const MAX_SKILLS_SHOWN = 8;
export const DEFAULT_STATUS = "applied";

export const STATUS_OPTIONS = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "ghosted", label: "Ghosted" },
];

export const QUICK_FILTER_OPTIONS = [{ value: "all", label: "all" }].concat(
  STATUS_OPTIONS
);

export const JOB_POSTED_KEYS = ["posted", "postedAt"];
export const JOB_APPLIED_KEYS = ["appliedAt", "applied_date", "appliedDate"];

export const JOB_SEARCH_FIELDS = [
  "jobTitle",
  "company",
  "jobDetails",
  "experienceLevel",
  "hourlyRange",
  "hourly",
  "projectLength",
  "url",
];

export const JOB_CARD_FACT_FIELDS = [
  { label: "Experience level", key: "experienceLevel" },
  { label: "Hourly range", key: "hourlyRange" },
  { label: "Hourly", key: "hourly" },
  { label: "Project length", key: "projectLength" },
];

export const JOB_CARD_SELECTORS = {
  title: ".job-card__title",
  company: ".job-card__company",
  posted: ".job-card__date-line--posted",
  applied: ".job-card__date-line--applied",
  facts: ".job-card__facts",
  details: ".job-card__details",
  link: ".job-card__link",
  skills: ".job-card__skills",
  skillsWrap: ".job-card__skills-wrap",
  statusPill: ".job-card__status-pill",
  statusSelect: ".job-card__select",
  deleteBtn: ".job-card__delete-btn",
};

export const POSTED_PREFIX_RE = /^posted\s*/i;
export const POSTED_TRIM_MAX_LEN = 35;
export const POSTED_REJECT_MAX_LEN = 40;
export const POSTED_JUNK_RE = /\b(seeking|developer|development|experience)\b/i;
export const HIDE_TEXT_RE = /^remaining balance:\s*\d+\s*connects?$/i;

export const POSTED_DATE_PATTERNS = [
  /\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i,
  /\b(?:today|yesterday|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\b/i,
];
