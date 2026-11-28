import React, { useEffect, useState } from 'react';
import { Lock, X, Trash2 } from 'lucide-react';
import { useEntitlements } from '../../context/EntitlementsContext';
import { FEATURE_LABELS, removeBoard, daysLeft } from '../../api/entitlements';
import { trelloFetch } from '../../api/trello';
import '../../styles/plans.css';

// Paid plans open in phase 4 (Paddle). Until then the upgrade prompts explain
// the plan without a checkout button.
const UPGRADE_COPY = 'Paid plans are opening soon.';

/** Small "Pro" tag shown next to locked controls. */
export const ProTag = () => <span className="pro-tag">Pro</span>;

/** Inline notice in place of a locked setting or button. */
export const ProLock = ({ feature, children, compact = false }) => {
    const label = FEATURE_LABELS[feature] || 'This feature';
    return (
        <div className={`pro-lock${compact ? ' pro-lock-compact' : ''}`} role="note">
            <Lock size={compact ? 14 : 16} aria-hidden="true" />
            <div>
                <strong>{label} is part of Trellops Pro.</strong>
                {!compact && <span className="pro-lock-sub">{children || UPGRADE_COPY}</span>}
            </div>
        </div>
    );
};

/** Full page shown instead of a locked view (map, statistics, tasks). */
export const ProLockScreen = ({ feature, onBack }) => {
    const label = FEATURE_LABELS[feature] || 'This view';
    return (
        <div className="pro-lock-screen">
            <div className="pro-lock-card">
                <Lock size={28} aria-hidden="true" />
                <h2>{label} is part of Trellops Pro</h2>
                <p>
                    Your plan is Free, which covers one dashboard refreshed every 60 minutes.
                    Pro adds the map, statistics, tasks, AI summaries, sharing and refresh down to one minute,
                    for up to 5 boards. A Board plan unlocks the same views for everyone on one board.
                </p>
                <p className="pro-lock-sub">{UPGRADE_COPY}</p>
                <button type="button" className="button-primary" onClick={onBack}>Back to the dashboard</button>
            </div>
        </div>
    );
};

/** One-line plan status for the settings page. */
export const PlanStatus = () => {
    const { entitlements: e } = useEntitlements();
    if (!e || e.offline || !e.enforced) return null;
    const left = daysLeft(e.trialEndsAt);
    let text;
    if (e.planSource === 'trial') text = `Pro trial, ${left} day${left === 1 ? '' : 's'} left.`;
    else if (e.plan === 'pro') text = `Pro plan, ${e.boardsUsed} of ${e.boardLimit} boards used.`;
    else text = `Free plan: one board, refreshed every 60 minutes.`;
    if (e.board?.coveredByBoardPlan) text += ' This board has a Board plan.';
    return <div className="plan-status">{text}</div>;
};

/** Plan label for the pill and the billing tab, e.g. "Pro plan" or "Pro trial, 9 days left". */
export const planLabel = (e) => {
    if (!e || e.offline) return null;
    if (e.planSource === 'trial') {
        const left = daysLeft(e.trialEndsAt);
        return `Pro trial, ${left} day${left === 1 ? '' : 's'} left`;
    }
    if (e.plan === 'pro') return 'Pro plan';
    if (e.board?.coveredByBoardPlan) return 'Board plan';
    return 'Free plan';
};

/** Small pill next to the Settings title; opens the Plan and billing tab. */
export const PlanPill = ({ onClick }) => {
    const { entitlements: e } = useEntitlements();
    const label = planLabel(e);
    if (!label) return null;
    const kind = label.startsWith('Free') ? 'free' : label.startsWith('Board') ? 'board' : 'pro';
    return (
        <button type="button" className={`plan-pill plan-pill-${kind}`} onClick={onClick} title="Plan and billing">
            {label}
        </button>
    );
};

/**
 * Shown when the member is at their board limit. Lists their boards (names
 * come from Trello in the browser; the server only knows ids) with a Remove
 * button each, so they can free a slot.
 */
export const BoardLimitModal = ({ limit, token, onResolved, onClose, onChooseBoard }) => {
    const [names, setNames] = useState({});
    const [boards, setBoards] = useState(limit.boards || []);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        trelloFetch('/members/me/boards?fields=id,name', token)
            .then((list) => alive && setNames(Object.fromEntries((list || []).map((b) => [b.id, b.name]))))
            .catch(() => {});
        return () => { alive = false; };
    }, [token]);

    const handleRemove = async (id) => {
        setBusy(id);
        setError('');
        const left = await removeBoard(id);
        setBusy(null);
        if (!left) { setError('That board could not be removed. Try again.'); return; }
        setBoards(left);
        // Adding a board needs a free slot; an over-limit account needs to get back within it.
        if (limit.boardId ? left.length < limit.boardLimit : left.length <= limit.boardLimit) onResolved();
    };

    const n = limit.boardLimit;
    return (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="board-limit-title">
            <div className="modal-content board-limit-modal">
                {onClose && (
                    <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
                        <X size={18} aria-hidden="true" />
                    </button>
                )}
                <h3 id="board-limit-title">Your plan covers {n} board{n === 1 ? '' : 's'}</h3>
                <p>
                    {limit.boardId
                        ? `To use ${names[limit.boardId] || 'this board'}, remove one of your boards first.`
                        : 'You are using more boards than your plan covers. Remove boards until you are within the limit.'}
                    {' '}Removing a board keeps its settings in this browser. Pro covers 5 boards, plus 5 more per add-on pack.
                </p>
                <ul className="board-limit-list">
                    {boards.map((id) => (
                        <li key={id}>
                            <span>
                                <strong>{names[id] || 'Board'}</strong>
                                <code>{id}</code>
                            </span>
                            <button type="button" className="button-secondary" onClick={() => handleRemove(id)} disabled={busy === id}>
                                <Trash2 size={14} aria-hidden="true" /> {busy === id ? 'Removing...' : 'Remove'}
                            </button>
                        </li>
                    ))}
                </ul>
                {error && <div className="notice notice-danger">{error}</div>}
                <p className="pro-lock-sub">{UPGRADE_COPY}</p>
                {(onClose || onChooseBoard) && (
                    <div className="modal-actions">
                        {onChooseBoard && <button type="button" className="button-secondary" onClick={onChooseBoard}>Choose another board</button>}
                        {onClose && <button type="button" className="button-secondary" onClick={onClose}>Cancel</button>}
                    </div>
                )}
            </div>
        </div>
    );
};

/** Dismissible banner at the top of the app (share link warnings, trial ending). */
export const PlanBanner = ({ notice, onDismiss }) => {
    if (!notice) return null;
    return (
        <div className={`plan-banner plan-banner-${notice.tone || 'info'}`} role="status">
            <Lock size={16} aria-hidden="true" />
            <div>
                <strong>{notice.title}</strong>
                {notice.text && <span>{notice.text}</span>}
            </div>
            <button type="button" className="plan-banner-close" onClick={onDismiss} aria-label="Dismiss">
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    );
};
