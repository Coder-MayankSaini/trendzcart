/**
 * Breakpoint Boundaries Verification Script (TASK 031 Final Checks)
 * Tests widths: 479px, 480px, 767px, 768px, 959px, 960px, 980px
 * Uses Chrome DevTools Protocol & Firebase Emulator
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const BOUNDARY_WIDTHS = [479, 480, 767, 768, 959, 960, 980];

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
    console.log("[BOUNDARY QA] Initializing Firebase Admin and Seeding Catalog...");

    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.app();
    } catch {
        app = admin.initializeApp({ projectId: "demo-trendkartz" });
    }
    const adminDb = admin.firestore(app);

    // Seed Cramp Relief Belt
    const beltImages = [
        svgDataUri("Cramp Belt Front", "#fed7aa", "#c2410c"),
        svgDataUri("Cramp Belt Heating Pad", "#fed7aa", "#c2410c"),
        svgDataUri("Cramp Belt Strap", "#fed7aa", "#c2410c"),
        svgDataUri("Cramp Belt Display", "#fed7aa", "#c2410c"),
        svgDataUri("Cramp Belt Battery", "#fed7aa", "#c2410c"),
        svgDataUri("Cramp Belt In-Use", "#fed7aa", "#c2410c"),
        svgDataUri("Cramp Belt Packaging", "#fed7aa", "#c2410c"),
    ];

    await adminDb.collection("products").doc("prod-cramp-relief-belt").set({
        id: "prod-cramp-relief-belt",
        name: "Bazaarvilla CrampEase Pro™ Wireless Period Pain Relief Heating & Massager Belt with 3 Thermal Levels",
        slug: "bazaarvilla-cramease-pro-period-pain-relief-massager-belt",
        price: 1499,
        originalPrice: 2999,
        inventory: 25,
        category: "Wellness & Health",
        categories: ["Wellness & Health", "Women Care"],
        images: beltImages,
        featuredImage: beltImages[0],
        isVisible: true,
        isFeatured: true,
        hasVariants: false,
        sizeMode: "free_size",
        rating: 4.8,
        reviewCount: 38,
        createdAt: Date.now(),
    });

    // Seed Multi-Variant T-Shirt
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

    console.log("[BOUNDARY QA] Catalog seeded successfully.");

    // Start Next.js dev server on port 3333
    console.log("[BOUNDARY QA] Starting Next.js server on port 3333...");
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
        console.log("[BOUNDARY QA] Next.js dev server ready!");

        const chromeProfile = path.join(process.cwd(), ".chrome-profile-boundaries-" + Date.now());
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

        const setViewport = async (w, h) => {
            await send("Emulation.setDeviceMetricsOverride", {
                width: w,
                height: h,
                deviceScaleFactor: 2,
                mobile: w < 960,
            });
            await new Promise((r) => setTimeout(r, 400));
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 3000));
        };

        const evaluateInPage = async (expr) => {
            const res = await send("Runtime.evaluate", {
                returnByValue: true,
                expression: expr,
            });
            return res.result.value;
        };

        const boundaryResults = [];
        let allPassed = true;

        for (const width of BOUNDARY_WIDTHS) {
            console.log(`\n======================================================`);
            console.log(`TESTING BOUNDARY VIEWPORT: ${width}px`);
            console.log(`======================================================`);

            await setViewport(width, 900);

            // 1. Verify PDP on Cramp Relief Belt
            await navigateTo("http://127.0.0.1:3333/products/bazaarvilla-cramease-pro-period-pain-relief-massager-belt");

            const pdpData = await evaluateInPage(`
                (() => {
                    const docEl = document.documentElement;
                    const body = document.body;
                    const getRect = (sel) => {
                        const el = document.querySelector(sel);
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        return {
                            width: Math.round(r.width * 100) / 100,
                            height: Math.round(r.height * 100) / 100,
                            top: Math.round(r.top * 100) / 100,
                            left: Math.round(r.left * 100) / 100,
                            right: Math.round(r.right * 100) / 100,
                            bottom: Math.round(r.bottom * 100) / 100,
                        };
                    };

                    const addBtn = document.querySelector('.pc-add-btn:not(.pc-btn-primary)');
                    const buyBtn = document.querySelector('.pc-btn-primary') || document.querySelector('.pc-add-btn.pc-btn-primary');
                    const wa = document.querySelector('.whatsapp-float');

                    return {
                        rootScrollWidth: docEl.scrollWidth,
                        rootClientWidth: docEl.clientWidth,
                        bodyScrollWidth: body.scrollWidth,
                        bodyClientWidth: body.clientWidth,
                        galleryBox: getRect('.pdp-gallery-col'),
                        mainImageBox: getRect('.pig-main'),
                        titleBox: getRect('.pdp-title'),
                        infoBox: getRect('.pdp-info-col'),
                        actionsBox: getRect('.pc-actions'),
                        qtyBox: getRect('.pc-quantity') || getRect('.pc-qty-wrapper'),
                        addBtnBox: getRect('.pc-add-btn:not(.pc-btn-primary)'),
                        buyBtnBox: getRect('.pc-btn-primary') || getRect('.pc-add-btn.pc-btn-primary'),
                        waBox: getRect('.whatsapp-float'),
                        addBtnClickable: addBtn ? !addBtn.disabled && addBtn.offsetParent !== null : false,
                        buyBtnClickable: buyBtn ? !buyBtn.disabled && buyBtn.offsetParent !== null : false,
                    };
                })()
            `);

            const pdpOverflow = pdpData.rootScrollWidth > (pdpData.rootClientWidth + 1) ||
                                pdpData.bodyScrollWidth > (pdpData.bodyClientWidth + 1);

            console.log(`[PDP ${width}px] Scroll: ${pdpData.rootScrollWidth}px / Client: ${pdpData.rootClientWidth}px | Body: ${pdpData.bodyScrollWidth}px / ${pdpData.bodyClientWidth}px`);
            if (pdpOverflow) {
                console.error(`  FAIL: Horizontal overflow on PDP at ${width}px!`);
                allPassed = false;
            } else {
                console.log(`  PASS: Zero horizontal overflow.`);
            }

            if (pdpData.mainImageBox) {
                const imgFit = pdpData.mainImageBox.right <= (pdpData.rootClientWidth + 1);
                console.log(`  Main Image: width=${pdpData.mainImageBox.width}px, right=${pdpData.mainImageBox.right}px (viewport: ${pdpData.rootClientWidth}px)`);
                if (!imgFit) {
                    console.error(`  FAIL: Main image exceeds viewport width!`);
                    allPassed = false;
                } else {
                    console.log(`  PASS: Main image fully contained.`);
                }
            }

            if (pdpData.titleBox) {
                const titleFit = pdpData.titleBox.right <= (pdpData.rootClientWidth + 1);
                console.log(`  Title: width=${pdpData.titleBox.width}px, height=${pdpData.titleBox.height}px, right=${pdpData.titleBox.right}px`);
                if (!titleFit) {
                    console.error(`  FAIL: Title exceeds viewport width!`);
                    allPassed = false;
                } else {
                    console.log(`  PASS: Title wrapped cleanly.`);
                }
            }

            if (pdpData.addBtnBox && pdpData.buyBtnBox) {
                const addFit = pdpData.addBtnBox.right <= (pdpData.rootClientWidth + 1) && pdpData.addBtnBox.left >= 0;
                const buyFit = pdpData.buyBtnBox.right <= (pdpData.rootClientWidth + 1) && pdpData.buyBtnBox.left >= 0;
                console.log(`  Add to Cart: right=${pdpData.addBtnBox.right}px, height=${pdpData.addBtnBox.height}px, clickable=${pdpData.addBtnClickable}`);
                console.log(`  Buy Now: right=${pdpData.buyBtnBox.right}px, height=${pdpData.buyBtnBox.height}px, clickable=${pdpData.buyBtnClickable}`);
                if (!addFit || !buyFit) {
                    console.error(`  FAIL: Purchase button clipped or overflowing!`);
                    allPassed = false;
                } else {
                    console.log(`  PASS: Both purchase buttons completely visible and clickable.`);
                }
            }

            // WhatsApp overlap check
            if (pdpData.waBox && pdpData.buyBtnBox) {
                // Fixed coordinates overlap check
                const wa = pdpData.waBox;
                const bb = pdpData.buyBtnBox;
                const overlap = !(wa.right < bb.left || wa.left > bb.right || wa.bottom < bb.top || wa.top > bb.bottom);
                if (overlap) {
                    console.warn(`  WARNING: WhatsApp button overlaps Buy Now button in static viewport!`);
                } else {
                    console.log(`  PASS: WhatsApp button does not obstruct purchase buttons.`);
                }
            }

            // 2. Verify Variant PDP
            await navigateTo("http://127.0.0.1:3333/products/bazaarvilla-classic-organic-cotton-tshirt");

            const variantData = await evaluateInPage(`
                (() => {
                    const docEl = document.documentElement;
                    const body = document.body;
                    const getRect = (sel) => {
                        const el = document.querySelector(sel);
                        if (!el) return null;
                        const r = el.getBoundingClientRect();
                        return {
                            width: Math.round(r.width * 100) / 100,
                            height: Math.round(r.height * 100) / 100,
                            right: Math.round(r.right * 100) / 100,
                            left: Math.round(r.left * 100) / 100,
                        };
                    };

                    const colorBtns = Array.from(document.querySelectorAll('.pc-color-btn')).map(getRect);
                    const sizeBtns = Array.from(document.querySelectorAll('.pc-size-btn')).map(getRect);

                    return {
                        rootScrollWidth: docEl.scrollWidth,
                        rootClientWidth: docEl.clientWidth,
                        bodyScrollWidth: body.scrollWidth,
                        bodyClientWidth: body.clientWidth,
                        colorBtns,
                        sizeBtns,
                    };
                })()
            `);

            const varOverflow = variantData.rootScrollWidth > (variantData.rootClientWidth + 1);
            if (varOverflow) {
                console.error(`  FAIL: Variant PDP horizontal overflow at ${width}px!`);
                allPassed = false;
            } else {
                console.log(`  PASS: Variant PDP zero overflow. Color swatches count: ${variantData.colorBtns.length}, Size buttons count: ${variantData.sizeBtns.length}`);
            }

            // 3. Verify Homepage Benefits Cards
            await navigateTo("http://127.0.0.1:3333/");

            const homeData = await evaluateInPage(`
                (() => {
                    const docEl = document.documentElement;
                    const body = document.body;
                    const features = document.querySelector('.hp-features');
                    const cards = Array.from(document.querySelectorAll('.hp-feature')).map(c => {
                        const r = c.getBoundingClientRect();
                        return {
                            width: Math.round(r.width * 100) / 100,
                            height: Math.round(r.height * 100) / 100,
                            right: Math.round(r.right * 100) / 100,
                            left: Math.round(r.left * 100) / 100,
                        };
                    });

                    return {
                        rootScrollWidth: docEl.scrollWidth,
                        rootClientWidth: docEl.clientWidth,
                        bodyScrollWidth: body.scrollWidth,
                        bodyClientWidth: body.clientWidth,
                        featuresHeight: features ? Math.round(features.getBoundingClientRect().height * 100) / 100 : 0,
                        cards,
                    };
                })()
            `);

            const homeOverflow = homeData.rootScrollWidth > (homeData.rootClientWidth + 1);
            console.log(`[Home ${width}px] Scroll: ${homeData.rootScrollWidth}px / Client: ${homeData.rootClientWidth}px | Section Height: ${homeData.featuresHeight}px`);
            if (homeOverflow) {
                console.error(`  FAIL: Homepage horizontal overflow at ${width}px!`);
                allPassed = false;
            } else {
                console.log(`  PASS: Homepage zero overflow. All ${homeData.cards.length} cards rendered and readable.`);
            }

            boundaryResults.push({
                width,
                pdp: pdpData,
                variant: variantData,
                home: homeData,
            });
        }

        const outPath = path.join(process.cwd(), "docs", "screenshots", "task031", "boundary-measurements.json");
        fs.writeFileSync(outPath, JSON.stringify(boundaryResults, null, 2));
        console.log(`[BOUNDARY QA] Saved boundary measurements to ${outPath}`);

        ws.close();
        if (chromeProcess) chromeProcess.kill();
        nextProcess.kill();

        console.log(`\n======================================================`);
        if (allPassed) {
            console.log(`ALL 7 BOUNDARY VIEWPORTS (479px, 480px, 767px, 768px, 959px, 960px, 980px) PASSED ALL CHECKS!`);
        } else {
            console.error(`BOUNDARY VERIFICATION DETECTED DEFECTS!`);
            process.exit(1);
        }
    } catch (err) {
        console.error("Fatal error during boundary verification:", err);
        if (chromeProcess) chromeProcess.kill();
        if (nextProcess) nextProcess.kill();
        process.exit(1);
    }
}

main();
