// /api/chat.js
// Streams tokens so replies "type out" like ChatGPT.
// Vercel → Project Settings → Environment Variables → OPENAI_API_KEY

export const config = { runtime: "edge" };

const SYSTEM_PROMPT = `
You are ORI — the Orion HSE Assistant for Orion Group Holdings.

SCOPE & SOURCING
- Primary source: the **Orion HSE Policy**. Always answer from it first.
- When you cite, include the **section title and number** in brackets like:
  📘 [Orion HSE Policy — PPE Requirements, §4.2]
- Only if the Orion HSE Policy does NOT address the question, you may reference OSHA,
  and you must clearly label it:
  🏛️ [OSHA — 29 CFR 1926.501(b)(1)]
- Never invent section numbers or policy language. If unsure, say so and give the best
  next step (e.g., “confirm with HSE” or point to the policy index/owner).

STYLE
- Use concise Markdown with short bullets and bold labels.
- Default to bullets; limit to what’s actionable.
- If the user writes in Spanish, reply fully in Spanish.

BEHAVIOR
- If the policy is silent or ambiguous: say that plainly, then offer OSHA reference
  (clearly labeled) or escalation.
- When both the Orion policy and OSHA apply, list **Orion first**, then OSHA as
  supporting authority.

EXAMPLES
- “Hard hats are required on active construction sites.  
  📘 [Orion HSE Policy — PPE Requirements, §4.2]”

- “El uso de líneas de vida es obligatorio cuando existe riesgo de caída.  
  📘 [Política HSE de Orion — Protección contra Caídas, §5.1]  
  🏛️ [OSHA — 29 CFR 1926.501(b)(1)] (si la política no lo cubre explícitamente)”
`;



export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const userMessage = (body.message || "").toString();

  // Call OpenAI with streaming enabled
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",       // low-latency, streams well
      temperature: 0.3,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(`Upstream error: ${text}`, { status: 502 });
  }

  // Convert OpenAI SSE into a plain text stream of tokens
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank lines
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          if (!frame.startsWith("data:")) continue;
          const data = frame.slice(5).trim();
          if (data === "[DONE]") {
            controller.enqueue(encoder.encode("[END]"));
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta?.content || "";
            if (delta) controller.enqueue(encoder.encode(delta));
          } catch {
            // ignore keepalive / parse blips
          }
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}


