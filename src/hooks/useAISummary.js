/**
 * useAISummary
 *
 * Streams an AI summary from /api/summarize using the Vercel AI SDK's
 * `useCompletion` hook, with a browser-side cache in front of it.
 *
 * - The request body is hashed (SHA-256) and the finished summary is stored in
 *   localStorage, so re-opening the same board/period/prompt shows the summary
 *   instantly without a network call.
 * - The server keeps its own cache too (shared by every admin of the board).
 * - Rendering is throttled so Markdown is not re-parsed on every token.
 */
import { useCallback, useRef, useState } from 'react';
import { useCompletion } from '@ai-sdk/react';

const CACHE_PREFIX = 'TRELLOPS_AI_SUMMARY_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 30;

const sha256 = async (text) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
};

const readCache = (key) => {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (!entry?.text || Date.now() - entry.at > CACHE_TTL_MS) {
            localStorage.removeItem(CACHE_PREFIX + key);
            return null;
        }
        return entry.text;
    } catch {
        return null;
    }
};

const writeCache = (key, text) => {
    try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ text, at: Date.now() }));
        // Keep only the newest entries.
        const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
        if (keys.length > CACHE_MAX_ENTRIES) {
            keys
                .map(k => {
                    try { return [k, JSON.parse(localStorage.getItem(k))?.at || 0]; } catch { return [k, 0]; }
                })
                .sort((a, b) => a[1] - b[1])
                .slice(0, keys.length - CACHE_MAX_ENTRIES)
                .forEach(([k]) => localStorage.removeItem(k));
        }
    } catch {
        // Storage full or disabled: caching is best-effort.
    }
};

const friendlyError = (err) => {
    let detail = err?.message || String(err);
    try {
        detail = JSON.parse(detail).error || detail;
    } catch { /* not JSON */ }
    const billing = /credit|billing|quota|insufficient|funds|payment|exhausted/i.test(detail);
    const headline = billing
        ? 'The AI provider account has run out of credit or quota. An admin needs to top it up before summaries can be generated.'
        : 'The AI model could not produce a summary right now. This is usually temporary, please try again shortly.';
    return `*${headline}*\n\n<details><summary>Developer Info</summary>${detail}</details>`;
};

export const useAISummary = () => {
    const [source, setSource] = useState(null); // 'browser' | 'server' | 'live' | null
    const [errorText, setErrorText] = useState('');
    const cacheKeyRef = useRef(null);

    const { completion, complete, setCompletion, isLoading, stop } = useCompletion({
        api: '/api/summarize',
        streamProtocol: 'text',
        experimental_throttle: 50,
        fetch: async (input, init) => {
            const res = await fetch(input, init);
            setSource(res.headers.get('X-Summary-Cache') === 'HIT' ? 'server' : 'live');
            return res;
        },
        onFinish: (_prompt, text) => {
            if (text && cacheKeyRef.current) writeCache(cacheKeyRef.current, text);
        },
        onError: (err) => setErrorText(friendlyError(err)),
    });

    /**
     * @param {object} body   { cardsData, periodLabel, diffDays, customPromptContext }
     * @param {object} opts   { force: true } skips both caches
     */
    const generate = useCallback(async (body, { force = false } = {}) => {
        setErrorText('');
        const key = await sha256(JSON.stringify(body));
        cacheKeyRef.current = key;

        if (!force) {
            const cached = readCache(key);
            if (cached) {
                setCompletion(cached);
                setSource('browser');
                return;
            }
        }

        setSource(null);
        setCompletion('');
        await complete('', { body: { ...body, force } });
    }, [complete, setCompletion]);

    return {
        summaryText: errorText || completion,
        isGenerating: isLoading,
        source,
        generate,
        stop,
    };
};
