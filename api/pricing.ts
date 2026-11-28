/**
 * /api/pricing  (public, no sign-in)
 *
 * GET  Plan names, limits, features and prices for the pricing page, as set
 *      in the admin page (Plans and limits). Falls back to the defaults in
 *      api/_lib/entitlements.ts when the database is not reachable.
 */
import { json, methodNotAllowed } from './_lib/http.js';
import { getDb, ensureSchema } from './_lib/db.js';
import { loadPlans, loadEnforcement, DEFAULT_PLANS, type PlanRule } from './_lib/entitlements.js';
import { paddleConfigured } from './_lib/paddle.js';

export const config = { maxDuration: 10 };

export const publicPlan = (p: PlanRule) => ({
  code: p.code,
  name: p.name,
  boardLimit: p.boardLimit,
  boardsPerPack: p.boardsPerPack,
  minRefreshSeconds: p.minRefreshSeconds,
  features: p.features,
  priceMonthly: p.priceMonthly,
  priceAnnual: p.priceAnnual,
  packPriceMonthly: p.packPriceMonthly,
  packPriceAnnual: p.packPriceAnnual,
});

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    let plans: Record<string, PlanRule> = DEFAULT_PLANS;
    let source = 'defaults';
    let salesOpen = false;
    const sql = getDb();
    if (sql) {
      try {
        await ensureSchema(sql);
        plans = await loadPlans(sql);
        source = 'database';
        // Paid plans are on sale to everyone once plan limits apply to everyone.
        salesOpen = paddleConfigured() && (await loadEnforcement(sql)).mode === 'all';
      } catch (e) {
        console.error('[pricing] falling back to default plans', e);
      }
    }
    const order = ['free', 'pro', 'board'];
    return json(
      200,
      { currency: 'USD', source, salesOpen, plans: order.filter((c) => plans[c]).map((c) => publicPlan(plans[c])) },
      // Short cache so admin edits show within a minute.
      { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    );
  },
};
