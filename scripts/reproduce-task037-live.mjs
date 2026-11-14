// scripts/reproduce-task037-live.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task037");
fs.mkdirSync(outDir, { recursive: true });

async function main() {
    console.log("=== TASK 037 — LIVE PRODUCTION REPRODUCTION VIA CHROME CDP ===");
    const chromeProfile = path.join(process.cwd(), ".chrome-profile-task037-" + Date.now());
    const chromeProcess = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
        "--headless",
        "--remote-debugging-port=9223",
        "--window-size=1440,900",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=" + chromeProfile,
    ]);

    try {
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
            await new Promise((r) => setTimeout(r, 600));
        };

        const capture = async (filename) => {
            const { data } = await send("Page.captureScreenshot", { format: "png" });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[Captured] ${filename} (${filePath})`);
        };

        const navigate = async (url) => {
            console.log(`Navigating to ${url}...`);
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 3500));
        };

        const evaluate = async (expr) => {
            const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
            return res.result ? res.result.value : null;
        };

        // 1. Categories Page
        await setViewport(1440, 900);
        await navigate("https://bazaarvilla.com/categories");
        await capture("01-live-categories-page.png");
        const categoryCards = await evaluate(`
            Array.from(document.querySelectorAll("a[href*='category=']")).map(a => ({
                href: a.href,
                text: a.innerText.trim()
            }))
        `);
        console.log("Categories found on /categories:", categoryCards);

        // 2. Winter Special Category Page
        await navigate("https://bazaarvilla.com/products?category=Winter+Special");
        await capture("02-live-winter-special-category-grid.png");
        const winterListingCards = await evaluate(`
            Array.from(document.querySelectorAll(".product-card")).map(card => {
                const name = card.querySelector(".product-name")?.innerText?.trim();
                const price = card.querySelector(".product-price")?.innerText?.trim();
                const discount = card.querySelector(".product-discount-badge")?.innerText?.trim();
                const link = card.getAttribute("href");
                return { name, price, discount, link };
            })
        `);
        console.log("Winter Special Listing Cards:", winterListingCards);

        // 3. Representative Product 1: Grey Bomber Jacket
        // Slug: men-s-premium-grey-bomber-jacket-with-black-ribbed-collar-full-zip-stylish-winter-casual-wear
        const prod1Url = "https://bazaarvilla.com/products/men-s-premium-grey-bomber-jacket-with-black-ribbed-collar-full-zip-stylish-winter-casual-wear";
        await navigate(prod1Url);
        await capture("03-live-prod1-grey-bomber-jacket-initial.png");

        let prod1Inspection = await evaluate(`
            (() => {
                const title = document.querySelector(".pdp-title")?.innerText?.trim();
                const price = document.querySelector(".pdp-price")?.innerText?.trim();
                const originalPrice = document.querySelector(".pdp-original-price")?.innerText?.trim();
                const discountBadge = document.querySelector(".product-discount-badge")?.innerText?.trim();
                const buttons = Array.from(document.querySelectorAll(".pc-btn-group button")).map(b => ({
                    text: b.innerText.trim(),
                    disabled: b.disabled,
                    className: b.className
                }));
                const variantBadge = document.querySelector(".pc-container [style*='background-color']")?.innerText?.trim();
                const sizeButtons = Array.from(document.querySelectorAll("[data-testid='pc-size-section'] button, .pc-custom-section button")).map(b => ({
                    text: b.innerText.trim(),
                    className: b.className
                }));
                const stockText = document.body.innerText.match(/(Unavailable|Out of Stock|In Stock[^\\n]*|Only \\d+ left[^\\n]*)/gi) || [];
                return { title, price, originalPrice, discountBadge, buttons, variantBadge, sizeButtons, stockText };
            })()
        `);
        console.log("\nProd 1 Inspection (Initial):", JSON.stringify(prod1Inspection, null, 2));

        // Click a different size on Prod 1 (e.g. Size M or L)
        await evaluate(`
            (() => {
                const btns = Array.from(document.querySelectorAll("button"));
                const mBtn = btns.find(b => b.innerText.trim() === "M" || b.innerText.trim() === "✓ M");
                if (mBtn) mBtn.click();
            })()
        `);
        await new Promise((r) => setTimeout(r, 1000));
        await capture("04-live-prod1-grey-bomber-jacket-size-M-clicked.png");

        let prod1AfterClick = await evaluate(`
            (() => {
                const buttons = Array.from(document.querySelectorAll(".pc-btn-group button")).map(b => ({
                    text: b.innerText.trim(),
                    disabled: b.disabled,
                    className: b.className
                }));
                const stockText = document.body.innerText.match(/(Unavailable|Out of Stock|In Stock[^\\n]*|Only \\d+ left[^\\n]*)/gi) || [];
                return { buttons, stockText };
            })()
        `);
        console.log("Prod 1 Inspection (After clicking M):", JSON.stringify(prod1AfterClick, null, 2));

        // 4. Representative Product 4: Black Hooded Winter Jacket (with Color and Sizes)
        // Slug: men-s-premium-black-hooded-winter-jacket-with-soft-fur-fleece-lining-full-zip
        const prod4Url = "https://bazaarvilla.com/products/men-s-premium-black-hooded-winter-jacket-with-soft-fur-fleece-lining-full-zip";
        await navigate(prod4Url);
        await capture("05-live-prod4-black-hooded-jacket-initial.png");

        let prod4Inspection = await evaluate(`
            (() => {
                const title = document.querySelector(".pdp-title")?.innerText?.trim();
                const price = document.querySelector(".pdp-price")?.innerText?.trim();
                const buttons = Array.from(document.querySelectorAll(".pc-btn-group button")).map(b => ({
                    text: b.innerText.trim(),
                    disabled: b.disabled,
                    className: b.className
                }));
                const stockText = document.body.innerText.match(/(Unavailable|Out of Stock|In Stock[^\\n]*|Only \\d+ left[^\\n]*)/gi) || [];
                return { title, price, buttons, stockText };
            })()
        `);
        console.log("\nProd 4 Inspection (Initial):", JSON.stringify(prod4Inspection, null, 2));

        // Also check Mobile viewport on Prod 1
        await setViewport(390, 844, true);
        await navigate(prod1Url);
        await capture("06-live-prod1-grey-bomber-jacket-mobile.png");

        ws.close();
    } finally {
        chromeProcess.kill();
        try { fs.rmSync(chromeProfile, { recursive: true, force: true }); } catch {}
    }
}

main().catch(console.error);
