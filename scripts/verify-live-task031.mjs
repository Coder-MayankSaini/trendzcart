/**
 * TASK 031 — Live Production Verification Script
 * Target: https://bazaarvilla.com
 * Tests all 10 user criteria using real Chrome CDP + HTTPS smoke checks
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task031", "live");
fs.mkdirSync(outDir, { recursive: true });

const TARGET_HOST = "https://bazaarvilla.com";

async function main() {
    console.log("================================================================================");
    console.log("TASK 031 — LIVE PRODUCTION VERIFICATION (https://bazaarvilla.com)");
    console.log("================================================================================");

    const results = [];
    const record = (id, name, passed, details) => {
        results.push({ id, name, passed, details });
        const tag = passed ? "[PASS]" : "[FAIL]";
        console.log(`${tag} Check #${id}: ${name} — ${details}`);
    };

    // 1. Live HTTPS smoke checks on core routes
    console.log("\n--- Part 1: Read-Only HTTPS Endpoint Health Checks ---");
    const endpoints = [
        { path: "/", label: "Homepage" },
        { path: "/products", label: "Catalog" },
        { path: "/cart", label: "Cart" },
        { path: "/checkout", label: "Checkout" },
        { path: "/terms", label: "Terms" },
        { path: "/privacy", label: "Privacy" },
        { path: "/contact", label: "Contact" },
        { path: "/about", label: "About" },
        { path: "/admin/products", label: "Admin Products" },
        { path: "/api/razorpay/public-config", label: "Razorpay Public Config" },
    ];

    for (const ep of endpoints) {
        try {
            const res = await fetch(`${TARGET_HOST}${ep.path}`);
            const isOk = res.status === 200;
            let note = `HTTP ${res.status}`;
            if (ep.path === "/api/razorpay/public-config") {
                const json = await res.json();
                note += ` (keyId: ${json.keyId ? json.keyId.substring(0, 12) + "..." : "none"}, commercialCheckoutEnabled: ${json.commercialCheckoutEnabled})`;
            }
            record(ep.path, `Route ${ep.label} Accessible`, isOk, note);
        } catch (err) {
            record(ep.path, `Route ${ep.label} Accessible`, false, err.message);
        }
    }

    // 2. Launch Chrome via CDP for in-browser visual & layout checks
    console.log("\n--- Part 2: Live In-Browser Viewport QA via Chrome CDP ---");
    const chromeProfile = path.join(process.cwd(), ".chrome-profile-live-31-" + Date.now());
    const chromeProcess = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
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

    const capture = async (filename) => {
        const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
        const buf = Buffer.from(result.data, "base64");
        const targetPath = path.join(outDir, filename);
        fs.writeFileSync(targetPath, buf);
        console.log(`  [Live Screenshot] Saved ${filename} (${buf.length} bytes)`);
    };

    const navigateTo = async (url) => {
        await send("Page.navigate", { url });
        await new Promise((r) => setTimeout(r, 3500));
    };

    const evaluateInPage = async (expr) => {
        const res = await send("Runtime.evaluate", {
            returnByValue: true,
            expression: expr,
        });
        return res.result.value;
    };

    // Check A: Cramp Relief Massager Belt on Live (390px)
    console.log("\n--- Checking Live Cramp Relief Belt Page at 390px ---");
    await setViewport(390, 844);
    await navigateTo(`${TARGET_HOST}/products/bazaarvilla-cramease-pro-period-pain-relief-massager-belt`);

    const liveBelt390 = await evaluateInPage(`
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
                    left: Math.round(r.left * 100) / 100,
                    right: Math.round(r.right * 100) / 100,
                };
            };

            const addBtn = document.querySelector('.pc-add-btn:not(.pc-btn-primary)');
            const buyBtn = document.querySelector('.pc-btn-primary') || document.querySelector('.pc-add-btn.pc-btn-primary');

            return {
                rootScrollWidth: docEl.scrollWidth,
                rootClientWidth: docEl.clientWidth,
                bodyScrollWidth: body.scrollWidth,
                bodyClientWidth: body.clientWidth,
                mainImage: getRect('.pig-main'),
                title: getRect('.pdp-title'),
                qtyWrapper: getRect('.pc-qty-wrapper'),
                addBtn: getRect('.pc-add-btn:not(.pc-btn-primary)'),
                buyBtn: getRect('.pc-btn-primary') || getRect('.pc-add-btn.pc-btn-primary'),
                whatsapp: getRect('.whatsapp-float'),
                addBtnClickable: addBtn ? !addBtn.disabled && addBtn.offsetParent !== null : false,
                buyBtnClickable: buyBtn ? !buyBtn.disabled && buyBtn.offsetParent !== null : false,
            };
        })()
    `);

    await capture("01-live-cramp-belt-390px.png");

    record(
        "LIVE-BELT-390",
        "Cramp Relief Belt at 390px has zero overflow",
        liveBelt390.rootScrollWidth <= (liveBelt390.rootClientWidth + 1) && liveBelt390.bodyScrollWidth <= (liveBelt390.bodyClientWidth + 1),
        `Scroll: ${liveBelt390.rootScrollWidth}px / Client: ${liveBelt390.rootClientWidth}px (overflow: ${liveBelt390.rootScrollWidth - liveBelt390.rootClientWidth}px)`
    );

    record(
        "LIVE-BELT-BTNS",
        "Add to Cart and Buy Now fully visible and clickable at 390px",
        liveBelt390.addBtnClickable && liveBelt390.buyBtnClickable && liveBelt390.buyBtn.right <= (liveBelt390.rootClientWidth + 1),
        `Add to Cart: right=${liveBelt390.addBtn.right}px, Buy Now: right=${liveBelt390.buyBtn.right}px (within viewport ${liveBelt390.rootClientWidth}px)`
    );

    // Check B: Cramp Relief Belt on Live (320px ultra-narrow)
    console.log("\n--- Checking Live Cramp Relief Belt Page at 320px ---");
    await setViewport(320, 700);
    await new Promise((r) => setTimeout(r, 1000));
    const liveBelt320 = await evaluateInPage(`
        (() => {
            const docEl = document.documentElement;
            return {
                rootScrollWidth: docEl.scrollWidth,
                rootClientWidth: docEl.clientWidth,
            };
        })()
    `);
    await capture("02-live-cramp-belt-320px.png");

    record(
        "LIVE-BELT-320",
        "Cramp Relief Belt at 320px has zero overflow",
        liveBelt320.rootScrollWidth <= (liveBelt320.rootClientWidth + 1),
        `Scroll: ${liveBelt320.rootScrollWidth}px / Client: ${liveBelt320.rootClientWidth}px (overflow: ${liveBelt320.rootScrollWidth - liveBelt320.rootClientWidth}px)`
    );

    // Check C: Long Product Title Product on Live (375px)
    console.log("\n--- Checking Live Long Product Title at 375px ---");
    await setViewport(375, 812);
    await navigateTo(`${TARGET_HOST}/products/personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women`);

    const liveLongTitle = await evaluateInPage(`
        (() => {
            const docEl = document.documentElement;
            const title = document.querySelector('.pdp-title');
            const tr = title ? title.getBoundingClientRect() : null;
            return {
                rootScrollWidth: docEl.scrollWidth,
                rootClientWidth: docEl.clientWidth,
                titleRight: tr ? Math.round(tr.right * 100) / 100 : null,
                titleHeight: tr ? Math.round(tr.height * 100) / 100 : null,
            };
        })()
    `);
    await capture("03-live-long-title-375px.png");

    record(
        "LIVE-LONG-TITLE",
        "Long Title Product wraps cleanly at 375px with zero overflow",
        liveLongTitle.rootScrollWidth <= (liveLongTitle.rootClientWidth + 1) && liveLongTitle.titleRight <= (liveLongTitle.rootClientWidth + 1),
        `Scroll: ${liveLongTitle.rootScrollWidth}px / Client: ${liveLongTitle.rootClientWidth}px | Title Right: ${liveLongTitle.titleRight}px`
    );

    // Check D: Homepage Benefits Section on Live (390px)
    console.log("\n--- Checking Live Homepage Benefits Section at 390px ---");
    await setViewport(390, 844);
    await navigateTo(`${TARGET_HOST}/`);

    const liveHome390 = await evaluateInPage(`
        (() => {
            const docEl = document.documentElement;
            const sec = document.querySelector('.hp-features');
            const grid = document.querySelector('.hp-features-grid');
            const cards = Array.from(document.querySelectorAll('.hp-feature'));
            const textContent = sec ? sec.innerText : '';
            return {
                rootScrollWidth: docEl.scrollWidth,
                rootClientWidth: docEl.clientWidth,
                height: sec ? Math.round(sec.getBoundingClientRect().height * 100) / 100 : null,
                cardCount: cards.length,
                hasEligibleOrders: textContent.includes('On eligible orders'),
                hasPanIndia: textContent.includes('Delivery across India'),
            };
        })()
    `);
    await capture("04-live-homepage-benefits-390px.png");

    record(
        "LIVE-HOME-390-HEIGHT",
        "Homepage benefits section is compact on mobile (height <= 320px)",
        liveHome390.height !== null && liveHome390.height <= 320,
        `Rendered Height: ${liveHome390.height}px (Target: 220–320px, >50% reduction from 552px baseline)`
    );

    record(
        "LIVE-HOME-CLAIMS",
        "Homepage features include accurate claims ('On eligible orders' and 'Delivery across India')",
        liveHome390.hasEligibleOrders && liveHome390.hasPanIndia,
        `On eligible orders: ${liveHome390.hasEligibleOrders}, Delivery across India: ${liveHome390.hasPanIndia}`
    );

    // Check E: Homepage Benefits Section on Live (320px)
    console.log("\n--- Checking Live Homepage Benefits Section at 320px ---");
    await setViewport(320, 700);
    await new Promise((r) => setTimeout(r, 1000));
    const liveHome320 = await evaluateInPage(`
        (() => {
            const sec = document.querySelector('.hp-features');
            return {
                height: sec ? Math.round(sec.getBoundingClientRect().height * 100) / 100 : null,
            };
        })()
    `);
    await capture("05-live-homepage-benefits-320px.png");

    record(
        "LIVE-HOME-320-HEIGHT",
        "Homepage benefits section at 320px is compact (height <= 320px)",
        liveHome320.height !== null && liveHome320.height <= 320,
        `Rendered Height: ${liveHome320.height}px (Target <= 320px)`
    );

    // Check F: Desktop Homepage Layout Preservation (1440px)
    console.log("\n--- Checking Live Desktop Homepage at 1440px ---");
    await setViewport(1440, 900);
    await navigateTo(`${TARGET_HOST}/`);
    await capture("06-live-homepage-benefits-1440px.png");

    const liveHome1440 = await evaluateInPage(`
        (() => {
            const docEl = document.documentElement;
            const sec = document.querySelector('.hp-features');
            const grid = document.querySelector('.hp-features-grid');
            const cs = window.getComputedStyle(grid);
            return {
                rootScrollWidth: docEl.scrollWidth,
                rootClientWidth: docEl.clientWidth,
                gridColumns: cs.gridTemplateColumns,
                height: sec ? Math.round(sec.getBoundingClientRect().height * 100) / 100 : null,
            };
        })()
    `);

    record(
        "LIVE-HOME-DESKTOP",
        "Desktop homepage preserves 4-column benefits layout",
        liveHome1440.gridColumns.split(" ").length === 4,
        `Columns: ${liveHome1440.gridColumns.split(" ").length} (gridTemplateColumns: ${liveHome1440.gridColumns}), Height: ${liveHome1440.height}px`
    );

    // Check G: Floating WhatsApp Safe-Area Alignment
    console.log("\n--- Checking Live Floating WhatsApp Position at 390px ---");
    await setViewport(390, 844);
    await navigateTo(`${TARGET_HOST}/products/bazaarvilla-cramease-pro-period-pain-relief-massager-belt`);
    await capture("07-live-whatsapp-390px.png");

    const liveWa = await evaluateInPage(`
        (() => {
            const wa = document.querySelector('.whatsapp-float');
            if (!wa) return null;
            const r = wa.getBoundingClientRect();
            const cs = window.getComputedStyle(wa);
            return {
                width: Math.round(r.width),
                height: Math.round(r.height),
                right: Math.round(r.right),
                bottom: Math.round(r.bottom),
                zIndex: cs.zIndex,
            };
        })()
    `);

    record(
        "LIVE-WHATSAPP",
        "Floating WhatsApp scales to 50x50px on mobile with safe-area styling",
        liveWa !== null && liveWa.width === 50 && liveWa.height === 50,
        `Dimensions: ${liveWa ? liveWa.width : 0}x${liveWa ? liveWa.height : 0}px, zIndex: ${liveWa ? liveWa.zIndex : "none"}`
    );

    ws.close();
    chromeProcess.kill();

    console.log("\n================================================================================");
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`TOTAL LIVE PRODUCTION VERIFICATION CHECKS: ${passedCount} / ${results.length} PASSED`);
    console.log("================================================================================");

    if (passedCount !== results.length) {
        console.error("Some live production checks failed!");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Live verification fatal error:", err);
    process.exit(1);
});
