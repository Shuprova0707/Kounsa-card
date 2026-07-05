// On-demand rate refresh. Verifies current reward rates & offers for the 4
// cards via Gemini + Google Search and returns the updated rates JSON to the
// browser. Does NOT persist — the weekly job is what commits changes to the
// repo. This just refreshes what the user sees right now.

export const maxDuration = 60; // Gemini + Search grounding can be slow

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const CAT_IDS = [
  "homecentre","lifestyle","max","spar","landmarkx","dining","movies","swiggy",
  "zomato","myntra","online","grocery","travel","intl","fuel","utilities","other"
];

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
  return null;
}

function extract(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/```json|```/g, "").trim() : null;
}

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel env vars" });

  // Baseline = the rates.json shipped with this deployment.
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers.host;
  let current;
  try {
    current = await fetch(`${proto}://${host}/rates.json`, { cache: "no-store" }).then(r => r.json());
  } catch {
    return res.status(502).json({ error: "could not read current rates.json" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. You maintain the rates file of a personal Indian
credit-card recommender covering exactly these four cards:
1. Landmark Rewards SBI Card SELECT (SBI Card × Landmark Group)
2. Axis Bank My Zone Credit Card
3. Axis Bank Neo Credit Card
4. DBS Spark5 Credit Card (DBS Bank India)

Use Google Search to verify, as of today: current reward earn rates, excluded
categories, and active merchant offers (Swiggy/Zomato flat discounts + coupon
codes, movie BOGO offers, EazyDiner/Dining Delights, Axis Travel EDGE, fuel
surcharge waiver caps, DBS Spark monthly milestone multiplier). Check official
pages (sbicard.com, axisbank.com, dbs.com/in) and cardinsider.com, technofino.in.

CURRENT rates.json:
${JSON.stringify(current)}

STRICT OUTPUT RULES:
- Return the COMPLETE updated rates.json between <RATES> and </RATES>. Nothing else.
- Keep the exact same JSON schema, card ids (sbi/myzone/neo/spark), and offer
  "type" values (flat/pctcap/bogo/waiver). Category keys only from:
  ${JSON.stringify(CAT_IDS)}.
- Rates are plain numbers (percent value-back, e.g. 3.75). Only change a value
  if a search result clearly confirms it changed; otherwise keep it as is.
- Remove discontinued offers; add new comparable ones in the same schema.
- Set "lastUpdated" to "${today}".`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 16384 }
        })
      }
    );

    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: "gemini error", detail: body.slice(0, 300) });
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const raw = extract(text, "RATES");
    if (!raw) return res.status(502).json({ error: "no <RATES> block in model output" });

    let out;
    try { out = JSON.parse(raw); }
    catch { return res.status(502).json({ error: "unparseable rates output" }); }

    const err = validRates(out);
    if (err) return res.status(502).json({ error: "validation failed", detail: err });

    if (!out.lastUpdated) out.lastUpdated = today;
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "refresh failed", detail: String(e).slice(0, 200) });
  }
}
