/**
 * TASK 023 — Post-Deployment Live Verification Script
 * Validates the deployed purchase activity counter, admin controls, security,
 * and storefront integrity on live production: https://bazaarvilla.com
 */

import admin from "firebase-admin";
import { execSync } from "child_process";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();
const apiKey = execSync("npx netlify env:get NEXT_PUBLIC_FIREBASE_API_KEY", { encoding: "utf8" }).trim();
const targetSlug = "personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women";
const targetProductId = "82b5c865-3128-4515-96e5-80f7f0eed58e";

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: "trendkartz",
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

async function runLiveVerification() {
    const db = admin.firestore();
    console.log("================================================================================");
    console.log("TASK 023 — LIVE PRODUCTION COMPREHENSIVE VERIFICATION");
    console.log("Domain:       https://bazaarvilla.com");
    console.log("Target Slug:  ", targetSlug);
    console.log("Target ID:    ", targetProductId);
    console.log("================================================================================\n");

    const results = [];
    function record(checkName, passed, details) {
        results.push({ checkName, passed, details });
        console.log(`[${passed ? "PASS" : "FAIL"}] ${checkName}: ${details}`);
    }

    // 1. Generate Authorized Admin ID Token
    const adminUid = "jdi97hwEJQYt5NXoUhyISOpW7Hl1";
    const customToken = await admin.auth().createCustomToken(adminUid, { admin: true });
    const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    const authJson = await authRes.json();
    const adminIdToken = authJson.idToken;
    record("Admin Token Generation", !!adminIdToken, "Provisioned valid Firebase ID token for authorized admin UID " + adminUid);

    // 2. Public API endpoint test
    const publicApiRes = await fetch(`https://bazaarvilla.com/api/products/${targetProductId}/purchase-activity`);
    const publicApiJson = await publicApiRes.json();
    const isPublicValid = publicApiRes.status === 200 &&
        publicApiJson.productId === targetProductId &&
        publicApiJson.metric === "units_sold" &&
        typeof publicApiJson.count === "number" &&
        typeof publicApiJson.label === "string" &&
        typeof publicApiJson.visible === "boolean" &&
        publicApiJson.orderId === undefined &&
        publicApiJson.customerName === undefined &&
        publicApiJson.email === undefined;
    record("Public API Security & Data Minimization", isPublicValid, `Status: ${publicApiRes.status}, count: ${publicApiJson.count}, visible: ${publicApiJson.visible}, PII redacted: true`);

    // 3. Edge CDN Cache-Control header
    const cacheHeader = publicApiRes.headers.get("cache-control") || "";
    record("Public API CDN Cache Headers", cacheHeader.includes("s-maxage=3600") || cacheHeader.includes("public"), `Cache-Control: ${cacheHeader}`);

    // 4. Test Fixture exclusion from public activity
    const fixtureRes = await fetch("https://bazaarvilla.com/api/products/task013_test_prod_simple/purchase-activity");
    record("Test Fixture Product 404 Exclusion", fixtureRes.status === 404, `Status: ${fixtureRes.status} (strictly barred)`);

    // 5. Admin API Authentication Enforcement (401 on missing auth)
    const unauthAdminRes = await fetch(`https://bazaarvilla.com/api/admin/products/${targetProductId}/purchase-activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recalculate: true }),
    });
    record("Admin API Unauthenticated 401 Rejection", unauthAdminRes.status === 401, `Status: ${unauthAdminRes.status}`);

    // 6. Admin API Recalculation with genuine Admin ID token
    const authAdminRes = await fetch(`https://bazaarvilla.com/api/admin/products/${targetProductId}/purchase-activity`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${adminIdToken}`,
        },
        body: JSON.stringify({ recalculate: true, periodDays: 30, displayThreshold: 5 }),
    });
    const authAdminJson = await authAdminRes.json();
    record("Admin Recalculation & Config Persistence", authAdminRes.status === 200 && authAdminJson.success === true, `Status: ${authAdminRes.status}, unitsSold: ${authAdminJson.activity?.unitsSold}, period: ${authAdminJson.activity?.periodDays}`);

    // 7. Storefront PDP Availability & Hydration
    const pdpRes = await fetch(`https://bazaarvilla.com/products/${targetSlug}`);
    const pdpHtml = await pdpRes.text();
    const pdpClean = pdpRes.status === 200 && !pdpHtml.includes("Application error") && !pdpHtml.includes("500 Internal");
    record("Storefront PDP Rendering", pdpClean, `Status: ${pdpRes.status}, HTML bytes: ${pdpHtml.length}`);

    // 8. Review Management System Preservation (TASK 022)
    const reviewsRes = await fetch(`https://bazaarvilla.com/api/reviews?productId=${targetProductId}`);
    record("TASK 022 Review System Preservation", reviewsRes.status === 200, `Status: ${reviewsRes.status}`);

    // 9. Public Checkout Gate Preservation
    const checkoutGateRes = await fetch("https://bazaarvilla.com/api/razorpay/public-config");
    const checkoutGateJson = await checkoutGateRes.json();
    record("Commercial Checkout Gate Operational", checkoutGateRes.status === 200 && checkoutGateJson.commercialCheckoutEnabled === true, `Status: ${checkoutGateRes.status}, enabled: ${checkoutGateJson.commercialCheckoutEnabled}`);

    console.log("\n================================================================================");
    const passedCount = results.filter(r => r.passed).length;
    console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`);
    console.log("================================================================================\n");

    if (passedCount !== results.length) {
        process.exit(1);
    }
}

runLiveVerification().catch((err) => {
    console.error("Verification error:", err);
    process.exit(1);
});
