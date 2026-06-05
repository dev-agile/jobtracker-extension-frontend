// content-script.js
(function () {
    const UPWORK_HOST = "upwork.com";
    const UPWORK_APPLY_PATH_MATCHER = /\/nx\/proposals\/job\/~[^/]+\/apply\/?$/i;
    const UPWORK_JOB_PATH_MATCHER = /\/jobs\/~[^/]+/i;
    const UPWORK_PROPOSAL_JOB_PATH_MATCHER = /\/nx\/proposals\/job\/~[^/]+/i;
    const JUNK_TITLE_PATTERNS = [
        /\bmaximize your earnings\b/i,
        /\bservice fee\b/i,
        /\bbring new clients\b/i,
        /\brefer(?: a)? friend\b/i,
        /\bget started on upwork\b/i,
        /\bjoin upwork\b/i,
        /\bmonthly\s+connects\b/i,
        /\bconnects\s+and\s+full\s+access\b/i,
        /\bupwork'?s\s+mindful\s+ai\b/i,
        /\bmindful\s+ai\b/i,
        /\bget\s+\d+\s+connects\b/i,
        /\b\d+\s+monthly\s+connects\b/i,
        /\bfull\s+access\s+to\s+uma\b/i,
    ];
    const UPWORK_JOB_URL_MATCHER = /\/(?:jobs\/~|nx\/proposals\/job\/~)/i;
    const MIN_DESCRIPTION_CHARS = 120;
    const MIN_TITLE_CHARS = 8;

    let saveInFlight = false;
    let pendingSaveKey = "";
    const sessionSavedKeys = new Set();
    let toastEl = null;
    let toastTimeout = null;

    const DESCRIPTION_SELECTORS = [
        '[data-test*="description"]',
        ".job-description",
        '[class*="job-description"]',
        ".up-markdown",
    ];

    function isUpworkPage() {
        return window.location.hostname.includes(UPWORK_HOST);
    }

    function cleanText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function normalizeUrl(url) {
        if (!url) return "";
        try {
            const parsed = new URL(url);
            parsed.hash = "";
            return parsed.origin + parsed.pathname;
        } catch (_) {
            return cleanText(url);
        }
    }

    function getText(selector, root = document) {
        return cleanText(root.querySelector(selector)?.textContent || "");
    }

    function getAllTexts(selectors, root = document, limit = 20) {
        const out = [];
        for (const selector of selectors) {
            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
                const text = cleanText(node.textContent || node.innerText);
                if (text) out.push(text);
                if (out.length >= limit) return out;
            }
        }
        return out;
    }

    function isOnUpworkApplyPage() {
        return UPWORK_APPLY_PATH_MATCHER.test(window.location.pathname);
    }

    function isOnUpworkJobPage() {
        const path = window.location.pathname;
        return (
            UPWORK_JOB_PATH_MATCHER.test(path) ||
            UPWORK_PROPOSAL_JOB_PATH_MATCHER.test(path)
        );
    }

    function isOnUpworkJobContext() {
        return isOnUpworkApplyPage() || isOnUpworkJobPage();
    }

    function isPromoOrMarketingText(text) {
        const value = cleanText(text);
        if (!value) return true;
        if (JUNK_TITLE_PATTERNS.some((pattern) => pattern.test(value))) return true;
        const lower = value.toLowerCase();
        if (/\bconnects\b/.test(lower) && /\b(monthly|full access|uma)\b/.test(lower)) {
            return true;
        }
        return false;
    }

    function isLikelyJobTitle(text) {
        const value = cleanText(text);
        if (!value || value.length < MIN_TITLE_CHARS) return false;
        if (isPromoOrMarketingText(value)) return false;
        const lower = value.toLowerCase();
        if (lower === "job details" || lower === "apply now") return false;
        return true;
    }

    function hasValidUpworkJobUrl() {
        const url = getCanonicalJobUrl();
        return Boolean(url && UPWORK_JOB_URL_MATCHER.test(url));
    }

    function canonicalizeJobUrl(url) {
        if (!url) return "";
        try {
            const parsed = new URL(url);
            const applyMatch = parsed.pathname.match(/(\/nx\/proposals\/job\/~[^/]+)\/apply\/?/i);
            if (applyMatch) {
                parsed.pathname = applyMatch[1];
            }
            const jobMatch = parsed.pathname.match(/(\/jobs\/~[^/]+)\/?/i);
            if (jobMatch) {
                parsed.pathname = jobMatch[1];
            }
            parsed.hash = "";
            parsed.search = "";
            return parsed.origin + parsed.pathname;
        } catch (_) {
            return normalizeUrl(url);
        }
    }

    function getCanonicalJobUrl() {
        const fromPage = canonicalizeJobUrl(window.location.href);
        if (fromPage && /\/(?:jobs\/~|nx\/proposals\/job\/~)/i.test(fromPage)) {
            return fromPage;
        }

        const scope = getPrimaryJobScope();
        if (scope) {
            for (const anchor of scope.querySelectorAll('a[href*="/jobs/~"], a[href*="/nx/proposals/job/~"]')) {
                const href = anchor.getAttribute("href") || "";
                const canonical = canonicalizeJobUrl(
                    href.startsWith("http") ? href : `${window.location.origin}${href}`
                );
                if (canonical) return canonical;
            }
        }

        return fromPage;
    }

    function buildDedupeKey(payload) {
        return (
            canonicalizeJobUrl(payload.url) ||
            `${(payload.jobTitle || "").toLowerCase()}::${(payload.company || "").toLowerCase()}`
        );
    }

    function isMostlyVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 32) return false;
        const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        const visibleWidth = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
        if (visibleHeight <= 0 || visibleWidth <= 0) return false;
        const totalArea = rect.width * rect.height;
        const visibleArea = visibleWidth * visibleHeight;
        return visibleArea / totalArea >= 0.55;
    }

    function findVisibleDescriptionBlocks() {
        const seen = new Set();
        const blocks = [];

        for (const selector of DESCRIPTION_SELECTORS) {
            for (const el of document.querySelectorAll(selector)) {
                const text = cleanText(el.textContent || "");
                if (text.length < MIN_DESCRIPTION_CHARS) continue;
                if (!isMostlyVisible(el)) continue;
                const key = text.slice(0, 80);
                if (seen.has(key)) continue;
                seen.add(key);
                blocks.push({ el, text });
            }
        }

        return blocks;
    }

    function getPrimaryJobScope() {
        const blocks = findVisibleDescriptionBlocks();

        if (isOnUpworkApplyPage()) {
            if (blocks.length === 1) {
                return (
                    blocks[0].el.closest(
                        ".air3-card-section, [class*='job-details'], [data-test*='job-details'], main"
                    ) || blocks[0].el
                );
            }
            return (
                document.querySelector(
                    '[data-test*="job-details"], [class*="job-details"], [class*="JobDetails"]'
                ) || null
            );
        }

        if (blocks.length === 1) {
            return (
                blocks[0].el.closest(
                    ".air3-card-section, [class*='job-details'], [data-test*='job-details'], main"
                ) || blocks[0].el
            );
        }

        if (blocks.length === 0) {
            return null;
        }

        return null;
    }

    function validateJobContext(scraped) {
        if (!scraped) {
            return { ok: false, message: "Could not read job details on this page." };
        }

        if (!isLikelyJobTitle(scraped.title)) {
            return { ok: false, message: "Open a job with a visible title, then click Save this job." };
        }

        if (!isOnUpworkJobContext()) {
            return {
                ok: false,
                message: "Open the job posting or apply page first.",
            };
        }

        if (!hasValidUpworkJobUrl()) {
            return {
                ok: false,
                message: "This page is not a valid Upwork job URL.",
            };
        }

        const visibleBlocks = findVisibleDescriptionBlocks();

        if (isOnUpworkApplyPage()) {
            const hasDescription =
                visibleBlocks.length >= 1 ||
                (scraped.details && scraped.details.length >= MIN_DESCRIPTION_CHARS);
            if (!hasDescription) {
                return {
                    ok: false,
                    message: "Wait until the full job description is visible.",
                };
            }
            return { ok: true };
        }

        if (visibleBlocks.length === 0) {
            return {
                ok: false,
                message: "Scroll so the full job description is visible, then apply.",
            };
        }

        if (visibleBlocks.length > 1) {
            return {
                ok: false,
                message: "Only one job description should be visible. Open a single job first.",
            };
        }

        if (!scraped.details || scraped.details.length < MIN_DESCRIPTION_CHARS) {
            return {
                ok: false,
                message: "Scroll so the full job description is visible, then apply.",
            };
        }

        return { ok: true };
    }

    function showAlreadyAppliedToast(dedupeKey) {
        sessionSavedKeys.add(dedupeKey);
        showToast("Already applied. Job is already saved.", "warning");
    }

    function showToast(message, variant) {
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.id = "jobtracker-toast";
            toastEl.style.position = "fixed";
            toastEl.style.right = "16px";
            toastEl.style.bottom = "64px";
            toastEl.style.zIndex = "2147483647";
            toastEl.style.padding = "10px 14px";
            toastEl.style.borderRadius = "10px";
            toastEl.style.fontSize = "13px";
            toastEl.style.fontWeight = "600";
            toastEl.style.boxShadow = "0 12px 24px rgba(0,0,0,0.22)";
            toastEl.style.transition = "opacity 140ms ease, transform 140ms ease";
            toastEl.style.opacity = "0";
            toastEl.style.transform = "translateY(6px)";
            document.body.appendChild(toastEl);
        }

        if (variant === "warning") {
            toastEl.style.background = "#fff7ed";
            toastEl.style.color = "#9a3412";
            toastEl.style.border = "1px solid #fed7aa";
        } else if (variant === "error") {
            toastEl.style.background = "#fef2f2";
            toastEl.style.color = "#b91c1c";
            toastEl.style.border = "1px solid #fecaca";
        } else {
            toastEl.style.background = "#ecfdf3";
            toastEl.style.color = "#166534";
            toastEl.style.border = "1px solid #bbf7d0";
        }

        toastEl.textContent = message;
        toastEl.style.opacity = "1";
        toastEl.style.transform = "translateY(0)";

        if (toastTimeout) window.clearTimeout(toastTimeout);
        toastTimeout = window.setTimeout(() => {
            if (!toastEl) return;
            toastEl.style.opacity = "0";
            toastEl.style.transform = "translateY(6px)";
        }, 2200);
    }

    // 1) Fetch heading/title first (as shown in UI)
    function scrapeUpworkTitle(root) {
        const candidates = [
            getText(".air3-card-section .content h3.h5", root),
            getText(".air3-card-section .content h3", root),
            getText("[data-test*='job-title']", root),
            getText("[class*='job-title']", root),
            getText("[data-test*='JobDetails'] h2", root),
            getText("[data-test*='job-details'] h2", root),
            getText("[class*='job-details'] h2", root),
            getText("main h2", root),
            getText("main h3", root),
        ].filter(Boolean);

        for (const text of candidates) {
            if (isLikelyJobTitle(text)) return text;
        }
        return "";
    }

    function normalizePostedText(raw) {
        const text = cleanText(raw);
        if (!text) return "";

        let value = text.replace(/^posted\s*/i, "").trim();

        const iso = value.match(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/);
        if (iso) return iso[0];

        const longDate = value.match(
            /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i
        );
        if (longDate) return longDate[0];

        const relative = value.match(
            /\b(?:today|yesterday|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\b/i
        );
        if (relative) return relative[0];

        if (value.length > 40 || /\b(seeking|developer|development|experience)\b/i.test(value)) {
            return "";
        }

        return value.length <= 40 ? value : "";
    }

    function getUpworkJobDetailRoots(scope) {
        const roots = [
            ...scope.querySelectorAll(
                ".air3-card-section, [class*='job-details'], [class*='JobDetails'], [data-test*='job-details']"
            ),
        ];
        if (scope.matches?.(".air3-card-section, main, [data-test*='job-details']")) {
            roots.unshift(scope);
        }
        return roots.length ? roots : [scope];
    }

    // 2) Fetch posted date text from job page
    function scrapeUpworkPosted(scope) {
        for (const root of getUpworkJobDetailRoots(scope)) {
            for (const node of root.querySelectorAll('[data-test*="posted"], [data-cy*="posted"]')) {
                const text = cleanText(node.textContent || "");
                if (!/\bposted\b/i.test(text)) continue;
                if (text.length > 80) continue;
                const normalized = normalizePostedText(text);
                if (normalized) return normalized;
            }

            for (const timeEl of root.querySelectorAll("time[datetime]")) {
                const label = cleanText(timeEl.textContent || "");
                if (!/\bposted\b/i.test(label)) continue;
                const dt = timeEl.getAttribute("datetime");
                const normalized = normalizePostedText(dt || label);
                if (normalized) return normalized;
            }

            for (const node of root.querySelectorAll("span, small, p, time")) {
                const text = cleanText(node.textContent || "");
                if (text.length < 8 || text.length > 55) continue;
                if (!/^posted\b/i.test(text)) continue;
                const normalized = normalizePostedText(text);
                if (normalized) return normalized;
            }
        }

        return "";
    }

    // 3) Fetch category (used in popup subline)
    function scrapeUpworkCategory(scope) {
        const candidates = getAllTexts(
            [
                "li.d-xs-block .air3-token",
                "[data-test*='category'] .air3-token",
                ".air3-token.text-body-sm",
                ".air3-token",
            ],
            scope,
            30
        );

        for (const text of candidates) {
            const lower = text.toLowerCase();
            if (!text || text.length > 60) continue;
            if (lower.includes("connects")) continue;
            if (lower.includes("experience level")) continue;
            if (lower.includes("hourly")) continue;
            if (lower.includes("fixed-price")) continue;
            if (lower.includes("duration")) continue;
            return text;
        }
        return "Upwork";
    }

    // 4) Fetch description/details
    function scrapeUpworkDetails(scope) {
        const visible = findVisibleDescriptionBlocks().filter((block) =>
            scope.contains(block.el)
        );
        if (visible.length) {
            return visible[0].text.slice(0, 600);
        }

        const blocks = getAllTexts(
            [
                '[data-test*="description"]',
                ".job-description",
                '[class*="description"]',
                ".up-markdown",
                "article p",
            ],
            scope,
            40
        );
        const best = blocks.find((item) => item.length >= MIN_DESCRIPTION_CHARS) || blocks[0] || "";
        return best.slice(0, 600);
    }

    // 5) Fetch skills
    function scrapeUpworkSkills(scope) {
        const raw = getAllTexts(
            [
                '[data-test*="skill"]',
                '[aria-label*="skill" i]',
                ".air3-token",
                ".chip",
            ],
            scope,
            60
        );

        const unique = [];
        const seen = new Set();
        for (const text of raw) {
            if (!text || text.length > 40) continue;
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(text);
        }
        return unique.slice(0, 12);
    }

    // 6) Fetch right sidebar values (experience, budget, duration)
    function scrapeUpworkSidebarMeta(scope) {
        const meta = {
            experienceLevel: "",
            hourlyRange: "",
            hourly: "",
            projectLength: "",
            fixedPrice: "",
        };

        const items = scope.querySelectorAll(
            ".fe-ui-job-features li, ul[class*='job-features'] li, li[data-test], li[data-cy]"
        );

        for (const item of items) {
            const rawLabel = cleanText(
                item.querySelector("small, [class*='text-light']")?.textContent || ""
            );
            const label = rawLabel.toLowerCase();
            const strong = item.querySelector("strong");
            const hint = cleanText(
                item.getAttribute("data-test") || item.getAttribute("data-cy") || ""
            ).toLowerCase();

            const isProjectLength =
                (label && label.includes("project length")) ||
                (label && label.includes("duration")) ||
                hint.includes("duration");
                
            const value = cleanText(
                isProjectLength
                    ? strong?.querySelector("span")?.textContent ||
                      strong?.firstElementChild?.textContent ||
                      ""
                    : strong?.textContent ||
                      item.querySelector(".header")?.textContent ||
                      item.querySelector("[class*='value']")?.textContent ||
                      ""
            );

            // Upwork occasionally renders hint-only rows without a visible label.
            if (!value) continue;

            if ((label && label.includes("experience level")) || hint.includes("expertise")) {
                meta.experienceLevel = value;
                continue;
            }
            if ((label && label.includes("hourly range")) || hint.includes("hourly-rate")) {
                meta.hourlyRange = value;
                continue;
            }
            if (label && label.includes("hourly")) {
                meta.hourly = value;
                continue;
            }
            if (
                (label && label.includes("fixed-price")) ||
                (label && label.includes("fixed price")) ||
                hint.includes("fixed-price")
            ) {
                meta.fixedPrice = value;
                continue;
            }
            if (
                (label && label.includes("project length")) ||
                (label && label.includes("duration")) ||
                hint.includes("duration")
            ) {
                meta.projectLength = value;
            }
        }

        return meta;
    }

    // for cover letter
    function scrapeUpworkCoverLetter() {
        const el = document.querySelector('textarea[aria-labelledby="cover_letter_label"]')
            || document.querySelector('#cover_letter_label ~ div textarea')
            || document.querySelector('textarea.inner-textarea');
        return cleanText(el?.value || "");
    }

    function scrapeUpworkJob() {
        if (!isUpworkPage()) {
            return null;
        }

        const scope = getPrimaryJobScope();
        if (!scope) {
            return null;
        }

        const title = scrapeUpworkTitle(scope);
        const company = scrapeUpworkCategory(scope);
        const posted = scrapeUpworkPosted(scope);
        const details = scrapeUpworkDetails(scope);
        const skills = scrapeUpworkSkills(scope);
        const sidebarMeta = scrapeUpworkSidebarMeta(scope);
        const coverLetter = scrapeUpworkCoverLetter(scope);

        return { title, company, posted, details, skills, ...sidebarMeta, coverLetter };
    }

    function sendJobApplied(payloadOverrides) {
        if (!isUpworkPage()) return;

        const scraped = scrapeUpworkJob();
        const validation = validateJobContext(scraped);
        if (!validation.ok) {
            showToast(validation.message, "warning");
            return;
        }

        const payload = {
            jobTitle: scraped.title,
            company: scraped.company,
            posted: scraped.posted,
            jobDetails: scraped.details,
            skills: scraped.skills,
            experienceLevel: scraped.experienceLevel,
            hourlyRange: scraped.hourlyRange,
            hourly: scraped.hourly,
            fixedPrice: scraped.fixedPrice,
            projectLength: scraped.projectLength,
            coverLetter: scraped.coverLetter,
            url: getCanonicalJobUrl(),
            appliedAt: new Date().toISOString(),
            status: "applied",
            ...(payloadOverrides || {}),
        };

        const dedupeKey = buildDedupeKey(payload);

        if (sessionSavedKeys.has(dedupeKey)) {
            showAlreadyAppliedToast(dedupeKey);
            return;
        }

        if (saveInFlight) {
            if (pendingSaveKey === dedupeKey) {
                showAlreadyAppliedToast(dedupeKey);
            }
            return;
        }

        saveInFlight = true;
        pendingSaveKey = dedupeKey;

        chrome.runtime.sendMessage({ type: "JOB_APPLIED", payload }, (response) => {
            saveInFlight = false;
            pendingSaveKey = "";

            if (chrome.runtime.lastError) {
                showToast("Could not save job", "error");
                return;
            }

            if (response && response.reason === "duplicate") {
                showAlreadyAppliedToast(dedupeKey);
                return;
            }

            if (response && response.saved) {
                sessionSavedKeys.add(dedupeKey);
                showToast("Job saved successfully", "success");
                return;
            }

            if (response && response.error) {
                showToast(response.error, "error");
                return;
            }

            showToast("Could not save job", "error");
        });
    }

    function shouldShowSaveButton() {
        return isUpworkPage() && isOnUpworkJobContext();
    }

    function injectSaveJobButton() {
        if (!shouldShowSaveButton()) return;
        if (document.getElementById("jobtracker-upwork-save-btn")) return;

        const btn = document.createElement("button");
        btn.id = "jobtracker-upwork-save-btn";
        btn.type = "button";
        btn.textContent = "Save this job";
        btn.style.position = "fixed";
        btn.style.right = "16px";
        btn.style.bottom = "16px";
        btn.style.zIndex = "2147483647";
        btn.style.padding = "10px 14px";
        btn.style.border = "none";
        btn.style.borderRadius = "8px";
        btn.style.background = "#14a800";
        btn.style.color = "#fff";
        btn.style.fontSize = "13px";
        btn.style.fontWeight = "600";
        btn.style.cursor = "pointer";
        btn.style.boxShadow = "0 8px 22px rgba(0,0,0,0.2)";
        btn.addEventListener("click", () => sendJobApplied());
        document.body.appendChild(btn);
    }

    injectSaveJobButton();

    const saveButtonObserver = new MutationObserver(() => {
        injectSaveJobButton();
    });
    saveButtonObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "GET_LOCAL_JOBS" }, (response) => {
            if (chrome.runtime.lastError || !response?.jobs) return;
            for (const job of response.jobs) {
                sessionSavedKeys.add(
                    buildDedupeKey({
                        url: job.url,
                        jobTitle: job.jobTitle,
                        company: job.company,
                    })
                );
            }
        });
    }
})();
