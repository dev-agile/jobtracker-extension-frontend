// background.js
const API_BASE = 'http://localhost:8000/api'; // change when deployed
const RETRY_INTERVAL_MS = 60 * 1000;
const OutboxAction = Object.freeze({
    CREATE: 'create',
    UPDATE: 'update'
});

const storageGet = (defaults) =>
    new Promise((resolve) => chrome.storage.local.get(defaults, resolve));

const storageSet = (values) =>
    new Promise((resolve) => chrome.storage.local.set(values, resolve));

function normalizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        const removableParams = [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
            'source',
            'ref'
        ];
        removableParams.forEach((key) => parsed.searchParams.delete(key));
        const sortedParams = Array.from(parsed.searchParams.entries()).sort(([a], [b]) =>
            a.localeCompare(b)
        );
        parsed.search = sortedParams.length
            ? `?${new URLSearchParams(sortedParams).toString()}`
            : '';
        return parsed.toString();
    } catch (_) {
        return String(url).trim();
    }
}

function buildJobFingerprint(job) {
    const normalizedUrl = normalizeUrl(job.url || '');
    if (normalizedUrl) return `url:${normalizedUrl}`;
    const title = (job.jobTitle || '').trim().toLowerCase();
    const company = (job.company || '').trim().toLowerCase();
    return `tc:${title}::${company}`;
}

function isDuplicateJob(existingJobs, incomingJob) {
    const incomingKey = buildJobFingerprint(incomingJob);
    if (!incomingKey || incomingKey === 'tc::') return false;
    return existingJobs.some((item) => buildJobFingerprint(item) === incomingKey);
}

async function getExtensionUserId() {
    const { extensionUserId = null } = await storageGet({ extensionUserId: null });
    if (extensionUserId) {
        return extensionUserId;
    }

    const generatedId =
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? `ext-user-${crypto.randomUUID()}`
            : `ext-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await storageSet({ extensionUserId: generatedId });
    return generatedId;
}

function withUserId(url, userId) {
    const parsed = new URL(url);
    parsed.searchParams.set('userId', userId);
    return parsed.toString();
}


async function upsertLocalJob(job) {
    const { jobs = [] } = await storageGet({ jobs: [] });
    const nextJobs = [...jobs];
    const index = job.id != null
        ? nextJobs.findIndex((item) => item.id === job.id)
        : nextJobs.findIndex(
            (item) =>
                !item.id &&
                item.url === job.url &&
                item.appliedAt === job.appliedAt
        );

    if (index >= 0) {
        nextJobs[index] = { ...nextJobs[index], ...job };
    } else {
        nextJobs.unshift(job);
    }

    await storageSet({ jobs: nextJobs });
}


async function enqueueOutbox(entry) {
    const { outbox = [] } = await storageGet({ outbox: [] });
    outbox.push(entry);
    await storageSet({ outbox });
}


async function createJob(job, opts = {}) {
    try {
        const userId = await getExtensionUserId();
        const payload = { ...job, userId };
        const res = await fetch(withUserId(`${API_BASE}/jobs`, userId), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            throw new Error(`Failed to create job (${res.status})`);
        }

        const saved = await res.json();
        await upsertLocalJob(saved);
        return saved;
    } catch (error) {
        console.error('Failed to send job to server', error);
        if (!opts.skipQueue) {
            await enqueueOutbox({
                action: OutboxAction.CREATE,
                payload: job,
                ts: Date.now()
            });
        }
        throw error;
    }
}


async function patchJob(jobId, updates, opts = {}) {
    try {
        const userId = await getExtensionUserId();
        const res = await fetch(withUserId(`${API_BASE}/jobs/${jobId}`, userId), {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });

        if (!res.ok) {
            throw new Error(`Failed to update job (${res.status})`);
        }

        const updated = await res.json();
        await upsertLocalJob(updated);
        return updated;
    } catch (error) {
        console.error('Failed to update job on server', error);
        if (!opts.skipQueue) {
            await enqueueOutbox({
                action: OutboxAction.UPDATE,
                jobId,
                payload: updates,
                ts: Date.now()
            });
        }
        throw error;
    }
}


async function removeLocalJob(jobId, url, appliedAt) {
    const { jobs = [] } = await storageGet({ jobs: [] });
    const nextJobs = jobs.filter((item) => {
        if (jobId) {
            return item.id !== jobId;
        }
        return !(item.url === url && item.appliedAt === appliedAt);
    });
    await storageSet({ jobs: nextJobs });
}


async function deleteJob(jobId) {
    if (!jobId) return { ok: true, localOnly: true };
    const userId = await getExtensionUserId();
    const res = await fetch(withUserId(`${API_BASE}/jobs/${jobId}`, userId), {
        method: 'DELETE'
    });
    if (!res.ok) {
        throw new Error(`Failed to delete job (${res.status})`);
    }
    return { ok: true };
}


async function fetchAllJobs() {
    const res = await fetch(`${API_BASE}/allJobs`);
    if (!res.ok) {
        throw new Error(`Failed to fetch all jobs (${res.status})`);
    }
    return await res.json();
}

async function fetchJobs() {
    const userId = await getExtensionUserId();
    const res = await fetch(`${API_BASE}/jobs/${userId}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch jobs (${res.status})`);
    }

    const { jobs: localJobs = [] } = await storageGet({ jobs: [] });
    const jobs = await res.json();
    const localById = new Map(localJobs.filter((j) => j.id).map((j) => [j.id, j]));
    const merged = jobs.map((serverJob) => {
        if (serverJob.posted) return serverJob;
        const local = localById.get(serverJob.id);
        if (local && local.posted) {
            return { ...serverJob, posted: local.posted };
        }
        return serverJob;
    });
    await storageSet({ jobs: merged });
    return merged;
}


async function processOutbox() {
    const { outbox = [] } = await storageGet({ outbox: [] });
    if (!outbox.length) {
        return;
    }

    const [next, ...rest] = outbox;

    try {
        if (next.action === OutboxAction.CREATE) {
            await createJob(next.payload, { skipQueue: true });
        } else if (next.action === OutboxAction.UPDATE) {
            await patchJob(next.jobId, next.payload, { skipQueue: true });
        }
        await storageSet({ outbox: rest });
    } catch (error) {
        console.error('Retry failed, will try again later', error);
    }
}


chrome.runtime.onInstalled.addListener(() => {
    fetchJobs().catch(() => {
        // Swallow errors; popup will fallback to local cache.
    });
});

chrome.runtime.onStartup.addListener(() => {
    fetchJobs().catch(() => { });
});


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'JOB_APPLIED') {
        (async () => {
            const payload = {
                ...msg.payload,
                status: msg.payload.status || 'applied'
            };
            const { jobs = [] } = await storageGet({ jobs: [] });
            if (isDuplicateJob(jobs, payload)) {
                sendResponse({ ok: true, saved: false, reason: 'duplicate' });
                return;
            }

            await upsertLocalJob(payload);
            createJob(payload).catch(() => { });
            sendResponse({ ok: true, saved: true });
        })().catch((error) => {
            sendResponse({ ok: false, error: error.message || 'Failed to save job' });
        });
        return true;
    }
    if (msg.type === 'GET_LOCAL_JOBS') {
        storageGet({ jobs: [] }).then((result) => sendResponse({ jobs: result.jobs }));
        return true;
    }

    if (msg.type === 'SYNC_JOBS') {
        (async () => {
            try {
                const jobs = await fetchJobs();
                sendResponse({ jobs });
            } catch (error) {
                const { jobs = [] } = await storageGet({ jobs: [] });
                sendResponse({ jobs, error: error.message });
            }
        })();
        return true;
    }

    if (msg.type === 'UPDATE_STATUS') {
        const { jobId, status } = msg.payload || {};
        if (!jobId) {
            sendResponse({ error: 'Missing job id' });
            return false;
        }

        upsertLocalJob({ id: jobId, status });
        (async () => {
            try {
                const job = await patchJob(jobId, { status });
                sendResponse({ job });
            } catch (error) {
                sendResponse({ error: error.message, queued: true });
            }
        })();
        return true;
    }

    if (msg.type === 'DELETE_JOB') {
        const { jobId, url, appliedAt } = msg.payload || {};
        (async () => {
            try {
                const userId = await getExtensionUserId();
                const jobs = await fetchAllJobs();

                const target = jobs.find((job) =>
                    jobId
                        ? job.id === jobId
                        : job.url === url && job.appliedAt === appliedAt
                )

                if (target?.userId && target.userId !== userId) {
                    throw new Error('Job does not belong to this user');
                }
                await removeLocalJob(jobId, url, appliedAt);
                await deleteJob(jobId);
                sendResponse({ ok: true });
            } catch (error) {
                sendResponse({ error: error.message });
            }
        })();
        return true;
    }

    return false;
});


setInterval(() => {
    processOutbox().catch(() => { });
}, RETRY_INTERVAL_MS);