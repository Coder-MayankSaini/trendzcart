/**
 * TASK 032 — Firebase Emulator End-to-End Functional Verification Script
 * Validates all 12 functional requirements requested by the user:
 * 1. Product Selection
 * 2. 5-Review Template Generation
 * 3. Exact Schema & Product ID Verification
 * 4. AI Prompt Generation with Attributes & Count
 * 5. Dynamic Count Updates
 * 6. Authentic Test Fixture Preparation
 * 7. Validation of Completed JSON
 * 8. Rejection of Malformed, Mismatched, & Placeholder JSON
 * 9. Review Publishing & Approval
 * 10. Storefront PDP Display & Rating Aggregates
 * 11. Complete Isolation from Unrelated Products
 * 12. Verified-Purchase Protection & Provenance Integrity
 */

import assert from "node:assert/strict";
import { generateReviewJsonTemplate, generateReviewAiPrompt } from "../src/lib/reviews/promptGenerator.ts";
import { POST as validateRoute } from "../src/app/api/admin/reviews/validate/route.ts";
import { POST as publishBatchRoute } from "../src/app/api/admin/reviews/publish-batch/route.ts";
import { GET as publicReviewsGetRoute } from "../src/app/api/reviews/route.ts";
import { adminAuth, adminDb } from "../src/lib/firebase/admin.ts";
import { NextRequest } from "next/server";

function createPostRequest(url, payload, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return new NextRequest(new Request(url, {
        method: "POST",
        headers,
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }));
}

async function getAdminToken(adminUid) {
    const customToken = await adminAuth.createCustomToken(adminUid, { admin: true });
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
    const cleanHost = authHost.replace(/^https?:\/\//, "");

    const res = await fetch(`http://${cleanHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });

    const data = await res.json();
    if (!data.idToken) {
        throw new Error(`Failed to exchange custom token for ID token: ${JSON.stringify(data)}`);
    }
    return data.idToken;
}

async function runVerification() {
    console.log("================================================================================");
    console.log("TASK 032 — FIREBASE EMULATOR END-TO-END FUNCTIONAL VERIFICATION");
    console.log("Project: demo-trendkartz (PRODUCTION ISOLATED)");
    console.log("================================================================================\n");

    const adminUid = "admin_e2e_task032";
    try { await adminAuth.deleteUser(adminUid); } catch {}
    await adminAuth.createUser({
        uid: adminUid,
        email: "admin032@bazaarvilla.test",
        displayName: "Bazaarvilla Administrator",
    });
    await adminAuth.setCustomUserClaims(adminUid, { admin: true });
    const adminToken = await getAdminToken(adminUid);

    const targetProductId = "prod_cram_ease_032";
    const unrelatedProductId = "prod_unrelated_hoodie_032";

    // Clean collections
    const collectionsToClean = ["reviews", "reviewImportBatches", "products"];
    for (const col of collectionsToClean) {
        const snap = await adminDb.collection(col).get();
        const batch = adminDb.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }

    const targetProduct = {
        id: targetProductId,
        name: "Bazaarvilla CrampEase Pro Portable Heating & Massage Belt",
        slug: "bazaarvilla-cramease-pro-massager-belt",
        price: 1299,
        description: "Fast-acting menstrual cramp relief belt with 3 heat settings and 4 vibration massage modes. Lightweight, rechargeable, and discreet under clothing.",
        category: "Personal Care",
        tags: ["wellness", "cramprelief", "heattherapy"],
        imageUrl: "/products/crampease-pro.jpg",
        isVisible: true,
        inventory: 75,
        reviewCount: 0,
        averageRating: 0.0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };

    const unrelatedProduct = {
        id: unrelatedProductId,
        name: "Bazaarvilla Classic Fleece Winter Hoodie",
        slug: "bazaarvilla-classic-fleece-winter-hoodie",
        price: 1499,
        description: "Heavyweight 380 GSM fleece hoodie for chilly evenings.",
        category: "Apparel",
        tags: ["hoodie", "winter"],
        imageUrl: "/products/fleece-hoodie.jpg",
        isVisible: true,
        inventory: 50,
        reviewCount: 0,
        averageRating: 0.0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };

    await adminDb.collection("products").doc(targetProductId).set(targetProduct);
    await adminDb.collection("products").doc(unrelatedProductId).set(unrelatedProduct);

    const checks = [];
    function record(stepNum, stepTitle, passed, details) {
        checks.push({ stepNum, stepTitle, passed, details });
        console.log(`[${passed ? "PASS" : "FAIL"}] Step ${stepNum} — ${stepTitle}`);
        console.log(`       Details: ${details}\n`);
        if (!passed) throw new Error(`Step ${stepNum} FAILED: ${details}`);
    }

    // 1. Select an existing product
    const docSnap = await adminDb.collection("products").doc(targetProductId).get();
    const loadedProduct = docSnap.data();
    record(
        1,
        "Select an existing product",
        docSnap.exists && loadedProduct.id === targetProductId,
        `Selected product '${loadedProduct.name}' (ID: ${loadedProduct.id})`
    );

    // 2. Generate a five-review JSON template
    const template5Obj = generateReviewJsonTemplate(loadedProduct.id, loadedProduct.name, 5);
    const template5Json = JSON.stringify(template5Obj, null, 2);
    const parsed5Template = JSON.parse(template5Json);
    record(
        2,
        "Generate a five-review JSON template",
        parsed5Template.productId === targetProductId && parsed5Template.reviews.length === 5,
        `Generated valid JSON template with productId='${parsed5Template.productId}' and exactly ${parsed5Template.reviews.length} review entries`
    );

    // 3. Verify every entry contains the correct product ID and the exact TASK 022 schema
    const allEntriesValid = parsed5Template.reviews.every((r, idx) => {
        return (
            typeof r.externalReviewId === "string" &&
            r.externalReviewId.includes(targetProductId.slice(0, 16)) &&
            typeof r.reviewerDisplayName === "string" &&
            typeof r.rating === "number" &&
            r.rating >= 1 && r.rating <= 5 &&
            typeof r.title === "string" &&
            typeof r.body === "string" &&
            typeof r.reviewedAt === "string" &&
            r.source === "offline-customer-feedback" &&
            typeof r.sourceReference === "string" &&
            typeof r.customerConsentConfirmed === "boolean"
        );
    });
    record(
        3,
        "Verify every entry contains correct product ID and exact TASK 022 schema",
        allEntriesValid,
        `All 5 entries contain externalReviewId with product ID, reviewerDisplayName, rating, title, body, reviewedAt, source, sourceReference, customerConsentConfirmed`
    );

    // 4. Generate an AI prompt containing product title, description, attributes and requested count
    const prompt5 = generateReviewAiPrompt({
        productId: loadedProduct.id,
        productName: loadedProduct.name,
        productDescription: loadedProduct.description,
        price: loadedProduct.price,
        category: loadedProduct.category,
        tags: loadedProduct.tags,
        count: 5,
    });
    const promptHasTitle = prompt5.includes(loadedProduct.name);
    const promptHasId = prompt5.includes(loadedProduct.id);
    const promptHasDesc = prompt5.includes(loadedProduct.description);
    const promptHasCategory = prompt5.includes("Category: Personal Care");
    const promptHasTags = prompt5.includes("Tags: wellness, cramprelief, heattherapy");
    const promptHasCount = prompt5.includes("Maximum Requested Review Capacity: 5 records");
    const promptHasAntiFabrication = prompt5.includes("DO NOT invent, fabricate, hallucinate, or simulate customer experiences");
    const step4Passed = promptHasTitle && promptHasId && promptHasDesc && promptHasCategory && promptHasTags && promptHasCount && promptHasAntiFabrication;
    record(
        4,
        "Generate AI prompt with title, description, attributes and count",
        step4Passed,
        `AI prompt contains title, ID, description, category/tags, requested count (5), schema specifications, and strict anti-fabrication guidelines`
    );

    // 5. Confirm changing the review count updates both outputs
    const template3Obj = generateReviewJsonTemplate(loadedProduct.id, loadedProduct.name, 3);
    const prompt3 = generateReviewAiPrompt({
        productId: loadedProduct.id,
        productName: loadedProduct.name,
        productDescription: loadedProduct.description,
        count: 3,
    });
    const step5Passed = template3Obj.reviews.length === 3 && prompt3.includes("Maximum Requested Review Capacity: 3 records");
    record(
        5,
        "Confirm changing review count updates both outputs",
        step5Passed,
        `Updating count from 5 to 3 immediately produced template with ${template3Obj.reviews.length} entries and prompt requesting 3 records`
    );

    // 6. Paste a test fixture containing authentic-style, explicitly authorized sample feedback
    const authenticSampleFixture = {
        productId: targetProductId,
        reviews: [
            {
                externalReviewId: "bv-auth-e2e-001",
                reviewerDisplayName: "Sneha Gupta",
                rating: 5,
                title: "Immediate relief for workday cramps",
                body: "Purchased at the Delhi wellness expo. The gentle heating takes under 10 seconds to warm up and the vibration settings are very soothing. Battery easily lasted through my entire office shift.",
                reviewedAt: "2026-11-08",
                source: "offline-customer-feedback",
                sourceReference: "DELHI-EXPO-BOOTH-042",
                customerConsentConfirmed: true,
            },
            {
                externalReviewId: "bv-auth-e2e-002",
                reviewerDisplayName: "Pooja Verma",
                rating: 4,
                title: "Comfortable and portable",
                body: "The elastic strap fits snugly without pinching. Charging via Type-C is very convenient. Takes off the edge during painful days.",
                reviewedAt: "2026-11-09",
                source: "offline-customer-feedback",
                sourceReference: "SURVEY-NOV26-088",
                customerConsentConfirmed: true,
            },
        ],
    };
    record(
        6,
        "Paste authentic-style, explicitly authorized sample feedback",
        authenticSampleFixture.reviews.length === 2 && authenticSampleFixture.reviews.every(r => r.customerConsentConfirmed === true),
        `Prepared 2 genuine-style authorized review entries with authentic feedback, distinct external IDs, and confirmed consent`
    );

    // 7. Validate the completed JSON
    const validateReq = createPostRequest(
        `http://localhost:3000/api/admin/reviews/validate?productId=${targetProductId}`,
        authenticSampleFixture,
        adminToken
    );
    const validateRes = await validateRoute(validateReq);
    const validateData = await validateRes.json();
    if (validateData.invalidCount > 0) {
        console.error("Validation entries errors:", JSON.stringify(validateData.entries.map(e => ({ id: e.externalReviewId, errors: e.errors })), null, 2));
    }
    const step7Passed = validateRes.status === 200 && validateData.valid === true && validateData.eligibleCount === 2 && validateData.invalidCount === 0;
    record(
        7,
        "Validate completed JSON via admin validator",
        step7Passed,
        `Validation succeeded with HTTP 200, valid=true, eligibleCount=${validateData.eligibleCount}, invalidCount=${validateData.invalidCount}`
    );

    // 8. Verify malformed JSON, mismatched product IDs and unchanged template placeholders are rejected
    // 8a: Malformed JSON syntax
    const malformedReq = createPostRequest(
        `http://localhost:3000/api/admin/reviews/validate?productId=${targetProductId}`,
        "{ productId: 'invalid-json'",
        adminToken
    );
    const malformedRes = await validateRoute(malformedReq);

    // 8b: Mismatched product ID
    const mismatchedFixture = {
        productId: unrelatedProductId,
        reviews: [authenticSampleFixture.reviews[0]],
    };
    const mismatchReq = createPostRequest(
        `http://localhost:3000/api/admin/reviews/validate?productId=${targetProductId}`,
        mismatchedFixture,
        adminToken
    );
    const mismatchRes = await validateRoute(mismatchReq);
    const mismatchData = await mismatchRes.json();

    // 8c: Unchanged template placeholder validation rejection
    const placeholderValidateReq = createPostRequest(
        `http://localhost:3000/api/admin/reviews/validate?productId=${targetProductId}`,
        parsed5Template,
        adminToken
    );
    const placeholderValidateRes = await validateRoute(placeholderValidateReq);
    const placeholderValidateData = await placeholderValidateRes.json();

    // 8d: Unchanged template placeholder publish rejection (HTTP 400)
    const placeholderPublishReq = createPostRequest(
        "http://localhost:3000/api/admin/reviews/publish-batch",
        parsed5Template,
        adminToken
    );
    const placeholderPublishRes = await publishBatchRoute(placeholderPublishReq);
    const placeholderPublishData = await placeholderPublishRes.json();

    const step8Passed = (
        malformedRes.status === 400 &&
        mismatchRes.status === 400 &&
        mismatchData.error.includes("Product mismatch") &&
        placeholderValidateRes.status === 200 &&
        placeholderValidateData.valid === false &&
        placeholderValidateData.eligibleCount === 0 &&
        placeholderValidateData.entries.every(e => e.isTemplatePlaceholder === true) &&
        placeholderPublishRes.status === 400 &&
        placeholderPublishData.error.includes("Template placeholder")
    );
    record(
        8,
        "Verify malformed JSON, mismatched product IDs, and placeholders are rejected",
        step8Passed,
        `Malformed syntax -> HTTP ${malformedRes.status}; Product mismatch -> HTTP ${mismatchRes.status} ('${mismatchData.error}'); Template placeholder validation -> valid=${placeholderValidateData.valid}, eligibleCount=${placeholderValidateData.eligibleCount}; Template placeholder publish -> HTTP ${placeholderPublishRes.status} ('${placeholderPublishData.error}')`
    );

    // 9. Approve an eligible test review in the emulator
    const publishReq = createPostRequest(
        "http://localhost:3000/api/admin/reviews/publish-batch",
        authenticSampleFixture,
        adminToken
    );
    const publishRes = await publishBatchRoute(publishReq);
    const publishData = await publishRes.json();
    const step9Passed = publishRes.status === 201 && publishData.success === true && publishData.publishedCount === 2;
    record(
        9,
        "Approve eligible test reviews in emulator",
        step9Passed,
        `Published successfully with HTTP 201, success=true, publishedCount=2`
    );

    // 10. Confirm it appears on the correct product page and contributes correctly to its rating aggregate
    const pubReq = new Request(`http://localhost:3000/api/reviews?productId=${targetProductId}`);
    const pubRes = await publicReviewsGetRoute(pubReq);
    const pubData = await pubRes.json();

    // Check product doc in Firestore emulator
    const updatedProdSnap = await adminDb.collection("products").doc(targetProductId).get();
    const updatedProd = updatedProdSnap.data();

    // Expected average: (5 + 4) / 2 = 4.5
    const step10Passed = (
        pubRes.status === 200 &&
        pubData.stats.reviewCount === 2 &&
        pubData.stats.averageRating === 4.5 &&
        pubData.reviews.length === 2 &&
        updatedProd.reviewCount === 2 &&
        updatedProd.averageRating === 4.5
    );
    record(
        10,
        "Confirm reviews appear on target product and update rating aggregate",
        step10Passed,
        `Target product reviewCount=${pubData.stats.reviewCount}, averageRating=${pubData.stats.averageRating} (4.5), Firestore product aggregate synchronized`
    );

    // 11. Confirm it does not appear on unrelated products
    const unrelatedReq = new Request(`http://localhost:3000/api/reviews?productId=${unrelatedProductId}`);
    const unrelatedRes = await publicReviewsGetRoute(unrelatedReq);
    const unrelatedData = await unrelatedRes.json();

    const unrelatedProdSnap = await adminDb.collection("products").doc(unrelatedProductId).get();
    const unrelatedProd = unrelatedProdSnap.data();

    const step11Passed = (
        unrelatedRes.status === 200 &&
        unrelatedData.stats.reviewCount === 0 &&
        unrelatedData.stats.averageRating === 0 &&
        unrelatedData.reviews.length === 0 &&
        unrelatedProd.reviewCount === 0 &&
        unrelatedProd.averageRating === 0
    );
    record(
        11,
        "Confirm reviews do not appear on unrelated products",
        step11Passed,
        `Unrelated product '${unrelatedProduct.name}' has reviewCount=${unrelatedData.stats.reviewCount}, averageRating=${unrelatedData.stats.averageRating}, reviews list empty`
    );

    // 12. Confirm imported reviews do not receive verified-purchase status without a qualifying order
    const reviewsInDb = await adminDb.collection("reviews").where("productId", "==", targetProductId).get();
    const allDbReviewsNotVerified = reviewsInDb.docs.every(d => d.data().verifiedPurchase === false);
    const allPublicReviewsNotVerified = pubData.reviews.every(r => r.verifiedPurchase === false);
    const step12Passed = allDbReviewsNotVerified && allPublicReviewsNotVerified && reviewsInDb.size === 2;
    record(
        12,
        "Confirm imported reviews do not receive verified-purchase status",
        step12Passed,
        `All ${reviewsInDb.size} reviews in Firestore and public API have verifiedPurchase=false. In-app verified-buyer badge protected`
    );

    console.log("================================================================================");
    console.log("ALL 12 EMULATOR FUNCTIONAL CHECKS PASSED SUCCESSFULLY!");
    console.log("================================================================================");
}

runVerification().catch((err) => {
    console.error("FATAL VERIFICATION ERROR:", err);
    process.exit(1);
});
