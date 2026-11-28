/**
 * Who may use what. One rule drives every gate in the app:
 *
 *   rights on a board = the best of (the member's own plan, an active Board
 *   plan on that board if they are a Trello member of it, any admin override)
 *
 * Plan limits and features live in the `plans` table. While enforcement is off
 * (the default until launch) everyone gets every feature, but the answer still
 * says which plan they are really on, so the admin page and tests can see it.
 */
import { getDb, ensureSchema } from './db.js';

type Sql = NonNullable<ReturnType<typeof getDb>>;

export const ALL_FEATURES = ['map', 'stats', 'tasks', 'ai', 'share', 'export', 'slideshow', 'keepScreenOn', 'sync'] as const;
export type Feature = (typeof ALL_FEATURES)[number];

export interface PlanRule {
  code: string;
  name: string;
  boardLimit: number;
  boardsPerPack: number;
  minRefreshSeconds: number;
  features: string[];
  /** US dollars; null when not sold (shown as "Free"). */
  priceMonthly: number | null;
  priceAnnual: number | null;
  /** Pro only: price of each extra pack of boards. */
  packPriceMonthly: number | null;
  packPriceAnnual: number | null;
}

/** Same values as the seed in db/schema.sql; used when the database is not reachable. */
export const DEFAULT_PLANS: Record<string, PlanRule> = {
  free: {
    code: 'free', name: 'Free', boardLimit: 1, boardsPerPack: 0, minRefreshSeconds: 3600, features: [],
    priceMonthly: 0, priceAnnual: 0, packPriceMonthly: null, packPriceAnnual: null,
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    boardLimit: 5,
    boardsPerPack: 5,
    minRefreshSeconds: 60,
    features: ['map', 'stats', 'tasks', 'ai', 'share', 'export', 'slideshow', 'keepScreenOn', 'sync'],
    priceMonthly: 5,
    priceAnnual: 50,
    packPriceMonthly: 5,
    packPriceAnnual: 50,
  },
  board: {
    code: 'board',
    name: 'Board plan',
    boardLimit: 0,
    boardsPerPack: 0,
    minRefreshSeconds: 60,
    features: ['map', 'stats', 'tasks', 'ai', 'slideshow', 'keepScreenOn'],
    priceMonthly: 10,
    priceAnnual: 100,
    packPriceMonthly: null,
    packPriceAnnual: null,
  },
};

/** The refresh floor the app had before plans existed; kept while enforcement is off. */
export const LEGACY_MIN_REFRESH_SECONDS = 15;

/** Membership of a Board plan board is re-confirmed with Trello after this long. */
export const MEMBERSHIP_TTL_HOURS = 24;

// --- Enforcement switch ------------------------------------------------------

export type EnforcementMode = 'off' | 'test' | 'all';
export interface Enforcement {
  mode: EnforcementMode;
  /** Trello member ids that see real plan limits while mode is 'test'. */
  testMemberIds: string[];
}

export const DEFAULT_ENFORCEMENT: Enforcement = { mode: 'off', testMemberIds: [] };

export function parseEnforcement(value: any): Enforcement {
  const mode: EnforcementMode = value?.mode === 'test' || value?.mode === 'all' ? value.mode : 'off';
  const ids = Array.isArray(value?.testMemberIds) ? value.testMemberIds : [];
  return {
    mode,
    testMemberIds: ids.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id)).map((id: string) => id.toLowerCase()),
  };
}

export const isEnforcedFor = (enforcement: Enforcement, memberId: string): boolean =>
  enforcement.mode === 'all' || (enforcement.mode === 'test' && enforcement.testMemberIds.includes(memberId.toLowerCase()));

// --- The access rule (pure, unit tested) -------------------------------------

export interface UserPlan {
  code: 'free' | 'pro';
  /** free, paid (Paddle), trial (time-limited override) or override (admin grant). */
  source: 'free' | 'paid' | 'trial' | 'override';
  packs: number;
  expiresAt: string | null;
}

export interface BoardPlan {
  source: 'paid' | 'override';
}

export interface BoardState {
  id: string;
  /** An active Board plan exists on this board. */
  hasBoardPlan: boolean;
  /** Trello confirmed this member belongs to the (private) board. */
  member: boolean;
}

export interface Entitlements {
  enforced: boolean;
  plan: 'free' | 'pro';
  planSource: UserPlan['source'];
  planName: string;
  trialEndsAt: string | null;
  packs: number;
  boardLimit: number | null;
  boardsPerPack: number;
  boardsUsed: number;
  minRefreshSeconds: number;
  features: string[];
  board: null | {
    id: string;
    coveredByBoardPlan: boolean;
    /** False when the member is over their board limit and must remove a board first. */
    allowed: boolean;
  };
}

export interface ComputeInput {
  plans: Record<string, PlanRule>;
  userPlan: UserPlan;
  enforced: boolean;
  /** Active boards this member uses that are not covered by a Board plan. */
  countedBoardIds: string[];
  board?: BoardState | null;
}

export function computeEntitlements({ plans, userPlan, enforced, countedBoardIds, board }: ComputeInput): Entitlements {
  const own = plans[userPlan.code] || DEFAULT_PLANS[userPlan.code];
  const boardRule = plans.board || DEFAULT_PLANS.board;
  const covered = !!board && board.hasBoardPlan && board.member;

  const boardLimit = own.boardLimit + (userPlan.code === 'pro' ? own.boardsPerPack * Math.max(0, userPlan.packs) : 0);
  const features = new Set(own.features);
  let minRefreshSeconds = own.minRefreshSeconds;
  if (covered) {
    boardRule.features.forEach((f) => features.add(f));
    minRefreshSeconds = Math.min(minRefreshSeconds, boardRule.minRefreshSeconds);
  }

  let allowed = true;
  if (board && !covered) {
    const index = countedBoardIds.indexOf(board.id);
    if (index === -1) allowed = countedBoardIds.length < boardLimit;
    else allowed = countedBoardIds.length <= boardLimit;
  }

  const base = {
    plan: userPlan.code,
    planSource: userPlan.source,
    planName: own.name,
    trialEndsAt: userPlan.source === 'trial' ? userPlan.expiresAt : null,
    packs: userPlan.packs,
    boardsPerPack: own.boardsPerPack,
    boardsUsed: countedBoardIds.length,
  };

  if (!enforced) {
    return {
      ...base,
      enforced: false,
      boardLimit: null,
      minRefreshSeconds: LEGACY_MIN_REFRESH_SECONDS,
      features: [...ALL_FEATURES],
      board: board ? { id: board.id, coveredByBoardPlan: covered, allowed: true } : null,
    };
  }
  return {
    ...base,
    enforced: true,
    boardLimit,
    minRefreshSeconds,
    features: ALL_FEATURES.filter((f) => features.has(f)),
    board: board ? { id: board.id, coveredByBoardPlan: covered, allowed } : null,
  };
}

// --- Database reads ----------------------------------------------------------

const ACTIVE_OVERRIDE = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`;
// A cancelled or unpaid plan keeps working until the end of the paid period.
const ACTIVE_SUBSCRIPTION = `(status IN ('active', 'trialing', 'past_due') OR (current_period_end IS NOT NULL AND current_period_end > NOW()))`;

const money = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export async function loadPlans(sql: Sql): Promise<Record<string, PlanRule>> {
  const rows = (await sql.query(
    `SELECT code, name, board_limit, boards_per_pack, min_refresh_seconds, features,
            price_monthly, price_annual, pack_price_monthly, pack_price_annual
     FROM plans WHERE active`,
  )) as any[];
  const plans: Record<string, PlanRule> = { ...DEFAULT_PLANS };
  for (const r of rows) {
    plans[r.code] = {
      code: r.code,
      name: r.name,
      boardLimit: Number(r.board_limit),
      boardsPerPack: Number(r.boards_per_pack),
      minRefreshSeconds: Number(r.min_refresh_seconds),
      features: Array.isArray(r.features) ? r.features : [],
      priceMonthly: money(r.price_monthly),
      priceAnnual: money(r.price_annual),
      packPriceMonthly: money(r.pack_price_monthly),
      packPriceAnnual: money(r.pack_price_annual),
    };
  }
  return plans;
}

export async function loadEnforcement(sql: Sql): Promise<Enforcement> {
  const rows = (await sql.query(`SELECT value FROM app_settings WHERE key = 'enforcement'`)) as any[];
  return rows[0] ? parseEnforcement(rows[0].value) : DEFAULT_ENFORCEMENT;
}

export async function loadUserPlan(sql: Sql, memberId: string): Promise<UserPlan> {
  const paid = (await sql.query(
    `SELECT pack_quantity FROM subscriptions
     WHERE kind = 'user' AND trello_member_id = $1 AND plan_code = 'pro' AND ${ACTIVE_SUBSCRIPTION}`,
    [memberId],
  )) as any[];
  const granted = (await sql.query(
    `SELECT pack_quantity, reason, expires_at FROM overrides
     WHERE target_type = 'user' AND target_id = $1 AND plan_code = 'pro' AND ${ACTIVE_OVERRIDE}`,
    [memberId],
  )) as any[];
  if (!paid.length && !granted.length) return { code: 'free', source: 'free', packs: 0, expiresAt: null };

  const packs = Math.max(0, ...paid.map((r) => Number(r.pack_quantity) || 0), ...granted.map((r) => Number(r.pack_quantity) || 0));
  if (paid.length) return { code: 'pro', source: 'paid', packs, expiresAt: null };
  const permanent = granted.find((r) => r.reason !== 'Trial' && !r.expires_at);
  if (permanent) return { code: 'pro', source: 'override', packs, expiresAt: null };
  // Latest expiry wins; a trial is reported as such so the app can count it down.
  const latest = granted.reduce((a, b) => (new Date(a.expires_at) > new Date(b.expires_at) ? a : b));
  return {
    code: 'pro',
    source: latest.reason === 'Trial' ? 'trial' : 'override',
    packs,
    expiresAt: latest.expires_at ? new Date(latest.expires_at).toISOString() : null,
  };
}

/** Boards with an active Board plan (paid or granted), from a list of ids. */
export async function boardsWithBoardPlan(sql: Sql, boardIds: string[]): Promise<Set<string>> {
  if (!boardIds.length) return new Set();
  const rows = (await sql.query(
    `SELECT board_id AS id FROM subscriptions WHERE kind = 'board' AND board_id = ANY($1) AND ${ACTIVE_SUBSCRIPTION}
     UNION
     SELECT target_id AS id FROM overrides WHERE target_type = 'board' AND target_id = ANY($1) AND ${ACTIVE_OVERRIDE}`,
    [boardIds],
  )) as any[];
  return new Set(rows.map((r) => r.id));
}

export async function activeBoards(sql: Sql, memberId: string): Promise<Array<{ board_id: string; member_checked_at: string | null }>> {
  return (await sql.query(
    `SELECT board_id, member_checked_at FROM user_boards
     WHERE trello_member_id = $1 AND removed_at IS NULL ORDER BY first_seen_at`,
    [memberId],
  )) as any[];
}

// --- Trello membership check -------------------------------------------------

const DEFAULT_TRELLO_API_KEY = '558e200650487a28cf1cc0b33561cd82';

/**
 * True when Trello says this member belongs to the board and the board is not
 * public (Board plans cover private boards only). Uses the member's own token,
 * sent with the request and never stored.
 */
export async function checkBoardMembership(
  boardId: string,
  memberId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const key = process.env.TRELLO_API_KEY || DEFAULT_TRELLO_API_KEY;
  const url = `https://api.trello.com/1/boards/${boardId}?fields=prefs&members=all&member_fields=id&key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const data: any = await res.json();
    if (data?.prefs?.permissionLevel === 'public') return false;
    return Array.isArray(data?.members) && data.members.some((m: any) => m?.id === memberId);
  } catch {
    return false;
  }
}

// --- Putting it together -----------------------------------------------------

export interface ResolveOptions {
  boardId?: string | null;
  /** The member's Trello token, used only to confirm Board plan membership. */
  trelloToken?: string | null;
  fetchImpl?: typeof fetch;
}

export async function resolveEntitlements(sql: Sql, memberId: string, opts: ResolveOptions = {}): Promise<Entitlements> {
  await ensureSchema(sql);
  const boardId = opts.boardId ? opts.boardId.toLowerCase() : null;
  const [plans, enforcement, userPlan, boards] = await Promise.all([
    loadPlans(sql),
    loadEnforcement(sql),
    loadUserPlan(sql, memberId),
    activeBoards(sql, memberId),
  ]);

  const ids = boards.map((b) => b.board_id);
  const covered = await boardsWithBoardPlan(sql, boardId && !ids.includes(boardId) ? [...ids, boardId] : ids);

  // Board plans count only for boards Trello confirmed this member belongs to.
  const fresh = (checkedAt: string | null) =>
    !!checkedAt && Date.now() - new Date(checkedAt).getTime() < MEMBERSHIP_TTL_HOURS * 3600 * 1000;
  const coveredForMember = new Set(boards.filter((b) => covered.has(b.board_id) && fresh(b.member_checked_at)).map((b) => b.board_id));

  let board: BoardState | null = null;
  if (boardId) {
    let member = coveredForMember.has(boardId);
    if (covered.has(boardId) && !member && opts.trelloToken) {
      member = await checkBoardMembership(boardId, memberId, opts.trelloToken, opts.fetchImpl);
      if (member) {
        await sql.query(
          `INSERT INTO user_boards (trello_member_id, board_id, member_checked_at) VALUES ($1, $2, NOW())
           ON CONFLICT (trello_member_id, board_id) DO UPDATE SET member_checked_at = NOW()`,
          [memberId, boardId],
        );
        coveredForMember.add(boardId);
      }
    }
    board = { id: boardId, hasBoardPlan: covered.has(boardId), member };
  }

  return computeEntitlements({
    plans,
    userPlan,
    enforced: isEnforcedFor(enforcement, memberId),
    countedBoardIds: ids.filter((id) => !coveredForMember.has(id)),
    board,
  });
}

/**
 * Route gate for a feature. Returns null when allowed, or a 403 Response.
 * Stays open without a database or session, like requireSession.
 */
export async function requireFeature(memberId: string | null, feature: Feature, boardId?: string | null): Promise<Response | null> {
  if (!memberId) return null;
  const sql = getDb();
  if (!sql) return null;
  try {
    const ent = await resolveEntitlements(sql, memberId, { boardId: boardId && /^[0-9a-f]{24}$/i.test(boardId) ? boardId : null });
    if (ent.features.includes(feature)) return null;
    return new Response(JSON.stringify({ error: 'This feature needs Trellops Pro.', code: 'NEEDS_PRO', feature }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('[entitlements] check failed; allowing the request', e);
    return null;
  }
}
