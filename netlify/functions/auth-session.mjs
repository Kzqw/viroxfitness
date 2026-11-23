import { services, verifiedUser, json } from "./_firebase.mjs";

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await verifiedUser(request);
    const { db, auth, FieldValue } = services();
    const ownerEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
    if (!ownerEmail) return json({ error: "Owner account is not configured" }, 503);
    const role = String(user.email).toLowerCase() === ownerEmail ? "OWNER" : "USER";
    const ref = db.collection("users").doc(user.uid);
    const snapshot = await ref.get();
    const previous = snapshot.exists ? snapshot.data() : {};
    if (!snapshot.exists && role !== "OWNER") {
      const pub = await db.collection("settings").doc("public").get();
      if (pub.exists && pub.data().signups_open === false) {
        return json({ error: "New sign-ups are currently closed" }, 403);
      }
    }
    const blocked = previous.access_blocked === true;
    if (blocked) {
      try { await auth.revokeRefreshTokens(user.uid); } catch {}
      return json({ error: "This VIROX account is blocked" }, 403);
    }
    await ref.set({
      uid: user.uid,
      email: String(user.email).toLowerCase(),
      display_name: user.name || "",
      photo_url: user.picture || "",
      role,
      access_blocked: false,
      created_at: previous.created_at || FieldValue.serverTimestamp(),
      last_seen_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    }, { merge: true });
    const expiry = previous.premium_expires_at?.toDate?.() || null;
    const premium = previous.premium === true && (!expiry || expiry.getTime() > Date.now());
    return json({
      uid: user.uid,
      email: String(user.email).toLowerCase(),
      displayName: user.name || "",
      photoURL: user.picture || "",
      role,
      premium,
      premiumExpiresAt: expiry ? expiry.toISOString() : null,
      accessBlocked: false
    });
  } catch (error) {
    return json({ error: error.message || "Authentication failed" }, error.status || 500);
  }
}
