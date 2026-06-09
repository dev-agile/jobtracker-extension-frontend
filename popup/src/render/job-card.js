import { handleDeleteJob } from "../actions/delete.js";
import { handleStatusChange } from "../actions/status.js";
import { template } from "../dom.js";
import {
  formatAppliedLine,
  formatPostedLine,
} from "../utils/dates.js";
import {
  getAppliedTimestamp,
  getCompanyName,
  getFactItems,
  getPostedTimestamp,
  queryCard,
} from "../utils/job-fields.js";
import { shouldHideText } from "../utils/text.js";
import { renderJobFacts } from "./job-facts.js";
import { renderJobSkills } from "./job-skills.js";
import { renderStatusSelect } from "./status-select.js";

export function renderJobCard(job) {
  const node = template.content.firstElementChild.cloneNode(true);
  const els = {
    title: queryCard(node, "title"),
    company: queryCard(node, "company"),
    posted: queryCard(node, "posted"),
    applied: queryCard(node, "applied"),
    facts: queryCard(node, "facts"),
    details: queryCard(node, "details"),
    link: queryCard(node, "link"),
    skills: queryCard(node, "skills"),
    skillsWrap: queryCard(node, "skillsWrap"),
    statusPill: queryCard(node, "statusPill"),
    statusSelect: queryCard(node, "statusSelect"),
    connects: queryCard(node, "connects"),
    deleteBtn: queryCard(node, "deleteBtn"),
  };

  els.title.textContent = job.jobTitle || "Untitled role";
  if (job.url) {
    els.title.href = job.url;
    els.title.title = job.url;
  } else {
    els.title.removeAttribute("href");
  }

  if (els.company) {
    els.company.textContent = getCompanyName(job) || "Unknown company";
  }

  if (els.posted) {
    els.posted.textContent = formatPostedLine(getPostedTimestamp(job));
    els.posted.style.display = "block";
  }

  if (els.applied) {
    els.applied.textContent = formatAppliedLine(getAppliedTimestamp(job));
    els.applied.style.display = "block";
  }

  const detailsText = (job.jobDetails || "").trim();
  if (detailsText && !shouldHideText(detailsText) && els.details) {
    els.details.textContent = detailsText;
    els.details.style.display = "block";
  } else if (els.details) {
    els.details.style.display = "none";
  }

  if (els.link) {
    if (job.url) {
      els.link.href = job.url;
      els.link.style.display = "inline-flex";
    } else {
      els.link.removeAttribute("href");
      els.link.style.display = "none";
    }
  }

  renderJobSkills(els.skills, els.skillsWrap, job);
  renderJobFacts(els.facts, getFactItems(job));
  renderStatusSelect(
    els.statusSelect,
    job,
    els.statusPill,
    handleStatusChange
  );

  if (els.connects) {
    els.connects.textContent = job.connects || "0";
    els.connects.style.display = "block";
  }

  if (els.deleteBtn) {
    els.deleteBtn.addEventListener("click", () => {
      handleDeleteJob(job, els.deleteBtn);
    });
  }

  return node;
}
