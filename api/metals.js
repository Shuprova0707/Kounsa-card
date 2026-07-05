// Live gold & silver rates for Bengaluru. Gemini + Google Search fetches today's
// prices, returns JSON. Edge-cached for 6 hours so it costs ~4 Gemini calls a
// day no matter how many people open the page. Prices are best-effort — the UI
// tells the user to verify before a big jewellery purchase.

export const maxDuration = 30;

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function extract(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/```json|```/g, "").trim() : null;
}

// Sanity ranges (per gram, INR) so a stray/hallucinated number can't render.
function valid(o) {
  const g = n => typeof n === "number" && n > 3000 && n < 25000;
  const s = n => typeof n === "number" && n > 30 && n < 600;
  if (!o || !g(o.gold24) || !g(o.gold22) || !s(o.silver)) return false;
  if (o.gold22 >= o.gold24) return false; // 22K must be cheaper than 24K
  return true;
}

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel env vars" });

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Use Google Search to find TODAY'S retail gold and
silver rates in Bengaluru (Bangalore), India. Check sources like goodreturns.in,
bankbazaar.com, and local jeweller rate pages.

Return ONLY the numbers between <METALS> and </METALS>, as a JSON object, nothing else:
<METALS>
{"gold24": <24K gold price per GRAM in INR>,
 "gold22": <22K gold price per GRAM in INR>,
 "silver": <silver price per GRAM in INR>,
 "asOf": "${today}"}
</METALS>
Plain numbers only (e.g. 7250), no commas, no currency symbols. 22K must be lower than 24K.`;

  try {
    let r, err = "gemini error";
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
          })
        }
      );
      if (r.ok) break;
      const body = await r.text();
      err = `gemini ${r.status}: ${body.slice(0, 150)}`;
      if (attempt === 0 && [429, 500, 502, 503].includes(r.status)) continue;
      return res.status(502).json({ error: err });
    }
    if (!r.ok) return res.status(502).json({ error: err });

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const raw = extract(text, "METALS");
    if (!raw) return res.status(502).json({ error: "no <METALS> block in model output" });

    let out;
    try { out = JSON.parse(raw); }
    catch { return res.status(502).json({ error: "unparseable metals output" }); }

    if (!valid(out)) return res.status(502).json({ error: "metals prices failed sanity check" });

    const result = {
      city: "Bengaluru",
      gold24: Math.round(out.gold24),
      gold22: Math.round(out.gold22),
      silver: Math.round(out.silver),
      asOf: out.asOf || today
    };

    // Edge-cache for 6 hours; serve stale for a day while revalidating.
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: "metals lookup failed", detail: String(e).slice(0, 200) });
  }
}
