// Orchestration: photo(s) → bottles → filtered candidates → cached/web lookup.

import { ask, ClaudeError } from './claude.js';
import { EXTRACT_SYSTEM, extractUserText, LOOKUP_SYSTEM, lookupUserText } from './prompts.js';
import { extractJson, wineKey, COLORS } from './scoring.js';
import * as db from './db.js';

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && isFinite(+x.replace(',', '.')) ? +x.replace(',', '.') : null);

function cleanBottle(b, i) {
  const color = COLORS.includes(b.color) ? b.color : 'unknown';
  let bbox = Array.isArray(b.bbox) && b.bbox.length === 4 ? b.bbox.map(Number) : null;
  if (bbox && bbox.some((v) => !isFinite(v))) bbox = null;
  return {
    idx: i,
    photo: Number.isInteger(b.photo) ? b.photo : 0,
    producer: b.producer || null,
    name: b.name || null,
    grapes: Array.isArray(b.grapes) ? b.grapes.filter(Boolean) : [],
    vintage: Number.isInteger(+b.vintage) && +b.vintage > 1900 ? +b.vintage : null,
    region: b.region || null,
    country: b.country || null,
    color,
    sweetness: b.sweetness || null,
    volume_ml: num(b.volume_ml),
    shelf_price: num(b.shelf_price),
    promo_price: num(b.promo_price),
    price_tag_text: b.price_tag_text || null,
    facings: Number.isInteger(b.facings) ? b.facings : 1,
    bbox,
    confidence: Math.max(0, Math.min(1, num(b.confidence) ?? 0.5)),
  };
}

export function label(b) {
  const main = [b.producer, b.name].filter(Boolean).join(' ');
  return main || (b.grapes?.length ? b.grapes.join(' / ') : 'Unidentified wine');
}

/** Step 3: read the shelf. */
export async function extract(photos, settings, signal) {
  const content = [];
  photos.forEach((p, i) => {
    if (photos.length > 1) content.push({ type: 'text', text: `Photo ${i}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } });
  });
  content.push({ type: 'text', text: extractUserText(photos.length) });

  const res = await ask(settings.apiKey, {
    model: settings.visionModel,
    system: EXTRACT_SYSTEM,
    content,
    effort: settings.visionEffort,
    maxTokens: 24000,
    signal,
  });
  const json = extractJson(res.text);
  const bottles = (json.bottles || []).map(cleanBottle);
  return { bottles, storeHint: json.store_hint || null, usage: res.usage };
}

function searchTool(variant, maxUses) {
  const base = {
    name: 'web_search',
    max_uses: maxUses,
    user_location: { type: 'approximate', country: 'RO', city: 'Bucharest', timezone: 'Europe/Bucharest' },
  };
  if (variant === 'dynamic') return { type: 'web_search_20260318', ...base, response_inclusion: 'excluded' };
  if (variant === 'direct') return { type: 'web_search_20260318', ...base, allowed_callers: ['direct'] };
  return { type: 'web_search_20250305', ...base };
}

let toolVariant = 'dynamic'; // downgraded automatically if the model/account rejects it

async function lookupBatch(items, settings, signal) {
  const variants = ['dynamic', 'direct', 'basic'];
  for (let v = variants.indexOf(toolVariant); v < variants.length; v++) {
    try {
      const res = await ask(settings.apiKey, {
        model: settings.lookupModel,
        system: LOOKUP_SYSTEM,
        content: [{ type: 'text', text: lookupUserText(items) }],
        tools: [searchTool(variants[v], Math.min(20, items.length * 3 + 2))],
        effort: settings.lookupEffort,
        maxTokens: 16000,
        signal,
      });
      toolVariant = variants[v];
      const json = extractJson(res.text);
      return { wines: json.wines || [], citations: res.citations, usage: res.usage };
    } catch (e) {
      const toolProblem = e instanceof ClaudeError && e.status === 400 && /tool|caller|web_search|code_execution/i.test(e.message);
      if (toolProblem && v < variants.length - 1) continue;
      throw e;
    }
  }
}

function cleanInfo(w) {
  const sources = Array.isArray(w.sources)
    ? w.sources.filter((s) => s && /^https?:\/\//.test(s.url)).slice(0, 6)
    : [];
  return {
    matched_name: w.matched_name || null,
    rating: num(w.rating) != null && num(w.rating) <= 5 ? num(w.rating) : null,
    rating_count: num(w.rating_count),
    rating_source: w.rating_source || null,
    critic_score: num(w.critic_score) != null && num(w.critic_score) <= 100 ? Math.round(num(w.critic_score)) : null,
    critic_source: w.critic_source || null,
    market_price_eur: num(w.market_price_eur),
    price_low_eur: num(w.price_low_eur),
    price_high_eur: num(w.price_high_eur),
    local_price_ron: num(w.local_price_ron),
    vintage_matched: typeof w.vintage_matched === 'boolean' ? w.vintage_matched : null,
    review_summary: w.review_summary || null,
    pairing: w.pairing || null,
    sources,
    match_confidence: Math.max(0, Math.min(1, num(w.match_confidence) ?? 0.5)),
  };
}

/**
 * Step 4–5: get info for each candidate from the local DB, else from the web.
 * onProgress({ key, state: 'cached'|'searching'|'done'|'failed', info })
 */
export async function lookup(candidates, settings, onProgress, signal) {
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
  const infoByKey = {};
  const ttl = settings.cacheDays * 864e5;

  // Unique wines only; skip those we can't identify at all.
  const unique = new Map();
  for (const b of candidates) {
    if (!b.producer && !b.name) continue;
    const k = wineKey(b);
    if (!unique.has(k)) unique.set(k, b);
  }

  const toFetch = [];
  for (const [k, b] of unique) {
    const hit = await db.getWine(k);
    if (hit && Date.now() - hit.fetchedAt < ttl && !settings.forceRefresh) {
      infoByKey[k] = hit.info;
      onProgress?.({ key: k, state: 'cached', info: hit.info });
    } else {
      toFetch.push([k, b]);
    }
  }

  const BATCH = 4;
  const batches = [];
  for (let i = 0; i < toFetch.length; i += BATCH) batches.push(toFetch.slice(i, i + BATCH));

  let next = 0;
  const errors = [];
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const items = batch.map(([k, b], j) => ({ ...b, _id: `w${j}`, _key: k }));
      items.forEach((it) => onProgress?.({ key: it._key, state: 'searching' }));
      try {
        const r = await lookupBatch(items, settings, signal);
        usage.input_tokens += r.usage.input_tokens;
        usage.output_tokens += r.usage.output_tokens;
        usage.web_search_requests += r.usage.web_search_requests;
        for (const it of items) {
          const w = r.wines.find((x) => x.id === it._id);
          if (!w) { onProgress?.({ key: it._key, state: 'failed' }); continue; }
          const info = { ...cleanInfo(w), citations: r.citations.slice(0, 10) };
          infoByKey[it._key] = info;
          await db.putWine(it._key, info, label(it));
          onProgress?.({ key: it._key, state: 'done', info });
        }
      } catch (e) {
        if (signal?.aborted) throw e;
        errors.push(e);
        items.forEach((it) => onProgress?.({ key: it._key, state: 'failed' }));
        if (e instanceof ClaudeError && (e.status === 401 || e.status === 403)) throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  if (errors.length && errors.length === batches.length && batches.length > 0) throw errors[0];
  return { infoByKey, usage, failed: errors.length };
}
