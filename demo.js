// Demo mode: a drawn shelf of FICTIONAL wines with made-up data,
// so the whole flow can be tried without an API key or a store.

import { wineKey } from './scoring.js';

const W = 1000, H = 1300;
const ROWS = [60, 480, 900]; // top of bottle area per shelf
const COLS = [70, 310, 550, 790];

const WINES = [
  // producer, name, vintage, color, shelf, promo, info
  ['Dealul Lupului', 'Fetească Neagră', 2021, 'red', 42.99, null, { rating: 3.9, rating_count: 1200, local_price_ron: 55, critic_score: null, review_summary: 'Ripe plum and smoky spice, soft tannins; drinkers praise it as a dependable weeknight red.', pairing: 'Grilled pork, mici, aged cheese' }],
  ['Valea Pietrei', 'Cabernet Sauvignon Reserve', 2020, 'red', 64.9, null, { rating: 4.1, rating_count: 640, local_price_ron: 89, critic_score: 90, critic_source: 'Demo Wine Guide', review_summary: 'Structured, oaky blackcurrant with a long finish; often called a bargain for its depth.', pairing: 'Steak, lamb' }],
  ['Casa Brumar', 'Merlot Clasic', null, 'red', 24.49, null, { rating: 3.4, rating_count: 2100, local_price_ron: 26, review_summary: 'Light, fruity and slightly sweet-edged; simple party wine.', pairing: 'Pizza, pasta' }],
  ['Podgoria Siret', 'Băbească Neagră', 2022, 'red', 34.99, 27.99, { rating: 3.7, rating_count: 310, local_price_ron: 38, review_summary: 'Bright cherry, low tannin, best slightly chilled.', pairing: 'Charcuterie, roast chicken' }],
  ['Conacul Alb', 'Sauvignon Blanc', 2023, 'white', 36.99, null, { rating: 3.8, rating_count: 900, local_price_ron: 41, review_summary: 'Zesty grapefruit and cut grass, crisp and clean.', pairing: 'Goat cheese, salads, fish' }],
  ['Dealul Ursului', 'Fetească Albă', 2023, 'white', 29.99, null, { rating: 3.6, rating_count: 450, local_price_ron: 33, review_summary: 'Floral, peachy and round with gentle acidity.', pairing: 'Chicken, mild curries' }],
  ['Valea Pietrei', 'Chardonnay Barrique', 2021, 'white', 72.5, null, { rating: 4.0, rating_count: 220, market_price_eur: 15, review_summary: 'Buttery, toasty oak over yellow apple; rich style.', pairing: 'Creamy pasta, lobster' }],
  ['Weingut Feldbach', 'Riesling Trocken', 2022, 'white', 49.99, null, { rating: 3.9, rating_count: 1800, market_price_eur: 12.5, critic_score: 89, critic_source: 'Demo Wine Guide', review_summary: 'Lime, slate and high acidity; bone dry and precise.', pairing: 'Sushi, Thai food' }],
  ['Carpatin', 'Spumant Brut', null, 'sparkling', 39.99, null, { rating: 3.6, rating_count: 700, local_price_ron: 42, review_summary: 'Fine bubbles, green apple and brioche hints.', pairing: 'Aperitif, canapés' }],
  ['Bollicine di Treviso', 'Prosecco DOC Extra Dry', null, 'sparkling', 32.99, null, { rating: 3.7, rating_count: 5000, market_price_eur: 9, review_summary: 'Pear and white flowers, softly off-dry; crowd-pleaser.', pairing: 'Spritz, light starters' }],
  ['Casa Brumar', 'Rosé de Drăgășani', 2023, 'rose', 27.49, null, { rating: 3.5, rating_count: 300, local_price_ron: 30, review_summary: 'Strawberry and watermelon, light and summery.', pairing: 'Salads, grilled fish' }],
  ['Maison Vercel', 'Crémant de Bourgogne Brut', null, 'sparkling', 79.9, null, { rating: 3.9, rating_count: 1500, market_price_eur: 16, review_summary: 'Champagne-like toast and citrus at a fraction of the price.', pairing: 'Oysters, celebrations' }],
];

const FILL = { red: '#3b0d16', white: '#c9c27a', rose: '#e6a3a6', sparkling: '#2c4a2a' };
const fmt = (n) => n.toFixed(2).replace('.', ',');

function bottleSvg(x, y, w) {
  const color = FILL[w[3]];
  const body = `<rect x="${x + 40}" y="${y + 90}" width="90" height="210" rx="18" fill="${color}"/>
  <rect x="${x + 70}" y="${y}" width="30" height="100" rx="8" fill="${color}"/>
  <rect x="${x + 48}" y="${y + 160}" width="74" height="96" rx="4" fill="#f4efe1"/>
  <text x="${x + 85}" y="${y + 186}" font-size="13" font-weight="700" text-anchor="middle" fill="#222" font-family="Georgia">${w[0].split(' ')[0]}</text>
  <text x="${x + 85}" y="${y + 204}" font-size="11" text-anchor="middle" fill="#444" font-family="Georgia">${w[0].split(' ').slice(1).join(' ')}</text>
  <text x="${x + 85}" y="${y + 226}" font-size="11" text-anchor="middle" fill="#7a1f2e" font-family="Georgia">${w[1].split(' ')[0]}</text>
  <text x="${x + 85}" y="${y + 244}" font-size="11" text-anchor="middle" fill="#444" font-family="Georgia">${w[2] || 'NV'}</text>`;
  const price = w[5] ?? w[4];
  const tag = `<rect x="${x}" y="${y + 322}" width="170" height="62" fill="${w[5] ? '#ffe14d' : '#ffffff'}" stroke="#999"/>
  <text x="${x + 8}" y="${y + 340}" font-size="11" fill="#333" font-family="Arial">${(w[0] + ' ' + w[1]).slice(0, 26)}</text>
  <text x="${x + 160}" y="${y + 376}" font-size="30" font-weight="900" text-anchor="end" fill="${w[5] ? '#c4303a' : '#111'}" font-family="Arial">${fmt(price)}</text>
  ${w[5] ? `<text x="${x + 8}" y="${y + 374}" font-size="13" fill="#555" text-decoration="line-through" font-family="Arial">${fmt(w[4])}</text>` : ''}`;
  return body + tag;
}

export function demoShelfDataUrl() {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#d8d4cc"/>`;
  ROWS.forEach((ry) => { s += `<rect x="0" y="${ry + 300}" width="${W}" height="22" fill="#8a8f93"/>`; });
  WINES.forEach((w, i) => { s += bottleSvg(COLS[i % 4], ROWS[Math.floor(i / 4)], w); });
  s += `<text x="${W / 2}" y="34" font-size="22" text-anchor="middle" fill="#555" font-family="Arial">DEMO SHELF · FICTIONAL WINES</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

export function demoBottles() {
  return WINES.map((w, i) => {
    const x = COLS[i % 4], y = ROWS[Math.floor(i / 4)];
    return {
      idx: i, photo: 0, producer: w[0], name: w[1], grapes: [], vintage: w[2], region: null, country: null,
      color: w[3], sweetness: null, volume_ml: 750, shelf_price: w[4], promo_price: w[5],
      price_tag_text: null, facings: 2,
      bbox: [Math.round((x + 40) / W * 1000), Math.round(y / H * 1000), Math.round((x + 130) / W * 1000), Math.round((y + 300) / H * 1000)],
      confidence: 0.9,
    };
  });
}

export function demoInfo() {
  const out = {};
  WINES.forEach((w) => {
    const key = wineKey({ producer: w[0], name: w[1], vintage: w[2] });
    out[key] = {
      matched_name: `${w[0]} ${w[1]}`, rating_source: 'Demo data', vintage_matched: true,
      market_price_eur: null, local_price_ron: null, critic_score: null, critic_source: null,
      sources: [], citations: [], match_confidence: 0.9, ...w[6],
    };
  });
  return out;
}

/* ---------------------------------------------------------------- demo wine list (restaurant) */

const MW = 1000, MH = 1400;
// [section, producer, name, vintage, color, bottle, glass, info]
const MENU = [
  ['Vinuri roșii', 'Dealul Lupului', 'Fetească Neagră', 2021, 'red', 145, 32, { rating: 3.9, rating_count: 1200, horeca_price_ron: 175, horeca_sample_count: 5, horeca_price_low_ron: 150, horeca_price_high_ron: 210 }],
  ['Vinuri roșii', 'Valea Pietrei', 'Cabernet Sauvignon Reserve', 2020, 'red', 260, null, { rating: 4.1, rating_count: 640, critic_score: 90, critic_source: 'Demo Wine Guide', horeca_price_ron: 230, horeca_sample_count: 3 }],
  ['Vinuri roșii', 'Podgoria Siret', 'Băbească Neagră', 2022, 'red', null, 28, { rating: 3.7, rating_count: 310, horeca_price_ron: 120, horeca_sample_count: 2 }],
  ['Vinuri roșii', 'Casa Brumar', 'Merlot Clasic', null, 'red', 95, 22, { rating: 3.4, rating_count: 2100, horeca_price_ron: 110, horeca_sample_count: 6 }],
  ['Vinuri albe', 'Conacul Alb', 'Sauvignon Blanc', 2023, 'white', 135, 30, { rating: 3.8, rating_count: 900, horeca_price_ron: 160, horeca_sample_count: 4 }],
  ['Vinuri albe', 'Weingut Feldbach', 'Riesling Trocken', 2022, 'white', 210, null, { rating: 3.9, rating_count: 1800, critic_score: 89, critic_source: 'Demo Wine Guide', horeca_price_ron: null, horeca_sample_count: null }],
  ['Rose & spumante', 'Casa Brumar', 'Rosé de Drăgășani', 2023, 'rose', 110, 25, { rating: 3.5, rating_count: 300, horeca_price_ron: 115, horeca_sample_count: 3 }],
  ['Rose & spumante', 'Bollicine di Treviso', 'Prosecco DOC Extra Dry', null, 'sparkling', 150, 30, { rating: 3.7, rating_count: 5000, horeca_price_ron: 140, horeca_sample_count: 7 }],
];

const xml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

const lineY = (i) => {
  const sectionsBefore = new Set(MENU.slice(0, i + 1).map((m) => m[0])).size;
  return 210 + i * 118 + sectionsBefore * 70;
};

export function demoMenuDataUrl() {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MW} ${MH}" width="${MW}" height="${MH}">
    <rect width="${MW}" height="${MH}" fill="#f6f0e4"/>
    <rect x="30" y="30" width="${MW - 60}" height="${MH - 60}" fill="none" stroke="#7a3346" stroke-width="3"/>
    <text x="${MW / 2}" y="110" font-size="46" text-anchor="middle" fill="#3b1520" font-family="Georgia" font-style="italic">Bistro Demo</text>
    <text x="${MW / 2}" y="160" font-size="22" text-anchor="middle" fill="#7a3346" font-family="Georgia" letter-spacing="6">LISTA DE VINURI · FICTIONAL</text>
    <text x="760" y="215" font-size="18" text-anchor="middle" fill="#7a3346" font-family="Georgia">pahar 150 ml</text>
    <text x="900" y="215" font-size="18" text-anchor="middle" fill="#7a3346" font-family="Georgia">sticlă 750 ml</text>`;
  let lastSection = null;
  MENU.forEach((m, i) => {
    const y = lineY(i);
    if (m[0] !== lastSection) { s += `<text x="80" y="${y - 52}" font-size="28" fill="#7a3346" font-family="Georgia" font-weight="bold">${xml(m[0])}</text>`; lastSection = m[0]; }
    s += `<text x="80" y="${y}" font-size="26" fill="#222" font-family="Georgia">${xml(`${m[1]} — ${m[2]}${m[3] ? ' ' + m[3] : ''}`)}</text>
      <text x="80" y="${y + 32}" font-size="18" fill="#777" font-family="Georgia" font-style="italic">${m[4] === 'red' ? 'sec, roșu' : m[4] === 'white' ? 'sec, alb' : m[4] === 'rose' ? 'sec, rose' : 'spumant'}</text>
      <text x="760" y="${y}" font-size="26" text-anchor="middle" fill="#222" font-family="Georgia">${m[6] ?? '—'}</text>
      <text x="900" y="${y}" font-size="26" text-anchor="middle" fill="#222" font-family="Georgia">${m[5] ?? '—'}</text>`;
  });
  s += '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

export function demoMenuBottles() {
  return MENU.map((m, i) => {
    const y = lineY(i);
    return {
      idx: i, photo: 0, section: m[0], producer: m[1], name: m[2], grapes: [], vintage: m[3], region: null, country: null,
      color: m[4], sweetness: 'dry', volume_ml: 750, shelf_price: m[5], promo_price: null,
      glass_price: m[6], glass_ml: m[6] ? 150 : null, price_tag_text: null, facings: 1,
      bbox: [60, Math.round((y - 34) / MH * 1000), 950, Math.round((y + 44) / MH * 1000)],
      confidence: 0.9,
    };
  });
}

export function demoMenuInfo() {
  const out = {};
  MENU.forEach((m) => {
    const key = wineKey({ producer: m[1], name: m[2], vintage: m[3] });
    out[key] = {
      domain: 'horeca', matched_name: `${m[1]} ${m[2]}`, rating_source: 'Demo data', vintage_matched: true,
      critic_score: null, critic_source: null, review_summary: null, pairing: null,
      horeca_examples: m[7].horeca_price_ron ? [{ venue: 'Demo Restaurant A', city: 'București', price_ron: m[7].horeca_price_ron, url: null, note: null }] : [],
      sources: [], citations: [], match_confidence: 0.9, ...m[7],
    };
  });
  return out;
}
