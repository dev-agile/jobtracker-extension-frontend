// popup.js — extension popup UI: list jobs, filter, sync with backend
(function () {
  // ---------------------------------------------------------------------------
  // 1) Config — edit these arrays when adding fields, filters, or card sections
  // ---------------------------------------------------------------------------

  const BANNER_HIDE_MS = 3200;
  const MAX_SKILLS_SHOWN = 8;
  const DEFAULT_STATUS = "applied";

  // Status dropdown + quick-filter chips
  const STATUS_OPTIONS = [
    { value: "applied", label: "Applied" },
    { value: "screening", label: "Screening" },
    { value: "interview", label: "Interview" },
    { value: "offer", label: "Offer" },
    { value: "rejected", label: "Rejected" },
    { value: "ghosted", label: "Ghosted" },
  ];

  const QUICK_FILTER_OPTIONS = [{ value: "all", label: "all" }].concat(STATUS_OPTIONS);

  // API/local may use different key names — pickJobField tries each in order
  const JOB_POSTED_KEYS = ["posted", "postedAt"];
  const JOB_APPLIED_KEYS = ["appliedAt", "applied_date", "appliedDate"];

  // Fields combined into one string for search box matching
  const JOB_SEARCH_FIELDS = [
    "jobTitle",
    "company",
    "jobDetails",
    "experienceLevel",
    "hourlyRange",
    "hourly",
    "projectLength",
    "url",
  ];

  // Right-column facts on each job card (label + job object key)
  const JOB_CARD_FACT_FIELDS = [
    { label: "Experience level", key: "experienceLevel" },
    { label: "Hourly range", key: "hourlyRange" },
    { label: "Hourly", key: "hourly" },
    { label: "Project length", key: "projectLength" },
  ];

  // Map logical names → CSS selectors inside #jobCardTemplate
  const JOB_CARD_SELECTORS = {
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

  // Posted-date parsing — strip junk from scraped/legacy DB values
  const POSTED_PREFIX_RE = /^posted\s*/i;
  const POSTED_TRIM_MAX_LEN = 35;
  const POSTED_REJECT_MAX_LEN = 40;
  const POSTED_JUNK_RE = /\b(seeking|developer|development|experience)\b/i;
  const HIDE_TEXT_RE = /^remaining balance:\s*\d+\s*connects?$/i;

  // Tried in order: ISO, "Jun 2, 2026", "3 days ago"
  const POSTED_DATE_PATTERNS = [
    /\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i,
    /\b(?:today|yesterday|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\b/i,
  ];

  // ---------------------------------------------------------------------------
  // 2) DOM — elements from index.html
  // ---------------------------------------------------------------------------
  const refreshBtn = document.getElementById("refreshBtn");
  const searchInput = document.getElementById("searchInput");
  const statusFilterEl = document.getElementById("statusFilter");
  const jobsContainer = document.getElementById("jobsContainer");
  const emptyState = document.getElementById("emptyState");
  const banner = document.getElementById("banner");
  const loader = document.getElementById("loader");
  const template = document.getElementById("jobCardTemplate");
  const clearLocalBtn = document.getElementById("clearLocalBtn");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");
  const clearSearchBtn = document.getElementById("clearSearchBtn");
  const quickFiltersEl = document.getElementById("quickFilters");
  const totalCountEl = document.getElementById("totalCount");
  const visibleCountEl = document.getElementById("visibleCount");

  // ---------------------------------------------------------------------------
  // 3) State
  // ---------------------------------------------------------------------------
  let bannerTimeout;
  let allJobs = [];

  // ---------------------------------------------------------------------------
  // 4) Job field helpers — read/normalize data from API + chrome.storage
  // ---------------------------------------------------------------------------

  // Return first non-empty value for any key in the keys array
  function pickJobField(job, keys) {
    if (!job || typeof job !== "object") return "";
    for (const key of keys) {
      const value = job[key];
      if (value != null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return "";
  }

  function getPostedTimestamp(job) {
    return pickJobField(job, JOB_POSTED_KEYS);
  }

  function getAppliedTimestamp(job) {
    return pickJobField(job, JOB_APPLIED_KEYS);
  }

  function getJobStatus(job) {
    return (job.status || DEFAULT_STATUS).toLowerCase();
  }

  // Lowercase string used by applyFilters() search input
  function buildSearchHaystack(job) {
    const parts = JOB_SEARCH_FIELDS.map((key) => String(job[key] || ""));
    if (Array.isArray(job.skills)) {
      parts.push(job.skills.join(" "));
    }
    return parts.join(" ").toLowerCase();
  }

  // Prefer job.company; fallback to hostname from job.url
  function getCompanyName(job) {
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

  // Build fact rows for card sidebar from JOB_CARD_FACT_FIELDS
  function getFactItems(job) {
    return JOB_CARD_FACT_FIELDS.map((field) => ({
      label: field.label,
      value: job[field.key],
    })).filter((item) => (item.value || "").trim() && !shouldHideText(item.value));
  }

  function queryCard(node, selectorKey) {
    return node.querySelector(JOB_CARD_SELECTORS[selectorKey]);
  }

  // ---------------------------------------------------------------------------
  // 5) Date helpers — format lines, sort newest applied first
  // ---------------------------------------------------------------------------

  function appliedDateMs(job) {
    const raw = getAppliedTimestamp(job);
    if (!raw) return 0;
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }

  // Latest application on top
  function sortJobsByAppliedDesc(jobs) {
    return jobs.slice().sort((a, b) => appliedDateMs(b) - appliedDateMs(a));
  }

  function stripPostedPrefix(raw) {
    return String(raw || "").trim().replace(POSTED_PREFIX_RE, "").trim();
  }

  // Pull only the date portion; reject description text leaked into posted field
  function extractPostedDate(raw) {
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

  // ISO or parseable string → locale date/time; fallback for relative text
  function formatDate(iso) {
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

  // UI line: "Posted Jun 2, 2026, 10:30 AM" (no double "Posted" prefix)
  function formatPostedLine(raw) {
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

  // UI line: "Applied Jun 2, 2026, 4:53 PM"
  function formatAppliedLine(raw) {
    const ts = String(raw || "").trim();
    if (!ts) return "Applied Date unknown";
    return `Applied ${formatDate(ts)}`;
  }

  // ---------------------------------------------------------------------------
  // 6) Messaging — talk to background.js service worker
  // ---------------------------------------------------------------------------
  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 7) UI helpers — banner, loading, status pill, counts
  // ---------------------------------------------------------------------------
  function setLoading(isLoading) {
    loader.classList.toggle("is-visible", isLoading);
    refreshBtn.disabled = isLoading;
  }

  function showBanner(message, variant = "info", persist = false) {
    banner.textContent = message;
    banner.classList.remove("banner--hidden", "banner--info", "banner--error");
    banner.classList.add(variant === "error" ? "banner--error" : "banner--info");

    if (bannerTimeout) window.clearTimeout(bannerTimeout);
    if (!persist) {
      bannerTimeout = window.setTimeout(() => {
        banner.classList.add("banner--hidden");
      }, BANNER_HIDE_MS);
    }
  }

  function hideBanner() {
    banner.classList.add("banner--hidden");
    if (bannerTimeout) window.clearTimeout(bannerTimeout);
  }

  function toLabelCase(value) {
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  // Hide Upwork "Remaining balance: N connects" noise in card body
  function shouldHideText(value) {
    return HIDE_TEXT_RE.test(String(value || "").trim().toLowerCase());
  }

  function statusClassName(status) {
    return "status-" + (status || DEFAULT_STATUS).toLowerCase();
  }

  function setStatusPillState(statusPill, status) {
    if (!statusPill) return;
    const normalized = (status || DEFAULT_STATUS).toLowerCase();
    statusPill.textContent = toLabelCase(normalized);
    statusPill.className = "job-card__status-pill " + statusClassName(normalized);
  }

  function updateQuickFilterHighlight() {
    if (!quickFiltersEl) return;
    const activeStatus = statusFilterEl.value;
    quickFiltersEl
      .querySelectorAll(".quick-filter-chip")
      .forEach((chip) =>
        chip.classList.toggle("is-active", chip.dataset.status === activeStatus)
      );
  }

  function updateCounts(visibleJobs) {
    if (totalCountEl) totalCountEl.textContent = String(allJobs.length);
    if (visibleCountEl) visibleCountEl.textContent = String(visibleJobs.length);
  }

  // ---------------------------------------------------------------------------
  // 8) Render — build list from template + JOB_CARD_* config
  // ---------------------------------------------------------------------------

  function renderQuickFilters() {
    if (!quickFiltersEl) return;
    quickFiltersEl.innerHTML = "";

    QUICK_FILTER_OPTIONS.forEach((option) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-filter-chip";
      btn.dataset.status = option.value;
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        statusFilterEl.value = option.value;
        updateQuickFilterHighlight();
        applyFilters();
      });
      quickFiltersEl.appendChild(btn);
    });

    updateQuickFilterHighlight();
  }

  // Sidebar grid: experience, hourly, project length, etc.
  function renderJobFacts(factsEl, factItems) {
    if (!factsEl) return;
    factsEl.innerHTML = "";

    factItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "job-card__fact-row";

      const valueEl = document.createElement("p");
      valueEl.className = "job-card__fact-value";
      valueEl.textContent = item.value;

      const labelEl = document.createElement("p");
      labelEl.className = "job-card__fact-label";
      labelEl.textContent = item.label;

      row.appendChild(valueEl);
      row.appendChild(labelEl);
      factsEl.appendChild(row);
    });

    factsEl.style.display = factItems.length ? "grid" : "none";
  }

  // Skill chips (max MAX_SKILLS_SHOWN)
  function renderJobSkills(skillsEl, skillsWrapEl, job) {
    if (!skillsEl) return;

    const skillList = (Array.isArray(job.skills) ? job.skills : []).filter(
      (skill) => !shouldHideText(skill)
    );

    skillsEl.innerHTML = "";

    if (!skillList.length) {
      skillsEl.style.display = "none";
      if (skillsWrapEl) skillsWrapEl.style.display = "none";
      return;
    }

    skillList.slice(0, MAX_SKILLS_SHOWN).forEach((skill) => {
      const chip = document.createElement("span");
      chip.className = "job-card__skill-chip";
      chip.textContent = String(skill);
      skillsEl.appendChild(chip);
    });

    skillsEl.style.display = "flex";
    if (skillsWrapEl) skillsWrapEl.style.display = "block";
  }

  // Status <select> + pill; disabled until server assigns job.id
  function renderStatusSelect(selectEl, job, statusPill) {
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
      handleStatusChange(job.id, selectEl, statusPill);
    });
  }

  // Clone #jobCardTemplate and fill one job
  function renderJobCard(job) {
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

    // Dates stack vertically: Posted first, Applied second (see index.html)
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
    renderStatusSelect(els.statusSelect, job, els.statusPill);

    if (els.deleteBtn) {
      els.deleteBtn.addEventListener("click", () => {
        handleDeleteJob(job, els.deleteBtn);
      });
    }

    return node;
  }

  function renderJobs(jobs) {
    // jobs should already be filtered + sorted by applyFilters()
    jobsContainer.innerHTML = "";
    updateCounts(jobs);

    if (!jobs.length) {
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    jobs.forEach((job) => {
      jobsContainer.appendChild(renderJobCard(job));
    });
  }

  // Search + status filter, then sort by applied date (newest first)
  function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const statusFilter = statusFilterEl.value;

    const filtered = allJobs.filter((job) => {
      const matchesStatus =
        statusFilter === "all" || getJobStatus(job) === statusFilter;
      const matchesSearch = !search || buildSearchHaystack(job).includes(search);
      return matchesStatus && matchesSearch;
    });

    renderJobs(sortJobsByAppliedDesc(filtered));
    updateQuickFilterHighlight();
  }

  // ---------------------------------------------------------------------------
  // 9) Actions — status update, delete, load local cache, sync API
  // ---------------------------------------------------------------------------
  async function handleStatusChange(jobId, selectEl, statusPill) {
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

  // Optimistic UI remove, then DELETE_JOB via background
  async function handleDeleteJob(job, deleteBtn) {
    const shouldDelete = window.confirm(
      "Delete this job from the extension list?"
    );
    if (!shouldDelete) return;

    if (deleteBtn) deleteBtn.disabled = true;
    const previousJobs = allJobs.slice();

    allJobs = allJobs.filter((item) => {
      if (job.id) return item.id !== job.id;
      return !(
        item.url === job.url &&
        getAppliedTimestamp(item) === getAppliedTimestamp(job)
      );
    });
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
      allJobs = previousJobs;
      applyFilters();
      showBanner(
        err && err.message ? err.message : "Failed to delete job",
        "error"
      );
      if (deleteBtn) deleteBtn.disabled = false;
    }
  }

  // Show chrome.storage.local immediately (offline-friendly)
  async function loadLocalJobs() {
    try {
      const jobs = await new Promise((resolve) => {
        chrome.storage.local.get({ jobs: [] }, (res) => {
          resolve(res.jobs || []);
        });
      });
      allJobs = jobs;
      applyFilters();
    } catch (err) {
      console.error("Failed to load local jobs", err);
    }
  }

  // Fetch from backend and replace allJobs (background merges posted if missing)
  async function syncJobs() {
    hideBanner();
    setLoading(true);

    try {
      const response = await sendMessage({ type: "SYNC_JOBS" });
      allJobs = (response && response.jobs) || [];
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

  // ---------------------------------------------------------------------------
  // 10) Init — load local cache first, then sync server
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    renderQuickFilters();
    setLoading(true);
    loadLocalJobs().finally(() => {
      setLoading(false);
      syncJobs();
    });

    searchInput.addEventListener("input", applyFilters);
    statusFilterEl.addEventListener("change", applyFilters);
    refreshBtn.addEventListener("click", syncJobs);

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener("click", () => {
        searchInput.value = "";
        applyFilters();
        searchInput.focus();
      });
    }

    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener("click", () => {
        searchInput.value = "";
        statusFilterEl.value = "all";
        applyFilters();
      });
    }

    if (clearLocalBtn) {
      clearLocalBtn.addEventListener("click", () => {
        chrome.storage.local.set({ jobs: [], outbox: [] }, () => {
          allJobs = [];
          renderJobs([]);
          showBanner("Local cache cleared", "info");
        });
      });
    }
  });
})();
