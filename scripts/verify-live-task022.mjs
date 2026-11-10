import admin from "firebase-admin";
import { execSync } from "child_process";
import crypto from "crypto";

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
    console.log("TASK 022 — LIVE PRODUCTION COMPREHENSIVE VERIFICATION");
    console.log("Domain: https://bazaarvilla.com");
    console.log("Product Slug:", targetSlug);
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

    // 2. /admin/reviews page availability
    const adminPageRes = await fetch("https://bazaarvilla.com/admin/reviews");
    record("/admin/reviews Route Availability", adminPageRes.status === 200, `HTTP status ${adminPageRes.status}`);

    // 3. /api/admin/reviews endpoint listing with admin token
    const adminReviewsRes = await fetch(`https://bazaarvilla.com/api/admin/reviews?productId=${targetProductId}`, {
        headers: { Authorization: `Bearer ${adminIdToken}` },
    });
    const adminReviewsJson = await adminReviewsRes.json();
    record("Admin Reviews API Authentication", adminReviewsRes.status === 200, `HTTP status ${adminReviewsRes.status}, retrieved ${adminReviewsJson.reviews?.length || 0} reviews`);

    // 4. JSON Import Validation Engine
    const validateRes = await fetch("https://bazaarvilla.com/api/admin/reviews/validate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminIdToken}`,
        },
        body: JSON.stringify({
            productId: targetProductId,
            reviews: [
                {
                    externalReviewId: "val-test-live-001",
                    reviewerDisplayName: "Aarav Gupta",
                    rating: 5,
                    title: "Exquisite Quality",
                    body: "The eyes engraving looks identical to my photo. Very pleased with the craftsmanship.",
                    reviewedAt: "2026-11-08",
                    source: "offline-customer-feedback",
                    sourceReference: "STORE-INV-2026-9921",
                    customerConsentConfirmed: true,
                },
                {
                    externalReviewId: "sim-test-live-002",
                    reviewerDisplayName: "Simulated Reviewer",
                    rating: 4,
                    title: "Simulated Test Entry",
                    body: "This is a private simulation entry for verification.",
                    reviewedAt: "2026-11-08",
                    source: "simulated-test",
                    customerConsentConfirmed: true,
                },
                {
                    externalReviewId: "invalid-test-003",
                    reviewerDisplayName: "Bad Rating",
                    rating: 9, // Invalid rating
                    body: "Invalid rating test.",
                    reviewedAt: "2026-11-08",
                    source: "offline-customer-feedback",
                    sourceReference: "REF-03",
                    customerConsentConfirmed: true,
                }
            ],
        }),
    });
    const validateJson = await validateRes.json();
    const validEntry = validateJson.entries?.find((e) => e.externalReviewId === "val-test-live-001");
    const simEntry = validateJson.entries?.find((e) => e.externalReviewId === "sim-test-live-002");
    const invalidEntry = validateJson.entries?.find((e) => e.externalReviewId === "invalid-test-003");

    record("JSON Import Validation - Authentic Item", validEntry?.valid === true && validEntry?.eligibleForPublication === true, "Valid 5-star review marked eligible");
    record("JSON Import Validation - Simulation Item", simEntry?.valid === true && simEntry?.isSimulation === true && simEntry?.eligibleForPublication === false, "Simulation entry isolated (eligibleForPublication: false)");
    record("JSON Import Validation - Error Rejection", invalidEntry?.valid === false && invalidEntry?.errors?.length > 0, "Rating > 5 correctly rejected with validation error");

    // 5. Public Review Summary API & Redaction
    const pubRes = await fetch(`https://bazaarvilla.com/api/reviews?productId=${targetProductId}`);
    const pubJson = await pubRes.json();
    record("Public Reviews API Status", pubRes.status === 200 && pubJson.success === true, `HTTP ${pubRes.status}`);
    record("Public Reviews Rating & Count", pubJson.stats?.reviewCount === 0 && pubJson.stats?.averageRating === 0, `reviewCount: ${pubJson.stats?.reviewCount}, averageRating: ${pubJson.stats?.averageRating}`);
    record("Public Metadata Redaction", !pubJson.reviews?.some((r) => r.sourceReference || r.importBatchId || r.importedBy), "Zero internal provenance fields leaked in public response");

    // 6. Dedicated View All Reviews Route
    const viewAllRes = await fetch(`https://bazaarvilla.com/products/${targetSlug}/reviews`);
    record("View All Reviews Route Availability", viewAllRes.status === 200, `HTTP status ${viewAllRes.status}`);

    // 7. Storefront PDP Availability
    const pdpRes = await fetch(`https://bazaarvilla.com/products/${targetSlug}`);
    const pdpHtml = await pdpRes.text();
    record("Storefront PDP Availability", pdpRes.status === 200, `HTTP status ${pdpRes.status}`);

    // 8. Product Photographs & TASK 026 Sharpness Preservation
    const necklaceImages = [
        { name: "Image 1 (Master Cover)", key: `products/${targetProductId}/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png`, expectedSha: "7bd1d620d0377a0059f4520c7b694fec0cf23d2cff0c2ea32e90de3ce93dc01a" },
        { name: "Image 2 (Side Angle)", key: `products/${targetProductId}/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png`, expectedSha: "2d3a10ccbe6e0f0c2c2f05021f6e05d25b91a22995b4509e8e2827e3d8491666" },
        { name: "Image 3 (Engraving Detail)", key: `products/${targetProductId}/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png`, expectedSha: "bb9409d77021e47d58c10782f550a8dffe690ea21986f6e875b826818ce36056" },
        { name: "Image 4 (Model Wearing)", key: `products/${targetProductId}/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png`, expectedSha: "cbc64da9f8109fa52636bd1d3ce4b48793c6c1625d37c760d6fce2af71397dd0" },
        { name: "Image 5 (Gift Packaging)", key: `products/${targetProductId}/50d254ff-38e7-4a1a-954a-78eb583ba335.png`, expectedSha: "a7c202a3c755f4a9499bf71a8fdfeed49d60a071e9fd9ec27edddcc1c1bb3457" }
    ];

    const hashes = new Set();
    let allImages200 = true;
    let allHashesMatch = true;
    for (let i = 0; i < necklaceImages.length; i++) {
        const item = necklaceImages[i];
        const imgUrl = `https://bazaarvilla.com/api/media/public/${item.key}`;
        const imgRes = await fetch(imgUrl);
        if (imgRes.status !== 200) allImages200 = false;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const hash = crypto.createHash("sha256").update(buf).digest("hex");
        if (hash !== item.expectedSha) allHashesMatch = false;
        hashes.add(hash);
    }
    record("All 5 Product Photos Availability (HTTP 200)", allImages200, "All 5 product images return HTTP 200");
    record("All 5 Product Photos Integrity", allHashesMatch, "All 5 product images match verified SHA-256 hashes");
    record("Product Image Distinctness (TASK 024/026)", hashes.size === 5, `All ${hashes.size}/5 images have distinct SHA-256 hashes`);

    // Category media isolation
    const catUrl = "https://bazaarvilla.com/api/media/public/categories/cd3e7259-51bc-420d-ac4c-2afa7d8fafa6/231ffa35-ceb3-4460-a06f-dd800c18a268.png";
    const catRes = await fetch(catUrl);
    record("Category Media Isolation (TASK 024)", catRes.status === 200, `Category image returned HTTP ${catRes.status}`);

    // 9. Razorpay Public Config & Live Mode
    const rzpRes = await fetch("https://bazaarvilla.com/api/razorpay/public-config");
    const rzpJson = await rzpRes.json();
    record("Razorpay Live Mode Active", rzpJson.keyId === "rzp_live_Ty8CuwoSSBGpHi", `keyId: ${rzpJson.keyId}`);
    record("Commercial Checkout Gate Open", rzpJson.commercialCheckoutEnabled === true, `commercialCheckoutEnabled: ${rzpJson.commercialCheckoutEnabled}`);

    // 10. Database Integrity & Absence of Synthetic Records
    const reviewsSnap = await db.collection("reviews").where("productId", "==", targetProductId).get();
    record("Zero Synthetic Product Reviews", reviewsSnap.size === 0, `Target product has 0 unapproved/synthetic reviews`);

    const batchesSnap = await db.collection("reviewImportBatches").get();
    record("Review Import Batches Clean", batchesSnap.size === 0, `0 synthetic batches created in live reviewImportBatches`);

    console.log("\n================================================================================");
    const allPassed = results.every((r) => r.passed);
    console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${results.filter((r) => r.passed).length} | FAILED: ${results.filter((r) => !r.passed).length}`);
    console.log(`OVERALL STATUS: ${allPassed ? "100% PASS — LIVE PRODUCTION SYSTEM FULLY OPERATIONAL" : "FAILED"}`);
    console.log("================================================================================");

    if (!allPassed) {
        process.exit(1);
    }
}

runLiveVerification().catch((err) => {
    console.error("Live verification execution failed:", err);
    process.exit(1);
});
