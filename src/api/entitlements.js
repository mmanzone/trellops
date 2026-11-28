/**
 * What the signed-in member may use, from /api/me (see api/_lib/entitlements.ts).
 *
 * Until plans are enforced the server answers with every feature on. When the
 * server can't be reached (no session or database yet) the app stays fully
 * open, so a server problem never locks anyone out of their dashboard.
 */
import { serverSessionReady } from './session';

export const ALL_FEATURES = ['map', 'stats', 'tasks', 'ai', 'share', 'export', 'slideshow', 'keepScreenOn', 'sync'];

export const FEATURE_LABELS = {
    map: 'Map view',
    stats: 'Statistics',
    tasks: 'Tasks view',
    ai: 'AI summary',
    share: 'Share links',
    export: 'Export and import',
    slideshow: 'Slideshow',
    keepScreenOn: 'Keep screen on',
    sync: 'Settings saved to your account',
    boards: 'More boards',
    refresh: 'Faster refresh',
};

export const OPEN_ENTITLEMENTS = {
    enforced: false,
    plan: 'free',
    planSource: 'free',
    planName: 'Free',
    trialEndsAt: null,
    packs: 0,
    boardLimit: null,
    boardsPerPack: 0,
    boardsUsed: 0,
    minRefreshSeconds: 15,
    features: ALL_FEATURES,
    board: null,
    offline: true,
};

const jsonOrNull = async (res) => {
    try { return await res.json(); } catch { return null; }
};

/** GET /api/me. Resolves to { me, entitlements } (entitlements may be OPEN_ENTITLEMENTS). */
export const fetchEntitlements = async ({ boardId, token, boardIds } = {}) => {
    await serverSessionReady();
    const params = new URLSearchParams();
    if (boardId) params.set('board', boardId);
    if (boardIds?.length) params.set('boards', boardIds.slice(0, 200).join(','));
    try {
        const res = await fetch(`/api/me${params.toString() ? `?${params}` : ''}`, {
            credentials: 'same-origin',
            headers: token ? { 'X-Trello-Token': token } : {},
        });
        const me = res.ok ? await jsonOrNull(res) : null;
        return { me, entitlements: me?.entitlements || OPEN_ENTITLEMENTS };
    } catch {
        return { me: null, entitlements: OPEN_ENTITLEMENTS };
    }
};

/**
 * POST /api/me { boardId }: records the board and checks the board limit.
 * Resolves to { ok: true } or { ok: false, limit: { boardLimit, boards } }.
 */
export const registerBoardWithLimit = async (boardId, token) => {
    if (!boardId) return { ok: true };
    await serverSessionReady();
    try {
        const res = await fetch('/api/me', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Trello-Token': token } : {}) },
            body: JSON.stringify({ boardId }),
        });
        if (res.status === 409) {
            const data = await jsonOrNull(res);
            return { ok: false, limit: { boardLimit: data?.boardLimit ?? 1, boards: data?.boards || [], boardId, message: data?.error } };
        }
        return { ok: true };
    } catch {
        return { ok: true }; // Offline: never block a board because the server is unreachable.
    }
};

/** DELETE /api/me?board=: frees a board slot. Resolves to the remaining board ids or null. */
export const removeBoard = async (boardId) => {
    try {
        const res = await fetch(`/api/me?board=${encodeURIComponent(boardId)}`, { method: 'DELETE', credentials: 'same-origin' });
        const data = await jsonOrNull(res);
        return res.ok ? data?.boards || [] : null;
    } catch {
        return null;
    }
};

// --- Pro: settings saved to the account ---------------------------------------

export const saveServerConfig = async (boardId, config) => {
    try {
        const res = await fetch('/api/configs', {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardId, config }),
        });
        return res.ok;
    } catch {
        return false;
    }
};

export const loadServerConfig = async (boardId) => {
    try {
        const res = await fetch(`/api/configs?board=${encodeURIComponent(boardId)}`, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return (await jsonOrNull(res))?.config || null;
    } catch {
        return null;
    }
};

// --- Share links ------------------------------------------------------------------

/** Creates a /?share=<id> link. Resolves to { url } or { error, code }. */
export const createShareLink = async (boardId, config) => {
    try {
        const res = await fetch('/api/shares', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boardId, config }),
        });
        const data = await jsonOrNull(res);
        if (!res.ok) return { error: data?.error || 'The link could not be created.', code: data?.code || res.status };
        return { url: `${window.location.origin}/?share=${data.id}` };
    } catch {
        return { error: 'The link could not be created. Check your connection.', code: 'OFFLINE' };
    }
};

/** Opens a share link. Resolves to { allowed, config?, error? }. */
export const openShareLink = async (id) => {
    await serverSessionReady();
    try {
        const res = await fetch(`/api/shares?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        const data = await jsonOrNull(res);
        if (!res.ok) return { allowed: false, error: data?.error || 'This share link could not be opened.' };
        return data;
    } catch {
        return { allowed: false, error: 'This share link could not be opened. Check your connection.' };
    }
};

export const daysLeft = (iso) => {
    if (!iso) return null;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
};
