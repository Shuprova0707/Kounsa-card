// Weekly data refresh.
// Asks Gemini (with Google Search grounding) to verify current reward rates &
// offers for the 4 cards, and to grow the brand list. Validates everything
// before writing — if the model output looks wrong, files are left untouched.

import fs from "node:fs";

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!KEY) {
  console.error("GEMINI_API_KEY is not set (add it in repo Settings → Secrets → Actions).");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const rates = fs.readFileSync("rates.json", "utf8");
const brands = fs.readFileSync("brands.json", "utf8");
const oldBrandCount = JSON.parse(brands).brands.length;

const CAT_IDS = [
  "homecentre","lifestyle","max","spar","landmarkx","dining","movies","swiggy",
  "zomato","myntra","online","grocery","travel","intl","fuel","utilities","other"
];

const prompt = `Today is ${today}. You maintain the data files of a personal Indian
credit-card recommender covering exactly these four cards:

1. Landmark Rewards SBI Card SELECT (SBI Card × Landmark Group)
2. Axis Bank My Zone Credit Card
3. Axis Bank Neo Credit Card
4. DBS Spark5 Credit Card (DBS Bank India)

TASK A — verify rates & offers. Use Google Search to check, as of today:
- current reward earn rates and excluded categories for each card
- active merchant offers: Swiggy/Zomato flat discounts + coupon codes, movie
  BOGO offers, EazyDiner/Dining Delights, Axis Travel EDGE, fuel surcharge
  waiver caps, DBS Spark monthly milestone multiplier.
Search official pages (sbicard.com, axisbank.com, dbs.com/in) and card sites
like cardinsider.com, paisabazaar.com, technofino.in.

TASK B — grow the brand list. Keep every existing brand. You may fix wrong
categories and ADD up to 10 popular Indian consumer brands that are missing.

CURRENT rates.json:
${rates}

CURRENT brands.json:
${brands}

STRICT OUTPUT RULES:
- Return the COMPLETE updated rates.json between <RATES> and </RATES>, and the
  COMPLETE updated brands.json between <BRANDS> and </BRANDS>. Nothing else.
- Keep the exact same JSON schema, card ids (sbi/myzone/neo/spark) and offer
  "type" values (flat/pctcap/bogo/waiver). Category keys must come only from:
  ${JSON.stringify(CAT_IDS)}.
- Rates are plain numbers (percent value-back, e.g. 3.75). Only change a value
  if a search result clearly confirms it changed; otherwise keep it as is.
- If an offer has been discontinued, remove it; if a new comparable offer
  exists for these cards, add it in the same schema.
- Set "lastUpdated" to "${today}" in both files.
- brands.json entries are {"n","a","c"} with optional "lm":1 and "tip".`;

async function callGemini() {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 32768 }
      })
    }
  );
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

function extract(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  return m[1].replace(/```json|```/g, "").trim();
}

function validRates(o) {
  if (!o || !Array.isArray(o.cards) || o.cards.length !== 4) return "cards must have 4 entries";
  const ids = o.cards.map(c => c.id).sort().join(",");
  if (ids !== "myzone,neo,sbi,spark") return "card ids changed";
  for (const c of o.cards) {
    if (typeof c.base !== "number" || c.base < 0 || c.base > 40) return `bad base on ${c.id}`;
    for (const [k, v] of Object.entries(c.over || {})) {
      if (!CAT_IDS.includes(k)) return `unknown category ${k} on ${c.id}`;
      if (typeof v !== "number" || v < 0 || v > 40) return `bad rate ${k} on ${c.id}`;
    }
  }
  if (!Array.isArray(o.offers)) return "offers missing";
  for (const of_ of o.offers) {
    if (!["flat","pctcap","bogo","waiver"].includes(of_.type)) return `bad offer type ${of_.type}`;
    if (!CAT_IDS.includes(of_.cat)) return `bad offer cat ${of_.cat}`;
  }
  if (!o.lastUpdated) return "lastUpdated missing";
  return null;
}

function validBrands(o) {
  if (!o || !Array.isArray(o.brands)) return "brands array missing";
  if (o.brands.length < oldBrandCount - 2) return "too many brands deleted";
  if (o.brands.length > oldBrandCount + 15) return "too many brands added";
  for (const b of o.brands) {
    if (!b.n || !b.c || !CAT_IDS.includes(b.c)) return `bad brand entry: ${JSON.stringify(b).slice(0,80)}`;
  }
  return null;
}

try {
  console.log(`Refreshing data with ${MODEL}…`);
  const text = await callGemini();

  const ratesRaw = extract(text, "RATES");
  const brandsRaw = extract(text, "BRANDS");
  if (!ratesRaw || !brandsRaw) {
    console.log("Model response missing <RATES>/<BRANDS> blocks — keeping existing files.");
    process.exit(0);
  }

  const newRates = JSON.parse(ratesRaw);
  const newBrands = JSON.parse(brandsRaw);

  const e1 = validRates(newRates);
  const e2 = validBrands(newBrands);
  if (e1 || e2) {
    console.log(`Validation failed (${e1 || e2}) — keeping existing files.`);
    process.exit(0);
  }

  fs.writeFileSync("rates.json", JSON.stringify(newRates, null, 2) + "\n");
  fs.writeFileSync("brands.json", JSON.stringify(newBrands, null, 2) + "\n");
  console.log(`Done. Brands: ${oldBrandCount} → ${newBrands.brands.length}. lastUpdated: ${newRates.lastUpdated}`);
} catch (e) {
  console.log("Refresh skipped:", String(e).slice(0, 300));
  process.exit(0); // don't fail the workflow on a flaky week — old data stays live
}
