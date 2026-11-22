import { json } from "./_firebase.mjs";

export default async function handler(request) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const config = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    appId: process.env.FIREBASE_APP_ID || ""
  };
  if (Object.values(config).some(value => !value)) {
    return json({ error: "Firebase web configuration is incomplete" }, 503);
  }
  return json(config);
}
