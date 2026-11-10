/**
 * Automated Screenshot Capture for TASK 027 — Customizable Product COD Restriction
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

const outDir = path.join(process.cwd(), "docs", "screenshots", "task027");
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
    console.log("[TASK-027 Visual QA] Starting emulator and Next.js server...");

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
        console.log("[TASK-027 Visual QA] Waiting for Firebase emulators on ports 8080 & 9099...");
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("[TASK-027 Visual QA] Emulators are online!");

        // 2. Seed data
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task027-seeder");
        } catch {
            app = admin.app("task027-seeder");
        }
        const adminAuth = app.auth();
        const adminDb = app.firestore();

        const adminUid = "admin_verified_task027";
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

        // Regular Product
        const regProductId = "prod-regular-hoodie";
        const regProduct = {
            id: regProductId,
            name: "Bazaarvilla Signature Green Hoodie",
            slug: "bazaarvilla-signature-green-hoodie",
            price: 1499,
            inventory: 50,
            category: "Apparel",
            categories: ["Apparel", "Winterwear"],
            images: ["/brand/bazaarvilla-banner-desktop.webp"],
            description: "100% organic cotton hoodie with signature green styling.",
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            createdAt: Date.now(),
        };
        await adminDb.collection("products").doc(regProductId).set(regProduct);

        // Customizable Product
        const customProductId = "prod-custom-photo-frame";
        const customProduct = {
            id: customProductId,
            name: "Personalized Acrylic Photo Frame",
            slug: "personalized-acrylic-photo-frame",
            price: 899,
            inventory: 35,
            category: "Customized Gifts",
            categories: ["Customized Gifts", "Personalized"],
            images: ["/brand/bazaarvilla-banner-desktop.webp"],
            description: "Crystal-clear acrylic photo frame personalized with your high-definition photograph.",
            isVisible: true,
            isFeatured: true,
            isCustomized: true,
            customizationType: "requires_picture",
            createdAt: Date.now(),
        };
        await adminDb.collection("products").doc(customProductId).set(customProduct);

        console.log("[TASK-027 Visual QA] Seeded products in Firestore!");

        // 3. Start Next.js
        console.log("[TASK-027 Visual QA] Starting Next.js server on port 3333...");
        nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        await waitForPort(3333, 40000);
        console.log("[TASK-027 Visual QA] Next.js dev server ready at http://localhost:3333!");

        // 4. Launch Chrome Headless
        console.log("[TASK-027 Visual QA] Launching Chrome Headless...");
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

        await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
        });

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
            console.log(`[Screenshot Captured] ${filename}`);
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 2500));
        };

        const setCartItems = async (items) => {
            await send("Runtime.evaluate", {
                expression: `localStorage.setItem('trendkartz_cart', JSON.stringify(${JSON.stringify(items)}))`,
            });
        };

        // SCENARIO 1: PDP for Regular Product (COD Available)
        console.log("[Visual QA 1/9] Capturing PDP for Regular Product...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/products/bazaarvilla-signature-green-hoodie");
        await capture("01-pdp-regular-cod-available.png");

        // SCENARIO 2: PDP for Customizable Product (Prepaid Only)
        console.log("[Visual QA 2/9] Capturing PDP for Customizable Product...");
        await navigateTo("http://localhost:3333/products/personalized-acrylic-photo-frame");
        await capture("02-pdp-customizable-prepaid-only.png");

        // SCENARIO 3: Cart with Customizable Product (Desktop)
        console.log("[Visual QA 3/9] Capturing Cart with Customizable Product (Desktop)...");
        const customCart = [
            {
                id: "item-custom-1",
                productId: customProductId,
                name: "Personalized Acrylic Photo Frame",
                price: 899,
                quantity: 1,
                image: "/brand/bazaarvilla-banner-desktop.webp",
                isCustomized: true,
                customizationData: {
                    name: "John & Jane Anniversary",
                },
            },
        ];
        await navigateTo("http://localhost:3333/cart");
        await setCartItems(customCart);
        await navigateTo("http://localhost:3333/cart");
        await capture("03-cart-customizable-note-desktop.png");

        // SCENARIO 4: Cart with Customizable Product (Mobile)
        console.log("[Visual QA 4/9] Capturing Cart with Customizable Product (Mobile 390x844)...");
        await setViewport(390, 844, true);
        await navigateTo("http://localhost:3333/cart");
        await capture("04-cart-customizable-note-mobile.png");

        // SCENARIO 5: Checkout with Regular Products Only (COD Available Desktop)
        console.log("[Visual QA 5/9] Capturing Checkout with Regular Product (COD Available Desktop)...");
        await setViewport(1440, 900, false);
        const regularCart = [
            {
                id: "item-reg-1",
                productId: regProductId,
                name: "Bazaarvilla Signature Green Hoodie",
                price: 1499,
                quantity: 1,
                image: "/brand/bazaarvilla-banner-desktop.webp",
                isCustomized: false,
            },
        ];
        await setCartItems(regularCart);
        await navigateTo("http://localhost:3333/checkout");
        await capture("05-checkout-regular-cod-available-desktop.png");

        // SCENARIO 6: Checkout with Customizable Product (COD Blocked Desktop)
        console.log("[Visual QA 6/9] Capturing Checkout with Customizable Product (COD Blocked Desktop)...");
        await setCartItems(customCart);
        await navigateTo("http://localhost:3333/checkout");
        await capture("06-checkout-customizable-cod-blocked-desktop.png");

        // SCENARIO 7: Mixed Cart Checkout (Regular Hoodie + Custom Frame - COD Blocked Desktop)
        console.log("[Visual QA 7/9] Capturing Mixed Cart Checkout (COD Blocked Desktop)...");
        const mixedCart = [
            {
                id: "item-reg-1",
                productId: regProductId,
                name: "Bazaarvilla Signature Green Hoodie",
                price: 1499,
                quantity: 1,
                image: "/brand/bazaarvilla-banner-desktop.webp",
                isCustomized: false,
            },
            {
                id: "item-custom-1",
                productId: customProductId,
                name: "Personalized Acrylic Photo Frame",
                price: 899,
                quantity: 1,
                image: "/brand/bazaarvilla-banner-desktop.webp",
                isCustomized: true,
                customizationData: {
                    name: "John & Jane Anniversary",
                },
            },
        ];
        await setCartItems(mixedCart);
        await navigateTo("http://localhost:3333/checkout");
        await capture("07-checkout-mixed-cart-cod-blocked-desktop.png");

        // SCENARIO 8: Mobile Checkout with Customizable Product (Mobile 390x844)
        console.log("[Visual QA 8/9] Capturing Mobile Checkout (COD Blocked Mobile 390x844)...");
        await setViewport(390, 844, true);
        await navigateTo("http://localhost:3333/checkout");
        await capture("08-checkout-customizable-cod-blocked-mobile.png");

        // SCENARIO 9: Admin Products Section showing Customizable Product & Notice
        console.log("[Visual QA 9/9] Capturing Admin Products Dashboard with Custom & Prepaid Only badges...");
        await setViewport(1440, 900, false);
        // Authenticate admin session
        await navigateTo("http://localhost:3333/");
        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    const { signInWithCustomToken } = await import('firebase/auth');
                    const { auth } = await import('/src/lib/firebase/config.ts');
                    await signInWithCustomToken(auth, ${JSON.stringify(customToken)});
                })()
            `,
            awaitPromise: true,
        });
        await navigateTo("http://localhost:3333/admin/products");
        await capture("09-admin-products-table-badges.png");

        console.log("[TASK-027 Visual QA] All 9 visual QA screenshots captured successfully!");
    } catch (err) {
        console.error("[TASK-027 Visual QA Error]", err);
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
        console.log("[TASK-027 Visual QA] Cleaned up processes.");
    }
}

main().catch(console.error);
