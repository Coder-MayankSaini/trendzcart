/**
 * Automated Responsive Diagnostic & "BEFORE" Screenshot Capture for TASK 031
 * Uses Chrome DevTools Protocol & Firebase Emulator
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task031", "before");
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

function svgDataUri(text, bg = "#f1f5f9", fg = "#006B3C", w = 800, h = 1000) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/><text x="${w / 2}" y="${h / 2}" fill="${fg}" font-family="system-ui,sans-serif" font-size="32" font-weight="bold" text-anchor="middle">${text}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function main() {
    console.log("[TASK-031 BEFORE QA] Seeding Firestore in emulator...");

    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task031-seeder-" + Date.now());
    } catch {
        app = admin.app("task031-seeder");
    }
    const adminDb = app.firestore();

    // 1. Seed Cramp Relief Massager Belt (7 images, Free Size)
    const beltImages = [
        svgDataUri("CramEase Belt - Front View", "#fdf2f8", "#be185d", 1200, 1500),
        svgDataUri("CramEase Belt - Heat Zones", "#fef2f2", "#b91c1c", 1200, 1500),
        svgDataUri("CramEase Belt - Vibration Modes", "#fff7ed", "#c2410c", 1200, 1500),
        svgDataUri("CramEase Belt - Battery & Port", "#f0fdf4", "#15803d", 1200, 1500),
        svgDataUri("CramEase Belt - Adjustable Strap", "#f0f9ff", "#0369a1", 1200, 1500),
        svgDataUri("CramEase Belt - Soft Velvet", "#faf5ff", "#7e22ce", 1200, 1500),
        svgDataUri("CramEase Belt - Package Box", "#f8fafc", "#334155", 1200, 1500),
    ];
    await adminDb.collection("products").doc("prod-cramease-belt").set({
        id: "prod-cramease-belt",
        name: "BazaarVilla™ CramEase Pro – Period Pain Relief Massager Belt",
        slug: "bazaarvilla-cramease-pro-period-pain-relief-massager-belt",
        price: 549,
        inventory: 10,
        category: "Women Personal Care",
        categories: ["Women Personal Care"],
        images: beltImages,
        thumbnails: beltImages,
        description: "Rechargeable heating and vibration massage belt designed to help ease period cramps and lower back discomfort.",
        isVisible: true,
        isCustomized: false,
        hasVariants: false,
        sizes: ["Free Size"],
        createdAt: Date.now(),
    });

    // 2. Seed Long Title Product with customization
    const longTitleImages = [
        svgDataUri("Landscape 16:9 Photo", "#f1f5f9", "#006B3C", 1600, 900),
        svgDataUri("Square 1:1 Photo", "#f1f5f9", "#006B3C", 1000, 1000),
        svgDataUri("Tall Portrait 9:16 Photo", "#f1f5f9", "#006B3C", 900, 1600),
    ];
    await adminDb.collection("products").doc("prod-long-title-necklace").set({
        id: "prod-long-title-necklace",
        name: "Personalized Eyes Engraved Bar Necklace with Name – Custom Photo Eyes Pendant for Men & Women (Luxury Gift Box Included With Premium Velvet Pouch & Certificate)",
        slug: "personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women",
        price: 499,
        inventory: 10,
        category: "Customizable",
        categories: ["Customizable", "Jewelry"],
        images: longTitleImages,
        thumbnails: longTitleImages,
        description: "Custom engraved eyes bar necklace with personalized name and photo engraving.",
        isVisible: true,
        isCustomized: true,
        customizationType: "requires_picture",
        hasVariants: false,
        createdAt: Date.now(),
    });

    // 3. Seed Multi-Variant Product (Size + Color)
    const variantColors = [
        { id: "col_blue", name: "Royal Blue", hex: "#1e3a8a", image: svgDataUri("Blue T-Shirt", "#1e3a8a", "#ffffff"), isActive: true },
        { id: "col_red", name: "Crimson Red", hex: "#dc2626", image: svgDataUri("Red T-Shirt", "#dc2626", "#ffffff"), isActive: true },
        { id: "col_green", name: "Forest Green", hex: "#15803d", image: svgDataUri("Green T-Shirt", "#15803d", "#ffffff"), isActive: true },
    ];
    const variantSizes = [
        { id: "size_s", name: "S", isActive: true, order: 0 },
        { id: "size_m", name: "M", isActive: true, order: 1 },
        { id: "size_l", name: "L", isActive: true, order: 2 },
    ];
    const generatedVariants = [];
    for (const s of variantSizes) {
        for (const c of variantColors) {
            generatedVariants.push({
                id: `var_${s.id}_${c.id}`,
                sizeId: s.id,
                sizeName: s.name,
                colorId: c.id,
                colorName: c.name,
                sku: `TSHIRT-${s.name}-${c.name.substring(0, 3).toUpperCase()}`,
                price: s.name === "L" ? 599 : null,
                inventory: 8,
                isActive: true,
                image: c.image,
            });
        }
    }
    await adminDb.collection("products").doc("prod-variant-tshirt").set({
        id: "prod-variant-tshirt",
        name: "Bazaarvilla Classic Organic Cotton T-Shirt",
        slug: "bazaarvilla-classic-organic-cotton-tshirt",
        price: 499,
        inventory: 50,
        category: "Apparel",
        categories: ["Apparel"],
        images: variantColors.map(c => c.image),
        isVisible: true,
        isFeatured: true,
        hasVariants: true,
        sizeMode: "apparel",
        sizesList: variantSizes,
        colors: variantColors,
        variants: generatedVariants,
        createdAt: Date.now(),
    });

    console.log("[TASK-031 BEFORE QA] Seeded products in demo emulator!");

    // Start Next.js dev server on port 3333
    console.log("[TASK-031 BEFORE QA] Starting Next.js dev server on port 3333...");
    const nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
        env: {
            ...process.env,
            PORT: "3333",
            USE_FIREBASE_EMULATOR: "true",
            NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
            FIREBASE_PROJECT_ID: "demo-trendkartz",
            NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-trendkartz",
            FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            COMMERCIAL_CHECKOUT_ENABLED: "true",
        },
        shell: true,
        stdio: "inherit",
    });

    let chromeProcess = null;
    try {
        await waitForPort(3333, 45000);
        console.log("[TASK-031 BEFORE QA] Next.js dev server ready!");

        const chromeProfile = path.join(process.cwd(), ".chrome-profile-before-31-" + Date.now());
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
            await new Promise((r) => setTimeout(r, 400));
        };

        const capture = async (filename) => {
            const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
            const buf = Buffer.from(result.data, "base64");
            const targetPath = path.join(outDir, filename);
            fs.writeFileSync(targetPath, buf);
            console.log(`[Captured BEFORE] ${filename} (${buf.length} bytes)`);
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 3500));
        };

        const measureLayout = async () => {
            const res = await send("Runtime.evaluate", {
                returnByValue: true,
                expression: `
                    (() => {
                        const rootScrollWidth = document.documentElement.scrollWidth;
                        const rootClientWidth = document.documentElement.clientWidth;
                        const bodyScrollWidth = document.body.scrollWidth;
                        const bodyClientWidth = document.body.clientWidth;

                        const getRect = (sel) => {
                            const el = document.querySelector(sel);
                            if (!el) return null;
                            const r = el.getBoundingClientRect();
                            return {
                                width: Math.round(r.width),
                                height: Math.round(r.height),
                                top: Math.round(r.top),
                                left: Math.round(r.left),
                                right: Math.round(r.right),
                                bottom: Math.round(r.bottom),
                                scrollWidth: el.scrollWidth,
                                clientWidth: el.clientWidth,
                            };
                        };

                        const benefitsSec = document.querySelector('.hp-features');
                        const benefitsHeight = benefitsSec ? Math.round(benefitsSec.getBoundingClientRect().height) : null;

                        return {
                            rootScrollWidth,
                            rootClientWidth,
                            hasHorizontalOverflow: rootScrollWidth > (rootClientWidth + 1),
                            overflowDelta: rootScrollWidth - rootClientWidth,
                            bodyScrollWidth,
                            bodyClientWidth,
                            galleryContainer: getRect('.pig-container'),
                            mainImage: getRect('.pig-main'),
                            thumbStrip: getRect('.pig-thumbs'),
                            productTitle: getRect('.pdp-title'),
                            priceRow: getRect('.pdp-price-row'),
                            actionsContainer: getRect('.pc-actions'),
                            qtySelector: getRect('.pc-qty'),
                            addBtn: getRect('.pc-add-btn'),
                            whatsAppFloat: getRect('.whatsapp-float'),
                            benefitsHeight,
                        };
                    })()
                `,
            });
            return res.result.value;
        };

        const beltUrl = "http://localhost:3333/products/bazaarvilla-cramease-pro-period-pain-relief-massager-belt";
        const longTitleUrl = "http://localhost:3333/products/personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women";
        const variantUrl = "http://localhost:3333/products/bazaarvilla-classic-organic-cotton-tshirt";
        const homeUrl = "http://localhost:3333/";

        const measurements = {};

        // 1. Cramp Belt at 390px (Mobile standard)
        console.log("\n--- Measuring Cramp Belt PDP @ 390px ---");
        await setViewport(390, 844, true);
        await navigateTo(beltUrl);
        measurements["belt_390px"] = await measureLayout();
        console.log("390px Measurements:", JSON.stringify(measurements["belt_390px"], null, 2));
        await capture("01-problem-belt-390px.png");

        // 2. Cramp Belt at 320px (Mobile narrow)
        console.log("\n--- Measuring Cramp Belt PDP @ 320px ---");
        await setViewport(320, 568, true);
        await navigateTo(beltUrl);
        measurements["belt_320px"] = await measureLayout();
        console.log("320px Measurements:", JSON.stringify(measurements["belt_320px"], null, 2));
        await capture("02-problem-belt-320px.png");

        // 3. Aspect Ratio: Landscape photo at 390px
        console.log("\n--- Measuring Landscape Photo @ 390px ---");
        await setViewport(390, 844, true);
        await navigateTo(longTitleUrl);
        measurements["landscape_390px"] = await measureLayout();
        await capture("03-gallery-landscape-390px.png");

        // 4. Aspect Ratio: Tall Portrait Photo at 390px
        console.log("\n--- Measuring Tall Portrait Photo @ 390px ---");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const thumbs = document.querySelectorAll('.pig-thumb');
                    if (thumbs.length >= 3) thumbs[2].click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 600));
        measurements["tall_portrait_390px"] = await measureLayout();
        await capture("04-gallery-tall-portrait-390px.png");

        // 5. Long Product Title at 375px
        console.log("\n--- Measuring Long Product Title @ 375px ---");
        await setViewport(375, 667, true);
        await navigateTo(longTitleUrl);
        measurements["long_title_375px"] = await measureLayout();
        console.log("Long title 375px Measurements:", JSON.stringify(measurements["long_title_375px"]?.productTitle, null, 2));
        await capture("05-long-title-375px.png");

        // 6. Quantity & Purchase Buttons at 320px
        console.log("\n--- Measuring Purchase Buttons @ 320px ---");
        await setViewport(320, 568, true);
        await navigateTo(beltUrl);
        measurements["buttons_320px"] = await measureLayout();
        console.log("Buttons 320px Actions Container:", JSON.stringify(measurements["buttons_320px"]?.actionsContainer, null, 2));
        await capture("06-quantity-purchase-buttons-320px.png");

        // 7. Product with Size & Color Variants at 390px
        console.log("\n--- Measuring Variants PDP @ 390px ---");
        await setViewport(390, 844, true);
        await navigateTo(variantUrl);
        measurements["variants_390px"] = await measureLayout();
        await capture("07-variants-pdp-390px.png");

        // 8. Homepage Benefits Section @ 390px
        console.log("\n--- Measuring Homepage Benefits @ 390px ---");
        await setViewport(390, 844, true);
        await navigateTo(homeUrl);
        measurements["home_benefits_390px"] = await measureLayout();
        console.log("Home Benefits 390px Height:", measurements["home_benefits_390px"]?.benefitsHeight);
        await capture("08-homepage-benefits-390px.png");

        // 9. Homepage Benefits Section @ 320px
        console.log("\n--- Measuring Homepage Benefits @ 320px ---");
        await setViewport(320, 568, true);
        await navigateTo(homeUrl);
        measurements["home_benefits_320px"] = await measureLayout();
        console.log("Home Benefits 320px Height:", measurements["home_benefits_320px"]?.benefitsHeight);
        await capture("09-homepage-benefits-320px.png");

        // 10. Homepage Benefits Section @ 1440px (Desktop)
        console.log("\n--- Measuring Homepage Benefits @ 1440px ---");
        await setViewport(1440, 900, false);
        await navigateTo(homeUrl);
        measurements["home_benefits_1440px"] = await measureLayout();
        console.log("Home Benefits 1440px Height:", measurements["home_benefits_1440px"]?.benefitsHeight);
        await capture("10-homepage-benefits-1440px.png");

        // 11. Floating WhatsApp position on mobile @ 390px
        console.log("\n--- Measuring WhatsApp Float @ 390px ---");
        await setViewport(390, 844, true);
        await navigateTo(beltUrl);
        measurements["whatsapp_390px"] = await measureLayout();
        console.log("WhatsApp Float 390px:", JSON.stringify(measurements["whatsapp_390px"]?.whatsAppFloat, null, 2));
        await capture("11-whatsapp-float-390px.png");

        // Save full measurements JSON
        fs.writeFileSync(path.join(outDir, "measurements-before.json"), JSON.stringify(measurements, null, 2));
        console.log("\n[SUCCESS] All BEFORE screenshots & measurements captured in docs/screenshots/task031/before/!");

    } finally {
        if (chromeProcess) {
            try { chromeProcess.kill(); } catch {}
        }
        if (nextProcess) {
            try { nextProcess.kill(); } catch {}
        }
    }
}

main().catch((err) => {
    console.error("[FATAL ERROR in BEFORE QA]", err);
    process.exit(1);
});
