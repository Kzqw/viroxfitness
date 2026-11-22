import { services, json } from "./_firebase.mjs";

const defaults = { winter_enabled: true, music_enabled: true, signups_open: true };

export default async function handler(request) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  try {
    const { db } = services();
    const snap = await db.collection("settings").doc("public").get();
    return json({ ...defaults, ...(snap.exists ? snap.data() : {}) });
  } catch (error) {
    return json({ error: "Public settings are temporarily unavailable" }, 503);
  }
}
