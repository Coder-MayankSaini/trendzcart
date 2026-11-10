/**
 * Automated Screenshot Capture for TASK 022 — Bulk Review Management & View All Reviews
 * Uses Chrome DevTools Protocol and Firebase Emulator
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

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

const outDir = path.join(process.cwd(), "docs", "screenshots", "task022");
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

async function main() {
    console.log("[TASK-022 Visual QA] Starting emulator and Next.js server...");

    const envLocalPath = path.join(process.cwd(), ".env.local");
    const originalEnvLocal = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf8") : "";
    let modified = originalEnvLocal.replace(/NEXT_PUBLIC_FIREBASE_API_KEY=.*/g, "# disabled for emulator");
    modified += "\nNEXT_PUBLIC_USE_FIREBASE_EMULATOR=true\nNEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-trendkartz\nNEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key\nNEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080\nNEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099\n";
    fs.writeFileSync(envLocalPath, modified);

    const restoreEnvLocal = () => {
        try { fs.writeFileSync(envLocalPath, originalEnvLocal); } catch {}
    };

    // 1. Start Emulator
    const emuProcess = spawn("npx", ["firebase", "emulators:start", "--project", "demo-trendkartz", "--only", "firestore,auth"], {
        env,
        shell: true,
        stdio: "pipe",
    });

    let nextProcess = null;
    let chromeProcess = null;

    try {
        console.log("[TASK-022 Visual QA] Waiting for Firebase emulators on ports 8080 & 9099...");
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("[TASK-022 Visual QA] Emulators are online!");

        // 2. Seed data
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task022-seeder");
        } catch {
            app = admin.app("task022-seeder");
        }
        const adminAuth = app.auth();
        const adminDb = app.firestore();

        const adminUid = "admin_verified_task022";
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

        const customToken = await adminAuth.createCustomToken(adminUid);

        // Seed product
        const targetProductId = "prod-hoodie-green";
        const sampleProduct = {
            id: targetProductId,
            name: "Bazaarvilla Signature Green Hoodie",
            slug: "bazaarvilla-signature-green-hoodie",
            price: 1499,
            inventory: 45,
            category: "Apparel",
            categories: ["Apparel", "Winterwear"],
            images: ["/brand/bazaarvilla-banner-desktop.webp"],
            description: "Crafted from 100% heavyweight organic fleece cotton, featuring Bazaarvilla's signature deep green shade and double-stitched reinforced hems.",
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            reviewCount: 0,
            averageRating: 0.0,
            ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            createdAt: Date.now(),
        };

        await adminDb.collection("products").doc(targetProductId).set(sampleProduct);
        console.log("[TASK-022 Visual QA] Seeded product in Firestore!");

        // 3. Start Next.js
        console.log("[TASK-022 Visual QA] Starting Next.js server on port 3333...");
        nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(3333, 40000);
        console.log("[TASK-022 Visual QA] Next.js dev server ready at http://localhost:3333!");

        // 4. Launch Chrome Headless
        console.log("[TASK-022 Visual QA] Launching Chrome Headless...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-" + Date.now());
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

        await new Promise((r) => ws.onopen = r);
        await send("Page.enable");
        await send("Runtime.enable");

        // Authenticate as Admin
        console.log("[TASK-022 Visual QA] Authenticating as Administrator...");
        await send("Page.navigate", { url: "http://localhost:3333" });
        await new Promise((r) => setTimeout(r, 3000));

        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    if (typeof window.__EMULATOR_SIGNIN__ === 'function') {
                        await window.__EMULATOR_SIGNIN__('${customToken}');
                        return "SignedIn";
                    }
                    return "NoEmulatorSignIn";
                })();
            `,
            awaitPromise: true,
        });

        await new Promise((r) => setTimeout(r, 2500));

        async function capture(pageUrl, filename, width, height, isMobile = false, waitMs = 2500) {
            console.log(`[Screenshot] Capturing ${filename} (${width}x${height})...`);
            await send("Emulation.setDeviceMetricsOverride", {
                width,
                height,
                deviceScaleFactor: 2,
                mobile: isMobile,
            });

            await send("Page.navigate", { url: pageUrl });
            await new Promise((r) => setTimeout(r, waitMs));

            const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[Screenshot] Saved ${filePath} (${fs.statSync(filePath).size} bytes)`);
        }

        // 1. Initial Admin Reviews Page (Desktop)
        await capture(
            `http://localhost:3333/admin/reviews?productId=${targetProductId}`,
            "01-admin-review-management-desktop.png",
            1440,
            900,
            false
        );

        // 2. Initial Admin Reviews Page (Mobile 390x844)
        await capture(
            `http://localhost:3333/admin/reviews?productId=${targetProductId}`,
            "02-admin-review-management-mobile.png",
            390,
            844,
            true
        );

        // 3. Load 38 Sample Batch and Validate
        console.log("[TASK-022 Visual QA] Loading 38 Sample Reviews and Validating...");
        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Load Sample Batch (38 Reviews)'));
                    if (btn) btn.click();
                    await new Promise(r => setTimeout(r, 600));
                    const valBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Validate Review Batch'));
                    if (valBtn) valBtn.click();
                })();
            `,
            awaitPromise: true,
        });
        await new Promise((r) => setTimeout(r, 3500));

        // Capture 38 Validated Preview (Audit Cards)
        const { data: data3 } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "03-admin-json-import-preview-38-desktop.png"), Buffer.from(data3, "base64"));
        console.log("[Screenshot] Saved 03-admin-json-import-preview-38-desktop.png");

        // 4. Switch to Storefront Look Preview
        console.log("[TASK-022 Visual QA] Switching to Storefront Look Preview...");
        await send("Runtime.evaluate", {
            expression: `
                const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Storefront Look'));
                if (btn) btn.click();
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));
        const { data: data4 } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "04-admin-json-import-storefront-preview.png"), Buffer.from(data4, "base64"));
        console.log("[Screenshot] Saved 04-admin-json-import-storefront-preview.png");

        // 5. Load Error / Simulation Sample to demonstrate validation rejections
        console.log("[TASK-022 Visual QA] Loading Error/Simulation Sample...");
        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Load Error/Sim Sample'));
                    if (btn) btn.click();
                    await new Promise(r => setTimeout(r, 600));
                    const valBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Validate Review Batch'));
                    if (valBtn) valBtn.click();
                })();
            `,
            awaitPromise: true,
        });
        await new Promise((r) => setTimeout(r, 3500));
        const { data: data5 } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "05-admin-json-import-validation-errors.png"), Buffer.from(data5, "base64"));
        console.log("[Screenshot] Saved 05-admin-json-import-validation-errors.png");

        // 6. Now publish the 38 reviews into Firestore so product page and manage tab reflect them
        console.log("[TASK-022 Visual QA] Reloading 38 reviews and publishing batch...");
        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Load Sample Batch (38 Reviews)'));
                    if (btn) btn.click();
                    await new Promise(r => setTimeout(r, 600));
                    const valBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Validate Review Batch'));
                    if (valBtn) valBtn.click();
                })();
            `,
            awaitPromise: true,
        });
        await new Promise((r) => setTimeout(r, 3500));

        // Click Publish button to open modal, then confirm
        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    const pubBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Publish Approved Batch'));
                    if (pubBtn) pubBtn.click();
                    await new Promise(r => setTimeout(r, 800));
                    const confBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Confirm & Publish'));
                    if (confBtn) confBtn.click();
                })();
            `,
            awaitPromise: true,
        });
        await new Promise((r) => setTimeout(r, 4500));

        // Switch to Manage Existing Reviews Tab
        await send("Runtime.evaluate", {
            expression: `
                const tab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Manage Existing Reviews'));
                if (tab) tab.click();
            `,
        });
        await new Promise((r) => setTimeout(r, 2000));
        const { data: data6 } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "06-admin-reviews-published-manage-tab.png"), Buffer.from(data6, "base64"));
        console.log("[Screenshot] Saved 06-admin-reviews-published-manage-tab.png");

        // 7. Open Provenance Modal
        console.log("[TASK-022 Visual QA] Opening Provenance Modal...");
        await send("Runtime.evaluate", {
            expression: `
                const provBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Provenance');
                if (provBtn) provBtn.click();
            `,
        });
        await new Promise((r) => setTimeout(r, 1200));
        const { data: data7 } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "07-admin-provenance-modal.png"), Buffer.from(data7, "base64"));
        console.log("[Screenshot] Saved 07-admin-provenance-modal.png");

        // Close modal
        await send("Runtime.evaluate", {
            expression: `
                const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Close' || b.textContent === '×');
                if (closeBtn) closeBtn.click();
            `,
        });
        await new Promise((r) => setTimeout(r, 800));

        // 8. Admin Product Catalog showing Reviews (38)
        await capture(
            "http://localhost:3333/admin/products",
            "08-admin-product-catalog-with-reviews.png",
            1440,
            900,
            false,
            3000
        );

        // 9. Storefront Product Details Page (Desktop) showing review summary, 38 count, stars, and "View All 38 Reviews" button
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "09-storefront-pdp-review-summary-desktop.png",
            1440,
            1050,
            false,
            3500
        );

        // 10. Storefront Product Details Page (Mobile 390x844)
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "10-storefront-pdp-review-summary-mobile.png",
            390,
            844,
            true,
            3500
        );

        // 11. Dedicated View All Reviews Page (Desktop)
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie/reviews",
            "11-storefront-view-all-reviews-desktop.png",
            1440,
            950,
            false,
            3500
        );

        // 12. Dedicated View All Reviews Page (Mobile 390x844)
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie/reviews",
            "12-storefront-view-all-reviews-mobile.png",
            390,
            844,
            true,
            3500
        );

        console.log("[TASK-022 Visual QA] Successfully captured all 12 screenshots into docs/screenshots/task022!");
    } finally {
        if (chromeProcess) chromeProcess.kill();
        if (nextProcess) nextProcess.kill();
        if (emuProcess) emuProcess.kill();
        restoreEnvLocal();
    }
}

main().catch((err) => {
    console.error("[TASK-022 Visual QA] Error capturing screenshots:", err);
    process.exit(1);
});
