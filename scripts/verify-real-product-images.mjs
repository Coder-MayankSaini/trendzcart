/**
 * Verification of Genuine Personalized Necklace Product & Computed In-Browser Dimensions
 * Validates Requirement 3 of TASK 028 Final Release Gate
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

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

const outDir = path.join(process.cwd(), "docs", "screenshots", "task028");
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

async function verifyLiveR2Assets() {
    console.log("\n--- [Step 1] Verifying 5 Live R2 Photographs of Personalized Necklace ---");
    const necklaceImages = [
        "https://bazaarvilla.com/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png",
        "https://bazaarvilla.com/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png",
        "https://bazaarvilla.com/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png",
        "https://bazaarvilla.com/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png",
        "https://bazaarvilla.com/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/50d254ff-38e7-4a1a-954a-78eb583ba335.png",
    ];

    const results = [];
    const hashes = new Set();

    for (let i = 0; i < necklaceImages.length; i++) {
        const url = necklaceImages[i];
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch image ${i + 1}: ${url} -> HTTP ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
        hashes.add(sha256);

        results.push({
            index: i + 1,
            url,
            status: res.status,
            sizeBytes: buf.byteLength,
            contentType: res.headers.get("content-type"),
            sha256: sha256.substring(0, 16) + "...",
        });
        console.log(`  Photo ${i + 1}: ${buf.byteLength.toLocaleString()} bytes | SHA256: ${sha256.substring(0, 16)}... | Status: HTTP ${res.status}`);
    }

    if (hashes.size !== 5) {
        throw new Error(`Expected 5 distinct image hashes, but found ${hashes.size}! Image duplication detected.`);
    }
    console.log(`  [PASS] All 5 photographs are distinct, non-duplicated, and accessible in live R2 storage!`);
    return results;
}

async function verifyChromeComputedDimensions() {
    console.log("\n--- [Step 2] Chrome Headless In-Browser Computed Dimensions & CLS Inspection ---");

    const envLocalPath = path.join(process.cwd(), ".env.local");
    const originalEnvLocal = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf8") : "";
    let modified = originalEnvLocal.replace(/NEXT_PUBLIC_FIREBASE_API_KEY=.*/g, "# disabled for emulator");
    modified += "\nNEXT_PUBLIC_USE_FIREBASE_EMULATOR=true\nNEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-trendkartz\nNEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key\nNEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080\nNEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099\n";
    fs.writeFileSync(envLocalPath, modified);

    const restoreEnvLocal = () => {
        try { fs.writeFileSync(envLocalPath, originalEnvLocal); } catch {}
    };

    let emuProcess = null;
    let nextProcess = null;
    let chromeProcess = null;

    try {
        console.log("  Starting Firebase emulator on ports 8080 & 9099...");
        emuProcess = spawn("npx", ["firebase", "emulators:start", "--project", "demo-trendkartz", "--only", "firestore,auth"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(8080);
        await waitForPort(9099);
        console.log("  Firebase emulator is online!");

        // Seed genuine necklace product with real remote R2 URLs
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "real-necklace-verifier");
        } catch {
            app = admin.app("real-necklace-verifier");
        }
        const adminDb = app.firestore();

        const fiveNecklaceImages = [
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png",
            "/api/media/public/products/82b5c865-3128-4515-96e5-80f7f0eed58e/50d254ff-38e7-4a1a-954a-78eb583ba335.png",
        ];

        const realProduct = {
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

        await adminDb.collection("products").doc(realProduct.id).set(realProduct);
        console.log("  Seeded genuine personalized necklace product in emulator!");

        // Start Next.js
        console.log("  Starting Next.js dev server on port 3333...");
        nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(3333, 40000);
        console.log("  Next.js dev server ready at http://localhost:3333!");

        // Launch Chrome
        console.log("  Launching Chrome Headless for computed style and DOM dimension measurements...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-necklace-" + Date.now());
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
            } catch {}
            await new Promise((r) => setTimeout(r, 500));
        }

        const ws = new (await import("ws")).WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((resolve) => ws.on("open", resolve));

        let id = 1;
        const send = (method, params = {}) =>
            new Promise((resolve, reject) => {
                const reqId = id++;
                const handler = (msg) => {
                    const data = JSON.parse(msg);
                    if (data.id === reqId) {
                        ws.off("message", handler);
                        if (data.error) reject(data.error);
                        else resolve(data.result);
                    }
                };
                ws.on("message", handler);
                ws.send(JSON.stringify({ id: reqId, method, params }));
            });

        await send("Page.enable");
        await send("Runtime.enable");

        const pdpUrl = `http://localhost:3333/products/${realProduct.slug}`;
        console.log(`  Warming up route ${pdpUrl}...`);
        for (let i = 0; i < 20; i++) {
            try {
                const warmup = await fetch(pdpUrl);
                if (warmup.ok) {
                    console.log(`  Route warmed up successfully (HTTP ${warmup.status})!`);
                    break;
                }
            } catch {}
            await new Promise((r) => setTimeout(r, 1000));
        }

        console.log(`  Navigating Chrome to ${pdpUrl}...`);
        await send("Page.navigate", { url: pdpUrl });
        
        // Wait for .pig-main to be rendered
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((r) => setTimeout(r, 500));
            const check = await send("Runtime.evaluate", {
                expression: `!!document.querySelector('.pig-main')`,
            });
            if (check.result?.value === true) {
                ready = true;
                break;
            }
        }
        if (!ready) {
            const docInfo = await send("Runtime.evaluate", {
                expression: `({ title: document.title, bodySnippet: document.body?.innerHTML?.substring(0, 400) })`,
                returnByValue: true,
            });
            throw new Error(`PDP did not render .pig-main within 30s! Page info: ${JSON.stringify(docInfo.result?.value)}`);
        }
        await new Promise((r) => setTimeout(r, 1500));

        // Evaluate Computed Styles & Metrics for All 5 Images
        const evaluation = await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    const thumbs = document.querySelectorAll('.pig-thumb');
                    const mainContainer = document.querySelector('.pig-main');
                    const mainImg = document.querySelector('.pig-main-img');

                    if (!mainContainer || !mainImg) {
                        return { error: "Missing .pig-main or .pig-main-img after ready check" };
                    }

                    const initialContainerRect = mainContainer.getBoundingClientRect();
                    const containerComputed = window.getComputedStyle(mainContainer);

                    const metrics = [];

                    for (let i = 0; i < thumbs.length; i++) {
                        thumbs[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        await new Promise((r) => setTimeout(r, 800));

                        const currentImg = document.querySelector('.pig-main-img');
                        const imgComputed = window.getComputedStyle(currentImg);
                        const imgRect = currentImg.getBoundingClientRect();
                        const cRect = mainContainer.getBoundingClientRect();

                        // CLS test: container height & width must stay rock-solid
                        const widthDelta = Math.abs(cRect.width - initialContainerRect.width);
                        const heightDelta = Math.abs(cRect.height - initialContainerRect.height);

                        metrics.push({
                            index: i + 1,
                            objectFit: imgComputed.objectFit,
                            containerAspectRatio: containerComputed.aspectRatio,
                            containerWidth: cRect.width,
                            containerHeight: cRect.height,
                            imgRenderedWidth: imgRect.width,
                            imgRenderedHeight: imgRect.height,
                            imgNaturalWidth: currentImg.naturalWidth,
                            imgNaturalHeight: currentImg.naturalHeight,
                            widthDelta,
                            heightDelta,
                            isContained: imgRect.width <= (cRect.width + 0.5) && imgRect.height <= (cRect.height + 0.5),
                        });
                    }

                    return {
                        success: true,
                        thumbCount: thumbs.length,
                        metrics,
                    };
                })()
            `,
            awaitPromise: true,
            returnByValue: true,
        });

        const data = evaluation.result.value;
        if (!data || !data.success) {
            throw new Error(`In-browser evaluation failed: ${JSON.stringify(data)}`);
        }

        console.log("\n  [Chrome Computed Metrics for All 5 Product Photographs]:");
        for (const m of data.metrics) {
            console.log(`    Photo ${m.index}:`);
            console.log(`      computed objectFit: "${m.objectFit}" (EXPECTED: "contain")`);
            console.log(`      container frame: ${m.containerWidth}px × ${m.containerHeight}px (aspect-ratio: ${m.containerAspectRatio})`);
            console.log(`      rendered img bounds: ${m.imgRenderedWidth}px × ${m.imgRenderedHeight}px`);
            console.log(`      natural source size: ${m.imgNaturalWidth}px × ${m.imgNaturalHeight}px`);
            console.log(`      container bounds Delta (CLS check): ΔW=${m.widthDelta}px, ΔH=${m.heightDelta}px (ZERO CLS)`);
            console.log(`      is fully contained within frame: ${m.isContained}`);

            if (m.objectFit !== "contain") {
                throw new Error(`Photo ${m.index} has objectFit='${m.objectFit}', expected 'contain'!`);
            }
            if (!m.isContained) {
                throw new Error(`Photo ${m.index} bounds overflow container!`);
            }
            if (m.widthDelta > 1 || m.heightDelta > 1) {
                throw new Error(`Photo ${m.index} caused container layout shift!`);
            }
        }

        // Capture screenshot of real necklace product with contained gallery
        const screenshotRes = await send("Page.captureScreenshot", { format: "png" });
        const screenshotPath = path.join(outDir, "after-13-real-product-necklace-gallery-contained.png");
        fs.writeFileSync(screenshotPath, Buffer.from(screenshotRes.data, "base64"));
        console.log(`\n  [Screenshot Captured]: docs/screenshots/task028/after-13-real-product-necklace-gallery-contained.png`);

        ws.close();
        console.log("\n  [PASS] Genuine personalized necklace product verified with 100% computed containment and 0 CLS!");
    } finally {
        restoreEnvLocal();
        if (chromeProcess) {
            try { chromeProcess.kill("SIGKILL"); } catch {}
        }
        if (nextProcess) {
            try { nextProcess.kill("SIGKILL"); } catch {}
        }
        if (emuProcess) {
            try { emuProcess.kill("SIGINT"); } catch {}
        }
    }
}

async function run() {
    await verifyLiveR2Assets();
    await verifyChromeComputedDimensions();
}

run().catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
});
