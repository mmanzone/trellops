/**
 * Server session for Trellops' own API (/api/session).
 *
 * After the browser signs in with Trello, it sends the token to the server
 * once. The server checks it with Trello, records the sign-in and sets an
 * HttpOnly session cookie that the AI routes require. Failures are swallowed:
 * the dashboard itself never depends on this call.
 */

let pending = null;

export const startServerSession = (token) => {
    pending = fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
    })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    return pending;
};

/** Resolves once the sign-in call has finished (immediately if none started). */
export const serverSessionReady = () => pending || Promise.resolve(null);

export const endServerSession = () => {
    pending = null;
    return fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
};

// --- "Reconnect to share your email" notice -------------------------------

const DISMISS_KEY = 'trellopsEmailScopeNoticeDismissedUntil';
const DISMISS_DAYS = 14;

export const isEmailNoticeDismissed = () => {
    try {
        return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now();
    } catch {
        return false;
    }
};

export const dismissEmailNotice = () => {
    try {
        localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000));
    } catch { /* storage unavailable */ }
};

// --- Account details and board usage --------------------------------------

/** The signed-in member as the server sees it: { memberId, admin } or null. */
export const fetchMe = async () => {
    await serverSessionReady();
    try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
};

const registeredBoards = new Set();

/** Tells the server which board id this member uses (once per page load). */
export const registerBoard = async (boardId) => {
    if (!boardId || registeredBoards.has(boardId)) return;
    registeredBoards.add(boardId);
    await serverSessionReady();
    fetch('/api/me', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
    }).catch(() => registeredBoards.delete(boardId));
};

/** Sends a charity or NGO request. Resolves to { ok, error? }. */
export const submitCompRequest = async (form) => {
    await serverSessionReady();
    try {
        const res = await fetch('/api/comp-requests', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok ? { ok: true } : { ok: false, error: data.error || 'The request could not be sent.' };
    } catch {
        return { ok: false, error: 'The request could not be sent. Check your connection and try again.' };
    }
};

export const CHARITY_TYPES = [
    'Registered charity',
    'Non-governmental organisation (NGO)',
    'Not-for-profit or community group',
    'Volunteer organisation',
    'Other',
];
