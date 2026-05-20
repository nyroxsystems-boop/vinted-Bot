// ──────────────────────────────────────────────────────────────────────────────
// Trend → CJ-Search Translator
//
// Vinted-scraped trends are in German (locale='de') and use Vinted's local
// vocabulary ("Y2K-Crop-Top", "Bomberjacke"). CJ-Search expects English
// product-style keywords ("crop top", "bomber jacket"). We feed the trend
// through Gemini-Flash to bridge the gap.
//
// Caching strategy:
//   • If a trend already has cj_query set, skip the LLM call entirely.
//   • Failures fall back to raw passthrough (keyword as-is) so the worker
//     never blocks on LLM downtime — a worse query is better than no query.
//
// Cost: Gemini 2.5 Flash with thinkingBudget=0 is ~$0 on the free tier.
// One translation per (keyword, locale) per lifetime → effectively zero.
// ──────────────────────────────────────────────────────────────────────────────

import {
  callLLM,
  parseLLMJson,
  createLogger,
  setTrendCjQuery,
  type VintedTrend,
} from '@vinted-system/shared';

const log = createLogger('trend-to-cj-mapper');

export interface CJTranslation {
  cj_query: string;
  cj_filter: Record<string, unknown>;
}

const SYSTEM_PROMPT = [
  'You are an e-commerce search translator.',
  'You convert German Vinted fashion keywords into English CJ-Dropshipping search queries.',
  'Output ONLY a single JSON object, no prose, no markdown fences.',
  'Shape:',
  '{"cj_query": "<english search keywords, 1-4 words, lowercase>",',
  ' "cj_filter": {"category_first": "<broad CJ category like Women Clothing or Accessories or Shoes>",',
  '               "max_price_usd": <integer 5..40 if obviously low-cost, else omit>}}',
  '',
  'Rules:',
  '- cj_query MUST be product-style keywords a Chinese supplier would index on.',
  '- If the input is a brand name (e.g. "Zara", "Nike"), translate it into the category most often shopped under that brand (e.g. "Zara" → "trendy women top").',
  '- Never wrap the JSON in code fences. Never add a leading sentence.',
].join('\n');

function buildUserPrompt(trend: VintedTrend): string {
  const cat = trend.category_path ?? '(unknown)';
  return [
    `trend_type: ${trend.trend_type}`,
    `keyword: ${trend.keyword}`,
    `locale: ${trend.locale ?? 'de'}`,
    `category_path: ${cat}`,
    '',
    'Return the JSON now.',
  ].join('\n');
}

/**
 * Translate one Vinted trend → CJ-Search query. Uses Gemini-Flash by default
 * (cheap, free-tier-friendly). On any failure path returns the raw keyword
 * passthrough so callers never need to special-case null.
 *
 * Cache behaviour: if `trend.cj_query` is already populated, returns it
 * unchanged and DOES NOT call the LLM. Callers can force-refresh by
 * clearing cj_query first (or via direct setTrendCjQuery()).
 */
export async function translateTrendToCJ(trend: VintedTrend): Promise<CJTranslation> {
  // Cache hit — reuse stored translation.
  if (trend.cj_query && trend.cj_query.trim().length > 0) {
    let filter: Record<string, unknown> = {};
    if (trend.cj_filter_json) {
      try {
        const parsed = JSON.parse(trend.cj_filter_json);
        if (parsed && typeof parsed === 'object') filter = parsed as Record<string, unknown>;
      } catch {
        /* ignore malformed cached filter */
      }
    }
    return { cj_query: trend.cj_query, cj_filter: filter };
  }

  const fallback: CJTranslation = {
    cj_query: trend.keyword.toLowerCase().trim(),
    cj_filter: {},
  };

  let text: string | null = null;
  try {
    text = await callLLM({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(trend),
      // Prefer Gemini for cost — falls back to whatever the user configured.
      provider: 'gemini',
      maxTokens: 200,
      timeoutMs: 20_000,
    });
  } catch (err) {
    log.warn('LLM call threw', { err: err instanceof Error ? err.message : String(err) });
  }

  if (!text) return fallback;

  const parsed = parseLLMJson<{
    cj_query?: unknown;
    cj_filter?: Record<string, unknown>;
  }>(text);

  if (!parsed || typeof parsed.cj_query !== 'string' || parsed.cj_query.trim().length === 0) {
    log.warn('LLM returned no usable cj_query — falling back to raw keyword', {
      keyword: trend.keyword,
      raw: text.slice(0, 200),
    });
    return fallback;
  }

  const cjQuery = String(parsed.cj_query).trim().toLowerCase().slice(0, 120);
  const cjFilter: Record<string, unknown> =
    parsed.cj_filter && typeof parsed.cj_filter === 'object' ? parsed.cj_filter : {};

  // Persist back into the DB so subsequent calls are free.
  if (trend.id !== undefined) {
    try {
      setTrendCjQuery(trend.id, cjQuery, cjFilter);
    } catch (err) {
      log.warn('setTrendCjQuery failed', {
        id: trend.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { cj_query: cjQuery, cj_filter: cjFilter };
}

/**
 * Translate many trends in parallel with a small concurrency cap. The cap
 * exists so we don't fan out 50 simultaneous Gemini calls and hit the
 * 15 RPM free-tier ceiling. Order of the returned array matches `trends`.
 */
export async function translateTrendBatch(
  trends: VintedTrend[],
  concurrency = 3,
): Promise<CJTranslation[]> {
  const results: CJTranslation[] = new Array(trends.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];

  const launch = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= trends.length) return;
      const trend = trends[idx];
      if (!trend) continue;
      try {
        results[idx] = await translateTrendToCJ(trend);
      } catch (err) {
        log.warn('translateTrendToCJ failed', {
          keyword: trend.keyword,
          err: err instanceof Error ? err.message : String(err),
        });
        results[idx] = { cj_query: trend.keyword.toLowerCase().trim(), cj_filter: {} };
      }
    }
  };

  const cap = Math.max(1, Math.min(8, concurrency));
  for (let i = 0; i < cap; i++) workers.push(launch());
  await Promise.all(workers);
  return results;
}
