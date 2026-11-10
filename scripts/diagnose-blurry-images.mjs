import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = "https://bazaarvilla.com";
const outDir = path.join(process.cwd(), "docs", "screenshots", "task-026", "before");
fs.mkdirSync(outDir, { recursive: true });

async function run() {
    console.log("=== BAZAARVILLA — DIAGNOSTIC IMAGE MEASUREMENT & BASELINE SNAPSHOTS ===");
    console.log("Target:", BASE_URL);

    // Launch Chrome Headless
    const chromeProcess = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
        "--headless",
        "--remote-debugging-port=9222",
        "--window-size=1440,900",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=" + path.join(process.cwd(), ".chrome-profile-" + Date.now())
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

    await new Promise((r) => ws.onopen = r);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("DOM.enable");

    async function setViewport(width, height, dpr = 2, mobile = false) {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height,
            deviceScaleFactor: dpr,
            mobile,
        });
    }

    async function captureScreenshot(filepath) {
        const { data } = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(filepath, Buffer.from(data, "base64"));
    }

    const viewports = [
        { name: "375px", width: 375, height: 812, dpr: 2, mobile: true },
        { name: "430px", width: 430, height: 932, dpr: 2, mobile: true },
        { name: "768px", width: 768, height: 1024, dpr: 2, mobile: false },
        { name: "1024px", width: 1024, height: 768, dpr: 2, mobile: false },
        { name: "1440px", width: 1440, height: 900, dpr: 2, mobile: false },
    ];

    console.log("\n--- 1. AUDITING /products CATALOG ---");
    for (const vp of viewports) {
        await setViewport(vp.width, vp.height, vp.dpr, vp.mobile);
        await send("Page.navigate", { url: `${BASE_URL}/products` });
        await new Promise((r) => setTimeout(r, 3000));

        const evalResult = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const img = document.querySelector('.product-card img');
                    if (!img) return { found: false };
                    const rect = img.getBoundingClientRect();
                    return {
                        found: true,
                        src: img.src,
                        currentSrc: img.currentSrc,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        renderedWidth: Math.round(rect.width),
                        renderedHeight: Math.round(rect.height),
                        dpr: window.devicePixelRatio,
                        complete: img.complete
                    };
                })()
            `,
            returnByValue: true
        });

        console.log(`[Catalog @ ${vp.name} (${vp.width}x${vp.height}, DPR: ${vp.dpr})]`, evalResult.result.value);

        const screenshotPath = path.join(outDir, `catalog-${vp.name}.png`);
        await captureScreenshot(screenshotPath);
        console.log(`  -> Saved screenshot: ${screenshotPath}`);
    }

    console.log("\n--- 2. AUDITING PRODUCT DETAIL PAGE ---");
    const pdpUrl = `${BASE_URL}/products/personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women`;
    for (const vp of viewports) {
        await setViewport(vp.width, vp.height, vp.dpr, vp.mobile);
        await send("Page.navigate", { url: pdpUrl });
        await new Promise((r) => setTimeout(r, 3000));

        const evalResult = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const img = document.querySelector('.pig-main-img');
                    if (!img) return { found: false };
                    const rect = img.getBoundingClientRect();
                    return {
                        found: true,
                        src: img.src,
                        currentSrc: img.currentSrc,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        renderedWidth: Math.round(rect.width),
                        renderedHeight: Math.round(rect.height),
                        dpr: window.devicePixelRatio,
                        complete: img.complete
                    };
                })()
            `,
            returnByValue: true
        });

        console.log(`[PDP @ ${vp.name} (${vp.width}x${vp.height}, DPR: ${vp.dpr})]`, evalResult.result.value);

        const screenshotPath = path.join(outDir, `pdp-${vp.name}.png`);
        await captureScreenshot(screenshotPath);
        console.log(`  -> Saved screenshot: ${screenshotPath}`);
    }

    console.log("\n--- 3. AUDITING CATEGORIES PAGE ---");
    await setViewport(1440, 900, 2, false);
    await send("Page.navigate", { url: `${BASE_URL}/categories` });
    await new Promise((r) => setTimeout(r, 3000));
    const catEval = await send("Runtime.evaluate", {
        expression: `
            (() => {
                const img = document.querySelector('.product-card img');
                if (!img) return { found: false };
                const rect = img.getBoundingClientRect();
                return {
                    found: true,
                    src: img.src,
                    currentSrc: img.currentSrc,
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight,
                    renderedWidth: Math.round(rect.width),
                    renderedHeight: Math.round(rect.height),
                    dpr: window.devicePixelRatio
                };
            })()
        `,
        returnByValue: true
    });
    console.log(`[Categories @ 1440px]`, catEval.result.value);
    await captureScreenshot(path.join(outDir, `categories-1440px.png`));

    console.log("\n--- 4. AUDITING HOMEPAGE ---");
    await send("Page.navigate", { url: `${BASE_URL}/` });
    await new Promise((r) => setTimeout(r, 3000));
    await captureScreenshot(path.join(outDir, `homepage-1440px.png`));

    // Cleanup
    ws.close();
    chromeProcess.kill();
    console.log("\n=== BASELINE DIAGNOSTIC COMPLETE ===");
}

run().catch((err) => {
    console.error("Diagnostic error:", err);
    process.exit(1);
});
