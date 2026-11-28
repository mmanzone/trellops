import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Search, Users, Inbox, Gift, LayoutGrid, ChartColumn, SlidersHorizontal } from 'lucide-react';
import { ThemeToggleButton, PageTitle } from './common/HeaderControls';
import { serverSessionReady, fetchMe } from '../api/session';
import '../styles/admin.css';

// Admin dashboard: adoption, users, comped plans and charity requests.
// Only members listed in ADMIN_TRELLO_IDS get data from /api/admin.

const REASONS = ['Charity', 'NGO', 'Beta tester', 'Support', 'Partner', 'Trial', 'Other'];

const api = async (path, options = {}) => {
    await serverSessionReady();
    const res = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || `Request failed (${res.status})`);
        err.status = res.status;
        err.code = data.code;
        throw err;
    }
    return data;
};

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const planOf = (user) => {
    const o = user.override;
    if (!o) return { label: 'Free', source: '', limit: 1 };
    const packs = o.pack_quantity || 0;
    return { label: o.reason === 'Trial' ? 'Pro trial' : 'Pro', source: o.reason, limit: 5 + 5 * packs, packs };
};

const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCsv = (filename, rows) => {
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Last 12 weeks (Monday start, as Postgres date_trunc('week')), zero-filled.
const lastWeeks = (weekly) => {
    const byWeek = new Map(weekly.map((w) => [w.week, w]));
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const out = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(monday);
        d.setUTCDate(d.getUTCDate() - i * 7);
        const key = d.toISOString().slice(0, 10);
        const w = byWeek.get(key);
        out.push({ week: key, signIns: w?.sign_ins || 0, newUsers: w?.new_users || 0 });
    }
    return out;
};

const Stat = ({ label, value, hint }) => (
    <div className="admin-stat">
        <div className="admin-stat-value">{value ?? '–'}</div>
        <div className="admin-stat-label">{label}</div>
        {hint && <div className="admin-stat-hint">{hint}</div>}
    </div>
);

const WeeklyChart = ({ weekly }) => {
    const weeks = lastWeeks(weekly);
    const max = Math.max(1, ...weeks.map((w) => w.signIns));
    const total = weeks.reduce((n, w) => n + w.signIns, 0);
    return (
        <section className="admin-panel">
            <div className="admin-panel-head">
                <h3>Sign-ins per week</h3>
                <span className="admin-muted">{total} in the last 12 weeks</span>
            </div>
            <div className="admin-bars" role="img" aria-label={`Sign-ins per week for the last 12 weeks, ${total} in total`}>
                {weeks.map((w) => (
                    <div className="admin-bar-col" key={w.week} title={`Week of ${fmtDate(w.week)}: ${w.signIns} sign-ins, ${w.newUsers} new users`}>
                        <span className="admin-bar-value">{w.signIns || ''}</span>
                        <div className="admin-bar-track">
                            <div className="admin-bar" style={{ height: `${(w.signIns / max) * 100}%` }} />
                            <div className="admin-bar admin-bar-new" style={{ height: `${(w.newUsers / max) * 100}%` }} />
                        </div>
                        <span className="admin-bar-label">{new Date(w.week).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                    </div>
                ))}
            </div>
            <div className="admin-legend">
                <span><i className="admin-swatch" /> Sign-ins</span>
                <span><i className="admin-swatch admin-swatch-new" /> New users</span>
            </div>
        </section>
    );
};

const Overview = ({ summary }) => {
    if (!summary) return <p className="admin-muted">Loading…</p>;
    const u = summary.users;
    return (
        <>
            <div className="admin-stats">
                <Stat label="Users" value={u.total} hint={`${u.new7} new this week`} />
                <Stat label="Active, last 7 days" value={u.active7} />
                <Stat label="Active, last 30 days" value={u.active30} />
                <Stat label="Emails captured" value={u.with_email} hint={`of ${u.total}`} />
                <Stat label="Boards in use" value={summary.boardsInUse} />
                <Stat label="Free" value={summary.plans.free} />
                <Stat label="Pro (granted)" value={summary.plans.pro} />
                <Stat label="Board plans (granted)" value={summary.plans.boardPlans} />
                <Stat label="Charity requests waiting" value={summary.pendingRequests} />
            </div>
            <WeeklyChart weekly={summary.weekly} />
            <p className="admin-muted admin-footnote">Paid plans appear here once billing is connected. Revenue, renewals and refunds stay in the payment provider's dashboard.</p>
        </>
    );
};

const BoardIds = ({ ids }) => {
    const [open, setOpen] = useState(false);
    if (!ids?.length) return <span className="admin-muted">None yet</span>;
    const shown = open ? ids : ids.slice(0, 2);
    return (
        <span className="admin-ids">
            {shown.map((id) => <code key={id}>{id}</code>)}
            {ids.length > 2 && (
                <button type="button" className="link-button" onClick={() => setOpen(!open)}>
                    {open ? 'Show less' : `+${ids.length - 2} more`}
                </button>
            )}
        </span>
    );
};

const UsersTab = ({ onGrant, initialQuery = '' }) => {
    const [q, setQ] = useState(initialQuery);
    const [users, setUsers] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const t = setTimeout(() => {
            api(`/api/admin?view=users&q=${encodeURIComponent(q.trim())}`)
                .then((d) => { if (!cancelled) { setUsers(d.users); setError(''); } })
                .catch((e) => { if (!cancelled) setError(e.message); });
        }, q ? 300 : 0);
        return () => { cancelled = true; clearTimeout(t); };
    }, [q]);

    const exportCsv = () => {
        const rows = [['email', 'trello_member_id', 'username', 'plan', 'plan_source', 'board_limit', 'board_count', 'board_ids', 'first_seen', 'last_seen', 'sign_ins']];
        (users || []).forEach((u) => {
            const p = planOf(u);
            rows.push([u.email, u.trello_member_id, u.username, p.label, p.source, p.limit, u.board_ids.length, u.board_ids.join(' '), u.first_seen_at, u.last_seen_at, u.login_count]);
        });
        downloadCsv(`trellops-users-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    };

    return (
        <section className="admin-panel">
            <div className="admin-toolbar">
                <label className="admin-search">
                    <Search size={16} aria-hidden="true" />
                    <input type="search" placeholder="Search by email, username, member ID or board ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
                </label>
                <button type="button" className="button-secondary" onClick={exportCsv} disabled={!users?.length}>
                    <Download size={16} aria-hidden="true" /> Export CSV
                </button>
            </div>
            {error && <div className="notice notice-danger">{error}</div>}
            {!users ? <p className="admin-muted">Loading…</p> : (
                <div className="admin-table-wrap">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Trello member ID</th>
                                <th>Plan</th>
                                <th>Boards</th>
                                <th>Board IDs</th>
                                <th>First seen</th>
                                <th>Last seen</th>
                                <th className="num">Sign-ins</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {users.length === 0 && <tr><td colSpan={9} className="admin-muted">No users match.</td></tr>}
                            {users.map((u) => {
                                const p = planOf(u);
                                const over = u.board_ids.length > p.limit;
                                return (
                                    <tr key={u.trello_member_id}>
                                        <td>
                                            {u.email || <span className="admin-muted" title="Signed in before the email permission">No email yet</span>}
                                            <div className="admin-sub">{u.username}</div>
                                        </td>
                                        <td><code>{u.trello_member_id}</code></td>
                                        <td>
                                            <span className={`admin-pill ${p.label === 'Pro' ? 'is-pro' : ''}`}>{p.label}</span>
                                            {p.source && <div className="admin-sub">{p.source}{p.packs ? `, +${p.packs} pack${p.packs > 1 ? 's' : ''}` : ''}</div>}
                                        </td>
                                        <td className={over ? 'admin-over' : ''}>{u.board_ids.length} of {p.limit}</td>
                                        <td><BoardIds ids={u.board_ids} /></td>
                                        <td>{fmtDate(u.first_seen_at)}</td>
                                        <td>{fmtDateTime(u.last_seen_at)}</td>
                                        <td className="num">{u.login_count}</td>
                                        <td><button type="button" className="link-button" onClick={() => onGrant({ targetType: 'user', targetId: u.trello_member_id })}>Give a plan</button></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

const GrantForm = ({ initial, onDone }) => {
    const [form, setForm] = useState({ targetType: 'board', targetId: '', packQuantity: 0, reason: 'Charity', orgName: '', expiresAt: '', note: '', ...initial });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    useEffect(() => { if (initial) setForm((f) => ({ ...f, ...initial })); }, [initial]);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
            await api('/api/admin', {
                method: 'POST',
                body: JSON.stringify({ action: 'grant', ...form, packQuantity: Number(form.packQuantity) || 0, expiresAt: form.expiresAt || null }),
            });
            setMessage({ ok: true, text: form.targetType === 'board' ? 'Board plan granted.' : 'Pro granted.' });
            setForm((f) => ({ ...f, targetId: '', orgName: '', note: '', expiresAt: '' }));
            onDone();
        } catch (err) {
            setMessage({ ok: false, text: err.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="admin-panel admin-grant" onSubmit={submit}>
            <h3>Give a plan without payment</h3>
            <div className="admin-form-grid">
                <label>
                    <span>Give to</span>
                    <select value={form.targetType} onChange={set('targetType')}>
                        <option value="board">A board (Board plan, all its members)</option>
                        <option value="user">A user (Pro)</option>
                    </select>
                </label>
                <label>
                    <span>{form.targetType === 'board' ? 'Board ID' : 'Trello member ID'}</span>
                    <input type="text" value={form.targetId} onChange={set('targetId')} placeholder="24 characters" required />
                </label>
                {form.targetType === 'user' && (
                    <label>
                        <span>Extra 5-board packs</span>
                        <input type="number" min="0" max="50" value={form.packQuantity} onChange={set('packQuantity')} />
                    </label>
                )}
                <label>
                    <span>Reason</span>
                    <select value={form.reason} onChange={set('reason')}>
                        {REASONS.map((r) => <option key={r}>{r}</option>)}
                    </select>
                </label>
                <label>
                    <span>Organisation (optional)</span>
                    <input type="text" value={form.orgName} onChange={set('orgName')} maxLength={160} />
                </label>
                <label>
                    <span>Expires (optional)</span>
                    <input type="date" value={form.expiresAt} onChange={set('expiresAt')} />
                </label>
                <label className="admin-form-wide">
                    <span>Note (optional)</span>
                    <input type="text" value={form.note} onChange={set('note')} maxLength={1000} />
                </label>
            </div>
            {message && <div className={`notice ${message.ok ? 'notice-success' : 'notice-danger'}`}>{message.text}</div>}
            <div className="admin-form-actions">
                <button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving…' : 'Give plan'}</button>
            </div>
        </form>
    );
};

const OverridesTable = ({ rows, kind, onRevoke }) => {
    if (!rows) return <p className="admin-muted">Loading…</p>;
    if (!rows.length) {
        return <p className="admin-muted">{kind === 'board' ? 'No board plans yet. Paid board plans will be listed here once billing is connected.' : 'No plans given yet.'}</p>;
    }
    return (
        <div className="admin-table-wrap">
            <table className="admin-table">
                <thead>
                    <tr>
                        <th>{kind === 'board' ? 'Board ID' : 'Given to'}</th>
                        <th>Plan</th>
                        <th>Reason</th>
                        <th>Organisation</th>
                        {kind === 'board' && <th>Requested by</th>}
                        {kind === 'board' && <th className="num">Members seen</th>}
                        <th>Given</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {rows.map((o) => (
                        <tr key={o.id} className={o.active ? '' : 'admin-inactive'}>
                            <td>
                                <code>{o.target_id}</code>
                                {o.target_type === 'user' && <div className="admin-sub">{o.target_email || o.target_username || 'Not signed in yet'}</div>}
                            </td>
                            <td>{o.plan_code === 'pro' ? `Pro${o.pack_quantity ? ` +${o.pack_quantity}` : ''}` : 'Board'}</td>
                            <td>{o.reason}</td>
                            <td>{o.org_name}</td>
                            {kind === 'board' && <td>{o.requester_email || <span className="admin-muted">Admin</span>}</td>}
                            {kind === 'board' && <td className="num">{o.members_seen}</td>}
                            <td>{fmtDate(o.created_at)}</td>
                            <td>{o.expires_at ? fmtDate(o.expires_at) : <span className="admin-muted">Never</span>}</td>
                            <td><span className={`admin-pill ${o.active ? 'is-active' : ''}`}>{o.active ? 'Active' : o.revoked_at ? 'Revoked' : 'Expired'}</span></td>
                            <td>{o.active && <button type="button" className="link-button admin-danger-link" onClick={() => onRevoke(o)}>Revoke</button>}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const RequestsTab = ({ requests, onReview, focusId }) => {
    useEffect(() => {
        if (!requests || !focusId) return;
        document.getElementById(`request-${focusId}`)?.scrollIntoView({ block: 'start' });
    }, [requests, focusId]);
    if (!requests) return <p className="admin-muted">Loading…</p>;
    const pending = requests.filter((r) => r.status === 'pending');
    const reviewed = requests.filter((r) => r.status !== 'pending');
    return (
        <>
            {pending.length === 0 && <section className="admin-panel"><p className="admin-muted">No requests are waiting for review.</p></section>}
            {pending.map((r) => (
                <section className={`admin-panel admin-request${r.id === focusId ? ' is-focused' : ''}`} key={r.id} id={`request-${r.id}`}>
                    <div className="admin-panel-head">
                        <h3>{r.charity_name}</h3>
                        <span className="admin-muted">{fmtDateTime(r.created_at)}</span>
                    </div>
                    <dl className="admin-dl">
                        <dt>Type</dt><dd>{r.charity_type}</dd>
                        <dt>Country or location</dt><dd>{r.country}</dd>
                        <dt>Board ID</dt><dd><code>{r.board_id}</code> <span className="admin-muted">({r.members_seen} member{r.members_seen === 1 ? '' : 's'} seen using it)</span></dd>
                        <dt>Requested by</dt><dd>{r.requester_email || r.requester_username || r.trello_member_id}</dd>
                        <dt>How they will use it</dt><dd className="admin-pre">{r.intended_use}</dd>
                        <dt>Why they need it free</dt><dd className="admin-pre">{r.justification}</dd>
                    </dl>
                    <div className="admin-form-actions">
                        <button type="button" className="button-secondary" onClick={() => onReview(r, 'decline')}>Decline</button>
                        <button type="button" className="button-primary" onClick={() => onReview(r, 'approve')}>Approve free Board plan</button>
                    </div>
                </section>
            ))}
            {reviewed.length > 0 && (
                <section className="admin-panel">
                    <h3>Reviewed</h3>
                    <div className="admin-table-wrap">
                        <table className="admin-table">
                            <thead><tr><th>Organisation</th><th>Board ID</th><th>Requested by</th><th>Decision</th><th>Reviewed</th></tr></thead>
                            <tbody>
                                {reviewed.map((r) => (
                                    <tr key={r.id}>
                                        <td>{r.charity_name}<div className="admin-sub">{r.charity_type}, {r.country}</div></td>
                                        <td><code>{r.board_id}</code></td>
                                        <td>{r.requester_email || r.trello_member_id}</td>
                                        <td><span className={`admin-pill ${r.status === 'approved' ? 'is-active' : ''}`}>{r.status === 'approved' ? 'Approved' : 'Declined'}</span></td>
                                        <td>{fmtDate(r.reviewed_at)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}
        </>
    );
};

const FEATURE_NAMES = {
    map: 'Map', stats: 'Statistics', tasks: 'Tasks', ai: 'AI', share: 'Share links', export: 'Export',
    slideshow: 'Slideshow', keepScreenOn: 'Keep screen on', sync: 'Account sync',
};

const fmtSeconds = (n) => (n >= 3600 && n % 3600 === 0 ? `${n / 3600} h` : n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`);

const PRICE_KEYS = ['priceMonthly', 'priceAnnual', 'packPriceMonthly', 'packPriceAnnual'];
const priceText = (v) => (v === null || v === undefined ? '' : String(v));

const PlanRow = ({ plan, onSaved, onError }) => {
    const initial = {
        boardLimit: plan.boardLimit,
        boardsPerPack: plan.boardsPerPack,
        minRefreshSeconds: plan.minRefreshSeconds,
        ...Object.fromEntries(PRICE_KEYS.map((k) => [k, priceText(plan[k])])),
    };
    const [form, setForm] = useState(initial);
    const [busy, setBusy] = useState(false);
    const dirty = Object.keys(initial).some((k) => form[k] !== initial[k]);
    const num = (key) => (e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }));
    const price = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
    const save = async () => {
        setBusy(true);
        try {
            const body = { action: 'updatePlan', code: plan.code, boardLimit: form.boardLimit, boardsPerPack: form.boardsPerPack, minRefreshSeconds: form.minRefreshSeconds };
            PRICE_KEYS.forEach((k) => { body[k] = form[k] === '' ? null : Number(form[k]); });
            await api('/api/admin', { method: 'POST', body: JSON.stringify(body) });
            onSaved();
        } catch (e) { onError(e.message); }
        setBusy(false);
    };
    const priceInput = (key, label) => (
        <label className="admin-price">
            <span>$</span>
            <input type="number" min="0" step="0.01" className="admin-num-input" value={form[key]} onChange={price(key)} aria-label={`${plan.name} ${label}`} />
            <span className="admin-sub">{label}</span>
        </label>
    );
    return (
        <tr>
            <td><strong>{plan.name}</strong><div className="admin-sub"><code>{plan.code}</code></div></td>
            <td>
                {plan.code === 'free' ? <span className="admin-muted">Free</span> : <>
                    {priceInput('priceMonthly', plan.code === 'board' ? 'per board / month' : 'per user / month')}
                    {priceInput('priceAnnual', plan.code === 'board' ? 'per board / year' : 'per user / year')}
                    {plan.code === 'pro' && <>
                        {priceInput('packPriceMonthly', 'per pack / month')}
                        {priceInput('packPriceAnnual', 'per pack / year')}
                    </>}
                </>}
            </td>
            <td><input type="number" min="0" className="admin-num-input" value={form.boardLimit} onChange={num('boardLimit')} aria-label={`${plan.name} board limit`} /></td>
            <td><input type="number" min="0" className="admin-num-input" value={form.boardsPerPack} onChange={num('boardsPerPack')} aria-label={`${plan.name} boards per pack`} /></td>
            <td>
                <input type="number" min="30" className="admin-num-input" value={form.minRefreshSeconds} onChange={num('minRefreshSeconds')} aria-label={`${plan.name} minimum refresh in seconds`} />
                <div className="admin-sub">{fmtSeconds(form.minRefreshSeconds)}</div>
            </td>
            <td className="admin-features">{plan.features.length ? plan.features.map((f) => FEATURE_NAMES[f] || f).join(', ') : <span className="admin-muted">None</span>}</td>
            <td>{dirty && <button type="button" className="button-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}</td>
        </tr>
    );
};

const PlansTab = () => {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [mode, setMode] = useState('off');
    const [testIds, setTestIds] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const d = await api('/api/admin?view=settings');
            setData(d);
            setMode(d.enforcement.mode);
            setTestIds(d.enforcement.testMemberIds.join('\n'));
        } catch (e) { setError(e.message); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const saveEnforcement = async (e) => {
        e.preventDefault();
        if (mode === 'all' && !window.confirm('Turn plan limits on for every user? Free users will lose Pro features straight away.')) return;
        setBusy(true);
        setError('');
        try {
            const ids = testIds.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
            await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'setEnforcement', mode, testMemberIds: ids }) });
            setNotice('Saved. Users see the change the next time the app checks their plan (on load, or when the window regains focus).');
            load();
        } catch (err) { setError(err.message); }
        setBusy(false);
    };

    const startTrials = async () => {
        if (!window.confirm(`Give a ${data.trialDays}-day Pro trial to ${data.trialEligible} user${data.trialEligible === 1 ? '' : 's'}? Each user can only get one trial.`)) return;
        setBusy(true);
        try {
            const r = await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'startTrials' }) });
            setNotice(`Started ${r.started} trial${r.started === 1 ? '' : 's'}.`);
            load();
        } catch (e) { setError(e.message); }
        setBusy(false);
    };

    if (!data) return error ? <div className="notice notice-danger">{error}</div> : <p className="admin-muted">Loading…</p>;
    return (
        <>
            {error && <div className="notice notice-danger">{error}</div>}
            {notice && <div className="notice notice-success">{notice}</div>}
            <section className="admin-panel">
                <h3>Plan limits</h3>
                <p className="admin-muted">
                    While limits are off, everyone keeps every feature, as today. Turn them on for a few test accounts first,
                    then flip a test account between Free and Pro from the Users tab to check the app. Turn them on for everyone at launch.
                </p>
                <form onSubmit={saveEnforcement} className="admin-enforcement">
                    <label className="admin-radio"><input type="radio" name="enf" value="off" checked={mode === 'off'} onChange={() => setMode('off')} /> Off: everyone gets every feature</label>
                    <label className="admin-radio"><input type="radio" name="enf" value="test" checked={mode === 'test'} onChange={() => setMode('test')} /> Test accounts only</label>
                    {mode === 'test' && (
                        <label className="admin-field">
                            <span>Trello member IDs of the test accounts, one per line</span>
                            <textarea rows={3} value={testIds} onChange={(e) => setTestIds(e.target.value)} placeholder="5338a7793d2062e9654bafb6" />
                        </label>
                    )}
                    <label className="admin-radio"><input type="radio" name="enf" value="all" checked={mode === 'all'} onChange={() => setMode('all')} /> Everyone (launch)</label>
                    <div><button type="submit" className="button-primary" disabled={busy}>Save</button></div>
                </form>
            </section>

            <section className="admin-panel">
                <h3>Plan rules</h3>
                <p className="admin-muted">Prices (US dollars) show on the <a href="/pricing.html" target="_blank" rel="noreferrer">pricing page</a> within a minute of saving. Board limits and the refresh floor apply straight away. The minimum refresh cannot go below 30 seconds, because Trello limits the whole app to 300 requests every 10 seconds.</p>
                <div className="admin-table-wrap">
                    <table className="admin-table admin-plans-table">
                        <thead>
                            <tr><th>Plan</th><th>Price (USD)</th><th>Boards</th><th>Boards per pack</th><th>Minimum refresh (s)</th><th>Features</th><th /></tr>
                        </thead>
                        <tbody>
                            {data.plans.map((p) => <PlanRow key={JSON.stringify(p)} plan={p} onSaved={load} onError={setError} />)}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="admin-panel">
                <h3>Trial for existing users</h3>
                <p className="admin-muted">
                    Gives every user who has no plan and never had a trial a {data.trialDays}-day Pro trial, no card needed.
                    Run it at launch. {data.trials.active} trial{data.trials.active === 1 ? '' : 's'} active, {data.trials.total} given in total.
                </p>
                <button type="button" className="button-primary" onClick={startTrials} disabled={busy || !data.trialEligible}>
                    Start trials for {data.trialEligible} user{data.trialEligible === 1 ? '' : 's'}
                </button>
            </section>
        </>
    );
};

const TABS = [
    { id: 'overview', label: 'Overview', icon: ChartColumn },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'boards', label: 'Board plans', icon: LayoutGrid },
    { id: 'plans', label: 'Given plans', icon: Gift },
    { id: 'requests', label: 'Charity requests', icon: Inbox },
    { id: 'rules', label: 'Plans and limits', icon: SlidersHorizontal },
];

// Links in admin emails open a tab directly: /admin?tab=users&q=<member id>
// or /admin?tab=requests&request=<request id>.
const readLink = () => {
    try {
        const p = new URLSearchParams(window.location.search);
        const tab = TABS.some((t) => t.id === p.get('tab')) ? p.get('tab') : 'overview';
        return { tab, q: (p.get('q') || '').slice(0, 120), request: p.get('request') || '' };
    } catch {
        return { tab: 'overview', q: '', request: '' };
    }
};

const AdminView = ({ onClose }) => {
    const [link] = useState(readLink);
    const [tab, setTab] = useState(link.tab);
    const [access, setAccess] = useState({ state: 'checking' });
    const [summary, setSummary] = useState(null);
    const [overrides, setOverrides] = useState(null);
    const [requests, setRequests] = useState(null);
    const [grantInitial, setGrantInitial] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setError('');
        try {
            const [s, o, r] = await Promise.all([
                api('/api/admin?view=summary'),
                api('/api/admin?view=overrides'),
                api('/api/admin?view=requests'),
            ]);
            setSummary(s);
            setOverrides(o.overrides);
            setRequests(r.requests);
            setAccess({ state: 'ok' });
        } catch (e) {
            if (e.status === 401 || e.status === 403) {
                const me = await fetchMe();
                setAccess({ state: 'denied', code: e.code, memberId: me?.memberId });
            } else if (e.status === 503) {
                setAccess({ state: 'denied', code: e.code, message: e.message });
            } else {
                setError(e.message);
                setAccess((a) => (a.state === 'checking' ? { state: 'ok' } : a));
            }
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const revoke = async (o) => {
        if (!window.confirm(`Revoke the ${o.plan_code === 'pro' ? 'Pro' : 'Board'} plan for ${o.target_id}?`)) return;
        try {
            await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'revoke', id: o.id }) });
            load();
        } catch (e) { setError(e.message); }
    };

    const review = async (r, decision) => {
        const verb = decision === 'approve' ? 'Approve a free Board plan for' : 'Decline the request from';
        if (!window.confirm(`${verb} ${r.charity_name}?`)) return;
        try {
            await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'review', id: r.id, decision }) });
            load();
        } catch (e) { setError(e.message); }
    };

    const boardOverrides = useMemo(() => overrides?.filter((o) => o.target_type === 'board'), [overrides]);

    const openGrant = (initial) => {
        setGrantInitial(initial);
        setTab('plans');
    };

    return (
        <div className="admin-view">
            <div className="map-header">
                <PageTitle>Trellops <span className="page-title-suffix">Admin</span></PageTitle>
                <div className="map-header-actions admin-header-actions">
                    <button type="button" className="button-secondary" onClick={load} title="Refresh">
                        <RefreshCw size={16} aria-hidden="true" /> Refresh
                    </button>
                    <button type="button" className="button-secondary" onClick={onClose}>
                        <ArrowLeft size={16} aria-hidden="true" /> Back to Trellops
                    </button>
                    <ThemeToggleButton />
                </div>
            </div>

            <main className="admin-main">
                {access.state === 'checking' && <p className="admin-muted">Checking access…</p>}

                {access.state === 'denied' && (
                    <section className="admin-panel admin-denied">
                        <h3>{access.code === 'NOT_ADMIN' ? 'This account is not an administrator' : 'Admin dashboard unavailable'}</h3>
                        {access.code === 'NOT_ADMIN' && (
                            <p>
                                To give this Trello account access, add its member ID to the <code>ADMIN_TRELLO_IDS</code> environment variable in Vercel and redeploy.
                                {access.memberId && <> Your member ID is <code>{access.memberId}</code>.</>}
                            </p>
                        )}
                        {access.code === 'NO_SESSION' && <p>Sign in with Trello first, then open this page again.</p>}
                        {access.message && <p>{access.message}</p>}
                    </section>
                )}

                {access.state === 'ok' && (
                    <>
                        <nav className="settings-tabs admin-tabs" aria-label="Admin sections">
                            {TABS.map(({ id, label, icon: Icon }) => (
                                <button key={id} type="button" className={`tab-button ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
                                    <Icon size={16} aria-hidden="true" /> {label}
                                    {id === 'requests' && summary?.pendingRequests > 0 && <span className="admin-count">{summary.pendingRequests}</span>}
                                </button>
                            ))}
                        </nav>

                        {error && <div className="notice notice-danger">{error}</div>}

                        {tab === 'overview' && <Overview summary={summary} />}
                        {tab === 'users' && <UsersTab onGrant={openGrant} initialQuery={link.q} />}
                        {tab === 'boards' && (
                            <section className="admin-panel">
                                <div className="admin-panel-head">
                                    <h3>Board plans</h3>
                                    <button type="button" className="link-button" onClick={() => openGrant({ targetType: 'board', targetId: '' })}>Give a Board plan</button>
                                </div>
                                <OverridesTable rows={boardOverrides} kind="board" onRevoke={revoke} />
                            </section>
                        )}
                        {tab === 'plans' && (
                            <>
                                <GrantForm initial={grantInitial} onDone={load} />
                                <section className="admin-panel">
                                    <h3>All given plans</h3>
                                    <OverridesTable rows={overrides} kind="all" onRevoke={revoke} />
                                </section>
                            </>
                        )}
                        {tab === 'requests' && <RequestsTab requests={requests} onReview={review} focusId={link.request} />}
                        {tab === 'rules' && <PlansTab />}
                    </>
                )}
            </main>
        </div>
    );
};

export default AdminView;
