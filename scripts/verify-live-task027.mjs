/**
 * TASK 027 — Post-Deployment Production Live Verification Script
 * Validates the deployed customizable product COD restrictions, fail-safe gates,
 * anti-flicker indicators, and preserved functionalities on live production: https://bazaarvilla.com
 */

import admin from "firebase-admin";
import { execSync } from "child_process";
import { isCustomizableProduct, evaluateCodEligibility } from "../src/lib/orders/customizationEligibility.ts";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();
const apiKey = execSync("npx netlify env:get NEXT_PUBLIC_FIREBASE_API_KEY", { encoding: "utf8" }).trim();

const necklaceSlug = "personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women";
const necklaceId = "82b5c865-3128-4515-96e5-80f7f0eed58e";

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: "trendkartz",
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

const db = admin.firestore();

async function runLiveVerification() {
    console.log("================================================================================");
    console.log("TASK 027 — LIVE PRODUCTION POST-DEPLOYMENT VERIFICATION");
    console.log("Domain:            https://bazaarvilla.com");
    console.log("Personalized Item: ", necklaceSlug);
    console.log("================================================================================\n");

    const results = [];
    function record(checkName, passed, details) {
        results.push({ checkName, passed, details });
        console.log(`[${passed ? "PASS" : "FAIL"}] ${checkName}: ${details}`);
    }

    try {
        // 1. Personalized Necklace PDP HTML check
        console.log("--- 1. Storefront PDP Indicators ---");
        const pdpRes = await fetch(`https://bazaarvilla.com/products/${necklaceSlug}`);
        const pdpHtml = await pdpRes.text();
        const hasPrepaidBadge = pdpHtml.includes("Prepaid Only (Personalized Item)");
        const hasCodBadge = pdpHtml.includes("Cash on Delivery Available");
        record(
            "PDP Personalized Indicator",
            pdpRes.status === 200 && hasPrepaidBadge && !hasCodBadge,
            `HTTP ${pdpRes.status}, contains 'Prepaid Only (Personalized Item)'=${hasPrepaidBadge}, contains 'Cash on Delivery Available'=${hasCodBadge}`
        );

        // 2. Authoritative Catalog Personalization Status
        console.log("\n--- 2. Production Catalog Inspection ---");
        const necklaceDoc = await db.collection("products").doc(necklaceId).get();
        const necklaceData = necklaceDoc.data();
        const isCustom = isCustomizableProduct(necklaceData);
        record(
            "Live Catalog Customization Metadata",
            necklaceDoc.exists && isCustom,
            `Product exists=${necklaceDoc.exists}, name='${necklaceData?.name}', isCustomizableProduct=${isCustom}`
        );

        // 3. Direct COD API Attempt on Customizable Product (Must Reject HTTP 400)
        console.log("\n--- 3. Direct COD API Enforcement ---");
        const testAttemptOrderId = `task027_live_verify_${Date.now()}`;
        const initialInventory = typeof necklaceData?.inventory === "number" ? necklaceData.inventory : null;

        const codOrderPayload = {
            id: testAttemptOrderId,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            orderStatus: "Processing",
            total: 499,
            subtotal: 499,
            items: [
                {
                    productId: necklaceId,
                    name: necklaceData?.name || "Personalized Necklace",
                    price: 499,
                    quantity: 1,
                    isCustomized: false, // Attempt forged flag
                }
            ],
            shippingAddress: {
                fullName: "QA Verification Test",
                email: "qa.bazaarvilla@gmail.com",
                addressLine1: "123 Test Street",
                city: "Jaipur",
                state: "Rajasthan",
                pincode: "302001",
                phone: "9876543210"
            }
        };

        const createRes = await fetch("https://bazaarvilla.com/api/orders/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(codOrderPayload)
        });
        const createJson = await createRes.json().catch(() => ({}));
        const isCodRejected = createRes.status === 400 && createJson.code === "COD_NOT_ALLOWED_CUSTOM_PRODUCT";
        record(
            "Direct COD API Attempt Rejected",
            isCodRejected,
            `HTTP ${createRes.status}, code='${createJson.code}', error='${createJson.error}'`
        );

        // 4. Verify Zero Side Effects on Database
        console.log("\n--- 4. Verify No Side Effects ---");
        const orderSnap = await db.collection("orders").doc(testAttemptOrderId).get();
        const afterNecklaceDoc = await db.collection("products").doc(necklaceId).get();
        const afterInventory = typeof afterNecklaceDoc.data()?.inventory === "number" ? afterNecklaceDoc.data().inventory : null;

        const noOrderCreated = !orderSnap.exists;
        const inventoryPreserved = initialInventory === afterInventory;
        record(
            "Zero Order & Inventory Mutation",
            noOrderCreated && inventoryPreserved,
            `Order doc created=${!noOrderCreated}, inventory before=${initialInventory} after=${afterInventory}`
        );

        // 5. Mixed Cart Logic Verification (Unit / Algorithmic Evaluation)
        console.log("\n--- 5. Mixed Cart Algorithmic Verification ---");
        const mockCatalog = new Map();
        mockCatalog.set(necklaceId, necklaceData);
        mockCatalog.set("mock-regular-shirt", {
            id: "mock-regular-shirt",
            name: "Classic Regular T-Shirt",
            isCustomized: false,
            sizes: ["M", "L"],
        });

        const mixedCart = [
            { productId: "mock-regular-shirt", name: "Classic Regular T-Shirt" },
            { productId: necklaceId, name: necklaceData?.name },
        ];
        const mixedCheck = evaluateCodEligibility(mixedCart, mockCatalog);
        record(
            "Mixed Cart Evaluates to Ineligible",
            !mixedCheck.isEligible && mixedCheck.code === "COD_NOT_ALLOWED_CUSTOM_PRODUCT",
            `isEligible=${mixedCheck.isEligible}, code='${mixedCheck.code}'`
        );

        const regularCart = [{ productId: "mock-regular-shirt", name: "Classic Regular T-Shirt" }];
        const regularCheck = evaluateCodEligibility(regularCart, mockCatalog);
        record(
            "Regular Cart Evaluates to Eligible",
            regularCheck.isEligible === true,
            `isEligible=${regularCheck.isEligible}`
        );

        // 6. Razorpay Public Config & Live Mode
        console.log("\n--- 6. Payment Gateway Verification ---");
        const rzpRes = await fetch("https://bazaarvilla.com/api/razorpay/public-config");
        const rzpJson = await rzpRes.json();
        const isRzpLive = rzpRes.status === 200 &&
            rzpJson.commercialCheckoutEnabled === true &&
            typeof rzpJson.keyId === "string" &&
            rzpJson.keyId.startsWith("rzp_live_");
        record(
            "Razorpay Live Gateway Operational",
            isRzpLive,
            `HTTP ${rzpRes.status}, commercialCheckoutEnabled=${rzpJson.commercialCheckoutEnabled}, keyPrefix=${rzpJson.keyId?.substring(0, 12)}`
        );

        // 7. TASK 022 Review Management System Preservation
        console.log("\n--- 7. Preservation of TASK 022 Reviews ---");
        const reviewsRes = await fetch(`https://bazaarvilla.com/api/reviews?productId=${necklaceId}`);
        const reviewsJson = await reviewsRes.json();
        const isReviewsIntact = reviewsRes.status === 200 && Array.isArray(reviewsJson.reviews);
        record(
            "Review Retrieval API Intact",
            isReviewsIntact,
            `HTTP ${reviewsRes.status}, reviewsCount=${reviewsJson.reviews?.length ?? 0}`
        );

        // 8. TASK 023 Purchase Activity Counter Preservation
        console.log("\n--- 8. Preservation of TASK 023 Purchase Activity ---");
        const activityRes = await fetch(`https://bazaarvilla.com/api/products/${necklaceId}/purchase-activity`);
        const activityJson = await activityRes.json();
        const isActivityIntact = activityRes.status === 200 && activityJson.productId === necklaceId;
        record(
            "Purchase Activity API Intact",
            isActivityIntact,
            `HTTP ${activityRes.status}, count=${activityJson.count}, visible=${activityJson.visible}`
        );

        // 9. Storefront Core Routes Availability
        console.log("\n--- 9. Storefront Route Availability ---");
        const routes = ["/", "/cart", "/checkout", "/categories"];
        let allRoutesOk = true;
        for (const route of routes) {
            const res = await fetch(`https://bazaarvilla.com${route}`);
            if (res.status !== 200) {
                allRoutesOk = false;
                console.log(`Route ${route} returned HTTP ${res.status}`);
            }
        }
        record(
            "Core Storefront Routes Accessible",
            allRoutesOk,
            "All routes (/, /cart, /checkout, /categories) returned HTTP 200"
        );

    } catch (err) {
        console.error("Verification encountered error:", err);
        record("Verification Script Execution", false, err.message);
    }

    console.log("\n================================================================================");
    const passCount = results.filter(r => r.passed).length;
    const failCount = results.length - passCount;
    console.log(`TASK 027 LIVE VERIFICATION SUMMARY: ${passCount}/${results.length} PASSED (Failures: ${failCount})`);
    console.log("================================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

runLiveVerification().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
