/**
 * POST /api/summarize
 *
 * Streams an AI summary of the Trello cards in the selected statistics period.
 *
 * Runtime: Node.js on Vercel Fluid compute (not Edge). Fluid keeps warm
 * instances alive and lets one instance serve many concurrent streams, so the
 * in-memory cache below survives between requests, and we can use the Vercel
 * Runtime Cache for a cache that is shared across instances and regions.
 *
 * Speedups compared to the previous Edge implementation:
 *  - Fast model with "thinking" disabled (Gemini 2.5 Flash thinks by default,
 *    which added seconds before the first token).
 *  - Two-level cache keyed on a SHA-256 of model + prompt + card data, so the
 *    same board/period/prompt is answered instantly without calling the model.
 *  - Stats (counts, top labels/members, locations) are computed here instead of
 *    asking the model to count, and cards are sent as compact lines instead of
 *    JSON, which cuts input tokens substantially.
 *  - Output is capped, temperature lowered, and transient provider errors are
 *    retried server-side (and, through AI Gateway, can fall back to another
 *    model) instead of the browser waiting 2s between blind retries.
 */
import { streamText, gateway, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getCache, waitUntil } from '@vercel/functions';
import { requireSession } from './_lib/session.js';

// Vercel function settings. No `runtime` is set, so this runs on Node.js (Fluid compute).
export const config = { maxDuration: 60 };

// Bump when the system prompt or payload format changes, to invalidate caches.
const PROMPT_VERSION = 'v2';
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h; card data is part of the key, so stale data never matches
const MAX_CARDS = 400;
const MAX_OUTPUT_TOKENS = 700;

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = 'gemini-2.5-flash';

function resolveModel(): { model: LanguageModel; modelId: string; providerOptions: Record<string, any> } {
  const modelId = process.env.AI_SUMMARY_MODEL || DEFAULT_MODEL;

  // Disable/minimise "thinking": a summary of structured data does not need it,
  // and it is the single biggest source of time-to-first-token.
  const google = modelId.startsWith('gemini-3')
    ? { thinkingConfig: { thinkingLevel: 'minimal' } }
    : { thinkingConfig: { thinkingBudget: 0 } };

  // AI Gateway (opt-in): set AI_GATEWAY_API_KEY, or AI_USE_GATEWAY=true to use
  // the project's OIDC token on Vercel. Gives automatic provider failover and
  // observability in the Vercel dashboard.
  const useGateway = !!process.env.AI_GATEWAY_API_KEY || process.env.AI_USE_GATEWAY === 'true';
  if (useGateway) {
    const id = modelId.includes('/') ? modelId : `google/${modelId}`;
    const fallback = `google/${FALLBACK_MODEL}`;
    return {
      model: gateway(id),
      modelId: id,
      providerOptions: { google, gateway: { models: id === fallback ? [] : [fallback] } },
    };
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      500,
      'Google Generative AI API key is missing. Add GOOGLE_GENERATIVE_AI_API_KEY (or AI_GATEWAY_API_KEY) to your environment variables and redeploy.',
    );
  }
  return { model: createGoogleGenerativeAI({ apiKey })(modelId), modelId, providerOptions: { google } };
}

// ---------------------------------------------------------------------------
// Cache: per-instance memory (instant) + Vercel Runtime Cache (shared)
// ---------------------------------------------------------------------------

const memoryCache = new Map<string, { text: string; expires: number }>();
const MEMORY_CACHE_MAX = 200;

function memoryGet(key: string): string | null {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  // Refresh LRU position
  memoryCache.delete(key);
  memoryCache.set(key, hit);
  return hit.text;
}

function memorySet(key: string, text: string) {
  memoryCache.set(key, { text, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
  while (memoryCache.size > MEMORY_CACHE_MAX) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

function runtimeCache() {
  try {
    return getCache({ namespace: 'ai-summary' });
  } catch {
    return null;
  }
}

async function cacheGet(key: string): Promise<string | null> {
  const mem = memoryGet(key);
  if (mem) return mem;
  try {
    const value = await runtimeCache()?.get(key);
    if (typeof value === 'string' && value) {
      memorySet(key, value);
      return value;
    }
  } catch (e) {
    console.warn('[summarize] runtime cache get failed', e);
  }
  return null;
}

async function cacheSet(key: string, text: string) {
  memorySet(key, text);
  try {
    await runtimeCache()?.set(key, text, { ttl: CACHE_TTL_SECONDS, tags: ['ai-summary'], name: 'ai-summary' });
  } catch (e) {
    console.warn('[summarize] runtime cache set failed', e);
  }
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Payload shaping
// ---------------------------------------------------------------------------

type InCard = {
  name?: string;
  desc?: string;
  labels?: string[];
  members?: string[];
  comments?: string[];
  commentsCount?: number;
  coords?: { lat: number; lng: number };
  created?: boolean;
  completed?: boolean;
};

const clip = (s: unknown, n: number) => {
  const str = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

function topCounts(values: string[], limit: number): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, c]) => `${k} (${c})`)
    .join(', ');
}

/** Pre-computes the numbers so the model describes them instead of counting tokens itself. */
function buildStats(cards: InCard[]): string {
  const created = cards.filter((c) => c.created).length;
  const completed = cards.filter((c) => c.completed).length;
  const lines = [`Cards in period: ${cards.length} (created: ${created}, completed: ${completed})`];

  const labels = topCounts(cards.flatMap((c) => c.labels || []), 8);
  if (labels) lines.push(`Top labels: ${labels}`);
  const members = topCounts(cards.flatMap((c) => c.members || []), 8);
  if (members) lines.push(`Most involved members: ${members}`);

  const located = cards.filter((c) => c.coords);
  if (located.length) {
    // Bucket to ~10km cells to show where activity concentrates.
    const cells = topCounts(
      located.map((c) => `${c.coords!.lat.toFixed(1)},${c.coords!.lng.toFixed(1)}`),
      5,
    );
    lines.push(`Cards with location: ${located.length}; busiest areas (lat,lng ~10km): ${cells}`);
  }
  return lines.join('\n');
}

/** One compact line per card; much cheaper than JSON for the model to read. */
function cardLine(c: InCard): string {
  const flags = [c.created ? 'new' : '', c.completed ? 'done' : ''].filter(Boolean).join('+') || '-';
  const parts = [`[${flags}] ${clip(c.name, 120)}`];
  if (c.labels?.length) parts.push(`labels: ${c.labels.slice(0, 6).map((l) => clip(l, 30)).join(', ')}`);
  if (c.members?.length) parts.push(`members: ${c.members.slice(0, 6).map((m) => clip(m, 40)).join(', ')}`);
  if (c.desc) parts.push(`desc: ${clip(c.desc, 80)}`);
  if (c.comments?.length) {
    parts.push(`comments (${c.commentsCount || c.comments.length}): ${c.comments.slice(0, 3).map((t) => `"${clip(t, 100)}"`).join(' ')}`);
  } else if (c.commentsCount) {
    parts.push(`comments: ${c.commentsCount}`);
  }
  if (c.coords) parts.push(`at ${c.coords.lat.toFixed(2)},${c.coords.lng.toFixed(2)}`);
  return `- ${parts.join(' | ')}`;
}

/** Busiest cards first, so the model sees what matters and truncation drops the quiet ones. */
function activityScore(c: InCard) {
  return (c.commentsCount || c.comments?.length || 0) * 2 + (c.members?.length || 0);
}

function buildSystemPrompt(periodLabel: string, diffDays: number, customPrompt: string) {
  let system = `You are an analyst embedded in a Trello statistics dashboard.
Summarise the cards created and completed during the period "${periodLabel}" (${Math.round(diffDays)} days).

Write ONE concise paragraph (max ~150 words) covering:
1. Volume: cards created vs completed (use the provided numbers exactly).
2. Main themes or trends from titles, descriptions and labels.
3. Notable cards with the most activity (comments, members); quote short comment snippets or name members where useful.
4. If locations are provided, where activity is concentrated.
${diffDays > 31 ? '5. A brief week-over-week trend.\n' : ''}
No greetings, no headings, no preamble. Use Markdown bold for emphasis.`;

  if (customPrompt) {
    system += `\n\nADDITIONAL INSTRUCTIONS FROM THE BOARD ADMIN (take priority over the format above):\n${clip(customPrompt, 2000)}`;
  }
  return system;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function handlePost(request: Request): Promise<Response> {
  const started = Date.now();
  try {
    const body = await request.json().catch(() => null);
    const cardsData: InCard[] | undefined = body?.cardsData;
    if (!Array.isArray(cardsData)) {
      return json(400, { error: 'cardsData is required and must be an array' });
    }

    const periodLabel = clip(body.periodLabel, 100) || 'selected period';
    const diffDays = Number(body.diffDays) || 0;
    const customPrompt = typeof body.customPromptContext === 'string' ? body.customPromptContext.trim() : '';
    const force = body.force === true;

    const cards = [...cardsData].sort((a, b) => activityScore(b) - activityScore(a));
    const shown = cards.slice(0, MAX_CARDS);

    const system = buildSystemPrompt(periodLabel, diffDays, customPrompt);
    const prompt = `STATS\n${buildStats(cards)}\n\nCARDS${
      cards.length > shown.length ? ` (${shown.length} most active of ${cards.length})` : ''
    }\n${shown.map(cardLine).join('\n')}`;

    const { model, modelId, providerOptions } = resolveModel();
    const cacheKey = await sha256(`${PROMPT_VERSION}\n${modelId}\n${system}\n${prompt}`);
    const baseHeaders = { 'X-Summary-Model': modelId, 'Cache-Control': 'no-store' };

    if (!force) {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        return new Response(cached, {
          headers: { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'X-Summary-Cache': 'HIT' },
        });
      }
    }

    const result = streamText({
      model,
      system,
      prompt,
      temperature: 0.3,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxRetries: 2,
      providerOptions,
      abortSignal: request.signal,
      onFinish: ({ text, finishReason, usage }) => {
        console.log(
          `[summarize] ${modelId} ${finishReason} in ${Date.now() - started}ms, ` +
            `in=${usage.inputTokens} out=${usage.outputTokens} cards=${cards.length}`,
        );
        if (text && (finishReason === 'stop' || finishReason === 'length')) {
          waitUntil(cacheSet(cacheKey, text));
        }
      },
      onError: ({ error }) => console.error('[summarize] stream error', error),
    });

    // Wait for the first token before committing to a 200 response, so provider
    // errors (overload, quota, bad key) still reach the browser as a real error
    // status instead of an empty 200 stream.
    const iterator = result.fullStream[Symbol.asyncIterator]();
    let first = '';
    for (;;) {
      const { value: part, done } = await iterator.next();
      if (done) break;
      if (part.type === 'error') throw part.error;
      if (part.type === 'text-delta' && part.text) {
        first = part.text;
        break;
      }
    }
    const ttft = Date.now() - started;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (first) controller.enqueue(encoder.encode(first));
      },
      async pull(controller) {
        try {
          // Skip non-text parts until we have something to enqueue (a pull that
          // enqueues nothing would not be called again and stall the stream).
          for (;;) {
            const { value: part, done } = await iterator.next();
            if (done) return controller.close();
            if (part.type === 'error') return controller.error(part.error);
            if (part.type === 'text-delta' && part.text) return controller.enqueue(encoder.encode(part.text));
          }
        } catch (e) {
          controller.error(e);
        }
      },
      async cancel() {
        await iterator.return?.();
      },
    });

    return new Response(stream, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Summary-Cache': 'MISS',
        'Server-Timing': `ttft;dur=${ttft}`,
      },
    });
  } catch (error: any) {
    console.error('[summarize] error', error);
    let message = error?.message || 'Internal Server Error';
    if (error?.name === 'AI_RetryError' || error?.name === 'AI_APICallError') {
      message = error.lastError?.message || error.cause?.message || message;
    }
    const status = error instanceof HttpError ? error.status : error?.statusCode || error?.lastError?.statusCode || 500;
    return json(status, { error: message });
  }
}

// Web-standard handler (Node.js runtime on Fluid compute).
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: 'POST' },
      });
    }
    // Signed-in Trellops users only (open until SESSION_SECRET is set).
    const gate = await requireSession(request);
    if ('response' in gate) return gate.response;
    return handlePost(request);
  },
};
