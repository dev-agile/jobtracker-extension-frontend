// content-script.js
(function () {
    const UPWORK_HOST = "upwork.com";
    const UPWORK_APPLY_PATH_MATCHER = /\/nx\/proposals\/job\/~[^/]+\/apply\/?$/i;
    const SAVE_DEBOUNCE_MS = 2000;

    let lastSaveAttemptAt = 0;
    let saveInFlight = false;
    let lastDuplicateToastKey = "";
    let toastEl = null;
    let toastTimeout = null;

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

    function getAllTexts(selectors, limit = 20) {
        const out = [];
        for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
                const text = cleanText(node.textContent || node.innerText);
                if (text) out.push(text);
                if (out.length >= limit) return out;
            }
        }
        return out;
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
    function scrapeUpworkTitle() {
        const candidates = [
            getText(".air3-card-section .content h3.h5"),
            getText(".air3-card-section .content h3"),
            getText("[data-test*='job-title']"),
            getText("[class*='job-title']"),
            getText("main h2"),
            getText("main h3"),
            getText("h1"),
            cleanText(document.title),
        ].filter(Boolean);

        for (const text of candidates) {
            const lower = text.toLowerCase();
            if (text.length < 8) continue;
            if (lower === "job details" || lower === "apply now") continue;
            return text;
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

    function getUpworkJobDetailRoots() {
        const roots = [
            ...document.querySelectorAll(
                ".air3-card-section, [class*='job-details'], [class*='JobDetails'], [data-test*='job-details']"
            ),
        ];
        const main = document.querySelector("main");
        if (main) roots.push(main);
        return roots.length ? roots : [document.body];
    }

    // 2) Fetch posted date text from job page
    function scrapeUpworkPosted() {
        for (const root of getUpworkJobDetailRoots()) {
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
    function scrapeUpworkCategory() {
        const candidates = getAllTexts(
            [
                "li.d-xs-block .air3-token",
                "[data-test*='category'] .air3-token",
                ".air3-token.text-body-sm",
                ".air3-token",
            ],
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
    function scrapeUpworkDetails() {
        const blocks = getAllTexts(
            [
                '[data-test*="description"]',
                ".job-description",
                '[class*="description"]',
                ".up-markdown",
                "article p",
            ],
            40
        );
        const best = blocks.find((item) => item.length > 60) || blocks[0] || "";
        return best.slice(0, 600);
    }

    // 5) Fetch skills
    function scrapeUpworkSkills() {
        const raw = getAllTexts(
            [
                '[data-test*="skill"]',
                '[aria-label*="skill" i]',
                ".air3-token",
                ".chip",
            ],
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
    function scrapeUpworkSidebarMeta() {
        const meta = {
            experienceLevel: "",
            hourlyRange: "",
            hourly: "",
            projectLength: "",
        };

        const items = document.querySelectorAll(
            ".fe-ui-job-features li, ul[class*='job-features'] li, li[data-test], li[data-cy]"
        );

        for (const item of items) {
            const rawLabel = cleanText(
                item.querySelector("small, [class*='text-light']")?.textContent || ""
            );
            const label = rawLabel.toLowerCase();
            const value =
                getText("strong", item) ||
                cleanText(item.querySelector(".header")?.textContent || "") ||
                cleanText(item.querySelector("[class*='value']")?.textContent || "");
            const hint = cleanText(
                item.getAttribute("data-test") || item.getAttribute("data-cy") || ""
            ).toLowerCase();

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
                meta.hourly = value;
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

    function scrapeUpworkJob() {
        if (!isUpworkPage()) {
            return null;
        }

        const title = scrapeUpworkTitle();
        const company = scrapeUpworkCategory();
        const posted = scrapeUpworkPosted();
        const details = scrapeUpworkDetails();
        const skills = scrapeUpworkSkills();
        const sidebarMeta = scrapeUpworkSidebarMeta();

        return { title, company, posted, details, skills, ...sidebarMeta };
    }

    function sendJobApplied(payloadOverrides) {
        if (!isUpworkPage()) return;

        const now = Date.now();
        if (saveInFlight || now - lastSaveAttemptAt < SAVE_DEBOUNCE_MS) {
            return;
        }
        lastSaveAttemptAt = now;
        saveInFlight = true;

        const scraped = scrapeUpworkJob();
        if (!scraped) {
            saveInFlight = false;
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
            projectLength: scraped.projectLength,
            url: window.location.href,
            appliedAt: new Date().toISOString(),
            status: "applied",
            ...(payloadOverrides || {}),
        };

        const dedupeKey =
            normalizeUrl(payload.url) ||
            `${(payload.jobTitle || "").toLowerCase()}::${(payload.company || "").toLowerCase()}`;

        chrome.runtime.sendMessage({ type: "JOB_APPLIED", payload }, (response) => {
            saveInFlight = false;

            if (chrome.runtime.lastError) {
                showToast("Could not save job", "error");
                return;
            }

            if (response && response.reason === "duplicate") {
                if (lastDuplicateToastKey !== dedupeKey) {
                    showToast("Already applied. Job is already saved.", "warning");
                    lastDuplicateToastKey = dedupeKey;
                }
                return;
            }

            if (response && response.saved) {
                lastDuplicateToastKey = "";
                showToast("Job saved successfully", "success");
                return;
            }

            showToast("Could not save job", "error");
        });
    }

    function shouldShowDemoButton() {
        return isUpworkPage() && UPWORK_APPLY_PATH_MATCHER.test(window.location.pathname);
    }

    function injectDemoButton() {
        if (!shouldShowDemoButton()) return;
        if (document.getElementById("jobtracker-upwork-demo-btn")) return;

        const btn = document.createElement("button");
        btn.id = "jobtracker-upwork-demo-btn";
        btn.type = "button";
        btn.textContent = "Demo Save Job";
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

    document.addEventListener(
        "click",
        (event) => {
            const text = cleanText(event.target?.innerText || "").toLowerCase();
            if (!text) return;
            if (text.includes("apply") || text.includes("submit application") || text.includes("send application")) {
                sendJobApplied();
            }
        },
        true
    );

    document.addEventListener(
        "submit",
        () => {
            sendJobApplied();
        },
        true
    );

    injectDemoButton();
})();
