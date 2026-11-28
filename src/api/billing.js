/**
 * Paddle checkout and billing, from the browser. The server (/api/billing)
 * decides whether checkout is open for this member and signs who is buying;
 * Paddle.js shows the checkout overlay and takes the payment.
 */

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';

let paddlePromise = null;
let completedHandler = null;

const call = async (method, body) => {
    const res = await fetch('/api/billing', {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
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

/** GET /api/billing, or null when signed out or the server is unavailable. */
export const fetchBilling = async () => {
    try {
        return await call('GET');
    } catch {
        return null;
    }
};

const loadPaddle = (billing) => {
    if (!paddlePromise) {
        paddlePromise = new Promise((resolve, reject) => {
            const ready = () => {
                const Paddle = window.Paddle;
                if (!Paddle) { reject(new Error('Paddle could not load.')); return; }
                if (billing.environment !== 'production') Paddle.Environment.set('sandbox');
                Paddle.Initialize({
                    token: billing.clientToken,
                    eventCallback: (event) => {
                        if (event?.name === 'checkout.completed' && completedHandler) completedHandler(event);
                    },
                });
                resolve(Paddle);
            };
            if (window.Paddle) { ready(); return; }
            const script = document.createElement('script');
            script.src = PADDLE_JS;
            script.async = true;
            script.onload = ready;
            script.onerror = () => { paddlePromise = null; reject(new Error('Paddle could not load. Check your connection and try again.')); };
            document.head.appendChild(script);
        });
    }
    return paddlePromise;
};

/**
 * Opens the Paddle checkout overlay.
 * plan: 'pro' | 'board'; period: 'monthly' | 'annual'; packs (Pro); boardId (Board plan).
 * onCompleted runs after payment; the plan becomes active once Paddle's
 * notification reaches the server, usually within a few seconds.
 */
export const openCheckout = async (billing, { plan, period, packs = 0, boardId = null }, onCompleted) => {
    if (!billing?.checkoutOpen || !billing.clientToken) throw new Error('Paid plans are not open yet.');
    const order = await call('POST', { action: 'checkout', plan, period, packs, boardId });
    const Paddle = await loadPaddle(billing);
    completedHandler = (event) => {
        completedHandler = null;
        onCompleted?.(event);
    };
    Paddle.Checkout.open({
        items: order.items,
        customData: order.customData,
        ...(order.email ? { customer: { email: order.email } } : {}),
        settings: { displayMode: 'overlay', theme: 'light', allowLogout: false },
    });
};

/** Opens Paddle's customer portal (change card, cancel, invoices) in a new tab. */
export const openPortal = async () => {
    const tab = window.open('', '_blank');
    try {
        const { url } = await call('POST', { action: 'portal' });
        if (tab) tab.location.href = url;
        else window.location.href = url;
    } catch (e) {
        tab?.close();
        throw e;
    }
};

export const setPacks = (packs) => call('POST', { action: 'setPacks', packs });

/** Polls the plan after a checkout until the webhook has recorded it (about 30 s at most). */
export const waitForPlan = async (check, tries = 10) => {
    for (let i = 0; i < tries; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (await check()) return true;
    }
    return false;
};
