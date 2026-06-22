// background.js
const API_BASE = 'http://localhost:8000/api';
const RETRY_INTERVAL_MS = 60 * 1000;
const STALE_OUTBOX_MS = 30 * 60 * 1000;
const OutboxAction = Object.freeze({
    CREATE: 'create',
    UPDATE: 'update'
});

const storageGet = (defaults) =>
    new Promise((resolve) => chrome.storage.local.get(defaults, resolve));

const storageSet = (values) =>
    new Promise((resolve) => chrome.storage.local.set(values, resolve));

const storageRemove = (keys) =>
    new Promise((resolve) => chrome.storage.local.remove(keys, resolve));

function canonicalizeUpworkJobUrl(url) {
    if (!url) return '';
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
        parsed.hash = '';
        parsed.search = '';
        return parsed.origin + parsed.pathname;
    } catch (_) {
        return String(url).trim();
    }
}

function normalizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.hostname.includes('upwork.com')) {
            return canonicalizeUpworkJobUrl(url);
        }
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

const inFlightJobSaves = new Set();

async function getAuthSession() {
    const { accessToken = null, user = null } = await storageGet({
        accessToken: null,
        user: null
    });
    return { accessToken, user };
}

async function setAuthSession(accessToken, user) {
    await storageSet({ accessToken, user });
}

async function clearAuthSession() {
    await storageRemove(['accessToken', 'user']);
}

async function parseApiError(res) {
    const text = await res.text();
    let detail = `Request failed (${res.status})`;
    if (text) {
        try {
            const data = JSON.parse(text);
            detail =
                typeof data.detail === 'string'
                    ? data.detail
                    : JSON.stringify(data.detail || data);
        } catch {
            detail = text;
        }
    }
    return detail;
}

async function apiFetch(path, options = {}) {
    const { accessToken } = await getAuthSession();
    if (!accessToken) {
        throw new Error('Not signed in');
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`
    };

    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    if (res.status === 401) {
        await clearAuthSession();
        throw new Error('Session expired — sign in again');
    }

    if (!res.ok) {
        throw new Error(await parseApiError(res));
    }

    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function authRequest(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        throw new Error(await parseApiError(res));
    }

    return res.json();
}

async function login(email, password) {
    const data = await authRequest('/auth/login', { email, password });
    if (data.user?.role === 'admin') {
        throw new Error('Admin accounts use the dashboard. Sign in as an invited user.');
    }
    await setAuthSession(data.access_token, data.user);
    return data;
}

async function acceptInvite(token, password, displayName) {
    const data = await authRequest('/auth/accept-invite', {
        token: token.trim(),
        password,
        display_name: displayName || undefined
    });
    await setAuthSession(data.access_token, data.user);
    return data;
}

async function previewInvite(token) {
    const res = await fetch(
        `${API_BASE}/auth/invite/${encodeURIComponent(token.trim())}`
    );
    if (!res.ok) {
        throw new Error(await parseApiError(res));
    }
    return res.json();
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

function isDuplicateApiError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('already exists') || message.includes('(409)');
}

async function pruneOutboxAgainstJobs(jobs) {
    const { outbox = [] } = await storageGet({ outbox: [] });
    if (!outbox.length) return;

    const serverKeys = new Set(
        (jobs || []).map((job) => buildJobFingerprint(job)).filter(Boolean)
    );

    const nextOutbox = outbox.filter((entry) => {
        if (entry.action !== OutboxAction.CREATE) return true;
        const key = buildJobFingerprint(entry.payload || {});
        if (key && serverKeys.has(key)) return false;
        const age = Date.now() - (entry.ts || 0);
        if (age > STALE_OUTBOX_MS) return false;
        return Boolean(key);
    });

    if (nextOutbox.length !== outbox.length) {
        await storageSet({ outbox: nextOutbox });
    }
}

async function createJob(job, opts = {}) {
    try {
        const saved = await apiFetch('/jobs', {
            method: 'POST',
            body: JSON.stringify(job)
        });
        await upsertLocalJob(saved);
        return saved;
    } catch (error) {
        console.error('Failed to send job to server', error);
        if (!opts.skipQueue && !isDuplicateApiError(error)) {
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
        const updated = await apiFetch(`/jobs/${jobId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
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
    await apiFetch(`/jobs/${jobId}`, { method: 'DELETE' });
    return { ok: true };
}

async function fetchJobs() {
    const { jobs: localJobs = [] } = await storageGet({ jobs: [] });
    const jobs = await apiFetch('/jobs');
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
    await pruneOutboxAgainstJobs(merged);
    return merged;
}

async function processOutbox() {
    const { accessToken } = await getAuthSession();
    if (!accessToken) return;

    const { jobs = [] } = await storageGet({ jobs: [] });
    await pruneOutboxAgainstJobs(jobs);

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
        if (isDuplicateApiError(error)) {
            await storageSet({ outbox: rest });
            return;
        }
        console.error('Retry failed, will try again later', error);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    getAuthSession().then(({ accessToken }) => {
        if (accessToken) {
            fetchJobs().catch(() => {});
        }
    });
});

chrome.runtime.onStartup.addListener(() => {
    getAuthSession().then(({ accessToken }) => {
        if (accessToken) {
            fetchJobs().catch(() => {});
        }
    });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_AUTH') {
        getAuthSession().then(({ user }) => sendResponse({ user }));
        return true;
    }

    if (msg.type === 'LOGIN') {
        (async () => {
            try {
                const data = await login(
                    msg.payload?.email?.trim(),
                    msg.payload?.password
                );
                sendResponse({ user: data.user });
            } catch (error) {
                sendResponse({ error: error.message || 'Login failed' });
            }
        })();
        return true;
    }

    if (msg.type === 'LOGOUT') {
        (async () => {
            try {
                const data = await apiFetch('/auth/logout', { method: 'POST' });
                if (data.message === 'Logged out successfully') {
                    await clearAuthSession();
                    sendResponse({ ok: true });
                } else {
                    await clearAuthSession();
                    sendResponse({ error: data.message || 'Logout failed' });
                }
            } catch (error) {
                await clearAuthSession();
                sendResponse({ error: error.message || 'Logout failed' });
            }
        })().catch((error) => {
            sendResponse({ error: error.message || 'Logout failed' });
        });
        return true;
    }

    if (msg.type === 'PREVIEW_INVITE') {
        (async () => {
            try {
                const preview = await previewInvite(msg.payload?.token || '');
                sendResponse(preview);
            } catch (error) {
                sendResponse({ valid: false, error: error.message });
            }
        })();
        return true;
    }

    if (msg.type === 'ACCEPT_INVITE') {
        (async () => {
            try {
                const data = await acceptInvite(
                    msg.payload?.token,
                    msg.payload?.password,
                    msg.payload?.displayName
                );
                sendResponse({ user: data.user });
            } catch (error) {
                sendResponse({ error: error.message || 'Could not accept invite' });
            }
        })();
        return true;
    }

    if (msg.type === 'JOB_APPLIED') {
        (async () => {
            const { accessToken } = await getAuthSession();
            if (!accessToken) {
                sendResponse({
                    ok: false,
                    error: 'Sign in to the Job Tracker extension first'
                });
                return;
            }

            const payload = {
                ...msg.payload,
                status: msg.payload.status || 'applied'
            };
            const fingerprint = buildJobFingerprint(payload);

            if (inFlightJobSaves.has(fingerprint)) {
                sendResponse({ ok: true, saved: false, reason: 'duplicate' });
                return;
            }

            const { jobs = [] } = await storageGet({ jobs: [] });
            if (isDuplicateJob(jobs, payload)) {
                sendResponse({ ok: true, saved: false, reason: 'duplicate' });
                return;
            }

            inFlightJobSaves.add(fingerprint);
            try {
                await upsertLocalJob(payload);
                createJob(payload).catch(() => {});
                sendResponse({ ok: true, saved: true });
            } finally {
                inFlightJobSaves.delete(fingerprint);
            }
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
                const { accessToken } = await getAuthSession();
                if (!accessToken) {
                    sendResponse({ jobs: [], error: 'Not signed in' });
                    return;
                }
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
                const { user } = await getAuthSession();
                if (!user) {
                    throw new Error('Not signed in');
                }

                const { jobs = [] } = await storageGet({ jobs: [] });
                const target = jobs.find((job) =>
                    jobId
                        ? job.id === jobId
                        : job.url === url && job.appliedAt === appliedAt
                );

                if (target?.userId && target.userId !== user.id) {
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
    processOutbox().catch(() => {});
}, RETRY_INTERVAL_MS);
