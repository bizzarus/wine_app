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
