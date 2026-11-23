import { services, verifiedUser, json } from "./_firebase.mjs";

const FREE_DAILY_LIMIT = 5;
const PREMIUM_DAILY_LIMIT = 40;
const MAX_MESSAGE_LENGTH = 3000;
const SYSTEM_PROMPT = [
  "You are VIROX Coach, a supportive fitness and wellbeing assistant.",
  "Answer in the language used by the user, preferably French or English.",
  "Give practical, clear, age-appropriate exercise guidance.",
  "Adapt recommendations to stated goals, experience, equipment and schedule.",
  "Prioritize safe technique, gradual progression, rest, hydration and consistency.",
  "Do not diagnose, prescribe treatment, or claim to replace a qualified professional.",
  "Do not recommend extreme exercise, dangerous challenges, restrictive diets, calorie deficits, supplements or performance-enhancing drugs.",
  "Do not shame, compare or judge bodies, weight or appearance. Focus on strength, skill, energy and wellbeing.",
  "If the user mentions pain, injury, illness or concerning symptoms, advise stopping the activity and speaking with a trusted adult or qualified healthcare professional.",
  "For minors, do not provide weight-loss plans, calorie targets, body transformation promises or maximal lifting prescriptions.",
  "When information is missing, ask one concise follow-up question rather than inventing personal details.",
  "Be transparent when uncertain."
].join(" ");

function isPremium(userDoc) {
  if (!userDoc || userDoc.premium !== true) return false;
  const expiry = userDoc.premium_expires_at;
  if (!expiry) return true;
  const date = expiry.toDate ? expiry.toDate() : new Date(expiry);
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now();
}

async function callGemini(apiKey, messages) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.65, maxOutputTokens: 900 }
      })
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("AI provider request failed");
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!text) throw new Error("AI provider returned an empty response");
  return text;
}

async function callGroq(apiKey, messages) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.65,
      max_tokens: 900,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("AI provider request failed");
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI provider returned an empty response");
  return text;
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await verifiedUser(request);
    const { db, FieldValue } = services();
    const action = new URL(request.url).searchParams.get("action") || "";
    const userRef = db.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists || userSnap.data().access_blocked === true) {
      return json({ error: "VIROX account is not available" }, 403);
    }
    const premium = isPremium(userSnap.data());
    const limit = premium ? PREMIUM_DAILY_LIMIT : FREE_DAILY_LIMIT;
    let body = {};
    try { body = await request.json(); } catch {}

    if (action === "history") {
      const snap = await userRef.collection("coach_threads").orderBy("updated_at", "desc").limit(12).get();
      return json({
        threads: snap.docs.map(doc => {
          const value = doc.data();
          return {
            id: doc.id,
            title: String(value.title || "New conversation").slice(0, 80),
            messages: Array.isArray(value.messages) ? value.messages.slice(-16) : [],
            updatedAt: value.updated_at?.toDate?.()?.toISOString?.() || null
          };
        }),
        premium,
        dailyLimit: limit
      });
    }

    if (action !== "chat") return json({ error: "Unknown action" }, 404);
    const message = String(body.message || "").trim();
    if (!message) return json({ error: "Write a message first" }, 400);
    if (message.length > MAX_MESSAGE_LENGTH) return json({ error: "Message is too long" }, 400);

    const provider = (process.env.AI_PROVIDER || "gemini").trim().toLowerCase();
    const apiKey = (process.env.AI_API_KEY || "").trim();
    if (!apiKey) return json({ error: "The AI coach is not configured yet" }, 503);
    if (provider !== "gemini" && provider !== "openai") return json({ error: "Unsupported AI provider configuration" }, 503);

    const day = new Date().toISOString().slice(0, 10);
    const usageRef = db.collection("coach_usage").doc(user.uid + "_" + day);
    let used = 0;
    try {
      await db.runTransaction(async transaction => {
        const usageSnap = await transaction.get(usageRef);
        used = Number(usageSnap.exists ? usageSnap.data().count || 0 : 0);
        if (used >= limit) throw Object.assign(new Error("Daily coach message limit reached"), { status: 429 });
        transaction.set(usageRef, {
          uid: user.uid, day, count: used + 1, updated_at: FieldValue.serverTimestamp()
        }, { merge: true });
      });
    } catch (error) {
      if (error.status === 429) return json({ error: error.message, limit, remaining: 0 }, 429);
      throw error;
    }

    const threads = userRef.collection("coach_threads");
    const requestedId = String(body.threadId || "").trim().slice(0, 100);
    const threadRef = requestedId ? threads.doc(requestedId) : threads.doc();
    const threadSnap = requestedId ? await threadRef.get() : null;
    if (requestedId && !threadSnap.exists) return json({ error: "Conversation not found" }, 404);
    const previous = threadSnap?.exists && Array.isArray(threadSnap.data().messages)
      ? threadSnap.data().messages.slice(-10) : [];
    const messages = [...previous, { role: "user", content: message }];
    const reply = provider === "openai" ? await callGroq(apiKey, messages) : await callGemini(apiKey, messages);
    const savedMessages = [...messages, { role: "assistant", content: reply }].slice(-16);
    const title = threadSnap?.exists ? String(threadSnap.data().title || message.slice(0, 60)) : message.slice(0, 60);
    await threadRef.set({
      title, messages: savedMessages,
      created_at: threadSnap?.exists ? threadSnap.data().created_at : FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });

    return json({ reply, threadId: threadRef.id, premium, dailyLimit: limit, remaining: Math.max(0, limit - used - 1) });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) return json({ error: "The coach is temporarily unavailable. Please try again." }, status);
    return json({ error: error.message || "Request failed" }, status);
  }
}
