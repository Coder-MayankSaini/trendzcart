/**
 * scripts/verify-live-task036.mjs
 *
 * Exhaustive, 100% READ-ONLY post-deployment live technical verification for TASK 036.
 * Target: https://bazaarvilla.com (trendzcartdemo / deploy 6af78185da842646970c2cc6)
 *
 * Strictly verifies live endpoints with ZERO production mutations.
 */

import fs from "fs";

const BASE_URL = "https://bazaarvilla.com";

let adminToken = "";
if (fs.existsSync(".admin-test-token")) {
    adminToken = fs.readFileSync(".admin-test-token", "utf8").trim();
}

async function verifyLive() {
    console.log("================================================================================");
    console.log("BAZAARVILLA — PRODUCTION TECHNICAL VERIFICATION (TASK 036)");
    console.log(`Target Host: ${BASE_URL}`);
    console.log("Mode:        100% READ-ONLY (ZERO MUTATIONS GUARANTEED)");
    console.log("================================================================================\n");

    const results = [];

    function record(id, title, passed, details) {
        results.push({ id, title, passed, details });
        const tag = passed ? "[PASS]" : "[FAIL]";
        console.log(`${tag} Check ${id.toString().padStart(2, "0")}: ${title}`);
        console.log(`       Details: ${details}\n`);
    }

    // -------------------------------------------------------------------------
    // 1. Homepage & Published Code Verification
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/`, { cache: "no-store" });
        const text = await res.text();
        const passed = res.status === 200 && text.includes("Bazaarvilla");
        record(1, "Homepage Availability & Branding Integrity", passed,
            `HTTP ${res.status}, length=${text.length}, contains 'Bazaarvilla': ${text.includes("Bazaarvilla")}`);
    } catch (e) {
        record(1, "Homepage Availability & Branding Integrity", false, `Network error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 2. Anti-False-Positive Media Proxy: Fallback Behavior & Cache-Control
    // -------------------------------------------------------------------------
    try {
        const probeKey = `products/nonexistent-test-probe-${Date.now()}.png`;
        const res = await fetch(`${BASE_URL}/api/media/public/${probeKey}`, { cache: "no-store" });
        const statusHeader = res.headers.get("x-bazaarvilla-media-status");
        const cacheControl = res.headers.get("cache-control") || "";
        const contentType = res.headers.get("content-type") || "";
        const body = await res.text();

        const isFallback = statusHeader === "fallback";
        const isSvg = contentType.includes("image/svg+xml");
        const isNotImmutable = !cacheControl.includes("immutable") && cacheControl.includes("no-cache");
        const hasSvgContent = body.includes("<svg") && body.includes("Bazaarvilla Image");

        const passed = res.status === 200 && isFallback && isSvg && isNotImmutable && hasSvgContent;
        record(2, "Media Proxy Anti-False-Positive Fallback & Cache Safeguard", passed,
            `HTTP ${res.status}, X-Bazaarvilla-Media-Status: "${statusHeader}", Content-Type: "${contentType}", Cache-Control: "${cacheControl}", SVG Fallback rendered: ${hasSvgContent}`);
    } catch (e) {
        record(2, "Media Proxy Anti-False-Positive Fallback & Cache Safeguard", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 3. Anti-False-Positive Media Proxy: Real Binary Media Hit & Immutable Cache
    // -------------------------------------------------------------------------
    try {
        const realKey = "products/12be4f44-a9fc-47bd-92d0-dd794a2efb65/5fa2997d-52f1-4f6e-b392-26ad1c3836cf.png";
        const res = await fetch(`${BASE_URL}/api/media/public/${realKey}`, { cache: "no-store" });
        const statusHeader = res.headers.get("x-bazaarvilla-media-status");
        const cacheControl = res.headers.get("cache-control") || "";
        const contentType = res.headers.get("content-type") || "";
        const arrayBuf = await res.arrayBuffer();

        const isHit = statusHeader === "hit";
        const isPng = contentType.includes("image/png");
        const isImmutable = cacheControl.includes("immutable");
        const isBinaryValid = arrayBuf.byteLength > 1000;

        const passed = res.status === 200 && isHit && isPng && isImmutable && isBinaryValid;
        record(3, "Media Proxy Real Binary Media Hit & Immutable Cache", passed,
            `HTTP ${res.status}, X-Bazaarvilla-Media-Status: "${statusHeader}", Content-Type: "${contentType}", Cache-Control: "${cacheControl}", bytes: ${arrayBuf.byteLength}`);
    } catch (e) {
        record(3, "Media Proxy Real Binary Media Hit & Immutable Cache", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 4. Canonical Bazaarvilla CSV Template Download Endpoint
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/api/admin/products/import/templates?type=bazaarvilla`, { cache: "no-store" });
        const disposition = res.headers.get("content-disposition") || "";
        const contentType = res.headers.get("content-type") || "";
        const csvText = await res.text();

        const isCsv = contentType.includes("text/csv");
        const hasFilename = disposition.includes("bazaarvilla-product-import-canonical-template.csv");
        const hasRequiredCols = csvText.includes("Handle") &&
            csvText.includes("Title") &&
            csvText.includes("Price") &&
            csvText.includes("Compare At Price") &&
            csvText.includes("Image Src") &&
            csvText.includes("Image Position");

        const passed = res.status === 200 && isCsv && hasFilename && hasRequiredCols;
        record(4, "Canonical Bazaarvilla CSV Template Download Endpoint", passed,
            `HTTP ${res.status}, Content-Type: "${contentType}", Content-Disposition: "${disposition}", required headers present: ${hasRequiredCols}`);
    } catch (e) {
        record(4, "Canonical Bazaarvilla CSV Template Download Endpoint", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 5. Shopify-to-Bazaarvilla CSV Converter Endpoint (Auth & Functionality)
    // -------------------------------------------------------------------------
    try {
        // 5a: Unauthenticated attempt (Fail-Closed)
        const unauthRes = await fetch(`${BASE_URL}/api/admin/products/import/convert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ csvText: "dummy" }),
        });
        const unauthBlocked = unauthRes.status === 401;

        // 5b: Authenticated attempt with sample Shopify CSV
        const sampleShopifyCsv = `Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Inventory Policy,Variant Fulfillment Service,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Image Src,Image Position
test-product,Test Converted Item,<p>Sample description</p>,Bazaarvilla,Home Decor,,true,Title,Default Title,SKU-001,100,shopify,10,deny,manual,499.00,799.00,true,true,https://cdn.shopify.com/s/files/1/test/img1.jpg,1
test-product,,,,,,,,,,,,,,,,,,https://cdn.shopify.com/s/files/1/test/img2.jpg,2`;

        const authRes = await fetch(`${BASE_URL}/api/admin/products/import/convert`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ csvText: sampleShopifyCsv }),
        });
        const authData = await authRes.json();

        const convertPassed = authRes.status === 200 &&
            authData.success === true &&
            authData.summary?.totalProducts === 1 &&
            authData.summary?.totalImages === 2 &&
            authData.convertedCsv.includes("Image Src") &&
            authData.convertedCsv.includes("Image Position");

        const passed = unauthBlocked && convertPassed;
        record(5, "Shopify-to-Bazaarvilla CSV Converter Endpoint (Auth & Conversion)", passed,
            `Unauthenticated blocked (401): ${unauthBlocked}, Authenticated HTTP ${authRes.status}, success: ${authData.success}, products: ${authData.summary?.totalProducts}, images: ${authData.summary?.totalImages}`);
    } catch (e) {
        record(5, "Shopify-to-Bazaarvilla CSV Converter Endpoint", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 6. Admin Media Repair Endpoint (Auth & Read-Only Audit Execution)
    // -------------------------------------------------------------------------
    try {
        // 6a: Unauthenticated GET (Fail-Closed)
        const unauthRes = await fetch(`${BASE_URL}/api/admin/products/import/repair`, { cache: "no-store" });
        const unauthBlocked = unauthRes.status === 401;

        // 6b: Authenticated GET (Live read-only catalog media audit)
        const authRes = await fetch(`${BASE_URL}/api/admin/products/import/repair`, {
            headers: { "Authorization": `Bearer ${adminToken}` },
            cache: "no-store",
        });
        const auditData = await authRes.json();

        const auditPassed = authRes.status === 200 &&
            auditData.success === true &&
            auditData.totalAudited === 18 &&
            auditData.healthyCount === 17 &&
            auditData.affectedCount === 1 &&
            auditData.affectedProducts?.[0]?.productId === "53d5be36-5962-405a-9e51-39bc00ef04f5";

        const passed = unauthBlocked && auditPassed;
        record(6, "Admin Media Repair Endpoint (Auth & Read-Only Audit Execution)", passed,
            `Unauthenticated blocked (401): ${unauthBlocked}, Total audited: ${auditData.totalAudited}, Healthy: ${auditData.healthyCount}, Affected: ${auditData.affectedCount}, Target Product: ${auditData.affectedProducts?.[0]?.productId} (Raw: ${JSON.stringify(auditData)})`);
    } catch (e) {
        record(6, "Admin Media Repair Endpoint", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 7. Secure Shopify CDN External Connectivity Verification
    // -------------------------------------------------------------------------
    try {
        const shopifyUrl = "https://cdn.shopify.com/s/files/1/0821/4475/6011/files/PID-68151-Plastic-Batman-Pen-Holder-Black-1.jpg?v=1791097549";
        const cdnRes = await fetch(shopifyUrl, { method: "HEAD" });
        const cdnContentType = cdnRes.headers.get("content-type") || "";
        const cdnContentLen = parseInt(cdnRes.headers.get("content-length") || "0", 10);

        const passed = cdnRes.status === 200 && cdnContentType.includes("image/jpeg") && cdnContentLen > 5000;
        record(7, "Shopify CDN Source Image Reachability & Binary Integrity", passed,
            `HTTP ${cdnRes.status}, Content-Type: "${cdnContentType}", Content-Length: ${cdnContentLen} bytes`);
    } catch (e) {
        record(7, "Shopify CDN Source Image Reachability", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 8. Catalog Storefront Page Availability
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/products`, { cache: "no-store" });
        const text = await res.text();
        const passed = res.status === 200 && (text.includes("Products") || text.includes("catalog") || text.includes("price"));
        record(8, "Storefront Catalog Page Availability", passed, `HTTP ${res.status}, length=${text.length}`);
    } catch (e) {
        record(8, "Storefront Catalog Page Availability", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 9. Product Detail Page (PDP) Availability & Images
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/products/silver-plated-rudraksha-om-bracelet`, { cache: "no-store" });
        const text = await res.text();
        const passed = res.status === 200 && text.includes("Rudraksha");
        record(9, "Product Detail Page (PDP) Availability", passed, `HTTP ${res.status}, contains 'Rudraksha': ${text.includes("Rudraksha")}`);
    } catch (e) {
        record(9, "Product Detail Page (PDP) Availability", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 10. Cart Page Availability
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/cart`, { cache: "no-store" });
        const text = await res.text();
        const passed = res.status === 200 && (text.includes("Cart") || text.includes("Shopping"));
        record(10, "Shopping Cart Page Availability", passed, `HTTP ${res.status}, length=${text.length}`);
    } catch (e) {
        record(10, "Shopping Cart Page Availability", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 11. Checkout Page Availability & Gate Status
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/checkout`, { cache: "no-store" });
        const text = await res.text();
        const passed = res.status === 200 && (text.includes("Checkout") || text.includes("bazaarvilla"));
        record(11, "Checkout Page Availability", passed, `HTTP ${res.status}, length=${text.length}`);
    } catch (e) {
        record(11, "Checkout Page Availability", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 12. Categories Listing Page Availability
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/categories`, { cache: "no-store" });
        const text = await res.text();
        const passed = res.status === 200 && (text.includes("Categories") || text.includes("category"));
        record(12, "Categories Page Availability", passed, `HTTP ${res.status}, length=${text.length}`);
    } catch (e) {
        record(12, "Categories Page Availability", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 13. Admin Products Management Page
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/admin/products`, { cache: "no-store" });
        record(13, "Admin Products Interface", res.status === 200, `HTTP ${res.status}`);
    } catch (e) {
        record(13, "Admin Products Interface", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 14. Admin Categories Management Page
    // -------------------------------------------------------------------------
    try {
        const res = await fetch(`${BASE_URL}/admin/categories`, { cache: "no-store" });
        record(14, "Admin Categories Interface", res.status === 200, `HTTP ${res.status}`);
    } catch (e) {
        record(14, "Admin Categories Interface", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // 15. Live Catalog Media Asset Verification (Sample of 3 Products)
    // -------------------------------------------------------------------------
    try {
        const testKeys = [
            "products/12be4f44-a9fc-47bd-92d0-dd794a2efb65/5fa2997d-52f1-4f6e-b392-26ad1c3836cf.png",
            "products/14a29e10-758e-4fd2-a10a-6c04c74fe73a/8fd8327a-c92c-423e-92f9-1e29358c99ba.png",
            "products/27b49fb7-e358-4fc2-b956-f3bb5fd685b2/29e5fc26-cfe3-414c-8405-509dca99e818.png",
        ];

        let allHealthy = true;
        const detailsArr = [];

        for (const k of testKeys) {
            const r = await fetch(`${BASE_URL}/api/media/public/${k}`, { cache: "no-store" });
            const st = r.headers.get("x-bazaarvilla-media-status");
            const ct = r.headers.get("content-type");
            const buf = await r.arrayBuffer();
            const healthy = r.status === 200 && st === "hit" && buf.byteLength > 1000;
            if (!healthy) allHealthy = false;
            detailsArr.push(`${k.split("/").pop()}: ${st} (${ct}, ${buf.byteLength}B)`);
        }

        record(15, "Live Catalog Media Multi-Asset Binary Delivery Smoke Test", allHealthy, detailsArr.join("; "));
    } catch (e) {
        record(15, "Live Catalog Media Multi-Asset Delivery Smoke Test", false, `Error: ${e.message}`);
    }

    // -------------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------------
    console.log("================================================================================");
    const passCount = results.filter((r) => r.passed).length;
    const failCount = results.filter((r) => !r.passed).length;
    console.log(`TOTAL CHECKS: ${results.length} | PASSED: ${passCount} | FAILED: ${failCount}`);
    console.log("MUTATIONS COMMITTED: 0 (100% READ-ONLY)");
    console.log("================================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

verifyLive();
