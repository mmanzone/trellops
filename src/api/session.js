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
