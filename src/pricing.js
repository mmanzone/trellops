// Pricing page (pricing.html). Plans, limits and prices come from /api/pricing,
// which reads what the admin set in Admin > Plans and limits. The defaults
// below are only used if that request fails.

const DEFAULT_PLANS = [
    { code: 'free', name: 'Free', boardLimit: 1, boardsPerPack: 0, minRefreshSeconds: 3600, features: [], priceMonthly: 0, priceAnnual: 0 },
    {
        code: 'pro', name: 'Pro', boardLimit: 5, boardsPerPack: 5, minRefreshSeconds: 60,
        features: ['map', 'stats', 'tasks', 'ai', 'share', 'export', 'slideshow', 'keepScreenOn', 'sync'],
        priceMonthly: 5, priceAnnual: 50, packPriceMonthly: 5, packPriceAnnual: 50,
    },
    {
        code: 'board', name: 'Board plan', boardLimit: 0, boardsPerPack: 0, minRefreshSeconds: 60,
        features: ['map', 'stats', 'tasks', 'ai', 'slideshow', 'keepScreenOn'],
        priceMonthly: 10, priceAnnual: 100,
    },
];

const FEATURES = [
    ['map', 'Map view of card locations'],
    ['stats', 'Statistics and trends'],
    ['tasks', 'Tasks view across workspaces'],
    ['ai', 'AI summaries'],
    ['slideshow', 'Slideshow between dashboard and map'],
    ['keepScreenOn', 'Keep the screen on for wall displays'],
    ['share', 'Share links'],
    ['export', 'Export and import configurations'],
    ['sync', 'Settings saved to your account'],
];

const state = { plans: DEFAULT_PLANS, period: 'monthly' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const byCode = (code) => state.plans.find((p) => p.code === code);

const money = (v) => {
    if (v === null || v === undefined) return '';
    const n = Number(v);
    return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
};

const refreshText = (s) => {
    if (s >= 3600) return s === 3600 ? 'every 60 minutes' : `every ${Math.round(s / 3600)} hours`;
    if (s >= 60) return s === 60 ? 'every minute' : `every ${Math.round(s / 60)} minutes`;
    return `every ${s} seconds`;
};

const boardsText = (p) => {
    if (p.code === 'board') return 'The board it is bought for';
    const base = `${p.boardLimit} board${p.boardLimit === 1 ? '' : 's'}`;
    return p.boardsPerPack ? `${base}, plus ${p.boardsPerPack} per pack` : base;
};

const check = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const dash = '<span class="pricing-no" aria-label="Not included">&mdash;</span>';
const yes = `<span class="pricing-yes" aria-label="Included">${check}</span>`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function saving() {
    const pro = byCode('pro');
    if (!pro?.priceMonthly || !pro?.priceAnnual) return '';
    const pct = Math.round((1 - pro.priceAnnual / (pro.priceMonthly * 12)) * 100);
    return pct > 0 ? `Save ${pct}%` : '';
}

function priceFor(p) {
    if (!p.priceMonthly && !p.priceAnnual) return { price: '$0', unit: 'forever' };
    const who = p.code === 'board' ? 'per board' : 'per user';
    return state.period === 'annual'
        ? { price: money(p.priceAnnual), unit: `${who} / year` }
        : { price: money(p.priceMonthly), unit: `${who} / month` };
}

function cardList(p) {
    const items = [
        p.code === 'board' ? 'Every member of the board, no per-user cost' : `${boardsText(p)}`,
        `Refreshes ${refreshText(p.minRefreshSeconds)}${p.code === 'free' ? '' : ', plus Refresh on demand'}`,
    ];
    if (p.code === 'free') {
        items.push('Dashboard with card counts per list', 'Settings kept in your browser');
    } else {
        FEATURES.filter(([key]) => p.features.includes(key)).slice(0, 6).forEach(([, label]) => items.push(label));
        if (p.code === 'board') items.push('Charities and NGOs: free on request');
    }
    return items.map((t) => `<li>${check}<span>${escapeHtml(t)}</span></li>`).join('');
}

function renderCards() {
    state.plans.forEach((p) => {
        const card = $(`.pricing-card[data-plan="${p.code}"]`);
        if (!card) return;
        const { price, unit } = priceFor(p);
        $('[data-price]', card).textContent = price;
        $('[data-unit]', card).textContent = unit;
        $('[data-list]', card).innerHTML = cardList(p);
        const pack = $('[data-pack]', card);
        if (pack) {
            const packPrice = state.period === 'annual' ? p.packPriceAnnual : p.packPriceMonthly;
            pack.textContent = p.boardsPerPack && packPrice !== null && packPrice !== undefined
                ? `Need more boards? ${money(packPrice)} per ${state.period === 'annual' ? 'year' : 'month'} for each ${p.boardsPerPack} more.`
                : '';
        }
    });
    const save = $('[data-save]');
    if (save) save.textContent = saving();
}

function renderCompare() {
    const [free, pro, board] = ['free', 'pro', 'board'].map(byCode);
    const priceCell = (p) => {
        if (!p.priceMonthly && !p.priceAnnual) return 'Free';
        const who = p.code === 'board' ? 'board' : 'user';
        return `${money(p.priceMonthly)} per ${who} / month<br><span class="pricing-sub">or ${money(p.priceAnnual)} per year</span>`;
    };
    const has = (p, key) => (p.features.includes(key) ? yes : dash);
    const rows = [
        ['group', 'Plan'],
        ['Price', priceCell(free), priceCell(pro), priceCell(board)],
        ['Extra boards', dash, pro.boardsPerPack ? `${money(pro.packPriceMonthly)} / month per ${pro.boardsPerPack} boards` : dash, 'Buy a Board plan per board'],
        ['Who it covers', 'You', 'You, on any device', 'Every member of the board'],
        ['Charities and NGOs', dash, dash, 'Free on request'],
        ['group', 'Dashboards'],
        ['Boards', boardsText(free), boardsText(pro), boardsText(board)],
        ['Automatic refresh', refreshText(free.minRefreshSeconds), `Down to ${refreshText(pro.minRefreshSeconds)}`, `Down to ${refreshText(board.minRefreshSeconds)}`],
        ['Refresh on demand', yes, yes, yes],
        ['Card counts, colours, blocks and filters', yes, yes, yes],
        ['Where settings are kept', 'This browser', 'Your account, any device', 'Each member\'s browser'],
        ['group', 'Views'],
        ...FEATURES.slice(0, 3).map(([key, label]) => [label, has(free, key), has(pro, key), has(board, key) === yes ? `${yes}<span class="pricing-sub">on that board</span>` : dash]),
        ['group', 'Displays and sharing'],
        ...FEATURES.slice(3).map(([key, label]) => [label, has(free, key), has(pro, key), has(board, key)]),
        ['Free users opening a shared link', 'Read-only notice', 'Imports the layout', dash],
    ];
    $('[data-compare]').innerHTML = rows.map((r) => (r[0] === 'group'
        ? `<tr class="pricing-group"><th colspan="4" scope="colgroup">${r[1]}</th></tr>`
        : `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`)).join('');
}

function render() {
    renderCards();
    renderCompare();
    renderQuiz();
}

// --- Billing period toggle -----------------------------------------------------
$$('.pricing-toggle [data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
        state.period = btn.dataset.period;
        $$('.pricing-toggle [data-period]').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
        renderCards();
    });
});

// --- Compare table ---------------------------------------------------------------
const toggleCompare = $('[data-toggle-compare]');
toggleCompare.addEventListener('click', () => {
    const table = $('#compare-table');
    const open = table.hidden;
    table.hidden = !open;
    toggleCompare.setAttribute('aria-expanded', String(open));
    toggleCompare.textContent = open ? 'Hide details' : 'Show all details';
});
if (window.location.hash === '#compare') toggleCompare.click();

// --- "Which plan is for me?" ------------------------------------------------------
const quiz = $('[data-quiz]');
let lastFocus = null;
const openQuiz = () => {
    lastFocus = document.activeElement;
    quiz.hidden = false;
    document.body.classList.add('pricing-modal-open');
    $('input', quiz).focus();
};
const closeQuiz = () => {
    quiz.hidden = true;
    document.body.classList.remove('pricing-modal-open');
    if (lastFocus) lastFocus.focus();
};
$$('[data-open-quiz]').forEach((b) => b.addEventListener('click', openQuiz));
$$('[data-close-quiz]').forEach((b) => b.addEventListener('click', closeQuiz));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !quiz.hidden) closeQuiz(); });
quiz.addEventListener('change', renderQuiz);
if (window.location.hash === '#which-plan') openQuiz();

export function recommend({ who, need, ngo }) {
    if (!who || !need || !ngo) return null;
    if (who === 'team') {
        if (ngo === 'yes') return { plan: 'board', free: true, why: 'A Board plan covers everyone on your board, and charities and NGOs can have it for free. Request it from Settings, under the board picker.' };
        if (need === 'more') return { plan: 'board', why: 'One Board plan unlocks the map, statistics and faster refresh for every member of the board, which costs less than Pro for each person.' };
        return { plan: 'free', why: 'Each team member can sign in and use Free on the shared board. Choose a Board plan later if you want the map, statistics or a faster refresh for everyone.', alt: 'board' };
    }
    if (who === 'me-many') {
        return { plan: 'pro', why: 'Free covers one board. Pro covers several boards with every view, and your settings follow you to any device.', alt: ngo === 'yes' ? 'board-free' : null };
    }
    if (need === 'more') {
        return { plan: 'pro', why: 'Pro adds the map, statistics, tasks, AI summaries and a refresh down to one minute.', alt: ngo === 'yes' ? 'board-free' : null };
    }
    return { plan: 'free', why: 'One board with card counts refreshed every hour is exactly what Free covers.' };
}

function renderQuiz() {
    const val = (name) => $(`input[name="${name}"]:checked`, quiz)?.value;
    const r = recommend({ who: val('who'), need: val('need'), ngo: val('ngo') });
    const box = $('[data-result]', quiz);
    if (!r) {
        box.innerHTML = '<p class="quiz-placeholder">Answer the questions to see a suggestion.</p>';
        return;
    }
    const p = byCode(r.plan);
    const price = r.free ? 'Free for charities and NGOs' : (p.priceMonthly ? `${money(p.priceMonthly)} ${p.code === 'board' ? 'per board' : 'per user'} / month` : 'Free');
    let alt = '';
    if (r.alt === 'board') alt = `<p class="quiz-alt">Later: a Board plan at ${money(byCode('board').priceMonthly)} per board / month unlocks everything for the whole team.</p>`;
    if (r.alt === 'board-free') alt = '<p class="quiz-alt">If your team shares a board, your charity can ask for a free Board plan instead.</p>';
    box.innerHTML = `
        <p class="quiz-label">We suggest</p>
        <p class="quiz-plan">${escapeHtml(p.name)} <span>${escapeHtml(price)}</span></p>
        <p>${escapeHtml(r.why)}</p>
        ${alt}
        <a class="s-btn s-btn-primary s-btn-sm" href="/">${r.plan === 'free' || r.free ? 'Start free' : 'Start free, upgrade when plans open'}</a>`;
}

// --- Buy buttons -------------------------------------------------------------------
// "Opening soon" until paid plans open. Then a signed-in member can start the
// Pro checkout here; a Board plan is bought in Settings, where the board is chosen.
const LIVE = ['active', 'trialing', 'past_due', 'paused'];

function swapCta(card, el) {
    const old = $('.pricing-cta', card);
    el.className = `${old.className.replace('is-soon', '').trim()}`;
    old.replaceWith(el);
}

const link = (text, href) => Object.assign(document.createElement('a'), { textContent: text, href });

function setupBuyButtons(billing, salesOpen) {
    const proCard = $('[data-plan="pro"]');
    const boardCard = $('[data-plan="board"]');
    if (billing?.checkoutOpen) {
        const hasPro = (billing.subscriptions || []).some((s) => s.kind === 'user' && LIVE.includes(s.status) && !s.cancel_at);
        if (hasPro) {
            swapCta(proCard, link('You have Pro: manage in Settings', '/settings'));
        } else if (billing.available?.pro) {
            const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Upgrade to Pro' });
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const { openCheckout } = await import('./api/billing.js');
                    await openCheckout(billing, { plan: 'pro', period: state.period }, () => {
                        swapCta(proCard, link('Payment received. Open Trellops', '/settings'));
                    });
                } catch (e) {
                    btn.textContent = e.message;
                }
                btn.disabled = false;
            });
            swapCta(proCard, btn);
        }
        if (billing.available?.board) swapCta(boardCard, link('Choose the board in Settings', '/settings'));
    } else if (salesOpen && !billing) {
        swapCta(proCard, link('Sign in to upgrade', '/'));
        swapCta(boardCard, link('Sign in to buy', '/'));
    }
}

// --- Load the admin-set plans -------------------------------------------------------
render();
fetch('/api/pricing')
    .then((res) => (res.ok ? res.json() : null))
    .then(async (data) => {
        if (!data?.plans?.length) return;
        const merged = DEFAULT_PLANS.map((d) => ({ ...d, ...(data.plans.find((p) => p.code === d.code) || {}) }));
        state.plans = merged;
        render();
        const { fetchBilling } = await import('./api/billing.js');
        setupBuyButtons(await fetchBilling(), data.salesOpen);
    })
    .catch(() => { /* keep the defaults */ });
