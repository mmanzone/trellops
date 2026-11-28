import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useEntitlements } from '../../context/EntitlementsContext';
import { fetchBilling, openCheckout, openPortal, setPacks, waitForPlan } from '../../api/billing';
import '../../styles/plans.css';

const LIVE = ['active', 'trialing', 'past_due', 'paused'];
const isLive = (s) => LIVE.includes(s.status) && (!s.cancel_at || new Date(s.cancel_at) > new Date());
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const money = (v) => (v === null || v === undefined ? '' : `$${Number(v) % 1 ? Number(v).toFixed(2) : Number(v)}`);

const describe = (s) => {
    const what = s.plan_code === 'board' ? 'Board plan' : `Pro${s.pack_quantity ? ` with ${s.pack_quantity} extra pack${s.pack_quantity === 1 ? '' : 's'}` : ''}`;
    const billed = s.billing_period === 'annual' ? 'billed yearly' : 'billed monthly';
    let when = '';
    if (s.cancel_at) when = `Ends ${fmtDate(s.cancel_at)}.`;
    else if (s.status === 'past_due') when = 'Payment failed: update your card in Manage billing.';
    else if (s.status === 'paused') when = 'Paused.';
    else if (s.current_period_end) when = `Renews ${fmtDate(s.current_period_end)}.`;
    return `${what}, ${billed}. ${when}`;
};

/**
 * Buy, change and manage paid plans (Settings). Shows only when checkout is
 * open for this member or they already have a subscription.
 */
const BillingPanel = ({ boardId, boardName }) => {
    const { entitlements, refresh } = useEntitlements();
    const [billing, setBilling] = useState(null);
    const [prices, setPrices] = useState(null);
    const [period, setPeriod] = useState('monthly');
    const [packs, setPackCount] = useState(0);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState(null);

    const load = useCallback(async () => {
        const b = await fetchBilling();
        setBilling(b);
        return b;
    }, []);

    useEffect(() => {
        load();
        fetch('/api/pricing').then((r) => r.json()).then((d) => setPrices(Object.fromEntries((d.plans || []).map((p) => [p.code, p])))).catch(() => {});
    }, [load]);

    const subs = billing?.subscriptions || [];
    const proSub = subs.find((s) => s.kind === 'user' && isLive(s));
    const boardSub = boardId ? subs.find((s) => s.kind === 'board' && s.board_id === boardId.toLowerCase() && isLive(s)) : null;
    const otherBoardSubs = subs.filter((s) => s.kind === 'board' && isLive(s) && s !== boardSub);

    useEffect(() => { if (proSub) setPackCount(proSub.pack_quantity || 0); }, [proSub?.id, proSub?.pack_quantity]);

    if (!billing || (!billing.checkoutOpen && !subs.length)) return null;

    const run = async (key, fn) => {
        setBusy(key);
        setMessage(null);
        try { await fn(); } catch (e) { setMessage({ type: 'error', text: e.message }); }
        setBusy('');
    };

    const afterPayment = (match) => async () => {
        setMessage({ type: 'info', text: 'Payment received. Turning on your plan…' });
        const ok = await waitForPlan(async () => {
            const b = await load();
            return (b?.subscriptions || []).some(match);
        });
        refresh();
        setMessage(ok
            ? { type: 'success', text: 'Your plan is on. Thank you for supporting Trellops.' }
            : { type: 'info', text: 'Paddle took the payment, but the plan is not showing yet. Reload the page in a minute.' });
    };

    const buyPro = () => run('pro', () => openCheckout(billing, { plan: 'pro', period, packs }, afterPayment((s) => s.kind === 'user' && isLive(s))));
    const buyBoard = () => run('board', () => openCheckout(billing, { plan: 'board', period, boardId }, afterPayment((s) => s.kind === 'board' && s.board_id === boardId.toLowerCase() && isLive(s))));
    const manage = () => run('portal', openPortal);
    const savePacks = () => run('packs', async () => {
        await setPacks(packs);
        setMessage({ type: 'info', text: 'Updating your boards. Paddle charges or credits the difference for the rest of this period.' });
        await waitForPlan(async () => {
            const b = await load();
            return (b?.subscriptions || []).some((s) => s.kind === 'user' && isLive(s) && (s.pack_quantity || 0) === packs);
        }, 6);
        refresh();
        setMessage({ type: 'success', text: `Your plan now covers ${5 + 5 * packs} boards.` });
    });

    const pro = prices?.pro;
    const board = prices?.board;
    const unit = period === 'annual' ? 'year' : 'month';
    const proPrice = pro && (period === 'annual' ? pro.priceAnnual : pro.priceMonthly);
    const packPrice = pro && (period === 'annual' ? pro.packPriceAnnual : pro.packPriceMonthly);
    const boardPrice = board && (period === 'annual' ? board.priceAnnual : board.priceMonthly);
    const covered = entitlements?.board?.coveredByBoardPlan;
    const canBuyBoard = billing.checkoutOpen && billing.available.board && boardId && !boardSub && !covered;
    const canBuyPro = billing.checkoutOpen && billing.available.pro && !proSub;

    return (
        <section className="billing-panel" aria-labelledby="billing-title">
            <div className="billing-head">
                <h3 id="billing-title"><CreditCard size={18} aria-hidden="true" /> Plan and billing</h3>
                {billing.environment !== 'production' && <span className="billing-test">Test mode</span>}
            </div>

            {(proSub || boardSub || otherBoardSubs.length > 0) && (
                <ul className="billing-subs">
                    {proSub && <li>{describe(proSub)}</li>}
                    {boardSub && <li>{describe(boardSub)} Covers {boardName || 'this board'}.</li>}
                    {otherBoardSubs.map((s) => <li key={s.id}>{describe(s)} Board <code>{s.board_id}</code>.</li>)}
                </ul>
            )}

            {(canBuyPro || canBuyBoard) && (
                <div className="billing-period" role="radiogroup" aria-label="Billing period">
                    {['monthly', 'annual'].map((p) => (
                        <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? 'is-on' : ''} onClick={() => setPeriod(p)}>
                            {p === 'monthly' ? 'Monthly' : 'Yearly'}
                        </button>
                    ))}
                </div>
            )}

            <div className="billing-actions">
                {canBuyPro && (
                    <div className="billing-offer">
                        <div>
                            <strong>Pro</strong> for you, on up to {5 + 5 * packs} boards
                            {proPrice != null && <span className="billing-price"> · {money(proPrice + packs * (packPrice || 0))} per {unit}</span>}
                        </div>
                        {billing.available.packs && (
                            <label className="billing-packs">
                                Extra boards
                                <select value={packs} onChange={(e) => setPackCount(Number(e.target.value))}>
                                    {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : `+${5 * n} boards`}</option>)}
                                </select>
                            </label>
                        )}
                        <button type="button" className="button-primary" onClick={buyPro} disabled={!!busy}>{busy === 'pro' ? 'Opening…' : 'Upgrade to Pro'}</button>
                    </div>
                )}

                {canBuyBoard && (
                    <div className="billing-offer">
                        <div>
                            <strong>Board plan</strong> for everyone on {boardName || 'this board'}
                            {boardPrice != null && <span className="billing-price"> · {money(boardPrice)} per {unit}</span>}
                        </div>
                        <button type="button" className="button-secondary" onClick={buyBoard} disabled={!!busy}>{busy === 'board' ? 'Opening…' : 'Buy a Board plan'}</button>
                    </div>
                )}

                {proSub && billing.available.packs && (
                    <div className="billing-offer">
                        <label className="billing-packs">
                            Boards on your Pro plan
                            <select value={packs} onChange={(e) => setPackCount(Number(e.target.value))}>
                                {Array.from({ length: 21 }, (_, n) => <option key={n} value={n}>{5 + 5 * n} boards{n ? ` (${n} pack${n === 1 ? '' : 's'})` : ''}</option>)}
                            </select>
                        </label>
                        {packs !== (proSub.pack_quantity || 0) && (
                            <button type="button" className="button-primary" onClick={savePacks} disabled={!!busy}>{busy === 'packs' ? 'Updating…' : 'Update boards'}</button>
                        )}
                    </div>
                )}

                {subs.length > 0 && (
                    <button type="button" className="button-secondary billing-manage" onClick={manage} disabled={!!busy}>
                        {busy === 'portal' ? 'Opening…' : 'Manage billing'}
                    </button>
                )}
            </div>

            {message && <div className={`notice ${message.type === 'error' ? 'notice-danger' : message.type === 'success' ? 'notice-success' : 'notice-info'}`} role="status">{message.text}</div>}
            <p className="billing-fine">Payments are handled by Paddle, our reseller, which adds any sales tax and sends the receipts. Cancel any time in Manage billing; the plan stays on until the end of the paid period.</p>
        </section>
    );
};

export default BillingPanel;
