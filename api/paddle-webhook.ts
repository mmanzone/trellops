/**
 * POST /api/paddle-webhook
 *
 * Paddle notifications (subscription.* and transaction.completed). The body is
 * checked against the Paddle-Signature header with PADDLE_WEBHOOK_SECRET before
 * anything is read. Subscription events are written to `subscriptions`, every
 * event is logged in `events`, and a new subscription emails the admins.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { verifyPaddleSignature, upsertSubscription } from './_lib/paddle.js';
import { notifyAdmins, subscriptionEmail, appUrl } from './_lib/notify.js';

export const config = { maxDuration: 15 };

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const raw = await request.text();
    const header = request.headers.get('paddle-signature');
    const secret = (process.env.PADDLE_WEBHOOK_SECRET || '').trim();
    if (!verifyPaddleSignature(raw, header, secret)) {
      // Say why, without logging the secret or the signature.
      const ts = Number(/ts=(\d+)/.exec(header || '')?.[1]);
      const why = !secret
        ? 'PADDLE_WEBHOOK_SECRET is not set'
        : !header
          ? 'no Paddle-Signature header'
          : !Number.isFinite(ts)
            ? 'no timestamp in the signature header'
            : Math.abs(Date.now() / 1000 - ts) > 300
              ? `timestamp is ${Math.round(Date.now() / 1000 - ts)} s old`
              : `signature does not match (the secret ${secret.startsWith('pdl_ntfset_') ? 'has' : 'does not have'} the pdl_ntfset_ prefix of a notification secret)`;
      console.error(`[paddle] rejected a notification: ${why}`);
      return json(401, { error: 'Invalid signature' });
    }
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
    const sql = getDb();
    // 503 makes Paddle retry later instead of losing the event.
    if (!sql) return json(503, { error: 'The database is not configured.' });
    await ensureSchema(sql);

    const type = String(event?.event_type || '');
    const occurredAt = event?.occurred_at || new Date().toISOString();
    let outcome: string = 'ignored';
    let memberId: string | null = null;

    if (type.startsWith('subscription.')) {
      const res = await upsertSubscription(sql, event.data, occurredAt);
      outcome = res.result;
      memberId = res.memberId || null;
      if (res.result !== 'stored' && res.result !== 'stale') {
        console.error(`[paddle] ${type} ${event.data?.id} not stored: ${res.result}`);
      }
      if (res.result === 'stored' && res.isNew) {
        const users = memberId
          ? ((await sql.query(`SELECT username, email FROM users WHERE trello_member_id = $1`, [memberId])) as any[])
          : [];
        notifyAdmins(subscriptionEmail({
          plan: res.plan === 'board' ? 'Board plan' : 'Pro',
          status: String(event.data?.status || ''),
          boardId: res.plan === 'board' ? event.data?.custom_data?.boardId || null : null,
          memberId: memberId || '',
          username: users[0]?.username || null,
          email: users[0]?.email || null,
        }, appUrl(request)));
      }
    } else if (type === 'transaction.completed') {
      outcome = 'logged';
    }

    await sql.query(`INSERT INTO events (type, trello_member_id, payload) VALUES ('paddle', $1, $2::jsonb)`, [
      memberId,
      JSON.stringify({
        eventId: event?.event_id,
        eventType: type,
        id: event?.data?.id,
        status: event?.data?.status,
        outcome,
      }),
    ]);
    // Paddle retries non-2xx answers, so a price id not yet pasted in the admin
    // page is picked up once it is.
    if (outcome === 'unknown_price') return json(500, { error: 'Unknown price id; add it in Admin > Plans and limits.' });
    return json(200, { received: true, outcome });
  },
};
