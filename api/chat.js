// /api/chat.js
// Streams tokens so replies "type out" like ChatGPT.
// Vercel → Project Settings → Environment Variables → OPENAI_API_KEY

export const config = { runtime: "edge" };

const SYSTEM_PROMPT = `
You are ORI — the Orion HSE Assistant.
Write concise answers with clean formatting:
- Prefer short bullet points over big paragraphs.
- Bold key labels.
- Keep paragraphs 1–3 sentences max.
- If the user writes in Spanish, reply in Spanish.
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

      controller.enqueue(new TextEncoder().encode("[END]"));
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
