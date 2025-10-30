

export const config = { runtime: "edge" };

const OPENAI_API = "https://api.openai.com/v1";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const assistantId = process.env.ASSISTANT_ID;

  if (!apiKey) return new Response("Missing OPENAI_API_KEY", { status: 500 });
  if (!assistantId) return new Response("Missing ASSISTANT_ID", { status: 500 });

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const userMessage = (body.message || "").toString();

  // 1) Create a new thread
  const threadRes = await fetch(`${OPENAI_API}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!threadRes.ok) {
    const t = await threadRes.text().catch(() => "");
    return new Response(`Failed to create thread: ${t}`, { status: 502 });
  }

  const thread = await threadRes.json();
  const threadId = thread.id;

  // 2) Add the user message to the thread
  const msgRes = await fetch(`${OPENAI_API}/threads/${threadId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "user",
      content: userMessage,
    }),
  });

  if (!msgRes.ok) {
    const t = await msgRes.text().catch(() => "");
    return new Response(`Failed to add message: ${t}`, { status: 502 });
  }

  // 3) Create a run using your Assistant (policy files live there)
  //    We reinforce the policy-first behavior via "instructions" too.
  const runRes = await fetch(`${OPENAI_API}/threads/${threadId}/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistant_id: assistantId,
      instructions: `
You are ORI — the Orion HSE Assistant.

SCOPE & SOURCING
- Primary source: the Orion HSE Policy files attached to this Assistant.
- Cite the policy with section title and number:
  📘 [Orion HSE Policy — <Section Title>, §<Number>]
- Only reference OSHA if Orion policy does NOT address it, clearly labeled:
  🏛️ [OSHA — 29 CFR <part.section>]
- If unsure, say so; do not invent sections.

STYLE
- Use concise Markdown with short bullets and **bold** labels.
- Reply in the user's language (English or Spanish).
      `.trim(),
    }),
  });

  if (!runRes.ok) {
    const t = await runRes.text().catch(() => "");
    return new Response(`Failed to start run: ${t}`, { status: 502 });
  }

  const run = await runRes.json();
  const runId = run.id;

  // 4) Poll until the run completes
  let status = run.status;
  let tries = 0;
  const MAX_TRIES = 90; // ~90 * 700ms ≈ 63s

  while (status === "queued" || status === "in_progress" || status === "cancelling") {
    await sleep(700);
    tries++;
    if (tries > MAX_TRIES) {
      return new Response("Timed out waiting for assistant.", { status: 504 });
    }

    const check = await fetch(`${OPENAI_API}/threads/${threadId}/runs/${runId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!check.ok) {
      const t = await check.text().catch(() => "");
      return new Response(`Failed to check run: ${t}`, { status: 502 });
    }

    const data = await check.json();
    status = data.status;

    if (status === "requires_action") {
      // If you add tools later, handle required tool calls here.
      // For now, just fail gracefully.
      return new Response("Assistant requires action not implemented in this API.", { status: 501 });
    }
  }

  if (status !== "completed") {
    return new Response(`Run ended with status: ${status}`, { status: 500 });
  }

  // 5) Get the latest assistant message
  const listRes = await fetch(
    `${OPENAI_API}/threads/${threadId}/messages?limit=1&order=desc`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  if (!listRes.ok) {
    const t = await listRes.text().catch(() => "");
    return new Response(`Failed to read messages: ${t}`, { status: 502 });
  }

  const list = await listRes.json();
  const last = list?.data?.[0];
  let textOut = "";

  if (last?.content?.length) {
    // Concatenate text parts (ignore images/attachments)
    for (const part of last.content) {
      if (part.type === "text" && part.text?.value) {
        textOut += part.text.value + "\n";
      }
    }
  }

  textOut = textOut.trim();
  if (!textOut) textOut = "Sorry — I couldn't read a response.";

  // Return as plain text (front-end will animate/type it out)
  return new Response(textOut, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

