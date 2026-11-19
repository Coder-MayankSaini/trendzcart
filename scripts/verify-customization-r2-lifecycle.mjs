#!/usr/bin/env node
/**
 * TASK 013 — Phase H: Customization and Cloudflare R2 Media Privacy Verification
 * Verifies guest and registered customization uploads, order attachment, R2 ownership,
 * and strict admin-only fulfillment retrieval boundaries against https://bazaarvilla.com.
 */

import fs from "fs";
import path from "path";
import os from "os";

// 1x1 WebP synthetic test buffer
const SYNTHETIC_WEBP = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 0x0e, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00,
    0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0x00
]);

function getFirebaseApiKey() {
    if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
        return process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    }
    const envContent = fs.readFileSync(".env.local", "utf-8");
    const match = envContent.match(/NEXT_PUBLIC_FIREBASE_API_KEY\s*=\s*([^\r\n]+)/);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY not found in .env.local");
}

async function getTokens() {
    const apiKey = getFirebaseApiKey();

    // 1. Guest Anonymous Token
    const anonRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true }),
    });
    const anonData = await anonRes.json();

    // 2. Registered Customer 1 (Owner)
    const cust1Email = `task013_cust_owner_${Date.now()}@bazaarvilla.test`;
    const cust1Res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cust1Email, password: "CustOwnerPass123!", returnSecureToken: true }),
    });
    const cust1Data = await cust1Res.json();

    // 3. Registered Customer 2 (Attacker / Unrelated)
    const cust2Email = `task013_cust_attacker_${Date.now()}@bazaarvilla.test`;
    const cust2Res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cust2Email, password: "CustAttackerPass123!", returnSecureToken: true }),
    });
    const cust2Data = await cust2Res.json();

    // 4. Admin Token
    const admLoginRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "work.mayanksaini@gmail.com", password: "AdminTask013Secure!", returnSecureToken: true }),
    });
    const admData = await admLoginRes.json();

    return {
        guest: { uid: anonData.localId, token: anonData.idToken },
        owner: { uid: cust1Data.localId, token: cust1Data.idToken, email: cust1Email },
        unrelated: { uid: cust2Data.localId, token: cust2Data.idToken },
        admin: { uid: admData.localId, token: admData.idToken },
    };
}

async function testUploadAndOrder(userLabel, user, adminToken, unrelatedToken) {
    console.log(`\n======================================================`);
    console.log(`Testing Customization Flow for: ${userLabel} (UID: ${user.uid})`);
    console.log(`======================================================`);

    // 1. Authorize Upload
    console.log(`1. Requesting upload authorization for folder 'customizations'...`);
    const authRes = await fetch("https://bazaarvilla.com/api/uploads/authorize", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
            folder: "customizations",
            contentType: "image/webp",
            sizeBytes: SYNTHETIC_WEBP.length,
            originalName: `${userLabel}-custom.webp`,
        }),
    });
    console.log(`   Authorize status: HTTP ${authRes.status}`);
    const authData = await authRes.json();
    if (!authRes.ok || !authData.uploadUrl) {
        throw new Error(`Upload authorization failed: ${JSON.stringify(authData)}`);
    }
    const { uploadUrl, key, sessionId, headers: requiredHeaders } = authData;
    console.log(`   Issued key: ${key}`);
    console.log(`   Session ID: ${sessionId}`);

    // Verify key format: customizations/{ownerUid}/{uuid}.webp
    if (!key.startsWith(`customizations/${user.uid}/`)) {
        throw new Error(`Key format violation: expected prefix 'customizations/${user.uid}/', got '${key}'`);
    }
    console.log(`   + Key prefix correctly bound to owner UID!`);

    // 2. Direct Browser PUT Upload to Cloudflare R2 Presigned URL
    console.log(`2. Executing direct presigned PUT to Cloudflare R2...`);
    const putHeaders = {
        "Content-Type": "image/webp",
    };
    if (requiredHeaders && requiredHeaders["If-None-Match"]) {
        putHeaders["If-None-Match"] = requiredHeaders["If-None-Match"];
    }

    const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body: SYNTHETIC_WEBP,
    });
    console.log(`   R2 Direct PUT status: HTTP ${putRes.status}`);
    if (!putRes.ok && putRes.status !== 204) {
        const putErr = await putRes.text();
        throw new Error(`R2 direct PUT failed: HTTP ${putRes.status} - ${putErr}`);
    }
    console.log(`   + Image uploaded to Cloudflare R2 successfully!`);

    // 3. Complete Upload Session
    console.log(`3. Confirming upload completion via /api/uploads/complete...`);
    const compRes = await fetch("https://bazaarvilla.com/api/uploads/complete", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ sessionId, key }),
    });
    console.log(`   Complete status: HTTP ${compRes.status}`);
    const compData = await compRes.json();
    if (!compRes.ok || !compData.success || !compData.size) {
        throw new Error(`Upload completion verification failed: ${JSON.stringify(compData)}`);
    }
    console.log(`   + R2 Object HeadObject check verified (size: ${compData.size} bytes, type: ${compData.contentType})!`);

    // 4. Create Order with Customized Product
    console.log(`4. Creating customized order via /api/orders/create...`);
    const orderRes = await fetch("https://bazaarvilla.com/api/orders/create", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
            items: [
                {
                    id: "task013_test_prod_custom",
                    name: "TASK013 Test Custom Photo Frame",
                    price: 299,
                    quantity: 1,
                    isCustomized: true,
                    customizationData: {
                        storagePath: key,
                        pictureUrl: "/api/media/public",
                        customText: `${userLabel} Personalized Text`,
                    },
                },
            ],
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            orderStatus: "Processing",
            userId: user.uid,
            shippingAddress: {
                fullName: `${userLabel} Customer`,
                email: `${userLabel.toLowerCase()}@bazaarvilla.test`,
                phone: "9876543210",
                addressLine1: "101 Custom Lane",
                city: "Jaipur",
                state: "Rajasthan",
                pincode: "302001",
            },
        }),
    });
    console.log(`   Order creation status: HTTP ${orderRes.status}`);
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData.id) {
        throw new Error(`Order creation failed: ${JSON.stringify(orderData)}`);
    }
    console.log(`   + Order ${orderData.id} created with customization attachment!`);

    // 5. Verify Private Media Access Control (/api/media/download)
    console.log(`5. Verifying private media download authorization boundaries...`);

    // 5a. Admin should be authorized (HTTP 307 redirect to temporary signed R2 URL)
    const adminMediaRes = await fetch(`https://bazaarvilla.com/api/media/download?key=${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        redirect: "manual",
    });
    console.log(`   5a. Admin download attempt -> HTTP ${adminMediaRes.status}`);
    if (adminMediaRes.status !== 307) {
        throw new Error(`Expected HTTP 307 for admin private media download, got ${adminMediaRes.status}`);
    }
    const adminSignedUrl = adminMediaRes.headers.get("location");
    console.log(`       + Admin received presigned download redirect!`);

    // Verify admin can fetch the bytes from the signed URL
    const adminFetchRes = await fetch(adminSignedUrl);
    const adminBytes = await adminFetchRes.arrayBuffer();
    if (Buffer.from(adminBytes).equals(SYNTHETIC_WEBP)) {
        console.log(`       + Admin byte verification: 100% exact match (${adminBytes.byteLength} bytes)!`);
    } else {
        throw new Error(`Admin downloaded corrupted or mismatched bytes!`);
    }

    // 5b. Owner Customer should be authorized (HTTP 307)
    const ownerMediaRes = await fetch(`https://bazaarvilla.com/api/media/download?key=${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${user.token}` },
        redirect: "manual",
    });
    console.log(`   5b. Owner download attempt -> HTTP ${ownerMediaRes.status}`);
    if (ownerMediaRes.status !== 307) {
        throw new Error(`Expected HTTP 307 for owner customer download, got ${ownerMediaRes.status}`);
    }
    console.log(`       + Owner customer received presigned download redirect!`);

    // 5c. Unrelated Customer must be rejected (HTTP 403 Forbidden)
    const unauthMediaRes = await fetch(`https://bazaarvilla.com/api/media/download?key=${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${unrelatedToken}` },
        redirect: "manual",
    });
    console.log(`   5c. Unrelated customer download attempt -> HTTP ${unauthMediaRes.status}`);
    if (unauthMediaRes.status !== 403) {
        throw new Error(`Expected HTTP 403 for unrelated customer download, got ${unauthMediaRes.status}`);
    }
    console.log(`       + Unrelated customer correctly denied (HTTP 403 Forbidden)!`);

    // 5d. Unauthenticated request must be rejected (HTTP 401 Unauthorized)
    const anonMediaRes = await fetch(`https://bazaarvilla.com/api/media/download?key=${encodeURIComponent(key)}`, {
        redirect: "manual",
    });
    console.log(`   5d. Unauthenticated download attempt -> HTTP ${anonMediaRes.status}`);
    if (anonMediaRes.status !== 401) {
        throw new Error(`Expected HTTP 401 for unauthenticated download, got ${anonMediaRes.status}`);
    }
    console.log(`       + Unauthenticated request correctly denied (HTTP 401 Unauthorized)!`);

    console.log(`\n[SUCCESS] Customization flow and R2 media privacy verified for ${userLabel}!`);
    return { orderId: orderData.id, storageKey: key };
}

async function main() {
    console.log("=== Phase H: Customization and Cloudflare R2 Media Privacy Verification ===");
    const tokens = await getTokens();
    console.log("Tokens minted for Guest, Registered Owner, Unrelated Customer, and Admin.");

    // Test 1: Registered Customer
    await testUploadAndOrder("Registered_Customer", tokens.owner, tokens.admin.token, tokens.unrelated.token);

    // Test 2: Anonymous Guest
    await testUploadAndOrder("Anonymous_Guest", tokens.guest, tokens.admin.token, tokens.unrelated.token);

    console.log("\n================================================================================");
    console.log("ALL PHASE H CUSTOMIZATION AND R2 SECURITY CRITERIA PASSED WITH 100% COMPLIANCE!");
    console.log("================================================================================");
}

main().catch((err) => {
    console.error("Phase H Verification Failed:", err);
    process.exit(1);
});
