# Oeno — architecture

## Decisions

| Area | Choice | Why |
|---|---|---|
| Platform | PWA (static HTML/JS, no build step) | Installs from Safari; no Mac/Xcode/App Store |
| Recognition | Claude vision (`claude-sonnet-5-5`, effort medium) | One call reads labels/menu lines and pairs them with prices |
| Ratings & prices | Claude + server-side web search (`web_search_20260318`) with `claude-haiku-5-5` | Legal (no scraping), no CORS issues, cheap |
| Backend | None; phone calls `api.anthropic.com` directly | Header `anthropic-dangerous-direct-browser-access: true`; key in localStorage |
| Local DB | IndexedDB v2: `wines`, `observations`, `places`, `scans` | Cache makes repeat scans free; builds your own price history per place |
| Places | Phone GPS (or photo EXIF GPS) → OpenStreetMap Overpass | Free, no key; Overpass main server with a public backup server |
| Ranking | Deterministic JS (`scoring.js`), not the LLM | Transparent, testable, consistent |

## Two price domains

| | `retail` (shop shelf) | `horeca` (restaurant wine list) |
|---|---|---|
| Start | "Scan the shelf" | "Scan a wine list" (burgundy screens) |
| Reading prompt | `EXTRACT_SYSTEM`: bottles + shelf tags, promo prices | `EXTRACT_MENU_SYSTEM`: sections, bottle **and** glass prices, carafes, venue name |
| Price reference | Romanian online retail median, else international € average | **Only other restaurants' prices** (median of restaurant/bar/hotel wine lists, delivery menus as fallback) |
| Never used | — | Shop, e-commerce, Wine-Searcher shop offers, distributor "preț HORECA" wholesale lists |
| Saved lookups | key `wineKey` | key `horeca\|wineKey` (never mixed with retail) |
| Places searched | `shop=supermarket\|wine\|alcohol\|convenience\|…` | `amenity=restaurant\|bar\|pub\|cafe\|…`, `tourism=hotel` |

Ratings are looked up in both domains. A glass-only price is converted to a bottle equivalent (price × 750 / glass ml, 150 ml default) and flagged. If the photo looks like the other domain (`photo_kind`), the app offers to re-read it in the right mode.

## Pipeline

```
photo(s) ─┬─ image.js     EXIF orientation, resize 2576 px, JPEG q0.88
          └─ geo.js       GPS: photo EXIF (library photos) or phone position
                          → saved places nearby + Overpass POIs → auto-choose or ask
extract(domain)  1 call → bottles[] {producer, name, vintage, color, shelf/bottle price,
                          promo, glass price+ml, section, bbox, confidence}, store/venue name
                 (preferences + place card shown while this runs; venue name can confirm the place)
filterCandidates(type, budget per bottle) → capped at maxLookups
lookup(domain)   per unique wine: IndexedDB hit (< cacheDays, same domain) or web lookup
                 batches of 4, 3 in parallel; pause_turn handled; tool-version fallback
recommend(domain) → top 3 + full table
saveScan         place (visits+1), scan {domain, place, geo}, one observation per priced wine
```

## Place choice (geo.js `autoChoose`)

1. A printed name (price tags' store, menu header) matching a nearby place by ≥ 50% of its words wins.
2. Otherwise the nearest place, if within max(40 m, GPS accuracy) and clearly closer than the next (≥ 1.6× + 10 m).
3. Otherwise a place you saved before within that distance.
4. Otherwise the app asks ("Which restaurant is this?"); you can also type a name. Without GPS the printed name is used.

Changing the place after the scan was saved moves the scan and all its prices to the new place.

## Data model (IndexedDB v2)

```
wines        { key, wineKey, domain, info, label, fetchedAt }
observations { key, label, domain, price, priceKind: bottle|promo|glass, per750, volume_ml, glass_ml,
               promo, placeId, placeName, lat, lon, accuracy, scanId, at }   indexes: key, placeId, scanId
places       { id, name, brand, kind, domain, lat, lon, accuracy, address, source: osm|manual|hint,
               firstSeen, lastSeen, visits }
               ids: "osm:node/123", "name:horeca:caru-cu-bere@44.4800,26.1000", "name:retail:kaufland"
scans        { domain, store, placeId, place, geo, bottles, prefs, topLabels, thumbs, at }
```
v1 → v2 upgrade keeps everything; rows without a domain count as retail.

## Scoring (scoring.js)

- Shelf/list price: promo if present; normalised to 750 ml; glass-only → bottle equivalent.
- Reference price (per domain, above). Value v = clamp(0.5 + log2(reference / price) / 2).
- Quality q: rating 3.2→0 … 4.4→1, shrunk to 0.4 by n/(n+50); 70/30 with critic score 82→0 … 95→1.
- Priority weights (v, q): best deal / fairest price 0.65/0.35 · balanced 0.5/0.5 · best rated 0.2/0.8. Unknown v 0.4, q 0.3.
- × (0.55 + 0.45 × min(label confidence, match confidence)); × 0.95 if another vintage.

## Files

```
index.html, manifest.webmanifest, sw.js (stale-while-revalidate shell, never caches API calls)
app.css
app.js       screens, state, events, place card/picker, saving
pipeline.js  extract + lookup orchestration (domain-aware)
prompts.js   shelf + wine-list reading prompts, retail + HORECA lookup prompts
scoring.js   pure logic (unit-tested)
geo.js       GPS, EXIF GPS, Overpass, place auto-choice (unit-tested)
db.js        IndexedDB v2
claude.js    API client
image.js     photo preprocessing
demo.js      fictional demo shelf and wine list
```

## Known limits / next steps

- Restaurant prices are sparse online; many wines will show "no restaurant prices found" and rank on ratings. Your own saved restaurant prices (per place) are the planned remedy: use them as an extra reference once there are enough.
- GPS indoors (malls, cellars) can be 50–150 m off; the picker handles ambiguity, but a wrong auto-choice is possible when the printed name is missing.
- Safari strips location from camera photos; the phone's live position is used instead, so a photo taken earlier and scanned later from the library is placed by its EXIF GPS only if "Include location" was on.
- OpenStreetMap coverage of small shops/restaurants varies; "Somewhere else" covers the gaps.
