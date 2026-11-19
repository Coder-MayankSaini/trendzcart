#!/usr/bin/env node
/**
 * TASK 013 — Synthetic Test Fixtures Provisioner
 * Creates clearly identified synthetic test products and coupon in Firestore project 'trendkartz'.
 */

import fs from "fs";
import path from "path";
import os from "os";

const PROJECT_ID = "trendkartz";

async function getAccessToken() {
    const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
    if (!fs.existsSync(configPath)) {
        throw new Error("firebase-tools.json not found");
    }
    const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const token = data.tokens?.access_token;
    if (!token) throw new Error("No access_token in firebase-tools.json");
    return token;
}

async function setFirestoreDoc(token, collection, docId, fields) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
    const res = await fetch(url, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Failed to set ${collection}/${docId}: HTTP ${res.status} - ${err}`);
    }
    return res.json();
}

async function main() {
    console.log("=== Provisioning TASK 013 Synthetic Test Fixtures ===");
    const token = await getAccessToken();

    const now = Date.now().toString();

    // 1. Simple Product
    const simpleProd = {
        id: { stringValue: "task013_test_prod_simple" },
        name: { stringValue: "TASK013 Test Simple Mug" },
        price: { integerValue: "199" },
        inventory: { integerValue: "50" },
        isVisible: { booleanValue: true },
        isCustomized: { booleanValue: false },
        category: { stringValue: "Testing" },
        categories: { arrayValue: { values: [{ stringValue: "Testing" }] } },
        description: { stringValue: "Synthetic simple test product for TASK 013 checkout testing." },
        thumbnails: { arrayValue: { values: [{ stringValue: "/api/media/public" }] } },
        images: { arrayValue: { values: [{ stringValue: "/api/media/public" }] } },
        createdAt: { integerValue: now },
        updatedAt: { integerValue: now },
    };
    await setFirestoreDoc(token, "products", "task013_test_prod_simple", simpleProd);
    console.log("+ Provisioned products/task013_test_prod_simple (₹199, stock: 50)");

    // 2. Customizable Product
    const customProd = {
        id: { stringValue: "task013_test_prod_custom" },
        name: { stringValue: "TASK013 Test Custom Photo Frame" },
        price: { integerValue: "299" },
        inventory: { integerValue: "25" },
        isVisible: { booleanValue: true },
        isCustomized: { booleanValue: true },
        customizationType: { stringValue: "requires_picture" },
        category: { stringValue: "Testing" },
        categories: { arrayValue: { values: [{ stringValue: "Testing" }, { stringValue: "Customizable" }] } },
        description: { stringValue: "Synthetic customizable test product for TASK 013 R2 customization verification." },
        thumbnails: { arrayValue: { values: [{ stringValue: "/api/media/public" }] } },
        images: { arrayValue: { values: [{ stringValue: "/api/media/public" }] } },
        createdAt: { integerValue: now },
        updatedAt: { integerValue: now },
    };
    await setFirestoreDoc(token, "products", "task013_test_prod_custom", customProd);
    console.log("+ Provisioned products/task013_test_prod_custom (₹299, stock: 25, customizable)");

    // 3. Low Stock Product
    const lowStockProd = {
        id: { stringValue: "task013_test_prod_lowstock" },
        name: { stringValue: "TASK013 Test Low Stock Keyring" },
        price: { integerValue: "99" },
        inventory: { integerValue: "1" },
        isVisible: { booleanValue: true },
        isCustomized: { booleanValue: false },
        category: { stringValue: "Testing" },
        categories: { arrayValue: { values: [{ stringValue: "Testing" }] } },
        description: { stringValue: "Synthetic low-stock test product for TASK 013 inventory concurrency verification." },
        thumbnails: { arrayValue: { values: [{ stringValue: "/api/media/public" }] } },
        images: { arrayValue: { values: [{ stringValue: "/api/media/public" }] } },
        createdAt: { integerValue: now },
        updatedAt: { integerValue: now },
    };
    await setFirestoreDoc(token, "products", "task013_test_prod_lowstock", lowStockProd);
    console.log("+ Provisioned products/task013_test_prod_lowstock (₹99, stock: 1)");

    // 4. Valid Coupon
    const expiryIso = new Date(Date.now() + 14 * 86400000).toISOString();
    const validCoupon = {
        code: { stringValue: "TASK013_SAVE50" },
        discountType: { stringValue: "flat" },
        discountValue: { integerValue: "50" },
        expiryDate: { stringValue: expiryIso },
        usageLimit: { integerValue: "100" },
        timesUsed: { integerValue: "0" },
        isActive: { booleanValue: true },
        createdAt: { integerValue: now },
    };
    await setFirestoreDoc(token, "coupons", "TASK013_SAVE50", validCoupon);
    console.log("+ Provisioned coupons/TASK013_SAVE50 (Code: TASK013_SAVE50, Flat ₹50 off)");

    console.log("\nAll TASK 013 synthetic fixtures provisioned successfully!");
}

main().catch((err) => {
    console.error("Fixture provisioning failed:", err);
    process.exit(1);
});
