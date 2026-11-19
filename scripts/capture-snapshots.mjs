/**
 * Capture Admin Screenshots (Before & After) using Chrome DevTools Protocol & Firebase Emulator
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

// Auto-detect a compatible JDK >= 21
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

const targetFolder = process.argv[2] || "before";
const outDir = path.join(process.cwd(), "docs", "screenshots", targetFolder);
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

// Also assign to process.env so in-process firebase-admin connects to emulators
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
    console.log(`[Snapshot] Starting emulator and Next.js server to capture "${targetFolder}" screenshots...`);

    // Ensure .env.local has emulator flags for Next.js client bundling
    const envLocalPath = path.join(process.cwd(), ".env.local");
    const originalEnvLocal = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf8") : "";
    let modified = originalEnvLocal.replace(/NEXT_PUBLIC_FIREBASE_API_KEY=.*/g, "# disabled for emulator");
    modified += "\nNEXT_PUBLIC_USE_FIREBASE_EMULATOR=true\nNEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-trendkartz\nNEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key\nNEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080\nNEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099\n";
    fs.writeFileSync(envLocalPath, modified);

    const restoreEnvLocal = () => {
        try {
            fs.writeFileSync(envLocalPath, originalEnvLocal);
        } catch {}
    };

    // 1. Start Emulator
    const emuProcess = spawn("npx", ["firebase", "emulators:start", "--project", "demo-trendkartz", "--only", "firestore,auth"], {
        env,
        shell: true,
        stdio: "pipe",
    });

    emuProcess.stdout.on("data", (d) => {
        const str = d.toString();
        if (str.includes("Emulator") || str.includes("running on")) {
            console.log(`[Emulator] ${str.trim()}`);
        }
    });

    try {
        console.log("[Snapshot] Waiting for Firebase emulators on ports 8080 and 9099...");
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("[Snapshot] Emulators are online!");

        // 2. Seed data via dynamic import of firebase-admin
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "snapshot-seeder");
        } catch {
            app = admin.app("snapshot-seeder");
        }
        const adminAuth = app.auth();
        const adminDb = app.firestore();

        const adminUid = "admin_verified_test_user";
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

        // Create custom token for browser authentication
        const customToken = await adminAuth.createCustomToken(adminUid);
        console.log("[Snapshot] Generated admin custom token for emulator sign in");

        // Seed products
        const sampleProducts = [
            {
                id: "prod-hoodie-green",
                name: "Bazaarvilla Signature Green Hoodie",
                slug: "bazaarvilla-signature-green-hoodie",
                price: 1499,
                inventory: 45,
                category: "Apparel",
                categories: ["Apparel", "Winterwear"],
                images: ["/brand/bazaarvilla-banner-desktop.webp"],
                isVisible: true,
                isFeatured: true,
                isCustomized: false,
                sizes: ["S", "M", "L", "XL"],
                description: "Premium cotton fleece hoodie in official Bazaarvilla forest green.",
                createdAt: Date.now() - 86400000,
            },
            {
                id: "prod-engraved-bracelet",
                name: "Custom Engraved Silver Cuff",
                slug: "custom-engraved-silver-cuff",
                price: 899,
                inventory: 20,
                category: "Accessories",
                categories: ["Accessories", "Customized"],
                images: ["/brand/bazaarvilla-mascot.webp"],
                isVisible: true,
                isFeatured: true,
                isCustomized: true,
                customizationType: "requires_name",
                description: "Personalized metallic cuff bracelet with custom name engraving.",
                createdAt: Date.now() - 172800000,
            },
            {
                id: "prod-photo-mug",
                name: "Personalized Ceramic Memory Mug",
                slug: "personalized-ceramic-memory-mug",
                price: 499,
                inventory: 15,
                category: "Living",
                categories: ["Living", "Customized"],
                images: ["/brand/bazaarvilla-logo-horizontal.webp"],
                isVisible: true,
                isFeatured: false,
                isCustomized: true,
                customizationType: "requires_picture",
                description: "High quality gloss ceramic mug customized with customer photo.",
                createdAt: Date.now() - 259200000,
            }
        ];

        for (const p of sampleProducts) {
            await adminDb.collection("products").doc(p.id).set(p);
        }

        // Seed categories
        const sampleCategories = [
            { id: "cat-apparel", name: "Apparel", description: "Ready-to-wear fashion and hoodies", showOnHome: true, order: 1, image: "/brand/bazaarvilla-banner-desktop.webp" },
            { id: "cat-accessories", name: "Accessories", description: "Personalized jewelry and accessories", showOnHome: true, order: 2, image: "/brand/bazaarvilla-mascot.webp" },
            { id: "cat-living", name: "Living", description: "Home decor and customized mugs", showOnHome: false, order: 3, image: "/brand/bazaarvilla-logo-horizontal.webp" },
        ];
        for (const c of sampleCategories) {
            await adminDb.collection("categories").doc(c.id).set(c);
        }

        // Seed orders
        const sampleOrders = [
            {
                id: "ord-live-synthetic-101",
                createdAt: new Date(Date.now() - 3600000),
                total: 1499,
                paymentMethod: "Razorpay",
                paymentStatus: "PAID",
                orderStatus: "Processing",
                shippingAddress: {
                    fullName: "Ananya Sharma",
                    phone: "9876543210",
                    addressLine1: "Flat 402, Green Palms, Powai",
                    city: "Mumbai",
                    state: "Maharashtra",
                    pincode: "400076"
                },
                items: [
                    { name: "Bazaarvilla Signature Green Hoodie", quantity: 1, price: 1499 }
                ]
            },
            {
                id: "ord-live-synthetic-102",
                createdAt: new Date(Date.now() - 7200000),
                total: 899,
                paymentMethod: "COD",
                paymentStatus: "PENDING",
                orderStatus: "Shipped",
                shippingAddress: {
                    fullName: "Rahul Verma",
                    phone: "9811223344",
                    addressLine1: "12/B Sector 14",
                    city: "Gurugram",
                    state: "Haryana",
                    pincode: "122001"
                },
                items: [
                    { name: "Custom Engraved Silver Cuff", quantity: 1, price: 899, customizationData: { name: "Rahul" } }
                ]
            },
            {
                id: "ord-live-synthetic-103",
                createdAt: new Date(Date.now() - 14400000),
                total: 2398,
                paymentMethod: "Razorpay",
                paymentStatus: "PAID",
                orderStatus: "Delivered",
                shippingAddress: {
                    fullName: "Pooja Patel",
                    phone: "9722334455",
                    addressLine1: "B-501 Sunrise Towers",
                    city: "Ahmedabad",
                    state: "Gujarat",
                    pincode: "380015"
                },
                items: [
                    { name: "Bazaarvilla Signature Green Hoodie", quantity: 1, price: 1499 },
                    { name: "Custom Engraved Silver Cuff", quantity: 1, price: 899 }
                ]
            }
        ];
        for (const o of sampleOrders) {
            await adminDb.collection("orders").doc(o.id).set(o);
        }

        // Seed coupons
        const sampleCoupons = [
            { code: "SAVE70", discountType: "percentage", discountValue: 70, usageLimit: 500, timesUsed: 142, isActive: true },
            { code: "FLAT150", discountType: "flat", discountValue: 150, usageLimit: 200, timesUsed: 89, isActive: true },
        ];
        for (const c of sampleCoupons) {
            await adminDb.collection("coupons").doc(c.code).set(c);
        }

        console.log("[Snapshot] Seeded synthetic test records in Firestore!");

        // 3. Start Next.js
        console.log("[Snapshot] Starting Next.js server on port 3333...");
        const nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        nextProcess.stdout.on("data", (d) => {
            const s = d.toString();
            if (s.includes("Ready") || s.includes("started") || s.includes("compiled")) {
                console.log(`[Next.js] ${s.trim()}`);
            }
        });

        await waitForPort(3333, 40000);
        console.log("[Snapshot] Next.js dev server is ready at http://localhost:3333!");

        // 4. Launch Chrome headless with CDP
        console.log("[Snapshot] Launching Chrome Headless...");
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
        await send("Console.enable");

        ws.addEventListener("message", (e) => {
            const data = JSON.parse(e.data);
            if (data.method === "Runtime.consoleAPICalled") {
                const text = data.params?.args?.map(a => a.value || a.description || "").join(" ");
                console.log(`[Browser Console] ${text}`);
            }
        });

        // 5. Navigate to homepage and authenticate
        console.log("[Snapshot] Opening homepage to authenticate...");
        await send("Page.navigate", { url: "http://localhost:3333" });
        await new Promise((r) => setTimeout(r, 3000));

        console.log("[Snapshot] Signing in as admin via window.__EMULATOR_SIGNIN__ in browser...");
        const signInResult = await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    if (typeof window.__EMULATOR_SIGNIN__ === 'function') {
                        await window.__EMULATOR_SIGNIN__('${customToken}');
                        return "SignedInViaCustomToken";
                    }
                    return "__EMULATOR_SIGNIN__ not defined";
                })();
            `,
            awaitPromise: true,
        });
        console.log("[Snapshot] Sign in evaluation:", signInResult);

        console.log("[Snapshot] Waiting for auth confirmation...");
        let signedIn = false;
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 500));
            const check = await send("Runtime.evaluate", {
                expression: `Boolean(document.querySelector('.action-btn.logout-btn') || document.querySelector('.admin-btn'))`,
            });
            if (check?.result?.value) {
                signedIn = true;
                break;
            }
        }
        console.log("[Snapshot] Admin logged in successfully:", signedIn);

        // Helper to capture a screenshot
        async function capture(pageUrl, filename, width, height, isMobile = false) {
            console.log(`[Snapshot] Navigating to ${pageUrl} for ${filename} (${width}x${height})...`);
            await send("Emulation.setDeviceMetricsOverride", {
                width,
                height,
                deviceScaleFactor: 2,
                mobile: isMobile,
            });

            await send("Page.navigate", { url: pageUrl });
            await new Promise((r) => setTimeout(r, 3000));

            const pageInfo = await send("Runtime.evaluate", {
                expression: `JSON.stringify({ url: window.location.href, heading: document.querySelector('h1, h2')?.textContent || '' })`,
            });
            console.log(`[Snapshot] Page info for ${filename}:`, pageInfo?.result?.value);

            const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[Snapshot] Saved ${filePath} (${fs.statSync(filePath).size} bytes)`);
        }

        // Capture Desktop screenshots
        await capture("http://localhost:3333/admin/dashboard", "desktop-admin-dashboard.png", 1440, 900, false);
        await capture("http://localhost:3333/admin/products", "desktop-admin-products.png", 1440, 900, false);
        await capture("http://localhost:3333/admin/orders", "desktop-admin-orders.png", 1440, 900, false);
        await capture("http://localhost:3333/admin/categories", "desktop-admin-categories.png", 1440, 900, false);
        await capture("http://localhost:3333/admin/coupons", "desktop-admin-coupons.png", 1440, 900, false);

        // Capture Mobile (375x812 - standard smartphone)
        await capture("http://localhost:3333/admin/dashboard", "mobile-admin-dashboard.png", 375, 812, true);
        await capture("http://localhost:3333/admin/products", "mobile-admin-products.png", 375, 812, true);
        await capture("http://localhost:3333/admin/orders", "mobile-admin-orders.png", 375, 812, true);
        await capture("http://localhost:3333/admin/categories", "mobile-admin-categories.png", 375, 812, true);
        await capture("http://localhost:3333/admin/coupons", "mobile-admin-coupons.png", 375, 812, true);

        // Edit form on desktop
        console.log("[Snapshot] Opening product edit form on desktop...");
        await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
        await send("Page.navigate", { url: "http://localhost:3333/admin/products" });
        await new Promise((r) => setTimeout(r, 2500));
        await send("Runtime.evaluate", {
            expression: `
                const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Edit') || b.textContent.includes('Add Product'));
                if (editBtn) editBtn.click();
            `
        });
        await new Promise((r) => setTimeout(r, 1500));
        const { data: deskEditData } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "desktop-admin-product-edit.png"), Buffer.from(deskEditData, "base64"));
        console.log(`[Snapshot] Saved desktop-admin-product-edit.png`);

        // Edit form on mobile
        console.log("[Snapshot] Opening product add/edit form on mobile...");
        await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
        await send("Page.navigate", { url: "http://localhost:3333/admin/products" });
        await new Promise((r) => setTimeout(r, 2500));
        await send("Runtime.evaluate", {
            expression: `
                const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Edit') || b.textContent.includes('Add Product'));
                if (editBtn) editBtn.click();
            `
        });
        await new Promise((r) => setTimeout(r, 1500));
        const { data: editData } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        fs.writeFileSync(path.join(outDir, "mobile-admin-product-edit.png"), Buffer.from(editData, "base64"));
        console.log(`[Snapshot] Saved mobile-admin-product-edit.png`);

        ws.close();
        chromeProcess.kill();
        nextProcess.kill();
        emuProcess.kill();
        restoreEnvLocal();
        console.log(`[Snapshot] Successfully captured all "${targetFolder}" screenshots!`);
        process.exit(0);
    } catch (err) {
        console.error("[Snapshot Error]", err);
        try { emuProcess.kill(); } catch {}
        try { restoreEnvLocal(); } catch {}
        process.exit(1);
    }
}

main();
