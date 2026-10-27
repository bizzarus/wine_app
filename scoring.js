// Pure scoring & filtering logic. No DOM, no network — unit-tested in Node.

export const COLORS = ['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified', 'orange', 'unknown'];

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

/** Normalise a wine identity into a stable cache key. */
export function wineKey(w) {
  const norm = (s) => (s || '')
    .toString()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const vintage = w.vintage ? String(w.vintage) : 'nv';
  return `${norm(w.producer)}|${norm(w.name)}|${vintage}`;
}

/** Price the customer actually pays on the shelf (promo wins). */
export function effectiveShelfPrice(b) {
  const p = [b.promo_price, b.shelf_price].find((x) => typeof x === 'number' && x > 0);
  if (p == null) return null;
  // Normalise to 750 ml so magnums / 375 ml don't distort value.
  const vol = typeof b.volume_ml === 'number' && b.volume_ml > 0 ? b.volume_ml : 750;
  return { price: p, per750: (p * 750) / vol };
}

/** Matches the type preference. "other" covers dessert/fortified/orange/unknown. */
export function matchesType(color, types) {
  if (!types || types.length === 0 || types.includes('any')) return true;
  const c = color || 'unknown';
  if (types.includes(c)) return true;
  if (types.includes('other') && ['dessert', 'fortified', 'orange', 'unknown'].includes(c)) return true;
  return false;
}

export function filterCandidates(bottles, prefs) {
  const { types, minPrice, maxPrice, includeUnpriced } = prefs;
  return bottles.filter((b) => {
    if (!matchesType(b.color, types)) return false;
    const sp = effectiveShelfPrice(b);
    if (!sp) return !!includeUnpriced;
    if (minPrice != null && sp.price < minPrice) return false;
    if (maxPrice != null && sp.price > maxPrice) return false;
    return true;
  });
}

/**
 * Market reference price in RON for a 750 ml bottle.
 * Local Romanian retail (if found) is more relevant than international averages,
 * so it wins; otherwise the international average in EUR is converted.
 */
export function marketReferenceRon(info, rates) {
  if (!info) return null;
  if (typeof info.local_price_ron === 'number' && info.local_price_ron > 0) {
    return { value: info.local_price_ron, basis: 'Romanian online retail' };
  }
  if (typeof info.market_price_eur === 'number' && info.market_price_eur > 0) {
    return { value: info.market_price_eur * (rates?.EUR || 5.0), basis: 'international average' };
  }
  return null;
}

/** Quality on 0..1 from Vivino-style 5-point rating and/or 100-point critic score. */
export function qualityScore(info) {
  if (!info) return { q: null, known: false };
  const parts = [];
  if (typeof info.rating === 'number' && info.rating > 0) {
    let q = clamp((info.rating - 3.2) / (4.4 - 3.2));
    // Bayesian shrink toward a mediocre prior when there are few ratings.
    const n = typeof info.rating_count === 'number' ? info.rating_count : 20;
    const w = n / (n + 50);
    q = w * q + (1 - w) * 0.4;
    parts.push({ q, weight: 0.7 });
  }
  if (typeof info.critic_score === 'number' && info.critic_score > 50) {
    parts.push({ q: clamp((info.critic_score - 82) / (95 - 82)), weight: 0.3 });
  }
  if (!parts.length) return { q: null, known: false };
  const tw = parts.reduce((s, p) => s + p.weight, 0);
  return { q: parts.reduce((s, p) => s + p.q * p.weight, 0) / tw, known: true };
}

/** ratio = market / shelf; 1 = fair, 2 = half price, 0.5 = double price. */
export function valueScore(ratio) {
  if (!(ratio > 0)) return null;
  return clamp(0.5 + Math.log2(ratio) / 2);
}

export const PRIORITY_WEIGHTS = {
  value: { v: 0.65, q: 0.35 },
  balanced: { v: 0.5, q: 0.5 },
  quality: { v: 0.2, q: 0.8 },
};

export function scoreWine(bottle, info, prefs, rates) {
  const sp = effectiveShelfPrice(bottle);
  const market = marketReferenceRon(info, rates);
  const ratio = sp && market ? market.value / sp.per750 : null;
  const v = valueScore(ratio);
  const { q, known } = qualityScore(info);
  const w = PRIORITY_WEIGHTS[prefs.priority] || PRIORITY_WEIGHTS.balanced;

  const vEff = v ?? 0.4; // unknown value is slightly penalised, not ignored
  const qEff = known ? q : 0.3; // unknown quality is penalised harder
  let score = w.v * vEff + w.q * qEff;

  // Identification / match confidence: a great score on the wrong wine is worthless.
  const idConf = clamp(bottle.confidence ?? 0.7);
  const matchConf = clamp(info?.match_confidence ?? 0.5);
  score *= 0.55 + 0.45 * Math.min(idConf, matchConf);
  if (info && info.vintage_matched === false) score *= 0.95;

  return {
    score,
    ratio,
    valueScore: v,
    qualityScore: known ? q : null,
    market,
    shelf: sp,
    flags: {
      noMarket: !market,
      noRating: !known,
      lowConfidence: Math.min(idConf, matchConf) < 0.5,
    },
  };
}

/** Rank and return the top N distinct wines. */
export function recommend(bottles, infoByKey, prefs, rates, n = 3) {
  const scored = bottles.map((b) => {
    const info = infoByKey[wineKey(b)] || null;
    return { bottle: b, info, ...scoreWine(b, info, prefs, rates) };
  });
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const top = [];
  for (const s of scored) {
    const k = wineKey(s.bottle);
    if (seen.has(k)) continue;
    seen.add(k);
    top.push(s);
    if (top.length >= n) break;
  }
  return { top, all: scored };
}

/** Plain-language reasons for a pick. */
export function reasons(s, fmt = (x) => x.toFixed(0)) {
  const out = [];
  if (s.ratio != null && s.market) {
    const pct = Math.round((1 - 1 / s.ratio) * 100);
    if (pct >= 5) out.push(`${pct}% below its usual price (about ${fmt(s.market.value)} lei, ${s.market.basis})`);
    else if (pct <= -5) out.push(`${-pct}% above its usual price (about ${fmt(s.market.value)} lei)`);
    else out.push(`Priced in line with the market (about ${fmt(s.market.value)} lei)`);
  } else {
    out.push('No reliable market price found');
  }
  const i = s.info || {};
  if (typeof i.rating === 'number') {
    const n = i.rating_count ? ` from ${Number(i.rating_count).toLocaleString('en-US')} ratings` : '';
    out.push(`Rated ${i.rating.toFixed(1)}/5${n}`);
  }
  if (typeof i.critic_score === 'number') {
    out.push(`${i.critic_score} pts${i.critic_source ? ` (${i.critic_source})` : ''}`);
  }
  if (s.flags.lowConfidence) out.push('Identification is uncertain, check the label');
  return out;
}

/** Robustly pull the last JSON object out of model text. */
export function extractJson(text) {
  if (!text) throw new Error('Empty model response');
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.map((m) => m[1]).reverse();
  candidates.push(text);
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start < 0) continue;
    // Balanced-brace scan, string-aware.
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(c.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw new Error('Could not find valid JSON in the model response');
}
