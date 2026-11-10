import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import admin from "firebase-admin";

function resolveCompatibleJdk() {
    const candidates = [
        "C:\\Program Files\\JetBrains\\IntelliJ IDEA 2026.1.4\\jbr",
        path.join(process.env.USERPROFILE || "", ".jdks", "openjdk-26.0.1"),
        path.join(process.env.USERPROFILE || "", ".jdks", "openjdk-27"),
    ];

    for (const candidate of candidates) {
        const javaExe = path.join(candidate, "bin", "java.exe");
        if (fs.existsSync(javaExe)) {
            return candidate;
        }
    }
    return null;
}

const outDir = path.join(process.cwd(), "docs", "screenshots", "task-026", "after");
fs.mkdirSync(outDir, { recursive: true });

const compatibleJdk = resolveCompatibleJdk();
const env = { ...process.env };
if (compatibleJdk) {
    env.JAVA_HOME = compatibleJdk;
    env.PATH = `${path.join(compatibleJdk, "bin")};${env.PATH}`;
}

env.USE_FIREBASE_EMULATOR = "true";
env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR = "true";
env.FIREBASE_PROJECT_ID = "demo-trendkartz";
env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-trendkartz";
env.GCLOUD_PROJECT = "demo-trendkartz";
env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
env.COMMERCIAL_CHECKOUT_ENABLED = "true";
env.PORT = "3333";

Object.assign(process.env, env);

async function waitForPort(port, timeoutMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://127.0.0.1:${port}`, (res) => {
                    resolve(res);
                });
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
    console.log("================================================================================");
    console.log("TASK 026: STOREFRONT IMAGE SHARPNESS & QUALITY VISUAL VERIFICATION SUITE");
    console.log("================================================================================\n");

    // 1. Start Firebase Emulators
    console.log("[1/5] Starting isolated Firebase Emulators...");
    const emuProcess = spawn("npx", ["firebase", "emulators:start", "--project", "demo-trendkartz", "--only", "firestore,auth"], {
        env,
        shell: true,
        stdio: "pipe",
    });

    try {
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("      -> Firebase Emulators online!");

        // 2. Seed Genuine Product & Category with all 5 distinct R2 images
        console.log("[2/5] Seeding genuine product and category with 5 distinct R2 image assets...");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task026-verifier");
        } catch {
            app = admin.app("task026-verifier");
        }
        const adminDb = app.firestore();

        const fiveNecklaceImages = [
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/50d254ff-38e7-4a1a-954a-78eb583ba335.png"
        ];

        const productDoc = {
            id: "82b5c865-3128-4515-96e5-80f7f0eed58e",
            name: "Personalized Eyes Engraved Bar Necklace with Name – Custom Photo Eyes Pendant for Men & Women",
            slug: "personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women",
            price: 1499,
            inventory: 25,
            category: "Personalized Jewelry",
            categories: ["Personalized Jewelry", "Customizable"],
            images: fiveNecklaceImages,
            thumbnails: [
                "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/7adf7371-9945-46e6-9471-78a891e06588.png"
            ],
            isVisible: true,
            isFeatured: true,
            isCustomized: true,
            description: "High-grade stainless steel personalized bar necklace engraved with high-definition custom photo eyes and custom name. Water-resistant, hypoallergenic, and tarnish-free.",
            createdAt: Date.now(),
        };

        await adminDb.collection("products").doc(productDoc.id).set(productDoc);

        const categoryDoc = {
            id: "cd3e7259-51bc-420d-ac4c-2afa7d8fafa6",
            name: "Personalized Jewelry",
            description: "Custom engraved necklaces, pendants, and rings",
            showOnHome: true,
            order: 1,
            image: "/api/media/public/categories/cd3e7259-51bc-420d-ac4c-2afa7d8fafa6/231ffa35-ceb3-4460-a06f-dd800c18a268.png"
        };

        await adminDb.collection("categories").doc(categoryDoc.id).set(categoryDoc);
        console.log("      -> Seeded product and category successfully.");

        // 3. Start Next.js development server
        console.log("[3/5] Starting Next.js on port 3333...");
        const nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(3333, 45000);
        console.log("      -> Next.js ready at http://localhost:3333!");

        // 4. Launch Headless Chrome
        console.log("[4/5] Launching Chrome Headless with CDP...");
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

        console.log("\n[5/5] Executing Browser Visual Quality Audits & Capturing After-Fix Evidence...\n");

        // AUDIT 1: /products CATALOG
        console.log("--- 1. AUDITING /products CATALOG (ALL BREAKPOINTS) ---");
        for (const vp of viewports) {
            await setViewport(vp.width, vp.height, vp.dpr, vp.mobile);
            await send("Page.navigate", { url: `http://localhost:3333/products` });
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
            console.log(`  -> Saved: ${screenshotPath}`);
        }

        // AUDIT 2: PRODUCT DETAIL PAGE
        console.log("\n--- 2. AUDITING PRODUCT DETAIL PAGE (ALL BREAKPOINTS) ---");
        const pdpUrl = `http://localhost:3333/products/personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women`;
        for (const vp of viewports) {
            await setViewport(vp.width, vp.height, vp.dpr, vp.mobile);
            await send("Page.navigate", { url: pdpUrl });
            await new Promise((r) => setTimeout(r, 3000));

            const evalResult = await send("Runtime.evaluate", {
                expression: `
                    (() => {
                        const img = document.querySelector('.pig-main img');
                        if (!img) return { found: false };
                        const rect = img.getBoundingClientRect();
                        const thumbs = Array.from(document.querySelectorAll('.pig-thumb img')).map(t => ({
                            naturalWidth: t.naturalWidth,
                            naturalHeight: t.naturalHeight,
                            currentSrc: t.currentSrc
                        }));
                        return {
                            found: true,
                            src: img.src,
                            currentSrc: img.currentSrc,
                            naturalWidth: img.naturalWidth,
                            naturalHeight: img.naturalHeight,
                            renderedWidth: Math.round(rect.width),
                            renderedHeight: Math.round(rect.height),
                            dpr: window.devicePixelRatio,
                            complete: img.complete,
                            thumbsCount: thumbs.length,
                            thumbs
                        };
                    })()
                `,
                returnByValue: true
            });

            console.log(`[PDP @ ${vp.name} (${vp.width}x${vp.height}, DPR: ${vp.dpr})]`, evalResult.result.value);
            const screenshotPath = path.join(outDir, `pdp-${vp.name}.png`);
            await captureScreenshot(screenshotPath);
            console.log(`  -> Saved: ${screenshotPath}`);
        }

        // AUDIT 3: THUMBNAIL NAVIGATION ON PDP
        console.log("\n--- 3. VERIFYING PDP THUMBNAIL SWITCHING & DISTINCT IMAGES ---");
        await setViewport(1440, 900, 2, false);
        await send("Page.navigate", { url: pdpUrl });
        await new Promise((r) => setTimeout(r, 3000));

        for (let thumbIdx = 1; thumbIdx <= 4; thumbIdx++) {
            await send("Runtime.evaluate", {
                expression: `
                    (() => {
                        const buttons = document.querySelectorAll('.pig-thumb');
                        if (buttons[${thumbIdx}]) {
                            buttons[${thumbIdx}].click();
                        }
                    })()
                `,
            });
            await new Promise((r) => setTimeout(r, 1000));

            const switchEval = await send("Runtime.evaluate", {
                expression: `
                    (() => {
                        const img = document.querySelector('.pig-main img');
                        return {
                            selectedIdx: ${thumbIdx},
                            currentSrc: img ? img.currentSrc : null,
                            naturalWidth: img ? img.naturalWidth : 0,
                            naturalHeight: img ? img.naturalHeight : 0,
                        };
                    })()
                `,
                returnByValue: true
            });

            console.log(`[PDP Thumbnail Switch -> Image #${thumbIdx + 1}]`, switchEval.result.value);
            await captureScreenshot(path.join(outDir, `pdp-thumb-switch-${thumbIdx + 1}-1440px.png`));
        }

        // AUDIT 4: HOMEPAGE FEATURED PRODUCTS & CATEGORIES
        console.log("\n--- 4. AUDITING HOMEPAGE (FEATURED CARDS & CATEGORY BANNERS) ---");
        for (const vp of viewports) {
            await setViewport(vp.width, vp.height, vp.dpr, vp.mobile);
            await send("Page.navigate", { url: `http://localhost:3333/` });
            await new Promise((r) => setTimeout(r, 3000));

            const hpEval = await send("Runtime.evaluate", {
                expression: `
                    (() => {
                        const productImg = document.querySelector('.hp-product-card img');
                        const catImg = document.querySelector('.hp-category-card img');
                        const pRect = productImg ? productImg.getBoundingClientRect() : null;
                        const cRect = catImg ? catImg.getBoundingClientRect() : null;
                        return {
                            product: productImg ? {
                                currentSrc: productImg.currentSrc,
                                naturalWidth: productImg.naturalWidth,
                                naturalHeight: productImg.naturalHeight,
                                renderedWidth: pRect ? Math.round(pRect.width) : 0,
                                renderedHeight: pRect ? Math.round(pRect.height) : 0,
                            } : null,
                            category: catImg ? {
                                currentSrc: catImg.currentSrc,
                                naturalWidth: catImg.naturalWidth,
                                naturalHeight: catImg.naturalHeight,
                                renderedWidth: cRect ? Math.round(cRect.width) : 0,
                                renderedHeight: cRect ? Math.round(cRect.height) : 0,
                            } : null,
                        };
                    })()
                `,
                returnByValue: true
            });

            console.log(`[Homepage @ ${vp.name}]`, hpEval.result.value);
            await captureScreenshot(path.join(outDir, `homepage-${vp.name}.png`));
        }

        // AUDIT 5: CATEGORIES PAGE
        console.log("\n--- 5. AUDITING CATEGORIES CATALOG PAGE ---");
        await setViewport(1440, 900, 2, false);
        await send("Page.navigate", { url: `http://localhost:3333/categories` });
        await new Promise((r) => setTimeout(r, 3000));

        const catPageEval = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const img = document.querySelector('.product-card img');
                    if (!img) return { found: false };
                    const rect = img.getBoundingClientRect();
                    return {
                        found: true,
                        currentSrc: img.currentSrc,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        renderedWidth: Math.round(rect.width),
                        renderedHeight: Math.round(rect.height),
                    };
                })()
            `,
            returnByValue: true
        });
        console.log(`[Categories Catalog @ 1440px]`, catPageEval.result.value);
        await captureScreenshot(path.join(outDir, `categories-1440px.png`));

        // Cleanup
        ws.close();
        chromeProcess.kill();
        nextProcess.kill();
        emuProcess.kill();

        console.log("\n================================================================================");
        console.log("✓ ALL VISUAL QUALITY AUDITS COMPLETED SUCCESSFULLY!");
        console.log("================================================================================");
    } catch (err) {
        console.error("Verification error:", err);
        emuProcess.kill();
        process.exit(1);
    }
}

main().catch(console.error);
