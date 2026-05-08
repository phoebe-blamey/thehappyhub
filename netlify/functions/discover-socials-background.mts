import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
  let body: any;
  try { body = await req.json(); } catch { return; }

  const { clientId, name, websiteUrl, linkedIn, businessName } = body;
  if (!clientId) return;

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) { console.log("No ANTHROPIC_API_KEY — skipping discovery"); return; }

  const hasWebsite  = !!websiteUrl;
  const hasLinkedIn = !!linkedIn;
  if (!hasWebsite && !hasLinkedIn) return;

  const prompt = `A new coaching client named "${name}" has booked a Broker Business Breakthrough session with Phoebe Blamey (business coach, consultant, financial expert).

Known details:
- Business name: ${businessName || "not provided"}
- Website: ${websiteUrl || "not provided"}
- LinkedIn: ${linkedIn || "not provided"}

Based on these details, provide a quick pre-session intelligence brief:

## ⚠️ FOR PHOEBE'S ATTENTION
Anything Phoebe should know BEFORE the call — red flags, sensitive context, contradictions, things to handle with care. Be honest but kind. If you genuinely found nothing concerning, say "Nothing flagged — all clear from public sources." Don't fabricate concerns.

## SOCIAL MEDIA TO CHECK
List the social profiles Phoebe should review before the session (Instagram, Facebook, LinkedIn, TikTok). Include likely handles or URLs based on their business name and website domain.

## BUSINESS SNAPSHOT
What type of business is this likely to be? What industry? Who do they likely serve?

## DIGITAL PRESENCE GUESS
Based on the URL/domain structure alone — what does their online presence likely look like? (e.g. appears to be a service business with a personal brand, or a corporate firm, etc.)

## QUESTIONS TO PREPARE
2-3 specific questions Phoebe should have ready for this client based on what can be inferred.

Keep it brief and practical. Note clearly what is inferred vs confirmed.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await resp.json();
    const aiText: string = data.content?.[0]?.text || "";

    if (aiText) {
      const store = getStore("clients");
      const clientRaw = await store.get(clientId);
      if (clientRaw) {
        const client = JSON.parse(clientRaw);
        client.notes = client.notes || {};
        client.notes.research = `PRE-SESSION INTELLIGENCE (auto-generated — run full Research Brief for depth)\n\n${aiText}`;
        if (!client.biz && businessName) client.biz = businessName;
        await store.set(clientId, JSON.stringify(client));
        console.log(`Social discovery complete for ${name}`);
      }
    }
  } catch (err) {
    console.error("Discovery error:", err);
  }
};
