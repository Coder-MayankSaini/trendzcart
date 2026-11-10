import admin from "firebase-admin";
import { execSync } from "child_process";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();
const apiKey = execSync("npx netlify env:get NEXT_PUBLIC_FIREBASE_API_KEY", { encoding: "utf8" }).trim();

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: "trendkartz",
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

async function run() {
    const adminUid = "jdi97hwEJQYt5NXoUhyISOpW7Hl1";
    console.log("Generating custom token for admin UID:", adminUid);
    const customToken = await admin.auth().createCustomToken(adminUid, { admin: true });

    // Exchange custom token for ID token via Google Auth REST API
    const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });

    const verifyJson = await verifyRes.json();
    if (!verifyJson.idToken) {
        throw new Error("Failed to exchange custom token for ID token: " + JSON.stringify(verifyJson));
    }
    const idToken = verifyJson.idToken;
    console.log("Admin ID token successfully generated.");

    console.log("\nTesting POST /api/admin/reviews/publish-batch with Admin Bearer token during transition pause...");
    const res = await fetch("https://bazaarvilla.com/api/admin/reviews/publish-batch", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
            productId: "82b5c865-3128-4515-96e5-80f7f0eed58e",
            reviews: [
                {
                    externalReviewId: "test-trans-01",
                    reviewerDisplayName: "Test Transition Reviewer",
                    rating: 5,
                    body: "Attempting to publish review during transition pause.",
                    reviewedAt: "2026-11-01",
                    source: "offline-customer-feedback",
                    sourceReference: "TRANS-REF-01",
                    customerConsentConfirmed: true,
                }
            ],
        }),
    });

    console.log("Response Status:", res.status);
    const body = await res.json();
    console.log("Response Body:", JSON.stringify(body, null, 2));

    if (res.status === 503 && body.transitionPaused === true) {
        console.log("\n[SUCCESS]: Transition safety gate is strictly ACTIVE and enforcing 503 on live production!");
    } else {
        console.error("\n[FAILURE]: Expected HTTP 503 with transitionPaused: true!");
        process.exit(1);
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
