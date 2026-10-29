# Oeno — pick a wine from the shelf or the wine list

An iPhone web app (PWA). Photograph a supermarket wine shelf or a restaurant wine list, say what you want, get 2–3 picks with ratings and a price comparison.

- **Shelf (shop):** compared with shop prices (Romanian online retail, else international average).
- **Wine list (restaurant):** compared **only with what other restaurants charge**. Burgundy screens mark restaurant mode.
- **Places:** with location allowed, each scan is saved with the shop or restaurant (found via OpenStreetMap), and every price you see is kept per place for later comparisons.

## What you need

1. **An Anthropic API key** — create it at https://console.anthropic.com → API keys. Set a monthly spend limit there (e.g. $10).
2. **A free HTTPS host** for the app's files (the iPhone camera and offline mode require HTTPS). Pick one:
   - **GitHub Pages** (permanent, free): create a public repo, upload the contents of this folder (not the folder itself), then Settings → Pages → Branch `main`, folder `/ (root)` → Save. Your URL: `https://<you>.github.io/<repo>/`.
   - **Cloudflare Pages** or **Netlify**: drag-and-drop this folder in their dashboard ("Deploy manually" / Netlify Drop). Free accounts are enough.

## Install on the iPhone

1. Open your app URL in **Safari**.
2. Share button → **Add to Home Screen**.
3. Open **Oeno** from the home screen → gear icon → paste your API key → **Test key**.
4. Optional: tap **Try the demo shelf** to see the full flow with fictional wines (no key or cost).

Note: the home-screen app and a Safari tab keep separate data. Always use the home-screen icon.

## Using it in the store

1. **Scan the shelf** → the camera opens. Stand about one step back so labels *and* price tags are readable. For long shelves add up to 4 photos, one per section.
2. **Read the shelf** → while Claude reads the photo (≈15–40 s), choose type, price range and priority:
   - *Best deal*: biggest gap between the wine's usual price and this shelf price
   - *Balanced*: good ratings at a fair price
   - *Best rated*: highest ratings in budget
3. **Find my wines** → each matching wine is checked online (Vivino, Wine-Searcher, Romanian shops). Wines already in your list are instant and free.
4. Results: top 3 with the shelf price tag, % vs usual price, rating, critic score, a short review, **Show on shelf**, **Details and sources**, and **Wrong wine?** to correct a misread label.

## At a restaurant

1. **Scan a wine list** → photograph each page flat, whole page in frame, no glare (up to 4 pages).
2. Bottle and glass prices are both read. Wines sold only by the glass are compared as a bottle equivalent (glass price × 5 for 150 ml).
3. The price check uses only other restaurants' wine-list prices. Many wines have none online; they are then ranked on ratings and marked "no restaurant prices found".

## Location and places

- When you take a photo, Oeno asks for your location once (allow it for the home-screen app). The nearest shop or restaurant is picked automatically, or confirmed by the name on the price tags or menu; when unsure it asks you to choose. You can always tap the place card to change it or type a name.
- Location is sent only to OpenStreetMap to look up the place name. Places and prices stay on the phone. Turn it off in Settings → Location.
- History → **Places** lists every shop and restaurant with the prices you saw there.

## Cost (your Anthropic account)

Typical shelf or wine list of ~12 matching wines: about **$0.10–0.40** per scan (restaurant lookups search a little more). Reading the photo (Sonnet 5.5) is a few cents; each lookup batch uses Haiku 5.5 (cheap) plus ~$0.01 per web search. Repeat scans of known wines cost only the photo reading. The results screen shows the estimate for each scan.

## How good is the data?

- Ratings and prices come from Claude searching the web and can be wrong or refer to another vintage (flagged). Check **Details and sources** before a big purchase.
- Market price = Romanian online retail when found, otherwise international average (€ converted with the rate in Settings).
- Wines with uncertain identification or few ratings are scored down rather than hidden.

## Privacy

Everything stays on the phone (browser IndexedDB): API key, saved wines, places, prices you saw, past scans. Photos and wine names are sent only to api.anthropic.com; coordinates only to OpenStreetMap (overpass-api.de, overpass.private.coffee). Settings → Export backup to keep or move your wine list.

## Run locally (development)

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node --test tests/scoring.test.mjs tests/geo.test.mjs
tools/build-flat.sh ../dist   # flat copy for uploading to GitHub
```

See ARCHITECTURE.md for the design.
