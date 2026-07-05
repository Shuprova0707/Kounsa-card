# Kounsa Card

Personal tool: type any store or brand → it tells you which of your 4 cards to swipe
(SBI Landmark SELECT · Axis My Zone · Axis Neo · DBS Spark5), with real ₹ back,
coupon codes, and auto-refreshing rates.

## Files → where they go in the repo

Paste each file at exactly this path (GitHub: **Add file → Create new file**,
type the full path including slashes — GitHub creates the folders for you):

```
index.html                          ← the page
rates.json                          ← card rates & offers (auto-updated weekly)
brands.json                         ← brand → category map (grows weekly)
package.json                        ← tells Vercel/Node to use ES modules
api/lookup.js                       ← live AI lookup for unknown brands
scripts/update.mjs                  ← the weekly refresh script
.github/workflows/update-rates.yml  ← the schedule that runs it every Monday
README.md                           ← this file
```

## One-time setup (~10 min)

**1. Gemini API key (free)**
- https://aistudio.google.com/apikey → sign in → **Create API key** → copy (`AIza...`)

**2. GitHub secret** (lets the weekly job use the key)
- Repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name: `GEMINI_API_KEY` · Secret: paste the key → **Add secret**

**3. Vercel** (hosts the site + live lookup)
- https://vercel.com → sign in with GitHub → **Add New → Project** → import `Kounsa-card` → **Deploy**
- Project → **Settings → Environment Variables** → Key `GEMINI_API_KEY`, Value = the key, all environments → **Save**
- **Deployments** tab → ⋯ on latest → **Redeploy** (env vars only apply to new deploys)

**4. Test**
- Repo → **Actions** tab → *Weekly rates refresh* → **Run workflow** → should go green
  and may commit updated `rates.json` / `brands.json`
- Open `https://<your-project>.vercel.app` → type `levis` (instant) and something
  odd like `rolex` (live lookup, ~3 sec)
- On your phone: browser menu → **Add to Home Screen** → opens like an app

## How it stays fresh

Every Monday 08:00 IST the GitHub Action asks Gemini (with Google Search) to verify
current rates/offers for the 4 cards and rewrites the two JSON files. Any change is
committed → Vercel auto-redeploys → your page is current. Bad/unparseable model
output is rejected by validation and the old data stays live.

## Troubleshooting

- **Action fails with model error** → Google renamed the model. Repo → Settings →
  Secrets/Variables → add variable or edit `GEMINI_MODEL` env in the workflow, or
  change the default in `scripts/update.mjs` / `api/lookup.js` (currently `gemini-2.5-flash`).
- **Live lookup says "GEMINI_API_KEY not set"** → step 3 env var missing, or you
  didn't redeploy after adding it.
- **Rates look wrong** → edit `rates.json` directly on GitHub; your edit deploys in
  ~30 sec. The weekly job will keep it unless search says otherwise.

Free-tier footprint: GitHub Actions (~1 min/week), Vercel Hobby, Gemini free tier.
₹0/month.
