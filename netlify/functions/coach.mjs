import { verifiedUser, json } from "./_firebase.mjs";

const MAX_MESSAGES = 8;
const MAX_CHARS = 1200;
const DAILY_LIMIT = 12;

const instructions = `You are VIROX Coach, a supportive, age-appropriate fitness education assistant.
Give general, safe exercise guidance. Encourage technique, gradual progression, rest, hydration, enjoyment and consistency.
Never prescribe extreme routines, maximal-effort challenges, calorie restriction, weight-loss targets, supplements, or body-shape ideals.
Do not diagnose injuries or medical conditions. If the user mentions pain, injury, illness, dizziness, or a medical concern, advise them to stop the activity and speak with a qualified healthcare professional and a trusted adult where appropriate.
Do not shame, compare bodies, or promise physical results. Adapt suggestions to the user's stated experience and available equipment.
Keep answers clear, practical, encouraging, and concise. Ask one clarifying question only when essential.`;

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await verifiedUser(request);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "The VIROX Coach is not configured yet. Add OPENAI_API_KEY to Netlify environment variables." }, 503);

    let body = {};
    try { body = await request.json(); } catch {}
    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages = raw.slice(-MAX_MESSAGES).map(item => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]/g, "").trim().slice(0, MAX_CHARS)
    })).filter(item => item.content);

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "Write a message to start your coaching conversation." }, 400);
    }

    const { services } = await import("./_firebase.mjs");
    const { db } = services();
    const day = new Date().toISOString().slice(0, 10);
    const userRef = db.collection("users").doc(user.uid);
    const allowed = await db.runTransaction(async tx => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};
      const count = data.coach_day === day ? Number(data.coach_requests || 0) : 0;
      if (count >= DAILY_LIMIT) return false;
      tx.set(userRef, { coach_day: day, coach_requests: count + 1 }, { merge: true });
      return true;
    });
    if (!allowed) return json({ error: "You've reached today's Coach limit. Take a break and come back tomorrow." }, 429);

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6.2-astra",
        instructions,
        input: messages,
        max_output_tokens: 650,
        store: false
      })
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("VIROX Coach upstream error", upstream.status, result?.error?.code || "unknown");
      return json({ error: upstream.status === 429 ? "The Coach is busy right now. Try again shortly." : "The Coach could not answer right now. Please try again later." }, 502);
    }

    const answer = (result.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text || "")
      .join("\n")
      .trim();

    if (!answer) return json({ error: "The Coach returned an empty answer. Please try again." }, 502);
    return json({ answer, remaining: Math.max(0, DAILY_LIMIT - ((await userRef.get()).data()?.coach_requests || 0)) });
  } catch (error) {
    console.error("VIROX Coach error", error?.message || "unknown");
    return json({ error: error.message || "Authentication failed" }, error.status || 500);
  }
}
