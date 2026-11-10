/**
 * Automated Screenshot Capture for TASK 023 — Product Purchase Activity Counter
 * Uses Chrome DevTools Protocol and Firebase Emulator Suite
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

const outDir = path.join(process.cwd(), "docs", "screenshots", "task023");
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
    console.log("[TASK-023 Visual QA] Starting emulator and Next.js server...");

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
        console.log("[TASK-023 Visual QA] Waiting for Firebase emulators on ports 8080 & 9099...");
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("[TASK-023 Visual QA] Emulators are online!");

        // 2. Seed data
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task023-seeder");
        } catch {
            app = admin.app("task023-seeder");
        }
        const adminAuth = app.auth();
        const adminDb = app.firestore();

        const adminUid = "admin_verified_task023";
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

        // Seed product 1: With legitimate nonzero sales (18 units in 30 days)
        const targetProductId = "prod-hoodie-green";
        const now = Date.now();
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
            reviewCount: 3,
            averageRating: 4.7,
            purchaseActivity: {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
                unitsSold: 18,
                countsByPeriod: { 7: 6, 30: 18, 90: 42 },
                qualifyingOrdersCount: 14,
                uniquePurchasersCount: 12,
                lastCalculatedAt: now,
            },
            createdAt: now,
        };
        await adminDb.collection("products").doc(targetProductId).set(sampleProduct);

        // Seed product 2: With zero sales (below threshold)
        const zeroProductId = "prod-mug-zero";
        const zeroProduct = {
            id: zeroProductId,
            name: "Bazaarvilla Ceramic Memory Mug",
            slug: "bazaarvilla-ceramic-memory-mug",
            price: 499,
            inventory: 30,
            category: "Living",
            categories: ["Living"],
            images: ["/brand/bazaarvilla-banner-desktop.webp"],
            description: "Premium handcrafted ceramic mug with ergonomic heat-resistant handle.",
            isVisible: true,
            isFeatured: false,
            isCustomized: false,
            purchaseActivity: {
                enabled: true,
                periodDays: 30,
                displayThreshold: 5,
                unitsSold: 0,
                countsByPeriod: { 7: 0, 30: 0, 90: 0 },
                qualifyingOrdersCount: 0,
                uniquePurchasersCount: 0,
                lastCalculatedAt: now,
            },
            createdAt: now,
        };
        await adminDb.collection("products").doc(zeroProductId).set(zeroProduct);

        // Seed product 3: Counter disabled by admin
        const disabledProductId = "prod-cuff-disabled";
        const disabledProduct = {
            id: disabledProductId,
            name: "Bazaarvilla Engraved Silver Cuff",
            slug: "bazaarvilla-engraved-silver-cuff",
            price: 999,
            inventory: 20,
            category: "Accessories",
            categories: ["Accessories"],
            images: ["/brand/bazaarvilla-banner-desktop.webp"],
            description: "Solid silver cuff bracelet with custom inscription option.",
            isVisible: true,
            isFeatured: false,
            isCustomized: false,
            purchaseActivity: {
                enabled: false,
                periodDays: 30,
                displayThreshold: 5,
                unitsSold: 25,
                countsByPeriod: { 7: 10, 30: 25, 90: 50 },
                lastCalculatedAt: now,
            },
            createdAt: now,
        };
        await adminDb.collection("products").doc(disabledProductId).set(disabledProduct);

        console.log("[TASK-023 Visual QA] Seeded test products in Firestore!");

        // 3. Start Next.js
        console.log("[TASK-023 Visual QA] Starting Next.js server on port 3333...");
        nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(3333, 40000);
        console.log("[TASK-023 Visual QA] Next.js dev server ready at http://localhost:3333!");

        // 4. Launch Chrome Headless
        console.log("[TASK-023 Visual QA] Launching Chrome Headless...");
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
        console.log("[TASK-023 Visual QA] Authenticating as Administrator...");
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

        async function capture(pageUrl, filename, width, height, isMobile = false, waitMs = 2500, beforeEval = null) {
            console.log(`[Screenshot] Capturing ${filename} (${width}x${height})...`);
            await send("Emulation.setDeviceMetricsOverride", {
                width,
                height,
                deviceScaleFactor: 2,
                mobile: isMobile,
            });

            await send("Page.navigate", { url: pageUrl });
            await new Promise((r) => setTimeout(r, waitMs));

            if (beforeEval) {
                await send("Runtime.evaluate", {
                    expression: beforeEval,
                    awaitPromise: true,
                });
                await new Promise((r) => setTimeout(r, 1000));
            }

            const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[Screenshot] Saved ${filePath} (${fs.statSync(filePath).size} bytes)`);
        }

        // Navigate to Admin Products and open edit mode for prod-hoodie-green
        const openEditScript = `
            (() => {
                const rows = Array.from(document.querySelectorAll("tr"));
                const targetRow = rows.find(r => r.textContent.includes("Bazaarvilla Signature Green Hoodie"));
                if (targetRow) {
                    const editBtn = Array.from(targetRow.querySelectorAll("button")).find(b => b.textContent.includes("Edit"));
                    if (editBtn) editBtn.click();
                } else {
                    const btns = Array.from(document.querySelectorAll("button")).filter(b => b.textContent.includes("Edit"));
                    if (btns.length > 0) btns[0].click();
                }
                setTimeout(() => {
                    const sec = document.querySelector("[data-testid='section-purchase-activity']");
                    if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'center' });
                }, 500);
            })()
        `;

        // 1. Admin Settings Desktop 1440px
        await capture(
            "http://localhost:3333/admin/products",
            "01-admin-purchase-activity-settings-desktop-1440px.png",
            1440,
            900,
            false,
            3000,
            openEditScript
        );

        // 2. Admin Settings Desktop 1024px (Interactive simulation preview focus)
        const simFocusScript = `
            (() => {
                const rows = Array.from(document.querySelectorAll("tr"));
                const targetRow = rows.find(r => r.textContent.includes("Bazaarvilla Signature Green Hoodie"));
                if (targetRow) {
                    const editBtn = Array.from(targetRow.querySelectorAll("button")).find(b => b.textContent.includes("Edit"));
                    if (editBtn) editBtn.click();
                }
                setTimeout(() => {
                    const panel = document.querySelector("[data-testid='purchase-activity-simulation-panel']");
                    if (panel) panel.scrollIntoView({ behavior: 'instant', block: 'center' });
                }, 500);
            })()
        `;
        await capture(
            "http://localhost:3333/admin/products",
            "02-admin-simulation-preview-interactive-1024px.png",
            1024,
            768,
            false,
            3000,
            simFocusScript
        );

        // 3. Admin Settings Tablet 768px
        await capture(
            "http://localhost:3333/admin/products",
            "03-admin-settings-tablet-768px.png",
            768,
            1024,
            false,
            3000,
            openEditScript
        );

        // 4. Admin Settings Mobile 430px (iPhone 14/15 Pro Max)
        await capture(
            "http://localhost:3333/admin/products",
            "04-admin-settings-mobile-430px.png",
            430,
            932,
            true,
            3000,
            openEditScript
        );

        // 5. Admin Settings Mobile 375px (iPhone SE)
        await capture(
            "http://localhost:3333/admin/products",
            "05-admin-settings-mobile-375px.png",
            375,
            667,
            true,
            3000,
            openEditScript
        );

        // 6. Admin Settings Mobile 320px (Ultra-narrow)
        await capture(
            "http://localhost:3333/admin/products",
            "06-admin-settings-mobile-320px.png",
            320,
            568,
            true,
            3000,
            openEditScript
        );

        // 7. Storefront PDP Nonzero Counter Desktop 1440px
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "07-storefront-pdp-nonzero-counter-desktop-1440px.png",
            1440,
            900,
            false,
            3000
        );

        // 8. Storefront PDP Nonzero Counter Desktop 1024px
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "08-storefront-pdp-nonzero-counter-desktop-1024px.png",
            1024,
            768,
            false,
            3000
        );

        // 9. Storefront PDP Nonzero Counter Tablet 768px
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "09-storefront-pdp-nonzero-counter-tablet-768px.png",
            768,
            1024,
            false,
            3000
        );

        // 10. Storefront PDP Nonzero Counter Mobile 430px
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "10-storefront-pdp-nonzero-counter-mobile-430px.png",
            430,
            932,
            true,
            3000
        );

        // 11. Storefront PDP Nonzero Counter Mobile 375px
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "11-storefront-pdp-nonzero-counter-mobile-375px.png",
            375,
            667,
            true,
            3000
        );

        // 12. Storefront PDP Nonzero Counter Mobile 320px
        await capture(
            "http://localhost:3333/products/bazaarvilla-signature-green-hoodie",
            "12-storefront-pdp-nonzero-counter-mobile-320px.png",
            320,
            568,
            true,
            3000
        );

        // 13. Storefront PDP Zero Sales Hidden Desktop 1440px (Zero layout shifts, cleanly hidden)
        await capture(
            "http://localhost:3333/products/bazaarvilla-ceramic-memory-mug",
            "13-storefront-pdp-zero-sales-hidden-desktop-1440px.png",
            1440,
            900,
            false,
            3000
        );

        // 14. Storefront PDP Zero Sales Hidden Mobile 375px
        await capture(
            "http://localhost:3333/products/bazaarvilla-ceramic-memory-mug",
            "14-storefront-pdp-zero-sales-hidden-mobile-375px.png",
            375,
            667,
            true,
            3000
        );

        // 15. Storefront PDP Disabled Counter Desktop 1440px
        await capture(
            "http://localhost:3333/products/bazaarvilla-engraved-silver-cuff",
            "15-storefront-pdp-disabled-counter-desktop-1440px.png",
            1440,
            900,
            false,
            3000
        );

        console.log(`[TASK-023 Visual QA] Successfully captured all 15 authentic screenshots in ${outDir}!`);
    } catch (err) {
        console.error("[TASK-023 Visual QA] Fatal capture error:", err);
    } finally {
        restoreEnvLocal();
        if (chromeProcess) {
            try { chromeProcess.kill(); } catch {}
        }
        if (nextProcess) {
            try { nextProcess.kill(); } catch {}
        }
        if (emuProcess) {
            try { emuProcess.kill(); } catch {}
        }
    }
}

main().catch(console.error);
