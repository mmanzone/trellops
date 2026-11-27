/**
 * POST /api/improvePrompt
 *
 * Rewrites an admin's custom summary instructions into a tighter prompt.
 * Node.js runtime on Vercel Fluid compute, same model setup as /api/summarize.
 */
import { generateText, gateway, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { requireSession } from './_lib/session.js';

export const config = { maxDuration: 30 };

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

function resolveModel(): { model: LanguageModel; providerOptions: Record<string, any> } {
  const modelId = process.env.AI_SUMMARY_MODEL || DEFAULT_MODEL;
  const google = modelId.startsWith('gemini-3')
    ? { thinkingConfig: { thinkingLevel: 'minimal' } }
    : { thinkingConfig: { thinkingBudget: 0 } };

  if (process.env.AI_GATEWAY_API_KEY || process.env.AI_USE_GATEWAY === 'true') {
    return { model: gateway(modelId.includes('/') ? modelId : `google/${modelId}`), providerOptions: { google } };
  }
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Google Generative AI API key is missing. Add GOOGLE_GENERATIVE_AI_API_KEY (or AI_GATEWAY_API_KEY) to your environment variables and redeploy.',
    );
  }
  return { model: createGoogleGenerativeAI({ apiKey })(modelId), providerOptions: { google } };
}

const SYSTEM_PROMPT = `You are a prompt engineering expert.
Take the user's raw instruction (meant for another AI that summarises a set of Trello cards) and improve it.

The underlying AI summarises Trello cards using creation/completion status, titles, short descriptions, labels, members, comment snippets and locations, plus pre-computed counts.
Rewrite the user's instruction into a single, directive paragraph that keeps the user's intent and establishes the exact tone, focus and format they asked for.

Return only the improved prompt, with no preamble or quotes.`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function handlePost(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const rawPrompt = body?.rawPrompt;
    if (!rawPrompt || typeof rawPrompt !== 'string') {
      return json(400, { error: 'rawPrompt is required and must be a string' });
    }

    const { model, providerOptions } = resolveModel();
    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: `Raw user instruction to improve:\n\n${rawPrompt.slice(0, 4000)}`,
      temperature: 0.4,
      maxOutputTokens: 400,
      maxRetries: 2,
      providerOptions,
      abortSignal: request.signal,
    });

    return json(200, { improvedPrompt: text.trim() });
  } catch (error: any) {
    console.error('[improvePrompt] error', error);
    return json(error?.statusCode || 500, { error: error?.message || 'Internal Server Error' });
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
