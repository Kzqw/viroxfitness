# VIROX — Firebase authentication and owner administration

## Required setup before deployment

The code in this branch uses Firebase Authentication (Google provider), Cloud Firestore, Firebase Admin SDK and Netlify Functions.

### 1. Create/configure Firebase

1. Open the Firebase Console and create a project.
2. In **Authentication → Sign-in method**, enable **Google**.
3. In **Authentication → Settings → Authorized domains**, add:
   - `viroxfitness.netlify.app`
   - your own production domain, if any.
4. Create the **Cloud Firestore** database.
5. In **Project settings → General → Your apps**, register a Web app and copy its public configuration values.
6. In **Project settings → Service accounts**, generate a private service-account key. Keep this JSON private.

### 2. Add Netlify environment variables

In Netlify → Site configuration → Environment variables, add:

- `FIREBASE_WEB_API_KEY` — Firebase Web app `apiKey`
- `FIREBASE_AUTH_DOMAIN` — Firebase Web app `authDomain`
- `FIREBASE_PROJECT_ID` — Firebase project ID
- `FIREBASE_APP_ID` — Firebase Web app `appId`
- `FIREBASE_SERVICE_ACCOUNT` — the complete service-account JSON on one line
- `OWNER_EMAIL` — `walidox.dzz@gmail.com`

Never put the service-account JSON or its private key in GitHub, HTML, or a public chat. Only Netlify Functions should receive it.

After adding the variables, trigger a new deploy so the Functions receive them.

### 3. Firestore security rules

Publish the contents of `firestore.rules` in Firebase Console → Firestore Database → Rules. The browser is deliberately denied direct access; trusted Netlify Functions use the Firebase Admin SDK.

### 4. Test

- Open the Netlify site and choose **Continue with Google** in Profile.
- Sign in with the owner Google account above.
- Open Profile → VIROX Control Center. The server must identify the account as OWNER.
- Sign in with a different Google account and verify it cannot access the Control Center.
- Check that user records appear in Firestore → `users`.

## Important limitations

- The existing VIROX workout/profile data still uses browser-local storage; this branch adds cloud identity and server-side account records, not full cross-device workout synchronization.
- Premium payment is **not activated**. The existing €9.99 screen is a design preview. No card is charged, and an admin Premium grant is a manual 30-day entitlement, not a verified payment.
- The dashboard does not report Stripe/App Store revenue. A payment provider, server-side checkout, webhook signature verification, refunds and subscription lifecycle handling must be implemented before taking payments.
- Test the branch preview and complete the Firebase setup before merging it into `main`. Netlify automatically publishes `main`.
