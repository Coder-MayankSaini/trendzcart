/**
 * Inner Screenshot Capture for TASK 034
 * Executed inside `firebase emulators:exec`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task034");
fs.mkdirSync(outDir, { recursive: true });

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
    console.log("[TASK-034 QA] Emulator is running! Seeding Firestore data...");

    // 1. Seed data
    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task034-seeder-" + Date.now());
    } catch {
        app = admin.app("task034-seeder");
    }
    const adminAuth = app.auth();
    const adminDb = app.firestore();

    const adminUid = "admin_verified_task034";
    try { await adminAuth.deleteUser(adminUid); } catch {}
    await adminAuth.createUser({
        uid: adminUid,
        email: "admin@trendkartz.test",
        password: "AdminPassword123!",
        displayName: "Store Administrator",
    });
    await adminAuth.setCustomUserClaims(adminUid, { admin: true });

    await adminDb.collection("users").doc(adminUid).set({
        uid: adminUid,
        email: "admin@trendkartz.test",
        role: "admin",
        createdAt: Date.now(),
    });

    // Seed test products for TASK 034
    const sampleProducts = [
        {
            id: "bazaarvilla-discounted-hoodie",
            name: "Bazaarvilla Signature Heavyweight Cotton Hoodie",
            slug: "bazaarvilla-signature-heavyweight-cotton-hoodie",
            description: "380 GSM brushed fleece cotton hoodie with double-stitched kangaroo pocket and brass drawstring eyelets. Premium comfort and lasting durability.",
            price: 1249,
            compareAtPrice: 1499,
            inventory: 50,
            category: "Apparel",
            images: ["https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            reviewCount: 18,
            averageRating: 4.9,
            createdAt: Date.now() - 86400000,
        },
        {
            id: "bazaarvilla-regular-massager",
            name: "CrampEase Pro Period Pain Relief Massager Belt",
            slug: "crampease-pro-period-pain-relief-massager-belt",
            description: "Advanced thermal heating and multi-frequency vibration massage belt designed for rapid abdominal and lower back menstrual pain relief.",
            price: 1499,
            compareAtPrice: null,
            inventory: 40,
            category: "Wellness & Personal Care",
            images: ["https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            reviewCount: 9,
            averageRating: 4.7,
            createdAt: Date.now() - 172800000,
        },
        {
            id: "bazaarvilla-variant-tshirt",
            name: "Bazaarvilla Premium Cotton T-Shirt",
            slug: "bazaarvilla-premium-cotton-t-shirt",
            description: "Classic crew neck 100% combed cotton t-shirt with tailored drape and reinforced seams. Available in standard sizes.",
            price: 1249,
            compareAtPrice: 1499,
            inventory: 35,
            category: "Apparel",
            images: ["https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isCustomized: false,
            hasVariants: true,
            sizeMode: "apparel",
            sizes: [
                { id: "size-s", label: "S", active: true },
                { id: "size-xl", label: "XL", active: true },
            ],
            colors: [
                { id: "color-black", name: "Black", hex: "#000000", active: true },
            ],
            variants: [
                {
                    id: "size-s-color-black",
                    sizeId: "size-s",
                    sizeLabel: "S",
                    colorId: "color-black",
                    colorName: "Black",
                    price: 1249,
                    compareAtPrice: 1499,
                    stock: 20,
                    active: true,
                    sku: "TSHIRT-S-BLK",
                },
                {
                    id: "size-xl-color-black",
                    sizeId: "size-xl",
                    sizeLabel: "XL",
                    colorId: "color-black",
                    colorName: "Black",
                    price: 1499,
                    compareAtPrice: 1799,
                    stock: 15,
                    active: true,
                    sku: "TSHIRT-XL-BLK",
                },
            ],
            reviewCount: 14,
            averageRating: 4.8,
            createdAt: Date.now() - 259200000,
        },
    ];

    for (const prod of sampleProducts) {
        await adminDb.collection("products").doc(prod.id).set(prod);
    }
    console.log(`[TASK-034 QA] Seeded ${sampleProducts.length} products successfully.`);

    // 2. Start Next.js server on port 3333
    console.log("[TASK-034 QA] Starting Next.js test server on port 3333...");
    const nextProc = spawn("npx", ["next", "dev", "--port", "3333"], {
        env: {
            ...process.env,
            PORT: "3333",
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

    try {
        await waitForPort(3333, 45000);
        console.log("[TASK-034 QA] Next.js dev server ready at http://localhost:3333!");

        // 3. Launch Chrome Headless
        console.log("[TASK-034 QA] Launching Chrome Headless...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-task034-" + Date.now());
        chromeProcess = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
            "--headless",
            "--remote-debugging-port=9222",
            "--window-size=1440,900",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=" + chromeProfile,
        ]);

        let tab = null;
        for (let i = 0; i < 20; i++) {
            try {
                const res = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
                if (res.ok) {
                    tab = await res.json();
                    break;
                }
            } catch {
                await new Promise((r) => setTimeout(r, 200));
            }
        }
        if (!tab) throw new Error("Could not connect to Chrome debugging port 9222");

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
            await new Promise((r) => setTimeout(r, 600));
        };

        const capture = async (filename) => {
            const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
            const buf = Buffer.from(result.data, "base64");
            const targetPath = path.join(outDir, filename);
            fs.writeFileSync(targetPath, buf);
            console.log(`[Captured] ${filename} (${buf.length} bytes)`);
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 3500));
        };

        // Step A: Sign in as Admin via Homepage Auth Modal
        console.log("[TASK-034 QA] Navigating to homepage to authenticate as admin...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/");

        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const signinBtn = document.querySelector('.login-btn') || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Sign In'));
                    if (signinBtn) signinBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));

        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const setVal = (el, val) => {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(el, val);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    };
                    const emailInput = document.querySelector('input[type="email"]');
                    const passInput = document.querySelector('input[type="password"]');
                    if (emailInput && passInput) {
                        setVal(emailInput, "admin@trendkartz.test");
                        setVal(passInput, "AdminPassword123!");
                        const form = emailInput.closest('form');
                        if (form) {
                            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                        }
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 3000));

        // Step B: Navigate to Admin Products and open Add/Edit modal
        console.log("[TASK-034 QA] Navigating to Admin Products...");
        await navigateTo("http://localhost:3333/admin/products");
        await new Promise((r) => setTimeout(r, 2000));

        // Click edit on the first product or Add Product
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const editBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('Edit'));
                    if (editBtns.length > 0) {
                        editBtns[0].click();
                    } else {
                        const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Add Product'));
                        if (addBtn) addBtn.click();
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1500));

        // Scroll to Section 2: Pricing, Stock & Variants
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const pricingHeading = Array.from(document.querySelectorAll('h3')).find(h => h.textContent && h.textContent.includes('Pricing'));
                    if (pricingHeading) pricingHeading.scrollIntoView({ behavior: 'instant', block: 'center' });
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 600));

        // Capture 01: Admin Pricing Controls & Live Discount Preview
        console.log("[TASK-034 QA] Capturing 01-admin-pricing-controls-preview.png...");
        await capture("01-admin-pricing-controls-preview.png");

        // Close modal and edit variant product to view variant pricing matrix
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Cancel'));
                    if (cancelBtn) cancelBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));

        // Open edit for variant product
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    const variantRow = rows.find(r => r.textContent && r.textContent.includes('T-Shirt'));
                    if (variantRow) {
                        const editBtn = variantRow.querySelector('button');
                        if (editBtn) editBtn.click();
                    } else {
                        const editBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('Edit'));
                        if (editBtns.length > 1) editBtns[1].click();
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1500));

        // Scroll down to variant matrix table
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const variantSection = Array.from(document.querySelectorAll('h4')).find(h => h.textContent && (h.textContent.includes('Combinations') || h.textContent.includes('Variant Matrix')));
                    if (variantSection) variantSection.scrollIntoView({ behavior: 'instant', block: 'center' });
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 600));

        // Capture 02: Admin Variant Pricing Matrix with Selling & Original Prices
        console.log("[TASK-034 QA] Capturing 02-admin-variant-pricing-table.png...");
        await capture("02-admin-variant-pricing-table.png");

        // Close modal
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Cancel'));
                    if (cancelBtn) cancelBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));

        // Step C: Homepage discounted product cards (Desktop 1440px)
        console.log("[TASK-034 QA] Navigating to homepage (1440px)...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/");

        // Scroll to products section
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const trendingSection = document.querySelector('section') || document.body;
                    window.scrollTo({ top: 400, behavior: 'instant' });
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 600));

        // Capture 03: Homepage cards with dual-price display (₹1,249, ~~₹1,499~~, 17% OFF)
        console.log("[TASK-034 QA] Capturing 03-homepage-discounted-card-desktop-1440px.png...");
        await capture("03-homepage-discounted-card-desktop-1440px.png");

        // Step D: Homepage mobile view (390px)
        console.log("[TASK-034 QA] Capturing 04-homepage-discounted-card-mobile-390px.png...");
        await setViewport(390, 844, true);
        await new Promise((r) => setTimeout(r, 600));
        await capture("04-homepage-discounted-card-mobile-390px.png");

        // Step E: PDP Discounted Product (Desktop 1440px)
        console.log("[TASK-034 QA] Navigating to PDP Discounted Product...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/products/bazaarvilla-signature-heavyweight-cotton-hoodie");
        await new Promise((r) => setTimeout(r, 1000));

        // Capture 05: PDP with selling price ₹1,249, strikethrough ₹1,499, 17% OFF, and "You save ₹250"
        console.log("[TASK-034 QA] Capturing 05-pdp-discounted-product-desktop-1440px.png...");
        await capture("05-pdp-discounted-product-desktop-1440px.png");

        // Step F: PDP Regular Product without discount (Desktop 1440px)
        console.log("[TASK-034 QA] Navigating to PDP Regular Product...");
        await navigateTo("http://localhost:3333/products/crampease-pro-period-pain-relief-massager-belt");
        await new Promise((r) => setTimeout(r, 1000));

        // Capture 06: PDP regular product showing single clean price ₹1,499 without discount badge
        console.log("[TASK-034 QA] Capturing 06-pdp-regular-product-desktop-1440px.png...");
        await capture("06-pdp-regular-product-desktop-1440px.png");

        // Step G: PDP Variant Product with dynamic pricing update (Desktop 1440px)
        console.log("[TASK-034 QA] Navigating to PDP Variant Product...");
        await navigateTo("http://localhost:3333/products/bazaarvilla-premium-cotton-t-shirt");
        await new Promise((r) => setTimeout(r, 1000));

        // Click on "XL" size button to trigger variant price change
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const sizeBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.trim() === 'XL');
                    if (sizeBtns.length > 0) sizeBtns[0].click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));

        // Capture 07: PDP variant switching (XL variant: Selling ₹1,499, Original ₹1,799, 17% OFF)
        console.log("[TASK-034 QA] Capturing 07-pdp-variant-switching-xl.png...");
        await capture("07-pdp-variant-switching-xl.png");

        // Step H: Add to Cart and view Cart Page
        console.log("[TASK-034 QA] Adding item to cart and navigating to /cart...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Add to Cart'));
                    if (addBtn) addBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1200));

        await navigateTo("http://localhost:3333/cart");
        await new Promise((r) => setTimeout(r, 1500));

        // Capture 08: Cart showing selling price ₹1,499, strikethrough ₹1,799, 17% OFF, and subtotal
        console.log("[TASK-034 QA] Capturing 08-cart-price-consistency-desktop-1440px.png...");
        await capture("08-cart-price-consistency-desktop-1440px.png");

        // Step I: Checkout Page price consistency
        console.log("[TASK-034 QA] Navigating to /checkout...");
        await navigateTo("http://localhost:3333/checkout");
        await new Promise((r) => setTimeout(r, 1500));

        // Capture 09: Checkout order summary showing selling price unit ₹1,499 and final total
        console.log("[TASK-034 QA] Capturing 09-checkout-selling-price-summary-desktop-1440px.png...");
        await capture("09-checkout-selling-price-summary-desktop-1440px.png");

        // Step J: Viewport Responsiveness Suite (PDP Discounted Product across all 7 target viewports)
        console.log("[TASK-034 QA] Testing responsive viewports...");
        await navigateTo("http://localhost:3333/products/bazaarvilla-signature-heavyweight-cotton-hoodie");
        await new Promise((r) => setTimeout(r, 1000));

        const targetViewports = [
            { name: "10-responsive-320px.png", width: 320, height: 600, mobile: true },
            { name: "11-responsive-375px.png", width: 375, height: 667, mobile: true },
            { name: "12-responsive-390px.png", width: 390, height: 844, mobile: true },
            { name: "13-responsive-430px.png", width: 430, height: 932, mobile: true },
            { name: "14-responsive-768px.png", width: 768, height: 1024, mobile: false },
            { name: "15-responsive-1024px.png", width: 1024, height: 768, mobile: false },
            { name: "16-responsive-1440px.png", width: 1440, height: 900, mobile: false },
        ];

        for (const vp of targetViewports) {
            await setViewport(vp.width, vp.height, vp.mobile);
            await new Promise((r) => setTimeout(r, 500));
            console.log(`[TASK-034 QA] Capturing ${vp.name} (${vp.width}px)...`);
            await capture(vp.name);
        }

        console.log("[TASK-034 QA] All 16 Visual QA screenshots captured successfully!");
    } finally {
        if (chromeProcess) {
            console.log("[TASK-034 QA] Terminating Chrome...");
            chromeProcess.kill();
        }
        if (nextProc) {
            console.log("[TASK-034 QA] Terminating Next.js dev server...");
            nextProc.kill();
        }
    }
}

main().catch((err) => {
    console.error("[TASK-034 QA] Error during execution:", err);
    process.exit(1);
});
