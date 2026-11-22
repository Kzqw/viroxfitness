import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export function services() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid JSON");
    }
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    initializeApp({ credential: cert(serviceAccount) });
  }
  return { auth: getAuth(), db: getFirestore(), FieldValue };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function verifiedUser(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const { auth } = services();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch {
    throw Object.assign(new Error("Invalid or expired session"), { status: 401 });
  }
  if (!decoded.email || decoded.email_verified !== true) {
    throw Object.assign(new Error("A verified Google account is required"), { status: 403 });
  }
  return decoded;
}

export async function ownerUser(request) {
  const user = await verifiedUser(request);
  const ownerEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (!ownerEmail || String(user.email).toLowerCase() !== ownerEmail) {
    throw Object.assign(new Error("Owner access only"), { status: 403 });
  }
  return user;
}

export function methodNotAllowed() {
  return json({ error: "Method not allowed" }, 405);
}
