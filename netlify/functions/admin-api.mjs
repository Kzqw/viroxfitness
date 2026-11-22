import { services, ownerUser, json } from "./_firebase.mjs";

const allowedSettings = new Set(["winter_enabled", "music_enabled", "signups_open"]);
const dateValue = value => value?.toDate ? value.toDate().toISOString() : value || null;

async function log(db, FieldValue, action, target, actor) {
  await db.collection("admin_activity").add({
    action, target: target || "", actor: actor.email,
    at: FieldValue.serverTimestamp()
  });
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const actor = await ownerUser(request);
    const { db, auth, FieldValue } = services();
    const action = new URL(request.url).searchParams.get("action") || "";
    let body = {};
    try { body = await request.json(); } catch {}
    const usersRef = db.collection("users");

    if (action === "stats") {
      const snap = await usersRef.get();
      const docs = snap.docs.map(doc => doc.data());
      const now = Date.now();
      const sevenDays = now - 7 * 24 * 60 * 60 * 1000;
      const users = docs.length;
      const premium = docs.filter(u => u.premium === true &&
        (!u.premium_expires_at?.toDate || u.premium_expires_at.toDate().getTime() > now)).length;
      const new7 = docs.filter(u => (u.created_at?.toDate?.().getTime() || 0) >= sevenDays).length;
      const activitySnap = await db.collection("admin_activity").orderBy("at", "desc").limit(8).get().catch(() => null);
      const activity = activitySnap ? activitySnap.docs.map(d => {
        const v = d.data(); return { action: v.action || "", target: v.target || "", at: dateValue(v.at) };
      }) : [];
      return json({ users, premium, new7, mrr_cents: null, activity });
    }

    if (action === "users") {
      const q = String(body.q || "").trim().toLowerCase().slice(0, 120);
      const snap = await usersRef.limit(500).get();
      const result = snap.docs.map(doc => {
        const u = doc.data();
        const expiry = u.premium_expires_at?.toDate?.() || null;
        const premium = u.premium === true && (!expiry || expiry.getTime() > Date.now());
        return {
          id: doc.id, email: u.email || "", role: u.role || "USER",
          access_blocked: u.access_blocked === true, premium,
          created_at: dateValue(u.created_at)
        };
      }).filter(u => !q || u.email.toLowerCase().includes(q));
      return json({ users: result });
    }

    if (action === "subs") {
      const snap = await usersRef.where("premium", "==", true).limit(500).get();
      const subs = snap.docs.map(doc => {
        const u = doc.data();
        return {
          user_id: doc.id, email: u.email || "", status: u.access_blocked ? "blocked" : "active",
          source: "Admin grant", current_period_end: dateValue(u.premium_expires_at),
          cancel_at_period_end: false
        };
      }).filter(s => !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now());
      return json({ subs });
    }

    if (action === "settings") {
      const snap = await db.collection("settings").doc("public").get();
      return json({ settings: { winter_enabled: true, music_enabled: true, signups_open: true, ...(snap.exists ? snap.data() : {}) } });
    }

    if (action === "setting") {
      const key = String(body.key || "");
      if (!allowedSettings.has(key) || typeof body.value !== "boolean") return json({ error: "Invalid setting" }, 400);
      await db.collection("settings").doc("public").set({ [key]: body.value, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      await log(db, FieldValue, "setting:" + key, String(body.value), actor);
      return json({ success: true });
    }

    if (action === "user-block") {
      const uid = String(body.id || "");
      if (!uid || uid === actor.uid) return json({ error: "Invalid target account" }, 400);
      const ref = usersRef.doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return json({ error: "User not found" }, 404);
      if (String(snap.data().email || "").toLowerCase() === String(process.env.OWNER_EMAIL).toLowerCase()) {
        return json({ error: "The owner account cannot be blocked" }, 403);
      }
      const blocked = body.blocked === true;
      await auth.updateUser(uid, { disabled: blocked });
      if (blocked) await auth.revokeRefreshTokens(uid);
      await ref.set({ access_blocked: blocked, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      await log(db, FieldValue, blocked ? "user:blocked" : "user:unblocked", uid, actor);
      return json({ success: true });
    }

    if (action === "premium") {
      const uid = String(body.id || "");
      if (!uid || uid === actor.uid) return json({ error: "Invalid target account" }, 400);
      const ref = usersRef.doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return json({ error: "User not found" }, 404);
      const grant = body.grant === true;
      await ref.set({
        premium: grant,
        premium_expires_at: grant ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });
      await log(db, FieldValue, grant ? "premium:granted-30d" : "premium:revoked", uid, actor);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 404);
  } catch (error) {
    return json({ error: error.message || "Request failed" }, error.status || 500);
  }
}
