/**
 * Admin email notifications, sent through Resend (https://resend.com).
 *
 * Environment:
 *   RESEND_API_KEY      Resend API key. Without it no email is sent.
 *   NOTIFY_EMAIL_TO     Comma-separated admin addresses that receive the emails.
 *   NOTIFY_EMAIL_FROM   Sender, e.g. "Trellops <notifications@trellops.xyz>".
 *                       The domain must be verified in Resend. Defaults to
 *                       Resend's test sender, which only delivers to the
 *                       address that owns the Resend account.
 *   APP_URL             Base URL for links in the emails. Defaults to the
 *                       origin of the request that triggered the email.
 *
 * Sending never blocks or fails the request that triggered it.
 */
import { waitUntil } from '@vercel/functions';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Trellops <onboarding@resend.dev>';

export type Email = { subject: string; html: string; text: string };

export const notificationsConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && recipients().length);

const recipients = () =>
  (process.env.NOTIFY_EMAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s));

export function appUrl(request?: Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//.test(configured)) return configured;
  if (request) return new URL(request.url).origin;
  return 'https://trellops.xyz';
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Sends one email to the admin recipients. Returns whether Resend accepted it. */
export async function sendAdminEmail(email: Email): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = recipients();
  if (!key || !to.length) return false;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.NOTIFY_EMAIL_FROM || DEFAULT_FROM, to, ...email }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('[notify] Resend refused the email', res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notify] failed to send email', e);
    return false;
  }
}

/** Sends in the background: the response is not held up, and errors are only logged. */
export function notifyAdmins(email: Email): void {
  if (!notificationsConfigured()) return;
  waitUntil(sendAdminEmail(email));
}

type Row = [label: string, value: string | null | undefined];

/** Wraps content in the Trellops email layout (light, matching the public site). */
export function layout(opts: { eyebrow: string; title: string; intro: string; rows: Row[]; long?: Row[]; cta: { label: string; href: string }; footer: string }): string {
  const rows = opts.rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) => `<tr>
        <td style="padding:8px 0;border-top:1px solid #e6e3dc;color:#767c88;font-size:13px;width:150px;vertical-align:top">${esc(k)}</td>
        <td style="padding:8px 0;border-top:1px solid #e6e3dc;color:#15171c;font-size:14px;vertical-align:top;word-break:break-word">${esc(v)}</td>
      </tr>`,
    )
    .join('');
  const long = (opts.long || [])
    .filter(([, v]) => v)
    .map(
      ([k, v]) => `<p style="margin:20px 0 6px;color:#767c88;font-size:13px">${esc(k)}</p>
      <p style="margin:0;color:#15171c;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(v)}</p>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#fbfaf7;font-family:'Instrument Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#15171c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf7"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:10px;height:10px;background:#0079bf;border-radius:3px;font-size:0;line-height:10px">&nbsp;</td><td style="width:3px"></td>
        <td style="width:10px;height:10px;background:#d9822b;border-radius:3px;font-size:0;line-height:10px">&nbsp;</td><td style="width:3px"></td>
        <td style="width:10px;height:10px;background:#7a5cc7;border-radius:3px;font-size:0;line-height:10px">&nbsp;</td><td style="width:3px"></td>
        <td style="width:10px;height:10px;background:#1f8a70;border-radius:3px;font-size:0;line-height:10px">&nbsp;</td>
        <td style="padding-left:10px;font-family:'Bricolage Grotesque','Instrument Sans',Arial,sans-serif;font-weight:700;font-size:17px;color:#15171c">Trellops</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e6e3dc;border-radius:14px;padding:28px">
      <p style="margin:0 0 8px;color:#055a8c;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">${esc(opts.eyebrow)}</p>
      <h1 style="margin:0 0 10px;font-family:'Bricolage Grotesque','Instrument Sans',Arial,sans-serif;font-size:22px;line-height:1.25;font-weight:700;color:#15171c">${esc(opts.title)}</h1>
      <p style="margin:0 0 20px;color:#474d58;font-size:15px;line-height:1.55">${esc(opts.intro)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      ${long}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr>
        <td style="background:#0079bf;border-radius:8px"><a href="${esc(opts.cta.href)}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">${esc(opts.cta.label)}</a></td>
      </tr></table>
      <p style="margin:14px 0 0;color:#767c88;font-size:12px;word-break:break-all">${esc(opts.cta.href)}</p>
    </td></tr>
    <tr><td style="padding:16px 4px;color:#767c88;font-size:12px;line-height:1.5">${esc(opts.footer)}</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const textBody = (title: string, rows: Row[], long: Row[], href: string) =>
  [title, '', ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), ...long.filter(([, v]) => v).flatMap(([k, v]) => ['', `${k}:`, String(v)]), '', href].join('\n');

const FOOTER = 'You receive this because your address is in NOTIFY_EMAIL_TO for Trellops. Remove it there to stop these emails.';

export function signupEmail(member: { id: string; username: string; fullName?: string | null; email: string | null }, base: string): Email {
  const href = `${base}/admin?tab=users&q=${encodeURIComponent(member.id)}`;
  const name = member.fullName || member.username;
  const rows: Row[] = [
    ['Name', member.fullName || null],
    ['Trello username', member.username],
    ['Email', member.email || 'Not shared'],
    ['Member ID', member.id],
    ['Signed up', new Date().toUTCString()],
  ];
  const title = `${name} signed up`;
  return {
    subject: `New Trellops user: ${name}`,
    html: layout({
      eyebrow: 'New user',
      title,
      intro: 'Someone signed in to Trellops with Trello for the first time. They start on the Free plan.',
      rows,
      cta: { label: 'Open in admin', href },
      footer: FOOTER,
    }),
    text: textBody(title, rows, [], href),
  };
}

export function compRequestEmail(
  req: { id: string; boardId: string; charityName: string; charityType: string; country: string; intendedUse: string; justification: string },
  requester: { memberId: string; username?: string | null; email?: string | null },
  base: string,
): Email {
  const href = `${base}/admin?tab=requests&request=${encodeURIComponent(req.id)}`;
  const rows: Row[] = [
    ['Organisation', req.charityName],
    ['Type', req.charityType],
    ['Country', req.country],
    ['Board ID', req.boardId],
    ['Requested by', [requester.username, requester.email].filter(Boolean).join(', ') || requester.memberId],
  ];
  const long: Row[] = [
    ['How they plan to use Trellops', req.intendedUse],
    ['Why they need the free plan', req.justification],
  ];
  const title = `${req.charityName} asked for a free Board plan`;
  return {
    subject: `Charity request: ${req.charityName}`,
    html: layout({
      eyebrow: 'Charity request',
      title,
      intro: 'A charity or NGO request is waiting for review. Approving it gives every member of the board the Board plan at no cost.',
      rows,
      long,
      cta: { label: 'Review the request', href },
      footer: FOOTER,
    }),
    text: textBody(title, rows, long, href),
  };
}
