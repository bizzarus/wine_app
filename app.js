// Oeno — pick a wine from the supermarket shelf.
// UI controller: screens are pure render functions; events use data-action delegation.

import * as db from './db.js';
import { prepare } from './image.js';
import { extract, lookup, label } from './pipeline.js';
import { testKey, estimateCost } from './claude.js';
import { filterCandidates, recommend, reasons, wineKey, effectiveShelfPrice, scoreWine } from './scoring.js';
import { demoShelfDataUrl, demoBottles, demoInfo } from './demo.js';

/* ------------------------------------------------------------------ settings */

const MODELS = {
  'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', in: 2, out: 10 },
  'claude-opus-5-5': { name: 'Claude Opus 5.5', in: 4, out: 20 },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5', in: 0.1, out: 0.5 },
};

const DEFAULTS = {
  apiKey: '',
  visionModel: 'claude-sonnet-5-5',
  visionEffort: 'medium',
  lookupModel: 'claude-haiku-5-5',
  lookupEffort: 'medium',
  maxLookups: 16,
  cacheDays: 30,
  eurRon: 5.35,
  includeUnpriced: false,
  lastPrefs: { types: ['red'], minPrice: null, maxPrice: null, priority: 'balanced' },
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('oeno.settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem('oeno.settings', JSON.stringify(settings)); } catch {}
}
let settings = loadSettings();

/* ------------------------------------------------------------------ state */

const fresh = () => ({
  photos: [],
  extraction: { status: 'idle', bottles: [], storeHint: null, error: null, usage: null },
  prefs: structuredClone(settings.lastPrefs),
  prefsSubmitted: false,
  lookup: { status: 'idle', progress: {}, infoByKey: {}, usage: null, error: null, capped: null, failed: 0 },
  results: null,
  demo: false,
  saved: false,
  abort: null,
});

let screen = 'home';
let S = fresh();
let homeStats = { wines: 0, scans: 0 };
let historyTab = 'scans';
let historyData = { scans: [], wines: [] };
let sortBy = 'score';

/* ------------------------------------------------------------------ helpers */

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet-root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lei = (n) => (n == null ? '–' : n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const lei0 = (n) => Math.round(n).toLocaleString('ro-RO');
const TYPE_LABEL = { red: 'Red', white: 'White', rose: 'Rosé', sparkling: 'Sparkling', dessert: 'Dessert', fortified: 'Fortified', orange: 'Orange', unknown: 'Unknown' };
const TYPE_COLOR = { red: 'var(--red)', white: 'var(--white)', rose: 'var(--rose)', sparkling: 'var(--sparkling)', other: 'var(--other)', dessert: 'var(--other)', fortified: 'var(--other)', orange: 'var(--other)', unknown: '#ccc' };
const stars = (r) => {
  const full = Math.round(r * 2) / 2;
  return '★'.repeat(Math.floor(full)) + (full % 1 ? '½' : '') + '☆'.repeat(5 - Math.ceil(full));
};

const ICON = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="#1f7a4d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  db: '<svg viewBox="0 0 24 24" fill="none" stroke="#5b6c66" stroke-width="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="#c4303a" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="#c9d3c8"/></svg>',
};

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function go(next) {
  screen = next;
  render();
  window.scrollTo(0, 0);
}

function topBar(title, sub, { back, right } = {}) {
  return `<header class="top">
    ${back ? `<button class="icon-btn" data-action="${back}" aria-label="Back">${ICON.back}</button>` : ''}
    <h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>
    ${right || ''}
  </header>`;
}

/* ------------------------------------------------------------------ screens */

function viewHome() {
  const needsKey = !settings.apiKey;
  const bottleColors = ['var(--red)', 'var(--white)', 'var(--red)', 'var(--sparkling)', 'var(--rose)', 'var(--white)', 'var(--red)', 'var(--sparkling)'];
  const heights = [74, 66, 80, 70, 62, 76, 68, 72];
  return `${topBar('Oeno', 'Pick a wine from the shelf', {
    right: `<button class="icon-btn" data-action="history" aria-label="Your wines and past scans">${ICON.book}</button>
            <button class="icon-btn" data-action="settings" aria-label="Settings">${ICON.gear}</button>`,
  })}
  <main class="page">
    ${needsKey ? `<div class="notice">Add your Anthropic API key in <button class="link-btn" data-action="settings">Settings</button> to scan real shelves. You can try the demo shelf now.</div>` : ''}
    <button class="hero-scan" data-action="${needsKey ? 'settings' : 'take-photo'}">
      <div class="bottles" aria-hidden="true">${heights.map((h, i) => `<i style="height:${h}px;background:${bottleColors[i]}"></i>`).join('')}</div>
      <div class="shelf-edge" aria-hidden="true"></div>
      <strong>Scan the shelf</strong>
      <span>Take a photo of the wines in front of you</span>
    </button>
    <div class="stats">
      <div><b>${homeStats.wines}</b>wines in your list</div>
      <div><b>${homeStats.scans}</b>shelves scanned</div>
    </div>
    <h2 class="section-title">How it works</h2>
    <ol class="tips">
      <li>Photograph the shelf, price tags included. Add more photos for a long shelf.</li>
      <li>Choose type, price range and what matters most while the photo is read.</li>
      <li>Get 2–3 picks with ratings, usual price and where they are on the shelf.</li>
    </ol>
    <p style="display:flex;gap:22px;flex-wrap:wrap">
      ${needsKey ? '' : '<button class="link-btn" data-action="pick-photo">Use a photo you already took</button>'}
      <button class="link-btn" data-action="demo">Try the demo shelf</button>
    </p>
  </main>`;
}

function viewCapture() {
  const shots = S.photos.map((p, i) => `<div class="shot"><img src="${p.previewUrl}" alt="Shelf photo ${i + 1}"><button data-action="remove-photo" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join('');
  const busy = S.photos.some((p) => !p.prepared);
  return `${topBar('Your shelf', `${S.photos.length} photo${S.photos.length === 1 ? '' : 's'}`, { back: 'home' })}
  <main class="page">
    <div class="shots">
      ${shots}
      ${S.photos.length < 4 ? `<button class="shot add" data-action="take-photo">${ICON.camera}<br>Add another section</button>` : ''}
    </div>
    ${S.photos.length < 4 ? '<p><button class="link-btn" data-action="pick-photo">Add from your photos</button></p>' : ''}
    <ul class="tips">
      <li>Hold the phone straight, about one step back, so labels and price tags are both readable.</li>
      <li>For a long shelf, take one photo per section. Overlap is fine.</li>
    </ul>
  </main>
  <div class="bar">
    <button class="btn primary" data-action="analyze" ${!S.photos.length || busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> Preparing photo' : 'Read the shelf'}</button>
  </div>`;
}

function progressCard() {
  const e = S.extraction;
  if (e.status === 'running') {
    return `<div class="progress-card"><div class="spinner" aria-hidden="true"></div><div class="meter"><div class="label">Reading labels and price tags…</div><div class="track"><div class="fill indeterminate"></div></div></div></div>`;
  }
  if (e.status === 'done') {
    const priced = e.bottles.filter((b) => effectiveShelfPrice(b));
    const ps = priced.map((b) => effectiveShelfPrice(b).price);
    const range = ps.length ? ` · ${lei0(Math.min(...ps))}–${lei0(Math.max(...ps))} lei` : '';
    const byType = {};
    e.bottles.forEach((b) => { byType[b.color] = (byType[b.color] || 0) + 1; });
    const typeStr = Object.entries(byType).map(([t, n]) => `${n} ${TYPE_LABEL[t].toLowerCase()}`).join(', ');
    return `<div class="progress-card">${ICON.check}<div class="meter"><div class="label"><b>${e.bottles.length} wines found</b>${range}<br><span style="color:#a9c2b8;font-size:14px">${esc(typeStr)}</span></div></div></div>`;
  }
  if (e.status === 'error') {
    return `<div class="notice error"><b>Couldn't read the shelf.</b> ${esc(e.error)}<br><button class="link-btn" data-action="retry-extract">Try again</button></div>`;
  }
  return '';
}

function countMatching() {
  if (S.extraction.status !== 'done') return null;
  return filterCandidates(S.extraction.bottles, { ...S.prefs, includeUnpriced: settings.includeUnpriced }).length;
}

function viewPrefs() {
  const p = S.prefs;
  const types = [['red', 'Red'], ['white', 'White'], ['rose', 'Rosé'], ['sparkling', 'Sparkling'], ['other', 'Other']];
  const presets = [[null, 30, 'Under 30'], [30, 60, '30–60'], [60, 100, '60–100'], [100, null, '100+'], [null, null, 'Any price']];
  const pr = [
    ['value', 'Best deal', 'Biggest gap between its usual price and this shelf'],
    ['balanced', 'Balanced', 'Good ratings at a fair price'],
    ['quality', 'Best rated', 'Highest ratings within my budget'],
  ];
  const n = countMatching();
  const waiting = S.prefsSubmitted && S.extraction.status === 'running';
  return `${topBar('What are you after?', S.demo ? 'Demo shelf' : '', { back: 'cancel' })}
  <main class="page">
    ${progressCard()}
    <h2>Type</h2>
    <div class="chips" role="group" aria-label="Wine type">
      ${types.map(([k, l]) => `<button class="chip" data-action="toggle-type" data-v="${k}" aria-pressed="${p.types.includes(k)}"><span class="dot" style="background:${TYPE_COLOR[k]}"></span>${l}</button>`).join('')}
    </div>
    <h2>Price on the shelf</h2>
    <div class="price-row">
      <label class="field"><small>From</small><input inputmode="decimal" data-input="minPrice" value="${p.minPrice ?? ''}" placeholder="0" aria-label="Minimum price"><span>lei</span></label>
      <label class="field"><small>To</small><input inputmode="decimal" data-input="maxPrice" value="${p.maxPrice ?? ''}" placeholder="any" aria-label="Maximum price"><span>lei</span></label>
    </div>
    <div class="chips" style="margin-top:10px">
      ${presets.map(([a, b, l]) => `<button class="chip plain" data-action="preset" data-a="${a ?? ''}" data-b="${b ?? ''}" aria-pressed="${(p.minPrice ?? null) === a && (p.maxPrice ?? null) === b}">${l}</button>`).join('')}
    </div>
    <h2>What matters most</h2>
    <div class="seg" role="group" aria-label="Priority">
      ${pr.map(([k, t, d]) => `<button data-action="priority" data-v="${k}" aria-pressed="${p.priority === k}"><b>${t}</b><span>${d}</span></button>`).join('')}
    </div>
    ${n != null ? `<p class="hint">${n} wine${n === 1 ? '' : 's'} on this shelf match${n === 1 ? 'es' : ''} your type and price.</p>` : ''}
  </main>
  <div class="bar">
    <button class="btn primary" data-action="submit-prefs" ${p.types.length === 0 || n === 0 || S.extraction.status === 'error' ? 'disabled' : ''}>
      ${waiting ? '<span class="spinner"></span> Waiting for the shelf' : 'Find my wines'}
    </button>
  </div>`;
}

function viewLookup() {
  const L = S.lookup;
  const cands = currentCandidates();
  const items = cands.map((b) => {
    const k = wineKey(b);
    const st = L.progress[k] || 'waiting';
    const icon = { cached: ICON.db, done: ICON.check, failed: ICON.x, searching: '<span class="spinner" style="width:18px;height:18px;border-width:2px;border-color:#c9d3c8;border-top-color:#173029"></span>' }[st] || ICON.dot;
    const sub = { cached: 'From your wine list', done: 'Ratings and prices found', failed: 'Lookup failed, scored on shelf data only', searching: 'Searching ratings and prices…', waiting: 'Queued' }[st];
    const sp = effectiveShelfPrice(b);
    return `<li><span class="state">${icon}</span><div class="grow"><div class="t">${esc(label(b))}${b.vintage ? ` ${b.vintage}` : ''}</div><div class="s">${sp ? lei(sp.price) + ' lei · ' : ''}${sub}</div></div></li>`;
  }).join('');
  const done = Object.values(L.progress).filter((s) => s !== 'searching').length;
  return `${topBar('Checking the wines', `${done} of ${cands.length} ready`, { back: 'cancel' })}
  <main class="page">
    ${L.error ? `<div class="notice error"><b>Lookup stopped.</b> ${esc(L.error)}<br><button class="link-btn" data-action="submit-prefs">Try again</button></div>` : ''}
    ${L.capped ? `<div class="notice">${L.capped.total} wines match. Checking the ${L.capped.shown} most clearly read ones to keep it quick. Narrow the price range to include all.</div>` : ''}
    <ul class="list lookup-list">${items}</ul>
  </main>`;
}

function pickCard(s, i) {
  const b = s.bottle, info = s.info || {};
  const sp = s.shelf;
  let delta = '';
  if (s.ratio != null) {
    const pct = Math.round((1 - 1 / s.ratio) * 100);
    const cls = pct >= 5 ? '' : pct <= -5 ? 'dear' : 'even';
    delta = `<div class="delta ${cls}"><b>${pct >= 5 ? '−' + pct + '%' : pct <= -5 ? '+' + -pct + '%' : '≈'}</b><small>vs usual<br>${lei0(s.market.value)} lei</small></div>`;
  } else {
    delta = `<div class="delta even"><b>?</b><small>usual price<br>not found</small></div>`;
  }
  const [int, dec] = lei(sp?.price).split(',');
  const why = reasons(s, lei0).map((r) => `<li>${esc(r)}</li>`).join('');
  return `<article class="pick">
    <div class="pick-head">
      <div class="rank" aria-label="Pick ${i + 1}">${i + 1}</div>
      <div>
        <h3>${esc(label(b))}${b.vintage ? ` ${b.vintage}` : ''}</h3>
        <div class="meta"><span class="type-dot" style="background:${TYPE_COLOR[b.color]}"></span>${TYPE_LABEL[b.color]}${b.grapes?.length ? ` · ${esc(b.grapes.join(', '))}` : ''}${b.region || b.country ? ` · ${esc([b.region, b.country].filter(Boolean).join(', '))}` : ''}</div>
      </div>
    </div>
    <div class="tag" role="img" aria-label="Shelf price ${lei(sp?.price)} lei">
      <div class="price"><span class="n">${int ?? '–'}${dec ? `<sup>,${dec}</sup>` : ''}</span><span class="cur">lei</span>
        ${b.promo_price && b.shelf_price && b.promo_price < b.shelf_price ? `<span class="was">Promo, was ${lei(b.shelf_price)} lei</span>` : ''}
      </div>
      ${delta}
    </div>
    <div class="scores">
      ${typeof info.rating === 'number' ? `<div class="score"><b>${info.rating.toFixed(1)}</b> <span class="stars" aria-hidden="true">${stars(info.rating)}</span><span>${info.rating_count ? info.rating_count.toLocaleString('en-US') + ' ratings' : 'rating'}${info.rating_source ? ' · ' + esc(info.rating_source) : ''}</span></div>` : ''}
      ${typeof info.critic_score === 'number' ? `<div class="score"><b>${info.critic_score}</b><span>critic pts${info.critic_source ? ' · ' + esc(info.critic_source) : ''}</span></div>` : ''}
    </div>
    <ul class="why">${why}</ul>
    ${info.review_summary ? `<p class="review">${esc(info.review_summary)}${info.pairing ? ` <b>With:</b> ${esc(info.pairing)}` : ''}</p>` : ''}
    ${info.vintage_matched === false ? '<span class="flag">Ratings are for another vintage</span>' : ''}
    <div class="pick-actions">
      ${b.bbox ? `<button class="link-btn" data-action="show-shelf" data-idx="${b.idx}">Show on shelf</button>` : ''}
      <button class="link-btn" data-action="details" data-idx="${b.idx}">Details and sources</button>
      <button class="link-btn" data-action="fix" data-idx="${b.idx}">Wrong wine?</button>
    </div>
  </article>`;
}

function viewResults() {
  const R = S.results;
  if (!R) return viewHome();
  const picks = R.top.length
    ? R.top.map(pickCard).join('')
    : `<div class="notice">No wines on this shelf match. Try a wider price range or another type.</div>`;

  const candKeys = new Set(currentCandidates().map((b) => b.idx));
  const all = S.extraction.bottles.map((b) => {
    const info = S.lookup.infoByKey[wineKey(b)] || null;
    return { bottle: b, info, ...scoreWine(b, info, S.prefs, { EUR: settings.eurRon }), included: candKeys.has(b.idx) };
  });
  const sorters = {
    score: (a, b) => (b.included - a.included) || (b.score - a.score),
    price: (a, b) => (a.shelf?.price ?? 1e9) - (b.shelf?.price ?? 1e9),
    rating: (a, b) => (b.info?.rating ?? 0) - (a.info?.rating ?? 0),
    value: (a, b) => (b.ratio ?? 0) - (a.ratio ?? 0),
  };
  all.sort(sorters[sortBy]);
  const rows = all.map((s) => {
    const pct = s.ratio != null ? Math.round((1 - 1 / s.ratio) * 100) : null;
    return `<tr class="${s.included ? '' : 'excluded'}">
      <td><button data-action="details" data-idx="${s.bottle.idx}"><span class="type-dot" style="background:${TYPE_COLOR[s.bottle.color]}"></span>${esc(label(s.bottle))}${s.bottle.vintage ? ' ' + s.bottle.vintage : ''}</button></td>
      <td class="num">${s.shelf ? lei(s.shelf.price) : '–'}</td>
      <td class="num">${typeof s.info?.rating === 'number' ? s.info.rating.toFixed(1) : '–'}</td>
      <td class="num">${pct == null ? '–' : (pct > 0 ? '−' : '+') + Math.abs(pct) + '%'}</td>
    </tr>`;
  }).join('');

  const u = S.lookup.usage, eu = S.extraction.usage;
  let cost = '';
  if (!S.demo && (u || eu)) {
    const c = (eu ? estimateCost(eu, MODELS[settings.visionModel]) : 0) + (u ? estimateCost(u, MODELS[settings.lookupModel]) : 0);
    cost = `<p class="cost">This scan: about $${c.toFixed(2)} in API usage${u ? `, ${u.web_search_requests} web searches` : ''}.</p>`;
  }
  return `${topBar(R.top.length ? 'Your picks' : 'No match', S.extraction.storeHint ? S.extraction.storeHint : (S.demo ? 'Demo shelf, fictional wines' : ''), { back: 'home' })}
  <main class="page">
    ${S.lookup.failed ? `<div class="notice">Some lookups failed; those wines were scored on shelf data only.</div>` : ''}
    ${picks}
    <h2 class="section-title">Everything on the shelf</h2>
    <div class="sortbar" role="group" aria-label="Sort">
      ${[['score', 'Best match'], ['value', 'Best deal'], ['rating', 'Rating'], ['price', 'Price']].map(([k, l]) => `<button class="chip plain" data-action="sort" data-v="${k}" aria-pressed="${sortBy === k}">${l}</button>`).join('')}
    </div>
    <table class="all-table">
      <thead><tr><th>Wine</th><th class="num">Lei</th><th class="num">★</th><th class="num">vs usual</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">Greyed wines are outside your type or price filter.</p>
    ${cost}
  </main>
  <div class="bar">
    <button class="btn secondary" data-action="edit-prefs">Change filters</button>
    <button class="btn primary" data-action="new-scan">${ICON.camera} New scan</button>
  </div>`;
}

function viewHistory() {
  const tabs = `<div class="chips" style="margin-bottom:12px" role="tablist">
    <button class="chip plain" role="tab" data-action="htab" data-v="scans" aria-pressed="${historyTab === 'scans'}">Past scans</button>
    <button class="chip plain" role="tab" data-action="htab" data-v="wines" aria-pressed="${historyTab === 'wines'}">Wine list</button>
  </div>`;
  let body;
  if (historyTab === 'scans') {
    body = historyData.scans.length
      ? `<ul class="list">${historyData.scans.map((s) => `<li><button class="row" data-action="open-scan" data-id="${s.id}">
          ${s.thumb ? `<img src="${s.thumb}" alt="">` : ''}
          <span class="grow"><span class="t">${esc(s.topLabels?.[0] || 'No pick')}</span>
          <span class="s">${new Date(s.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${s.store ? ' · ' + esc(s.store) : ''} · ${s.bottles.length} wines</span></span></button></li>`).join('')}</ul>`
      : `<p class="lede">Your scans appear here after your first shelf.</p>`;
  } else {
    const ws = historyData.wines.slice().sort((a, b) => (b.info?.rating ?? 0) - (a.info?.rating ?? 0));
    body = ws.length
      ? `<ul class="list">${ws.map((w) => `<li><button class="row" data-action="wine-detail" data-key="${esc(w.key)}">
          <span class="grow"><span class="t">${esc(w.label)}</span>
          <span class="s">${typeof w.info?.rating === 'number' ? w.info.rating.toFixed(1) + '★ · ' : ''}${w.info?.local_price_ron ? 'usually ' + lei0(w.info.local_price_ron) + ' lei' : w.info?.market_price_eur ? 'usually ' + lei0(w.info.market_price_eur * settings.eurRon) + ' lei' : 'no price'} · checked ${new Date(w.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span></button></li>`).join('')}</ul>`
      : `<p class="lede">Every wine Oeno looks up is saved here, so the next scan of the same shelf is instant and free.</p>`;
  }
  return `${topBar('Your wines', '', { back: 'home' })}<main class="page">${tabs}${body}</main>`;
}

function viewSettings() {
  const opt = (sel, list) => list.map(([v, l]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${l}</option>`).join('');
  const models = Object.entries(MODELS).map(([k, m]) => [k, m.name]);
  const efforts = [['low', 'Low (fastest)'], ['medium', 'Medium'], ['high', 'High (slowest)']];
  return `${topBar('Settings', '', { back: 'home' })}
  <main class="page">
    <div class="form-row">
      <label for="k">Anthropic API key</label>
      <input id="k" type="password" autocomplete="off" spellcheck="false" data-setting="apiKey" value="${esc(settings.apiKey)}" placeholder="sk-ant-…">
      <p class="hint">Stored only on this phone and sent only to api.anthropic.com. Create one in the Claude Console and set a monthly spend limit there.</p>
      <button class="btn ghost" data-action="test-key" style="margin-top:6px;flex:none;width:100%">Test key</button>
    </div>
    <h2 class="section-title">Reading the shelf</h2>
    <div class="form-row"><label for="vm">Model</label><select id="vm" data-setting="visionModel">${opt(settings.visionModel, models)}</select></div>
    <div class="form-row"><label for="ve">Effort</label><select id="ve" data-setting="visionEffort">${opt(settings.visionEffort, efforts)}</select></div>
    <h2 class="section-title">Looking up ratings and prices</h2>
    <div class="form-row"><label for="lm">Model</label><select id="lm" data-setting="lookupModel">${opt(settings.lookupModel, models)}</select></div>
    <div class="form-row"><label for="le">Effort</label><select id="le" data-setting="lookupEffort">${opt(settings.lookupEffort, efforts)}</select></div>
    <div class="form-row"><label for="ml">Most wines to look up per scan</label><input id="ml" type="number" min="3" max="40" data-setting="maxLookups" value="${settings.maxLookups}"></div>
    <div class="form-row"><label for="cd">Reuse saved lookups for (days)</label><input id="cd" type="number" min="1" max="365" data-setting="cacheDays" value="${settings.cacheDays}"></div>
    <div class="form-row"><label for="fx">Euro rate (lei per €)</label><input id="fx" type="number" step="0.01" data-setting="eurRon" value="${settings.eurRon}"><p class="hint">Used to compare international prices with the shelf. Check the BNR rate occasionally.</p></div>
    <label class="toggle"><input type="checkbox" data-setting="includeUnpriced" ${settings.includeUnpriced ? 'checked' : ''}> Include wines whose price tag couldn't be read</label>
    <h2 class="section-title">Your data</h2>
    <div class="chips">
      <button class="chip plain" data-action="export">Export backup</button>
      <label class="chip plain" style="cursor:pointer">Import backup<input type="file" accept="application/json" data-action-change="import" class="sr"></label>
      <button class="chip plain" data-action="clear-data">Delete all saved wines</button>
    </div>
    <p class="hint" style="margin-top:24px">Ratings and prices are found by Claude with web search and can be wrong. Check the sources before relying on them.</p>
  </main>`;
}

function render() {
  const views = { home: viewHome, capture: viewCapture, prefs: viewPrefs, lookup: viewLookup, results: viewResults, settings: viewSettings, history: viewHistory };
  // Preserve focus/caret in price inputs while re-rendering.
  const active = document.activeElement?.dataset?.input;
  const caret = active ? document.activeElement.selectionStart : null;
  $app.innerHTML = (views[screen] || viewHome)();
  if (active) {
    const el = $app.querySelector(`[data-input="${active}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} }
  }
}

/* ------------------------------------------------------------------ sheets */

// Bottom sheet. Three ways to close it besides the backdrop:
//  - the close button (top right, stays visible while the content scrolls)
//  - a tap on the handle bar at the top
//  - a swipe down: always from the header; from the content when it is scrolled to the top
let sheetTimer = null;
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function openSheet(html) {
  clearTimeout(sheetTimer);
  $sheet.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet">
    <div class="sheet" role="dialog" aria-modal="true" tabindex="-1">
      <div class="sheet-head">
        <button class="grab-zone" data-action="dismiss-sheet" aria-label="Close"><span class="grab"></span></button>
        <button class="sheet-x" data-action="dismiss-sheet" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sheet-body">${html}</div>
    </div></div>`;
  document.body.classList.add('sheet-open');
  const sheet = $sheet.querySelector('.sheet');
  sheet.focus({ preventScroll: true });
  enableSwipe(sheet);
}

/** Immediate close (used before opening another sheet or changing screen). */
function closeSheet() {
  clearTimeout(sheetTimer);
  $sheet.innerHTML = '';
  document.body.classList.remove('sheet-open');
}

/** User-initiated close: slide down, then remove. */
function dismissSheet() {
  const sheet = $sheet.querySelector('.sheet');
  if (!sheet || reduceMotion()) return closeSheet();
  sheet.style.transition = 'transform .22s ease-in';
  sheet.style.transform = 'translateY(100%)';
  $sheet.querySelector('.sheet-backdrop').classList.add('leaving');
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(closeSheet, 220);
}

function enableSwipe(sheet) {
  const body = sheet.querySelector('.sheet-body');
  const head = sheet.querySelector('.sheet-head');
  let startY = 0, startT = 0, dy = 0, dragging = false, decided = false, fromHead = false;

  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    startT = Date.now();
    dy = 0; dragging = false; decided = false;
    fromHead = head.contains(e.target);
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    const d = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(d) < 6) return;
      decided = true;
      // Drag the sheet only when pulling down from the header, or from content already at its top.
      dragging = d > 0 && (fromHead || body.scrollTop <= 0);
      if (dragging) sheet.style.transition = 'none';
    }
    if (!dragging) return;
    e.preventDefault(); // stop the content from scrolling / rubber-banding while dragging
    dy = Math.max(0, d);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: false });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    const velocity = dy / Math.max(1, Date.now() - startT); // px per ms
    if (dy > Math.min(140, sheet.offsetHeight * 0.25) || (velocity > 0.5 && dy > 30)) {
      dismissSheet();
    } else {
      sheet.style.transition = 'transform .2s ease-out';
      sheet.style.transform = '';
    }
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

function photoFor(b) {
  const p = S.photos[b.photo] || S.photos[0];
  return p ? (p.previewUrl || p.thumb) : null;
}

function shelfSheet(idx) {
  const b = S.extraction.bottles.find((x) => x.idx === idx);
  const src = photoFor(b);
  if (!src) return;
  const picks = (S.results?.top || []).map((s) => s.bottle).filter((x) => x.photo === b.photo && x.bbox);
  const boxes = picks.map((x) => {
    const [x0, y0, x1, y1] = x.bbox.map((v) => Math.max(0, Math.min(1000, v)) / 10);
    const rank = S.results.top.findIndex((s) => s.bottle.idx === x.idx) + 1;
    return `<div class="box ${x.idx === idx ? '' : 'dim'}" style="left:${x0}%;top:${y0}%;width:${x1 - x0}%;height:${y1 - y0}%"><span class="lbl">${rank}</span></div>`;
  }).join('');
  openSheet(`<h3>${esc(label(b))}</h3><p class="hint" style="margin-top:0">Highlighted on your photo${S.photos.length > 1 ? ` (photo ${b.photo + 1})` : ''}. Position is approximate.</p>
    <div class="shelf-view"><img src="${src}" alt="Shelf photo">${boxes}</div>`);
}

function detailsSheet(b, info, extraNote = '') {
  const s = b ? scoreWine(b, info, S.prefs, { EUR: settings.eurRon }) : null;
  const rows = [];
  if (b) {
    const sp = effectiveShelfPrice(b);
    rows.push(['Shelf price', sp ? `${lei(sp.price)} lei${b.volume_ml && b.volume_ml !== 750 ? ` (${b.volume_ml} ml)` : ''}` : 'not read']);
    if (b.price_tag_text) rows.push(['Tag says', b.price_tag_text]);
  }
  if (info) {
    if (info.matched_name) rows.push(['Matched as', info.matched_name]);
    if (info.local_price_ron) rows.push(['Romanian retail', `about ${lei0(info.local_price_ron)} lei`]);
    if (info.market_price_eur) rows.push(['International', `about €${info.market_price_eur.toFixed(2)} (${lei0(info.market_price_eur * settings.eurRon)} lei)${info.price_low_eur && info.price_high_eur ? `, range €${info.price_low_eur}–${info.price_high_eur}` : ''}`]);
    if (typeof info.rating === 'number') rows.push(['Rating', `${info.rating.toFixed(1)}/5${info.rating_count ? ` (${info.rating_count.toLocaleString('en-US')})` : ''}${info.rating_source ? ', ' + info.rating_source : ''}`]);
    if (typeof info.critic_score === 'number') rows.push(['Critics', `${info.critic_score} pts${info.critic_source ? ', ' + info.critic_source : ''}`]);
    if (info.pairing) rows.push(['Goes with', info.pairing]);
    rows.push(['Match confidence', `${Math.round((info.match_confidence ?? 0) * 100)}%`]);
  }
  if (b) rows.push(['Label read confidence', `${Math.round(b.confidence * 100)}%`]);
  if (s) rows.push(['Score', `${Math.round(s.score * 100)} / 100`]);

  const srcList = [...(info?.sources || []), ...(info?.citations || [])];
  const seen = new Set();
  const srcHtml = srcList.filter((x) => x?.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 10)
    .map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a></li>`).join('');
  const name = b ? label(b) + (b.vintage ? ' ' + b.vintage : '') : info?.matched_name || 'Wine';
  openSheet(`<h3>${esc(name)}</h3>
    ${info?.review_summary ? `<p class="review">${esc(info.review_summary)}</p>` : ''}
    ${!info && b ? '<p class="hint">Not looked up: outside your filters, or the lookup failed.</p>' : ''}
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${srcHtml ? `<h2 class="section-title">Sources</h2><ul class="sources">${srcHtml}</ul>` : ''}
    ${extraNote}
    ${b ? `<button class="btn ghost" style="width:100%;margin-top:10px" data-action="fix" data-idx="${b.idx}">Wrong wine? Correct it</button>` : ''}`);
}

function fixSheet(idx) {
  const b = S.extraction.bottles.find((x) => x.idx === idx);
  const types = ['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified', 'orange', 'unknown'];
  openSheet(`<h3>Correct this wine</h3>
    <p class="hint" style="margin-top:0">Fix what the photo reading got wrong, then it is looked up again.</p>
    <form data-form="fix" data-idx="${idx}">
      <div class="form-row"><label>Producer</label><input type="text" name="producer" value="${esc(b.producer)}"></div>
      <div class="form-row"><label>Wine name / grape</label><input type="text" name="name" value="${esc(b.name)}"></div>
      <div class="form-row"><label>Vintage</label><input type="number" name="vintage" value="${b.vintage ?? ''}" placeholder="NV"></div>
      <div class="form-row"><label>Type</label><select name="color">${types.map((t) => `<option value="${t}" ${b.color === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select></div>
      <div class="form-row"><label>Shelf price (lei)</label><input type="text" inputmode="decimal" name="price" value="${b.promo_price ?? b.shelf_price ?? ''}"></div>
      <button class="btn primary" style="width:100%" type="submit">Save and look up again</button>
    </form>`);
}

/* ------------------------------------------------------------------ flow */

function pickFiles(fromLibrary = false) {
  document.querySelectorAll('input[data-picker]').forEach((x) => x.remove());
  const input = document.createElement('input');
  input.type = 'file';
  input.dataset.picker = '1';
  input.accept = 'image/*';
  if (!fromLibrary) input.capture = 'environment';
  input.style.display = 'none';
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const entry = { previewUrl: URL.createObjectURL(file), prepared: null };
    S.photos.push(entry);
    go('capture');
    try {
      const p = await prepare(file);
      URL.revokeObjectURL(entry.previewUrl);
      Object.assign(entry, { prepared: p, previewUrl: p.previewUrl, thumb: p.thumbDataUrl });
    } catch (e) {
      S.photos.splice(S.photos.indexOf(entry), 1);
      toast('That photo could not be opened. Try again.');
    }
    if (screen === 'capture') render();
  };
  document.body.appendChild(input);
  input.click();
}

async function runExtraction() {
  S.abort?.abort();
  S.abort = new AbortController();
  S.extraction = { status: 'running', bottles: [], storeHint: null, error: null, usage: null };
  render();
  try {
    const r = await extract(S.photos.map((p) => p.prepared), settings, S.abort.signal);
    if (!r.bottles.length) throw new Error('No wine bottles were recognised. Step a little closer and make sure labels are in focus.');
    S.extraction = { status: 'done', ...r, error: null };
    // Remember the shelf prices you saw (your own price history).
    r.bottles.forEach((b) => {
      const sp = effectiveShelfPrice(b);
      if (sp && (b.producer || b.name)) db.addObservation({ key: wineKey(b), label: label(b), price: sp.price, promo: !!b.promo_price, store: r.storeHint }).catch(() => {});
    });
  } catch (e) {
    if (S.abort.signal.aborted) return;
    S.extraction = { ...S.extraction, status: 'error', error: e.message };
  }
  if (screen === 'prefs') render();
  if (S.prefsSubmitted && S.extraction.status === 'done') runLookup();
}

function currentCandidates() {
  const all = filterCandidates(S.extraction.bottles, { ...S.prefs, includeUnpriced: settings.includeUnpriced });
  const sorted = all.slice().sort((a, b) => b.confidence - a.confidence);
  return sorted.slice(0, settings.maxLookups);
}

async function runLookup(forceKeys = null) {
  const all = filterCandidates(S.extraction.bottles, { ...S.prefs, includeUnpriced: settings.includeUnpriced });
  const cands = currentCandidates();
  const progress = {};
  if (forceKeys) cands.forEach((b) => { if (!forceKeys.includes(wineKey(b))) progress[wineKey(b)] = 'cached'; });
  S.lookup = { ...S.lookup, status: 'running', progress, error: null, failed: 0, capped: all.length > cands.length ? { shown: cands.length, total: all.length } : null };
  go('lookup');

  if (S.demo) {
    const info = demoInfo();
    for (const b of cands) {
      S.lookup.progress[wineKey(b)] = 'searching';
      render();
      await new Promise((r) => setTimeout(r, 160));
      S.lookup.infoByKey[wineKey(b)] = info[wineKey(b)];
      S.lookup.progress[wineKey(b)] = 'done';
    }
    return finish(cands);
  }

  S.abort?.abort();
  S.abort = new AbortController();
  try {
    const toLookup = forceKeys ? cands.filter((b) => forceKeys.includes(wineKey(b))) : cands;
    const r = await lookup(toLookup, { ...settings, forceRefresh: !!forceKeys }, ({ key, state, info }) => {
      S.lookup.progress[key] = state;
      if (info) S.lookup.infoByKey[key] = info;
      if (screen === 'lookup') render();
    }, S.abort.signal);
    // Merge cached info for wines we did not re-fetch.
    for (const b of cands) {
      const k = wineKey(b);
      if (!S.lookup.infoByKey[k]) {
        const hit = await db.getWine(k);
        if (hit) S.lookup.infoByKey[k] = hit.info;
      }
    }
    const prev = S.lookup.usage || { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
    S.lookup.usage = { input_tokens: prev.input_tokens + r.usage.input_tokens, output_tokens: prev.output_tokens + r.usage.output_tokens, web_search_requests: prev.web_search_requests + r.usage.web_search_requests };
    S.lookup.failed = r.failed;
    finish(cands);
  } catch (e) {
    if (S.abort.signal.aborted) return;
    S.lookup.status = 'error';
    S.lookup.error = e.message;
    render();
  }
}

async function finish(cands) {
  S.lookup.status = 'done';
  S.results = recommend(cands, S.lookup.infoByKey, S.prefs, { EUR: settings.eurRon }, 3);
  settings.lastPrefs = structuredClone(S.prefs);
  saveSettings();
  if (!S.demo) {
    const scan = {
      store: S.extraction.storeHint,
      bottles: S.extraction.bottles,
      prefs: S.prefs,
      topIdx: S.results.top.map((s) => s.bottle.idx),
      topLabels: S.results.top.map((s) => label(s.bottle)),
      thumb: S.photos[0]?.thumb || null,
      thumbs: S.photos.map((p) => p.thumb),
    };
    if (S.saved) { /* re-run of the same scan: keep a single history entry */ }
    else { S.saved = true; db.addScan(scan).catch(() => {}); }
  }
  go('results');
}

async function openScan(id) {
  const scan = historyData.scans.find((s) => s.id === id);
  if (!scan) return;
  S = fresh();
  S.saved = true;
  S.photos = (scan.thumbs || [scan.thumb]).filter(Boolean).map((t) => ({ previewUrl: t, thumb: t, prepared: null }));
  S.extraction = { status: 'done', bottles: scan.bottles, storeHint: scan.store, error: null, usage: null };
  S.prefs = scan.prefs;
  for (const b of scan.bottles) {
    const hit = await db.getWine(wineKey(b));
    if (hit) S.lookup.infoByKey[wineKey(b)] = hit.info;
  }
  S.results = recommend(currentCandidates(), S.lookup.infoByKey, S.prefs, { EUR: settings.eurRon }, 3);
  go('results');
}

function startDemo() {
  S = fresh();
  S.demo = true;
  S.photos = [{ previewUrl: demoShelfDataUrl(), prepared: {} }];
  S.prefs = { types: ['red'], minPrice: null, maxPrice: 70, priority: 'value' };
  S.extraction = { status: 'running', bottles: [], storeHint: null, error: null, usage: null };
  go('prefs');
  setTimeout(() => {
    S.extraction = { status: 'done', bottles: demoBottles(), storeHint: null, error: null, usage: null };
    if (screen === 'prefs') render();
    if (S.prefsSubmitted) runLookup();
  }, 1600);
}

async function refreshHome() {
  try { homeStats = await db.counts(); } catch {}
  if (screen === 'home') render();
}

/* ------------------------------------------------------------------ events */

const actions = {
  home: () => { closeSheet(); refreshHome(); go('home'); },
  settings: () => go('settings'),
  history: async () => {
    historyData = { scans: await db.allScans(), wines: await db.allWines() };
    go('history');
  },
  htab: (el) => { historyTab = el.dataset.v; render(); },
  demo: startDemo,
  'take-photo': () => {
    if (screen !== 'capture') { S = fresh(); }
    pickFiles();
  },
  'pick-photo': () => {
    if (screen !== 'capture') { S = fresh(); }
    pickFiles(true);
  },
  'remove-photo': (el) => { S.photos.splice(+el.dataset.i, 1); S.photos.length ? render() : go('home'); },
  analyze: () => {
    S.prefsSubmitted = false;
    go('prefs');
    runExtraction();
  },
  'retry-extract': () => runExtraction(),
  cancel: () => { S.abort?.abort(); refreshHome(); go(S.results ? 'results' : 'home'); },
  'toggle-type': (el) => {
    const v = el.dataset.v, t = S.prefs.types;
    S.prefs.types = t.includes(v) ? t.filter((x) => x !== v) : [...t, v];
    render();
  },
  preset: (el) => {
    S.prefs.minPrice = el.dataset.a === '' ? null : +el.dataset.a;
    S.prefs.maxPrice = el.dataset.b === '' ? null : +el.dataset.b;
    render();
  },
  priority: (el) => { S.prefs.priority = el.dataset.v; render(); },
  'submit-prefs': () => {
    S.prefsSubmitted = true;
    if (S.extraction.status === 'done') runLookup();
    else render();
  },
  'edit-prefs': () => { S.prefsSubmitted = false; go('prefs'); },
  'new-scan': () => { S = fresh(); pickFiles(); },
  sort: (el) => { sortBy = el.dataset.v; render(); },
  'show-shelf': (el) => shelfSheet(+el.dataset.idx),
  details: (el) => {
    const b = S.extraction.bottles.find((x) => x.idx === +el.dataset.idx);
    detailsSheet(b, S.lookup.infoByKey[wineKey(b)] || null);
  },
  'wine-detail': async (el) => {
    const w = historyData.wines.find((x) => x.key === el.dataset.key);
    const obs = await db.observationsFor(w.key);
    const note = obs.length
      ? `<h2 class="section-title">Prices you saw</h2><ul class="sources">${obs.sort((a, b) => b.at - a.at).slice(0, 8).map((o) => `<li>${lei(o.price)} lei${o.promo ? ' (promo)' : ''} · ${new Date(o.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${o.store ? ' · ' + esc(o.store) : ''}</li>`).join('')}</ul>`
      : '';
    detailsSheet(null, { ...w.info, matched_name: w.info.matched_name || w.label }, note + `<button class="btn ghost" style="width:100%;margin-top:10px" data-action="forget-wine" data-key="${esc(w.key)}">Remove from wine list</button>`);
  },
  'forget-wine': async (el) => {
    await db.deleteWine(el.dataset.key);
    historyData.wines = historyData.wines.filter((w) => w.key !== el.dataset.key);
    closeSheet(); render(); toast('Removed from your wine list');
  },
  fix: (el) => fixSheet(+el.dataset.idx),
  'close-sheet': (el, ev) => { if (ev.target === el) dismissSheet(); },
  'dismiss-sheet': () => dismissSheet(),
  'open-scan': (el) => openScan(+el.dataset.id),
  'test-key': async (el) => {
    if (!settings.apiKey) return toast('Paste your API key first');
    el.disabled = true; el.textContent = 'Testing…';
    try { await testKey(settings.apiKey, 'claude-haiku-5-5'); toast('Key works'); }
    catch (e) { toast(e.message, 4000); }
    el.disabled = false; el.textContent = 'Test key';
  },
  export: async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const file = new File([blob], `oeno-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Oeno backup' }); return; } catch { return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  },
  'clear-data': async () => {
    if (!confirm('Delete all saved wines, prices and scans from this phone?')) return;
    await db.clearAll(); toast('All saved data deleted');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.dataset.action !== 'close-sheet') ev.preventDefault();
  if (el.closest('.sheet') && !['close-sheet', 'dismiss-sheet', 'forget-wine', 'fix'].includes(el.dataset.action)) closeSheet();
  if (el.dataset.action === 'fix') closeSheet();
  fn(el, ev);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset.input) {
    const v = el.value.replace(',', '.').trim();
    S.prefs[el.dataset.input] = v === '' || isNaN(+v) ? null : +v;
    // Light re-render: update only the counter and button.
    const n = countMatching();
    const hint = $app.querySelector('.page > p.hint');
    if (hint && n != null) hint.textContent = `${n} wine${n === 1 ? '' : 's'} on this shelf match${n === 1 ? 'es' : ''} your type and price.`;
    $app.querySelectorAll('[data-action="preset"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    saveSettings();
  }
  if (el.dataset.actionChange === 'import' && el.files?.[0]) {
    try {
      const n = await db.importAll(JSON.parse(await el.files[0].text()));
      toast(`Imported ${n} wines`);
    } catch (e) { toast(e.message); }
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (form.dataset.form !== 'fix') return;
  ev.preventDefault();
  const b = S.extraction.bottles.find((x) => x.idx === +form.dataset.idx);
  const fd = new FormData(form);
  b.producer = fd.get('producer')?.trim() || null;
  b.name = fd.get('name')?.trim() || null;
  b.vintage = fd.get('vintage') ? +fd.get('vintage') : null;
  b.color = fd.get('color');
  const price = parseFloat(String(fd.get('price')).replace(',', '.'));
  if (!isNaN(price)) { b.promo_price = null; b.shelf_price = price; }
  b.confidence = 1;
  closeSheet();
  if (S.demo) { toast('Corrections are not looked up in the demo'); S.results = recommend(currentCandidates(), S.lookup.infoByKey, S.prefs, { EUR: settings.eurRon }, 3); return render(); }
  runLookup([wineKey(b)]);
});

document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $sheet.firstChild) dismissSheet(); });

/* ------------------------------------------------------------------ boot */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
db.persist();
render();
refreshHome();

// Exposed for automated tests only.
window.__oeno = { get state() { return S; }, get screen() { return screen; }, actions };
