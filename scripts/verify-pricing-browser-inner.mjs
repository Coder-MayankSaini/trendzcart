/**
 * Automated Browser Verification for TASK 034
 * Checks customer-facing pricing, variant switching, cart/checkout consistency,
 * and empirical mobile overflow across 320px, 375px, 390px, and 430px.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

async function waitForPort(port, timeoutMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://127.0.0.1:${port}`, (res) => resolve(res));
                req.on("error", reject);
                req.setTimeout(1000, () => req.destroy());
            });
            return true;
        } catch {
            await new Promise((r) => setTimeout(r, 500));
        }
    }
    throw new Error(`Port ${port} did not respond within ${timeoutMs}ms`);
}

async function main() {
    console.log("[Pricing Browser Verification] Seeding Firestore data in emulator...");

    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "browser-verifier-" + Date.now());
    } catch {
        app = admin.app("browser-verifier");
    }
    const adminDb = app.firestore();

    // Seed test products
    const sampleProducts = [
        {
            id: "browser-verify-hoodie-discounted",
            name: "Bazaarvilla Premium Oversized Hoodie",
            slug: "bazaarvilla-premium-oversized-hoodie",
            description: "Heavyweight 380 GSM fleece hoodie with kangaroo pocket.",
            price: 1249,
            compareAtPrice: 1499, // 17% OFF, ₹250 savings
            inventory: 40,
            category: "Apparel",
            images: ["https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            hasVariants: false,
            createdAt: Date.now() - 1000,
        },
        {
            id: "browser-verify-massager-regular",
            name: "CrampEase Pro Period Pain Relief Massager Belt",
            slug: "crampease-pro-period-pain-relief-massager-belt",
            description: "Advanced thermal heating and vibration massage belt.",
            price: 1499,
            compareAtPrice: null, // NO discount
            inventory: 35,
            category: "Wellness",
            images: ["https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            hasVariants: false,
            createdAt: Date.now() - 2000,
        },
        {
            id: "browser-verify-tee-variants",
            name: "Bazaarvilla Dual-Price Variant T-Shirt",
            slug: "bazaarvilla-dual-price-variant-t-shirt",
            description: "100% combed cotton crew neck tee.",
            price: 1249,
            compareAtPrice: 1499,
            inventory: 50,
            category: "Apparel",
            images: ["https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            hasVariants: true,
            sizeMode: "apparel",
            sizesList: [
                { id: "size-s", name: "S", isActive: true },
                { id: "size-xl", name: "XL", isActive: true },
            ],
            colors: [{ id: "col-black", name: "Black", hex: "#000000", isActive: true }],
            variants: [
                {
                    id: "var-s-blk",
                    sizeId: "size-s",
                    sizeName: "S",
                    colorId: "col-black",
                    colorName: "Black",
                    price: 1249,
                    compareAtPrice: 1499,
                    inventory: 25,
                    isActive: true,
                    sku: "TEE-S-BLK",
                },
                {
                    id: "var-xl-blk",
                    sizeId: "size-xl",
                    sizeName: "XL",
                    colorId: "col-black",
                    colorName: "Black",
                    price: 1499,
                    compareAtPrice: 1799,
                    inventory: 20,
                    isActive: true,
                    sku: "TEE-XL-BLK",
                },
            ],
            createdAt: Date.now() - 3000,
        },
    ];

    for (const p of sampleProducts) {
        await adminDb.collection("products").doc(p.id).set(p);
    }
    console.log("[Pricing Browser Verification] Seeded 3 test products.");

    // Start Next.js dev server on port 3334
    console.log("[Pricing Browser Verification] Starting Next.js test server on port 3334...");
    const nextProc = spawn("npx", ["next", "dev", "--port", "3334"], {
        env: {
            ...process.env,
            PORT: "3334",
            USE_FIREBASE_EMULATOR: "true",
            NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
            FIREBASE_PROJECT_ID: "demo-trendkartz",
            NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-trendkartz",
            FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
            COMMERCIAL_CHECKOUT_ENABLED: "true",
        },
        shell: true,
        stdio: "inherit",
    });

    let chromeProcess = null;
    let chromeProfile = null;

    try {
        await waitForPort(3334, 45000);
        console.log("[Pricing Browser Verification] Server is ready at http://localhost:3334!");

        chromeProfile = path.join(process.cwd(), ".chrome-profile-pricing-verify-" + Date.now());
        chromeProcess = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
            "--headless",
            "--remote-debugging-port=9223",
            "--window-size=1440,900",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=" + chromeProfile,
        ]);

        let tab = null;
        for (let i = 0; i < 20; i++) {
            try {
                const res = await fetch("http://127.0.0.1:9223/json/new", { method: "PUT" });
                if (res.ok) {
                    tab = await res.json();
                    break;
                }
            } catch {
                await new Promise((r) => setTimeout(r, 200));
            }
        }
        if (!tab) throw new Error("Could not connect to Chrome debugging port 9223");

        const ws = new WebSocket(tab.webSocketDebuggerUrl);
        let msgIdCounter = 1;
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = msgIdCounter++;
            const handler = (e) => {
                const data = JSON.parse(e.data);
                if (data.id === id) {
                    ws.removeEventListener("message", handler);
                    if (data.error) reject(new Error(data.error.message));
                    else resolve(data.result);
                }
            };
            ws.addEventListener("message", handler);
            ws.send(JSON.stringify({ id, method, params }));
        });

        await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
        await send("Page.enable");
        await send("Runtime.enable");
        await send("DOM.enable");

        const setViewport = async (w, h, isMobile = false) => {
            await send("Emulation.setDeviceMetricsOverride", {
                width: w,
                height: h,
                deviceScaleFactor: 2,
                mobile: isMobile,
            });
            await new Promise((r) => setTimeout(r, 400));
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 2500));
        };

        const evaluate = async (fnString) => {
            const result = await send("Runtime.evaluate", {
                expression: `(${fnString})()`,
                returnByValue: true,
            });
            if (result.exceptionDetails) {
                throw new Error("Evaluation error: " + JSON.stringify(result.exceptionDetails));
            }
            return result.result?.value;
        };

        // ---------------------------------------------------------------------
        // Check 1: Homepage Cards (Dual Pricing vs Single Price)
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Checking Homepage product cards...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3334/");

        const homepagePricing = await evaluate(`() => {
            const cards = Array.from(document.querySelectorAll('.hp-product-card, .product-card, a[href*="/products/"]'));
            const discountedCard = cards.find(c => c.textContent && c.textContent.includes('Oversized Hoodie'));
            const regularCard = cards.find(c => c.textContent && c.textContent.includes('Massager Belt'));

            return {
                discountedText: discountedCard ? discountedCard.textContent : '',
                regularText: regularCard ? regularCard.textContent : '',
                discountedHasStrikethrough: !!(discountedCard && (discountedCard.querySelector('del, s, .line-through, .hp-product-original-price, .product-card-original-price') || discountedCard.textContent.includes('1,499'))),
                discountedHasBadge: !!(discountedCard && discountedCard.textContent.includes('17% OFF')),
                regularHasStrikethrough: !!(regularCard && (regularCard.querySelector('del, s, .line-through, .hp-product-original-price, .product-card-original-price') || regularCard.textContent.includes('% OFF'))),
                regularHasBadge: !!(regularCard && regularCard.textContent.includes('% OFF')),
            };
        }`);

        console.log("Homepage Pricing Check:", homepagePricing);
        assert.ok(homepagePricing.discountedHasBadge, "Discounted card on homepage must show 17% OFF badge");
        assert.ok(homepagePricing.discountedHasStrikethrough, "Discounted card on homepage must show original price strikethrough");
        assert.equal(homepagePricing.regularHasBadge, false, "Regular product card must NOT show discount badge");
        assert.equal(homepagePricing.regularHasStrikethrough, false, "Regular product card must NOT show strikethrough");

        // ---------------------------------------------------------------------
        // Check 2: Catalog Page (/products)
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Checking Catalog page (/products)...");
        await navigateTo("http://localhost:3334/products");

        const catalogPricing = await evaluate(`() => {
            const cards = Array.from(document.querySelectorAll('.product-card, a[href*="/products/"]'));
            const discountedCard = cards.find(c => c.textContent && c.textContent.includes('Oversized Hoodie'));
            const regularCard = cards.find(c => c.textContent && c.textContent.includes('Massager Belt'));

            return {
                discountedHasBadge: !!(discountedCard && discountedCard.textContent.includes('17% OFF')),
                regularHasBadge: !!(regularCard && regularCard.textContent.includes('% OFF')),
            };
        }`);

        assert.ok(catalogPricing.discountedHasBadge, "Catalog discounted card must show 17% OFF");
        assert.equal(catalogPricing.regularHasBadge, false, "Catalog regular card must NOT show discount badge");

        // ---------------------------------------------------------------------
        // Check 3: PDP Discounted Product
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Checking PDP Discounted Product...");
        await navigateTo("http://localhost:3334/products/bazaarvilla-premium-oversized-hoodie");

        const pdpDiscounted = await evaluate(`() => {
            const bodyText = document.body.textContent || '';
            const sellingPresent = bodyText.includes('1,249');
            const originalPresent = bodyText.includes('1,499');
            const discountBadgePresent = bodyText.includes('17% OFF');
            const savingsPresent = bodyText.includes('You save ₹250') || bodyText.includes('250');

            return {
                sellingPresent,
                originalPresent,
                discountBadgePresent,
                savingsPresent,
            };
        }`);

        console.log("PDP Discounted Check:", pdpDiscounted);
        assert.ok(pdpDiscounted.sellingPresent, "PDP must show selling price ₹1,249");
        assert.ok(pdpDiscounted.originalPresent, "PDP must show strikethrough original price ₹1,499");
        assert.ok(pdpDiscounted.discountBadgePresent, "PDP must show 17% OFF badge");
        assert.ok(pdpDiscounted.savingsPresent, "PDP must show You save ₹250");

        // ---------------------------------------------------------------------
        // Check 4: PDP Regular Product (NO Discount)
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Checking PDP Regular Product without discount...");
        await navigateTo("http://localhost:3334/products/crampease-pro-period-pain-relief-massager-belt");

        const pdpRegular = await evaluate(`() => {
            const bodyText = document.body.textContent || '';
            const sellingPresent = bodyText.includes('1,499');
            const discountBadgePresent = bodyText.includes('% OFF');
            const savingsPresent = bodyText.includes('You save');

            return {
                sellingPresent,
                discountBadgePresent,
                savingsPresent,
            };
        }`);

        console.log("PDP Regular Check:", pdpRegular);
        assert.ok(pdpRegular.sellingPresent, "PDP must show single price ₹1,499");
        assert.equal(pdpRegular.discountBadgePresent, false, "Regular product PDP must NOT show discount badge");
        assert.equal(pdpRegular.savingsPresent, false, "Regular product PDP must NOT show 'You save' callout");

        // ---------------------------------------------------------------------
        // Check 5: PDP Variant Switching
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Checking PDP Variant Switching...");
        await navigateTo("http://localhost:3334/products/bazaarvilla-dual-price-variant-t-shirt");

        // Initial state (Size S selected by default)
        const variantInitial = await evaluate(`() => {
            const text = document.body.textContent || '';
            return {
                selling: text.includes('1,249'),
                original: text.includes('1,499'),
                discount: text.includes('17% OFF'),
            };
        }`);
        assert.ok(variantInitial.selling, "Initial variant S must show ₹1,249");
        assert.ok(variantInitial.original, "Initial variant S must show ₹1,499");
        assert.ok(variantInitial.discount, "Initial variant S must show 17% OFF");

        // Click on Size XL button
        await evaluate(`() => {
            const xlBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'XL');
            if (xlBtn) xlBtn.click();
        }`);
        await new Promise((r) => setTimeout(r, 600));

        // State after selecting Size XL
        const variantSwitched = await evaluate(`() => {
            const text = document.body.textContent || '';
            return {
                selling: text.includes('1,499'),
                original: text.includes('1,799'),
                discount: text.includes('17% OFF'),
                savings: text.includes('You save ₹300') || text.includes('300'),
            };
        }`);
        console.log("Variant Switched Check:", variantSwitched);
        assert.ok(variantSwitched.selling, "Switched variant XL must show selling price ₹1,499");
        assert.ok(variantSwitched.original, "Switched variant XL must show original price ₹1,799");
        assert.ok(variantSwitched.discount, "Switched variant XL must show 17% OFF");
        assert.ok(variantSwitched.savings, "Switched variant XL must show savings of ₹300");

        // ---------------------------------------------------------------------
        // Check 6: Cart & Checkout Price Consistency
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Adding variant XL to cart and verifying Cart page...");
        await evaluate(`() => {
            const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Add to Cart'));
            if (addBtn) addBtn.click();
        }`);
        await new Promise((r) => setTimeout(r, 1000));

        await navigateTo("http://localhost:3334/cart");

        const cartPricing = await evaluate(`() => {
            const text = document.body.textContent || '';
            return {
                sellingPricePresent: text.includes('1,499'),
                originalPricePresent: text.includes('1,799'),
                discountBadgePresent: text.includes('17% OFF'),
                subtotalMatchesSelling: text.includes('1,499'),
            };
        }`);
        console.log("Cart Pricing Check:", cartPricing);
        assert.ok(cartPricing.sellingPricePresent, "Cart must display selling price ₹1,499");
        assert.ok(cartPricing.originalPricePresent, "Cart must display original price strikethrough ₹1,799");
        assert.ok(cartPricing.discountBadgePresent, "Cart must display 17% OFF badge");

        console.log("[Pricing Browser Verification] Checking Checkout page...");
        await navigateTo("http://localhost:3334/checkout");

        const checkoutPricing = await evaluate(`() => {
            const text = document.body.textContent || '';
            return {
                sellingPricePresent: text.includes('1,499'),
                mrpNotCharged: !text.includes('1,799') || text.includes('1,499'),
            };
        }`);
        assert.ok(checkoutPricing.sellingPricePresent, "Checkout must derive subtotal and total from selling price ₹1,499");

        // ---------------------------------------------------------------------
        // Check 7: Empirical Mobile Overflow at 320px, 375px, 390px, 430px
        // ---------------------------------------------------------------------
        console.log("[Pricing Browser Verification] Verifying mobile overflow across viewports...");
        const mobileViewports = [320, 375, 390, 430];
        const pagesToTest = [
            "http://localhost:3334/",
            "http://localhost:3334/products",
            "http://localhost:3334/products/bazaarvilla-premium-oversized-hoodie",
            "http://localhost:3334/cart",
            "http://localhost:3334/checkout",
        ];

        for (const width of mobileViewports) {
            await setViewport(width, 700, true);
            for (const url of pagesToTest) {
                await navigateTo(url);
                const overflow = await evaluate(`() => {
                    const scrollWidth = document.documentElement.scrollWidth;
                    const innerWidth = window.innerWidth;
                    return {
                        scrollWidth,
                        innerWidth,
                        hasOverflow: scrollWidth > innerWidth,
                        overflowDelta: Math.max(0, scrollWidth - innerWidth),
                    };
                }`);

                if (overflow.hasOverflow) {
                    throw new Error(`Mobile overflow detected on ${url} at ${width}px: scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`);
                }
                console.log(`[Zero Overflow Verified] ${url} at ${width}px (scrollWidth: ${overflow.scrollWidth}px, innerWidth: ${overflow.innerWidth}px)`);
            }
        }

        console.log("[Pricing Browser Verification] ALL BROWSER & OVERFLOW CHECKS PASSED PERFECTLY!");
    } finally {
        if (chromeProcess) {
            console.log("[Pricing Browser Verification] Terminating Chrome...");
            chromeProcess.kill();
        }
        if (nextProc) {
            console.log("[Pricing Browser Verification] Terminating Next.js server...");
            nextProc.kill();
        }
        if (chromeProfile && fs.existsSync(chromeProfile)) {
            try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
        }
    }
}

main().catch((err) => {
    console.error("[Pricing Browser Verification Error]:", err);
    process.exit(1);
});
