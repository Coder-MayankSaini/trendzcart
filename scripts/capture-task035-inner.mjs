/**
 * Inner Screenshot Capture for TASK 035
 * Executed inside `firebase emulators:exec`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task035");
fs.mkdirSync(outDir, { recursive: true });

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
    console.log("[TASK-035 QA] Seeding Firestore with reference Gillkart products...");

    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task035-seeder-" + Date.now());
    } catch {
        app = admin.app("task035-seeder");
    }
    const adminAuth = app.auth();
    const adminDb = app.firestore();

    const adminUid = "admin_verified_task035";
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

    // Seed Representative Products with TASK 035 Normalized Descriptions & TASK 034 Dual Prices
    const sampleProducts = [
        {
            id: "prod-heng-balance-lamp",
            name: "Plastic Design Lamp Heng Balance (White)",
            slug: "plastic-design-lamp-heng-balance-white-68173",
            description: "Design Lamp Heng Balance White\n\nFeatures:\n- Magnetic sphere switch\n- Warm ambient LED illumination\n- Durable ABS engineering plastic\n- Modern ellipse silhouette\n\nDimensions: 20cm x 40cm x 7cm\nPower: USB 5V adapter included.",
            price: 1000,
            compareAtPrice: 1330,
            inventory: 500,
            category: "Home Decor",
            imageUrl: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80",
            images: [
                "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80",
                "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=600&q=80",
                "https://images.unsplash.com/photo-1540932239986-30128078f3c5?auto=format&fit=crop&w=600&q=80",
                "https://images.unsplash.com/photo-1517991104123-1d56a6e81ed9?auto=format&fit=crop&w=600&q=80",
            ],
            thumbnails: [
                "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80",
                "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=600&q=80",
                "https://images.unsplash.com/photo-1540932239986-30128078f3c5?auto=format&fit=crop&w=600&q=80",
                "https://images.unsplash.com/photo-1517991104123-1d56a6e81ed9?auto=format&fit=crop&w=600&q=80",
            ],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            attributes: [
                { name: "Material", value: "Plastic" },
                { name: "Type", value: "Desk Lamp" },
            ],
            reviewCount: 32,
            averageRating: 4.9,
            createdAt: Date.now() - 86400000,
        },
        {
            id: "prod-mushak-agarbati-holder",
            name: "Plastic Mushak Agarbati Holder (White)",
            slug: "plastic-mushak-agarbati-holder-white-68186",
            description: "Divine & Unique Design: Features An Intricately Sculpted Mouse Figurine Holding Traditional Offerings With Vibrant Detailing, Bringing A Unique, Auspicious, and Spiritual Aesthetic To Your Space.\n\nVersatile Decor Accent: Perfect For Placing On Office Desks, Living Room Display Shelves, Pooja Rooms, Or Entryways As A Charming Decorative Showpiece.\n\nSturdy & Durable Build: Crafted From High-Quality Solid Material To Provide A Stable, Well-Balanced Base That Rests Securely On Any Flat Surface.\n\nEasy Maintenance: Smooth Surface Allows For Quick and Effortless Dusting To Keep The Showpiece Looking Pristine.\n\nThoughtful Gift Option: A Meaningful and Distinctive Gift Choice For Housewarmings, Festivals, Or Special Occasions For Family and Friends.",
            price: 1000,
            compareAtPrice: 1330,
            inventory: 500,
            category: "Home Decor",
            imageUrl: "https://images.unsplash.com/photo-1584551246679-0daf3d275d0f?auto=format&fit=crop&w=600&q=80",
            images: [
                "https://images.unsplash.com/photo-1584551246679-0daf3d275d0f?auto=format&fit=crop&w=600&q=80"
            ],
            thumbnails: [
                "https://images.unsplash.com/photo-1584551246679-0daf3d275d0f?auto=format&fit=crop&w=600&q=80"
            ],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            attributes: [
                { name: "Material", value: "Plastic" },
                { name: "Type", value: "Decorative Figurine" },
            ],
            reviewCount: 19,
            averageRating: 4.8,
            createdAt: Date.now() - 172800000,
        },
        {
            id: "prod-levitating-moon-lamp",
            name: "Plastic Decorative Lamp Levitating Moon (White)",
            slug: "plastic-decorative-lamp-levitating-moon-white-68173",
            description: "Levitating Moon Lamp 3D Print Technology\n\nMagnetic Levitation: Suspended in mid-air with 360-degree rotation.\n\nWarm & Cool Lighting: Tap sensor switch between warm amber and cool daylight.\n\nEco-Friendly PLA: Non-toxic, high-resolution lunar texture print.\n\nBase Finish: Dark Walnut wood grain with wireless power induction.",
            price: 1200,
            compareAtPrice: 1599,
            inventory: 300,
            category: "Home Decor",
            imageUrl: "https://images.unsplash.com/photo-1532767153582-b1a0e5145009?auto=format&fit=crop&w=600&q=80",
            images: [
                "https://images.unsplash.com/photo-1532767153582-b1a0e5145009?auto=format&fit=crop&w=600&q=80"
            ],
            thumbnails: [
                "https://images.unsplash.com/photo-1532767153582-b1a0e5145009?auto=format&fit=crop&w=600&q=80"
            ],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            attributes: [
                { name: "Material", value: "Plastic" },
                { name: "Type", value: "Decorative Lamp" },
            ],
            reviewCount: 24,
            averageRating: 5.0,
            createdAt: Date.now() - 259200000,
        }
    ];

    for (const prod of sampleProducts) {
        await adminDb.collection("products").doc(prod.id).set(prod);
    }
    console.log(`[TASK-035 QA] Seeded ${sampleProducts.length} representative products.`);

    // Start Next.js on port 3334
    console.log("[TASK-035 QA] Starting Next.js test server on port 3334...");
    const nextProc = spawn("npx", ["next", "dev", "--port", "3334"], {
        env: {
            ...process.env,
            PORT: "3334",
            USE_FIREBASE_EMULATOR: "true",
            NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
            FIREBASE_PROJECT_ID: "demo-trendkartz",
            NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-trendkartz",
            FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
            COMMERCIAL_CHECKOUT_ENABLED: "true",
        },
        shell: true,
        stdio: "inherit",
    });

    let chromeProcess = null;

    try {
        await waitForPort(3334, 45000);
        console.log("[TASK-035 QA] Next.js dev server ready at http://localhost:3334!");

        // Launch Chrome Headless
        console.log("[TASK-035 QA] Launching Chrome Headless...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-task035-" + Date.now());
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
            await new Promise((r) => setTimeout(r, 600));
        };

        const capture = async (filename) => {
            const { data } = await send("Page.captureScreenshot", { format: "png" });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[TASK-035 QA] Captured: ${filename}`);
        };

        const navigate = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 2000));
        };

        // 1. Heng Balance Lamp PDP - Desktop (1440px)
        await setViewport(1440, 900, false);
        await navigate("http://localhost:3334/products/plastic-design-lamp-heng-balance-white-68173");
        await capture("01-heng-lamp-pdp-desktop-1440px.png");

        // 2. Heng Balance Lamp PDP - Mobile (390px)
        await setViewport(390, 844, true);
        await navigate("http://localhost:3334/products/plastic-design-lamp-heng-balance-white-68173");
        await capture("02-heng-lamp-pdp-mobile-390px.png");

        // 3. Mushak Agarbati Holder PDP (Decoded Ampersand & Multi-Paragraphs) - Desktop
        await setViewport(1440, 900, false);
        await navigate("http://localhost:3334/products/plastic-mushak-agarbati-holder-white-68186");
        await capture("03-mushak-holder-pdp-desktop-1440px.png");

        // 4. Mushak Agarbati Holder PDP - Mobile (375px)
        await setViewport(375, 667, true);
        await navigate("http://localhost:3334/products/plastic-mushak-agarbati-holder-white-68186");
        await capture("04-mushak-holder-pdp-mobile-375px.png");

        // 5. Levitating Moon Lamp PDP - Desktop
        await setViewport(1440, 900, false);
        await navigate("http://localhost:3334/products/plastic-decorative-lamp-levitating-moon-white-68173");
        await capture("05-moon-lamp-pdp-desktop-1440px.png");

        // 6. Storefront Catalog Grid showing dual prices & discount badges
        await navigate("http://localhost:3334/products");
        await capture("06-catalog-grid-dual-prices-desktop-1440px.png");

        // 7. Storefront Catalog Grid Mobile (390px)
        await setViewport(390, 844, true);
        await navigate("http://localhost:3334/products");
        await capture("07-catalog-grid-dual-prices-mobile-390px.png");

        console.log("[TASK-035 QA] All 7 browser screenshots captured successfully in docs/screenshots/task035/!");
    } finally {
        if (chromeProcess) chromeProcess.kill();
        nextProc.kill();
    }
}

main().catch((err) => {
    console.error("[TASK-035 QA Error]:", err);
    process.exit(1);
});
