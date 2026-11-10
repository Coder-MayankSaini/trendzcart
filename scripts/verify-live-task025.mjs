// scripts/verify-live-task025.mjs
async function verifyLive() {
    console.log("=== BAZAARVILLA PRODUCTION VERIFICATION (TASK 025) ===");
    const domain = "https://bazaarvilla.com";

    // 1. Check Public Config
    const configRes = await fetch(`${domain}/api/razorpay/public-config`);
    const config = await configRes.json();
    console.log("[1] Public Config:", config);
    if (config.commercialCheckoutEnabled !== true || config.keyId !== "rzp_live_Ty8CuwoSSBGpHi") {
        throw new Error("COMMERCIAL CHECKOUT OR RAZORPAY LIVE KEY COMPROMISED!");
    }
    console.log("    -> Razorpay Live Mode and Commercial Checkout Gate: 100% VERIFIED ACTIVE");

    // 2. Check Core Pages
    const pages = ["/", "/products", "/categories", "/cart", "/checkout", "/admin/products"];
    for (const page of pages) {
        const res = await fetch(`${domain}${page}`);
        console.log(`[2] Page ${page} Status:`, res.status);
        if (res.status !== 200) {
            throw new Error(`Page ${page} returned unexpected status ${res.status}`);
        }
    }

    // 3. Check Live CSS contains TASK 025 gallery styling and .is-hero
    const adminRes = await fetch(`${domain}/admin/products`);
    const adminHtml = await adminRes.text();
    const cssMatches = adminHtml.match(/href="(\/_next\/static\/[^"]+\.css)"/g);
    console.log("[3] Discovered Live CSS Links:", cssMatches);
    let foundGalleryCard = false;
    let foundIsHero = false;
    if (cssMatches) {
        for (const match of cssMatches) {
            const href = match.match(/href="([^"]+)"/)[1];
            const cssUrl = domain + href;
            const cssRes = await fetch(cssUrl);
            const css = await cssRes.text();
            if (css.includes(".admin-gallery-card")) foundGalleryCard = true;
            if (css.includes(".admin-gallery-card.is-hero")) foundIsHero = true;
        }
    }
    console.log("    -> Live CSS has .admin-gallery-card:", foundGalleryCard);
    console.log("    -> Live CSS has .admin-gallery-card.is-hero:", foundIsHero);
    if (!foundGalleryCard || !foundIsHero) {
        throw new Error("TASK 025 CSS rules missing from live production bundle!");
    }

    // 4. Verify Live Product & Category Media Delivery
    const testKeys = [
        "products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-ff6e-473b-a9b0-96f7c1bf19ce.png",
        "products/82b5c865-3128-4515-96e5-80f7f0eed58e/c0b8b64e-09a8-4c91-9e8c-850781e9f1a2.png",
        "products/82b5c865-3128-4515-96e5-80f7f0eed58e/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png",
        "products/82b5c865-3128-4515-96e5-80f7f0eed58e/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png",
        "products/82b5c865-3128-4515-96e5-80f7f0eed58e/50d254ff-38e7-4a1a-954a-78eb583ba335.png",
        "categories/cd3e7259-51bc-420d-ac4c-2afa7d8fafa6/231ffa35-ceb3-4460-a06f-dd800c18a268.png"
    ];

    console.log("[4] Testing Live Production Media URLs (Path-Based Delivery):");
    for (const key of testKeys) {
        const url = `${domain}/api/media/public/${key}`;
        const res = await fetch(url);
        const contentType = res.headers.get("content-type");
        const contentLength = res.headers.get("content-length");
        console.log(`    -> ${key.split("/").pop()} [Status: ${res.status}, Type: ${contentType}, Size: ${contentLength} bytes]`);
        if (res.status !== 200) {
            throw new Error(`Media URL ${key} returned status ${res.status}`);
        }
    }

    console.log("=== ALL LIVE VERIFICATION CHECKS PASSED SUCCESSFULLY! ===");
}

verifyLive().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});
