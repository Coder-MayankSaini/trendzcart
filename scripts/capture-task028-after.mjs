/**
 * Automated Screenshot Capture for TASK 028 — AFTER Image Containment Fix
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

async function main() {
    console.log("[TASK-028 AFTER Visual QA] Starting emulator and Next.js server...");

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
        console.log("[TASK-028 AFTER Visual QA] Waiting for Firebase emulators on ports 8080 & 9099...");
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("[TASK-028 AFTER Visual QA] Emulators are online!");

        // 2. Seed data
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task028-after-seeder");
        } catch {
            app = admin.app("task028-after-seeder");
        }
        const adminAuth = app.auth();
        const adminDb = app.firestore();

        const adminUid = "admin_verified_task028";
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

        // Seed Multi-Aspect Demonstration Product
        const demoProductId = "prod-containment-demo";
        const demoProduct = {
            id: demoProductId,
            name: "Bazaarvilla Bar Necklace Multi-Aspect Showcase",
            slug: "bazaarvilla-bar-necklace-showcase",
            price: 1299,
            inventory: 50,
            category: "Jewelry",
            categories: ["Jewelry", "Accessories"],
            images: [
                "/test-fixtures/landscape-16-9.png",
                "/test-fixtures/square-1-1.png",
                "/test-fixtures/portrait-4-5.png",
                "/test-fixtures/tall-portrait-9-16.png",
            ],
            description: "High-definition engraved bar necklace demonstration for aspect ratio containment testing.",
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            createdAt: Date.now(),
        };
        await adminDb.collection("products").doc(demoProductId).set(demoProduct);

        console.log("[TASK-028 AFTER Visual QA] Seeded multi-aspect test product in Firestore!");

        // 3. Start Next.js
        console.log("[TASK-028 AFTER Visual QA] Starting Next.js server on port 3333...");
        nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(3333, 40000);
        console.log("[TASK-028 AFTER Visual QA] Next.js dev server ready at http://localhost:3333!");

        // 4. Launch Chrome Headless
        console.log("[TASK-028 AFTER Visual QA] Launching Chrome Headless...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-after-" + Date.now());
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
        };

        const capture = async (filename) => {
            const { data } = await send("Page.captureScreenshot", { format: "png" });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[AFTER Screenshot Captured] ${filename}`);
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 3000));
        };

        const clickThumb = async (index) => {
            await send("Runtime.evaluate", {
                expression: `
                    (() => {
                        const thumbs = document.querySelectorAll('.pig-thumb');
                        if (thumbs && thumbs[${index}]) {
                            thumbs[${index}].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        }
                    })()
                `,
            });
            await new Promise((r) => setTimeout(r, 1200));
        };

        // SCENARIO 1: Desktop 1440px - Landscape 16:9 Image (AFTER - 100% CONTAINED & VISIBLE)
        console.log("[Visual QA AFTER 1/12] Capturing 16:9 Landscape on Desktop (1440px)...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/products/bazaarvilla-bar-necklace-showcase");
        await clickThumb(0);
        await capture("after-01-pdp-landscape-16-9-desktop-1440px.png");

        // SCENARIO 2: Desktop 1440px - Square 1:1 Image (AFTER - 100% CONTAINED & VISIBLE)
        console.log("[Visual QA AFTER 2/12] Capturing 1:1 Square on Desktop (1440px)...");
        await clickThumb(1);
        await capture("after-02-pdp-square-1-1-desktop-1440px.png");

        // SCENARIO 3: Desktop 1440px - Portrait 4:5 Image (AFTER - Recommended Baseline)
        console.log("[Visual QA AFTER 3/12] Capturing 4:5 Portrait on Desktop (1440px)...");
        await clickThumb(2);
        await capture("after-03-pdp-portrait-4-5-desktop-1440px.png");

        // SCENARIO 4: Desktop 1440px - Tall Portrait 9:16 Image (AFTER - 100% CONTAINED)
        console.log("[Visual QA AFTER 4/12] Capturing 9:16 Tall Portrait on Desktop (1440px)...");
        await clickThumb(3);
        await capture("after-04-pdp-tall-portrait-9-16-desktop-1440px.png");

        // SCENARIOS 5 to 10: Multi-Viewport Responsive Matrix (320px, 375px, 430px, 768px, 1024px, 1440px)
        console.log("[Visual QA AFTER 5/12] Capturing 320px Compact Mobile...");
        await setViewport(320, 568, true);
        await clickThumb(0); // Landscape photo on mobile
        await capture("after-05-pdp-responsive-320px.png");

        console.log("[Visual QA AFTER 6/12] Capturing 375px Standard Mobile...");
        await setViewport(375, 812, true);
        await capture("after-06-pdp-responsive-375px.png");

        console.log("[Visual QA AFTER 7/12] Capturing 430px Large Mobile...");
        await setViewport(430, 932, true);
        await capture("after-07-pdp-responsive-430px.png");

        console.log("[Visual QA AFTER 8/12] Capturing 768px Tablet Portrait...");
        await setViewport(768, 1024, false);
        await capture("after-08-pdp-responsive-768px.png");

        console.log("[Visual QA AFTER 9/12] Capturing 1024px Laptop / Tablet Landscape...");
        await setViewport(1024, 768, false);
        await capture("after-09-pdp-responsive-1024px.png");

        console.log("[Visual QA AFTER 10/12] Capturing 1440px Desktop Overview...");
        await setViewport(1440, 900, false);
        await capture("after-10-pdp-responsive-1440px.png");

        // SCENARIO 11: Gallery Navigation & Active State
        console.log("[Visual QA AFTER 11/12] Capturing Gallery Navigation & Active State...");
        await clickThumb(1); // Select Square
        await capture("after-11-pdp-gallery-navigation-selected.png");

        // SCENARIO 12: Admin Products Dropzone Guidance (4:5 Recommendation & Square/Landscape Support)
        console.log("[Visual QA AFTER 12/12] Capturing Admin Products Dropzone Guidance via AuthModal...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/");
        // Open AuthModal
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const signinBtn = document.querySelector('.login-btn');
                    if (signinBtn) signinBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));
        // Fill credentials & submit using React native value setter
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
        await navigateTo("http://localhost:3333/admin/products");
        await new Promise((r) => setTimeout(r, 2500));
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const addBtn = buttons.find(b => b.textContent && b.textContent.includes('Add Product'));
                    if (addBtn) addBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 2000));
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const dropzone = document.querySelector('.admin-gallery-dropzone');
                    if (dropzone) dropzone.scrollIntoView({ behavior: 'instant', block: 'center' });
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));
        await capture("after-12-admin-products-dropzone-recommendations.png");

        console.log("[TASK-028 AFTER Visual QA] All 12 AFTER screenshots captured successfully!");
    } catch (err) {
        console.error("[TASK-028 AFTER Visual QA Error]", err);
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
        console.log("[TASK-028 AFTER Visual QA] Cleaned up processes.");
    }
}

main().catch(console.error);
