// Live merchant lookup — classifies any brand the user types into one of the
// app's categories using Gemini (free tier). Same-origin only, edge-cached.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const CAT_IDS = [
  "homecentre","lifestyle","max","spar","landmarkx","dining","movies","swiggy",
  "zomato","myntra","online","grocery","travel","intl","fuel","utilities","other"
];

export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim().slice(0, 60);
  if (!q) return res.status(400).json({ error: "missing q" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel env vars" });

  const prompt = `You classify merchants for a personal Indian credit-card recommender.
Merchant typed by user: "${q}"

Return ONLY a JSON object, no markdown, with exactly these keys:
{
 "label": "proper brand name, or the input title-cased if unknown",
 "cat": "one of ${JSON.stringify(CAT_IDS)} — the category this merchant's spend falls under in India. Standalone apparel/footwear/electronics/pharmacy stores = "other". Marketplaces/D2C websites = "online". Restaurants/cafes/QSR = "dining". Supermarkets/quick-commerce = "grocery". OTT/telecom/broadband/DTH = "utilities".",
 "lm": 1 if this brand is commonly stocked INSIDE Landmark Group stores in India (Lifestyle, Max, Home Centre, Spar) else 0,
 "tip": "if lm=1 or there is a category quirk worth knowing (e.g. jewellery earns nothing on DBS Spark), one short sentence, else null",
 "note": "one short factual sentence about what this merchant is, else null"
}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 400,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: "gemini error", detail: body.slice(0, 300) });
    }

    const data = await r.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const cleaned = text.replace(/```json|```/g, "").trim();

    let out;
    try { out = JSON.parse(cleaned); }
    catch { return res.status(502).json({ error: "unparseable model output" }); }

    const result = {
      label: (out.label || q).toString().slice(0, 60),
      cat: CAT_IDS.includes(out.cat) ? out.cat : "other",
      lm: out.lm ? 1 : 0,
      tip: out.tip ? out.tip.toString().slice(0, 200) : null,
      note: out.note ? out.note.toString().slice(0, 200) : null
    };

    // Cache the same query at the edge for a week — you pay Gemini once per brand.
    res.setHeader("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: "lookup failed", detail: String(e).slice(0, 200) });
  }
}
