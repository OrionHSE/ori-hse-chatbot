// /api/chat.js
// Uses your OpenAI Assistant (files + retrieval) via Assistants v2.
// Env vars in Vercel:
//   OPENAI_API_KEY = <your key>
//   ASSISTANT_ID   = asst_xxxxxxx

export const config = { runtime: "edge" };

const OPENAI_API = "https://api.openai.com/v1";
const OA_HEADERS = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  // REQUIRED for Assistants v2:
  "OpenAI-Beta": "assistants=v2",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const assistantId = process.env.ASSISTANT_ID;
  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });
  if (!assistantId) return new Response("Missing ASSISTANT_ID", { status: 500 });

  let userMessage = "";
  try {
    const body = await req.json();
    userMessage = (body.message || "").toString();
  } catch {
    // no-op
  }

  // 1) Create thread
  const threadRes = await fetch(`${OPENAI_API}/threads`, {
    method: "POST",
    headers: OA_HEADERS(apiKey),
    body: JSON.stringify({}),
  });
  if (!threadRes.ok) {
    const t = await threadRes.text().catch(() => "");
    return new Response(`Failed to create thread (${threadRes.status}): ${t}`, { status: 502 });
  }
  const { id: threadId } = await threadRes.json();

  // 2) Add user message
  const msgRes = await fetch(`${OPENAI_API}/threads/${threadId}/messages`, {
    method: "POST",
    headers: OA_HEADERS(apiKey),
    body: JSON.stringify({ role: "user", content: userMessage }),
  });
  if (!msgRes.ok) {
    const t = await msgRes.text().catch(() => "");
    return new Response(`Failed to add message (${msgRes.status}): ${t}`, { status: 502 });
  }

  // 3) Run the assistant
  const runRes = await fetch(`${OPENAI_API}/threads/${threadId}/runs`, {
    method: "POST",
    headers: OA_HEADERS(apiKey),
    body: JSON.stringify({
      assistant_id: assistantId,
      // Optional: reinforce policy-first behavior
      instructions: `
You are ORI — the Orion HSE Assistant. Use the uploaded Orion HSE Policy files first.
Cite sections like: 📘 [Orion HSE Policy — <Section Title>, §<Number>].
Only reference OSHA if Orion policy is silent, clearly labeled: 🏛️ [OSHA — 29 CFR <part.section>].
Be concise, use short Markdown bullets, and reply in the user's language.
      `.trim(),
    }),
  });
  if (!runRes.ok) {
    const t = await runRes.text().catch(() => "");
    return new Response(`Failed to start run (${runRes.status}): ${t}`, { status: 502 });
  }
  const { id: runId } = await runRes.json();

  // 4) Poll until completed
  let status = "queued";
  let tries = 0;
  const MAX_TRIES = 90; // ~63s

  while (true) {
    await sleep(700);
    tries++;
    const check = await fetch(`${OPENAI_API}/threads/${threadId}/runs/${runId}`, {
      headers: OA_HEADERS(apiKey),
    });
    if (!check.ok) {
      const t = await check.text().catch(() => "");
      return new Response(`Failed to check run (${check.status}): ${t}`, { status: 502 });
    }
    const data = await check.json();
    status = data.status;

    if (status === "completed") break;
    if (status === "requires_action") {
      return new Response("Assistant requires tool action that is not implemented here.", { status: 501 });
    }
    if (status === "failed" || status === "cancelled" || status === "expired") {
      return new Response(`Run ended with status: ${status}`, { status: 500 });
    }
    if (tries > MAX_TRIES) {
      return new Response("Timed out waiting for assistant.", { status: 504 });
    }
  }

  // 5) Read latest assistant message
  const listRes = await fetch(
    `${OPENAI_API}/threads/${threadId}/messages?limit=1&order=desc`,
    { headers: OA_HEADERS(apiKey) }
  );
  if (!listRes.ok) {
    const t = await listRes.text().catch(() => "");
    return new Response(`Failed to read messages (${listRes.status}): ${t}`, { status: 502 });
  }
  const list = await listRes.json();
  const last = list?.data?.[0];
  let textOut = "";

  if (last?.content?.length) {
    for (const part of last.content) {
      if (part.type === "text" && part.text?.value) {
        textOut += part.text.value + "\n";
      }
    }
  }

  textOut = (textOut || "").trim();
  if (!textOut) textOut = "Sorry — I couldn't read a response.";

  return new Response(textOut, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
