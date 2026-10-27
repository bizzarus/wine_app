import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wineKey, effectiveShelfPrice, matchesType, filterCandidates, marketReferenceRon,
  qualityScore, valueScore, scoreWine, recommend, reasons, extractJson,
} from '../js/scoring.js';

const rates = { EUR: 5.35 };

test('wineKey normalises diacritics, case and punctuation', () => {
  assert.equal(wineKey({ producer: 'Cramele Recaș', name: 'Fetească  Neagră!', vintage: 2021 }), 'cramele recas|feteasca neagra|2021');
  assert.equal(wineKey({ producer: 'X', name: 'Y' }), 'x|y|nv');
});

test('effective price prefers promo and normalises volume', () => {
  assert.deepEqual(effectiveShelfPrice({ shelf_price: 40, promo_price: 30 }), { price: 30, per750: 30 });
  assert.equal(effectiveShelfPrice({ shelf_price: 20, volume_ml: 375 }).per750, 40);
  assert.equal(effectiveShelfPrice({ shelf_price: null }), null);
});

test('type matching including "other"', () => {
  assert.ok(matchesType('red', ['red']));
  assert.ok(!matchesType('white', ['red']));
  assert.ok(matchesType('dessert', ['other']));
  assert.ok(matchesType('white', []));
});

test('filter respects price bounds and unpriced flag', () => {
  const bs = [{ color: 'red', shelf_price: 25 }, { color: 'red', shelf_price: 75 }, { color: 'red', shelf_price: null }];
  assert.equal(filterCandidates(bs, { types: ['red'], minPrice: 20, maxPrice: 50 }).length, 1);
  assert.equal(filterCandidates(bs, { types: ['red'], includeUnpriced: true }).length, 3);
});

test('market reference prefers local RON', () => {
  assert.deepEqual(marketReferenceRon({ local_price_ron: 50, market_price_eur: 20 }, rates), { value: 50, basis: 'Romanian online retail' });
  assert.equal(marketReferenceRon({ market_price_eur: 10 }, rates).value, 53.5);
  assert.equal(marketReferenceRon({}, rates), null);
});

test('quality shrinks toward prior with few ratings', () => {
  const many = qualityScore({ rating: 4.2, rating_count: 5000 }).q;
  const few = qualityScore({ rating: 4.2, rating_count: 3 }).q;
  assert.ok(many > few);
  assert.equal(qualityScore({}).known, false);
});

test('value score is symmetric in log ratio', () => {
  assert.equal(valueScore(1), 0.5);
  assert.equal(valueScore(2), 1);
  assert.equal(valueScore(0.5), 0);
  assert.equal(valueScore(null), null);
});

test('value priority prefers the discounted wine, quality priority the better-rated one', () => {
  const cheap = { idx: 0, producer: 'A', name: 'Cheap', color: 'red', shelf_price: 30, confidence: 0.9 };
  const great = { idx: 1, producer: 'B', name: 'Great', color: 'red', shelf_price: 80, confidence: 0.9 };
  const info = {
    [wineKey(cheap)]: { rating: 3.7, rating_count: 2000, local_price_ron: 55, match_confidence: 0.9 },
    [wineKey(great)]: { rating: 4.3, rating_count: 2000, local_price_ron: 85, match_confidence: 0.9 },
  };
  const v = recommend([cheap, great], info, { priority: 'value' }, rates, 1).top[0];
  const q = recommend([cheap, great], info, { priority: 'quality' }, rates, 1).top[0];
  assert.equal(v.bottle.name, 'Cheap');
  assert.equal(q.bottle.name, 'Great');
});

test('low match confidence is penalised', () => {
  const b = { producer: 'A', name: 'B', color: 'red', shelf_price: 40, confidence: 0.9 };
  const hi = scoreWine(b, { rating: 4, rating_count: 500, local_price_ron: 50, match_confidence: 0.95 }, { priority: 'balanced' }, rates).score;
  const lo = scoreWine(b, { rating: 4, rating_count: 500, local_price_ron: 50, match_confidence: 0.2 }, { priority: 'balanced' }, rates).score;
  assert.ok(hi > lo * 1.3);
});

test('recommend dedupes the same wine seen twice', () => {
  const b1 = { idx: 0, producer: 'A', name: 'B', vintage: 2020, color: 'red', shelf_price: 40, confidence: 0.9 };
  const b2 = { ...b1, idx: 1, photo: 1 };
  assert.equal(recommend([b1, b2], {}, { priority: 'balanced' }, rates, 3).top.length, 1);
});

test('reasons describe discount', () => {
  const s = scoreWine({ shelf_price: 40, confidence: 1 }, { local_price_ron: 60, rating: 4, rating_count: 100, match_confidence: 1 }, { priority: 'value' }, rates);
  assert.match(reasons(s)[0], /33% below/);
});

test('extractJson handles fences, prose and braces inside strings', () => {
  assert.deepEqual(extractJson('Here:\n```json\n{"a": "x}y", "b": [1]}\n```'), { a: 'x}y', b: [1] });
  assert.deepEqual(extractJson('I searched. {"wines": []} done'), { wines: [] });
  assert.deepEqual(extractJson('```json\n{"draft":1}\n```\nfinal:\n```json\n{"final":2}\n```'), { final: 2 });
  assert.throws(() => extractJson('no json'));
});
