# Oeno — architecture

## Decisions

| Area | Choice | Why |
|---|---|---|
| Platform | PWA (static HTML/JS, no build step) | Installs from Safari; no Mac/Xcode/App Store |
| Recognition | Claude vision (`claude-sonnet-5-5`, effort medium) | One call reads labels and price tags and pairs them |
| Ratings & prices | Claude + server-side web search (`web_search_20260318`) with `claude-haiku-5-5` | Legal (no scraping), no CORS issues, cheap |
| Backend | None; phone calls `api.anthropic.com` directly | Header `anthropic-dangerous-direct-browser-access: true`; key stored in localStorage |
| Local DB | IndexedDB: `wines`, `observations`, `scans` | Cache makes repeat shelves instant and free; builds your own price history |
| Ranking | Deterministic JS (`scoring.js`), not the LLM | Transparent, testable, consistent |

## Pipeline

```
camera photo(s)
  └─ image.js        EXIF orientation, resize to 2576 px long edge (Claude high-res tier), JPEG q0.88
      └─ extract()   1 call, all photos → bottles[] {producer, name, vintage, color, shelf/promo price,
          │          volume, bbox 0–1000, confidence}; price tags paired by shelf position
          │  (preferences screen shown in parallel while this runs)
          └─ filterCandidates(type, price range)  → capped at maxLookups (highest confidence first)
              └─ lookup()  per unique wineKey: IndexedDB hit (< cacheDays) → use it
                  │        else batches of 4, 3 in parallel, web search ≤ 3/wine
                  │        handles pause_turn; auto-downgrades tool variant if rejected
                  └─ recommend()  → top 3 + full table
```

## Scoring (scoring.js)

- **Shelf price**: promo price if present, normalised to 750 ml.
- **Market reference (RON)**: Romanian online retail median if found, else international € average × EUR/RON.
- **Value** v = clamp(0.5 + log2(market / shelf) / 2): 1.0 at half price, 0.5 at par, 0 at double.
- **Quality** q: Vivino-style rating mapped 3.2→0, 4.4→1, shrunk toward 0.4 with weight n/(n+50) (few ratings ⇒ less trust); blended 70/30 with critic score (82→0, 95→1).
- **Priority weights** (v, q): Best deal 0.65/0.35 · Balanced 0.5/0.5 · Best rated 0.2/0.8. Unknown v = 0.4, unknown q = 0.3.
- **Confidence**: score × (0.55 + 0.45 × min(label-read confidence, match confidence)); ×0.95 if ratings are for another vintage.
- Deduplicate by wineKey (producer|name|vintage, diacritics stripped), take top 3.

## Files

```
index.html, manifest.webmanifest, sw.js (stale-while-revalidate shell, never caches the API)
css/app.css
js/app.js       screens, state, events
js/pipeline.js  extract + lookup orchestration
js/claude.js    API client (retries, timeouts, pause_turn, cost estimate)
js/prompts.js   extraction and lookup prompts (tune here)
js/scoring.js   pure logic (unit-tested)
js/db.js        IndexedDB
js/image.js     photo preprocessing
js/demo.js      fictional demo shelf
tests/scoring.test.mjs
```

## Known limits / next steps

- The API key lives on the phone; a spend limit on the key is the safeguard. Moving to a small proxy (Cloudflare Worker) would hide it.
- Very wide shelves: more, closer photos beat one wide photo for reading price tags.
- Barcode (EAN) reading is not used; adding it would make matching exact where tags show EANs.
