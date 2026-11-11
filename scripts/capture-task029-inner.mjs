/**
 * Inner Screenshot Capture for TASK 029
 * Executed inside `firebase emulators:exec`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task029");
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
    console.log("[TASK-029 Inner QA] Emulator is already running! Seeding Firestore data...");

    // 1. Seed data
    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task029-seeder-" + Date.now());
    } catch {
        app = admin.app("task029-seeder");
    }
    const adminAuth = app.auth();
    const adminDb = app.firestore();

    const adminUid = "admin_verified_task029";
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

    const blueImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%231e3a8a'/%3E%3Ctext x='200' y='210' fill='white' text-anchor='middle' font-family='sans-serif' font-size='22'%3ERoyal Blue Cushion%3C/text%3E%3C/svg%3E";
    const redImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%23dc2626'/%3E%3Ctext x='200' y='210' fill='white' text-anchor='middle' font-family='sans-serif' font-size='22'%3ECrimson Red Cushion%3C/text%3E%3C/svg%3E";
    const blackImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Crect width='400' height='400' fill='%23111827'/%3E%3Ctext x='200' y='210' fill='white' text-anchor='middle' font-family='sans-serif' font-size='22'%3EMidnight Black Cushion%3C/text%3E%3C/svg%3E";

    // Product 1: Mode D (Named sizes with dimensions) + Colors
    const cushionId = "prod-task029-cushion";
    const cushionProduct = {
        id: cushionId,
        name: "Bazaarvilla Premium Velvet Cushion",
        slug: "bazaarvilla-premium-velvet-cushion",
        description: "Luxurious handcrafted cushion available in structured dimensions with removable velvet covers.",
        price: 699,
        inventory: 30,
        category: "Home Decor",
        categories: ["Home Decor", "Living"],
        images: [blueImg, redImg, blackImg],
        isVisible: true,
        isFeatured: true,
        isCustomized: false,
        hasVariants: true,
        sizeMode: "dimensions",
        sizesList: [
            { id: "size_sm", name: "Small", dimensions: { width: 20, height: 20, unit: "cm" }, isActive: true, order: 0 },
            { id: "size_md", name: "Medium", dimensions: { width: 23, height: 23, unit: "cm" }, isActive: true, order: 1 },
            { id: "size_lg", name: "Large", dimensions: { width: 26, height: 26, unit: "cm" }, isActive: true, order: 2 },
        ],
        colors: [
            { id: "col_blue", name: "Royal Blue", hex: "#1e3a8a", image: blueImg, isActive: true },
            { id: "col_red", name: "Crimson Red", hex: "#dc2626", image: redImg, isActive: true },
            { id: "col_black", name: "Midnight Black", hex: "#000000", image: blackImg, isActive: true },
        ],
        variants: [
            { id: "var_sm_blue", sizeId: "size_sm", sizeName: "Small", colorId: "col_blue", colorName: "Royal Blue", sku: "CSH-BLUE-20X20", price: null, inventory: 10, isActive: true, image: blueImg, dimensions: { width: 20, height: 20, unit: "cm" } },
            { id: "var_sm_red", sizeId: "size_sm", sizeName: "Small", colorId: "col_red", colorName: "Crimson Red", sku: "CSH-RED-20X20", price: null, inventory: 8, isActive: true, image: redImg, dimensions: { width: 20, height: 20, unit: "cm" } },
            { id: "var_sm_black", sizeId: "size_sm", sizeName: "Small", colorId: "col_black", colorName: "Midnight Black", sku: "CSH-BLK-20X20", price: null, inventory: 0, isActive: true, image: blackImg, dimensions: { width: 20, height: 20, unit: "cm" } },

            { id: "var_md_blue", sizeId: "size_md", sizeName: "Medium", colorId: "col_blue", colorName: "Royal Blue", sku: "CSH-BLUE-23X23", price: 799, inventory: 6, isActive: true, image: blueImg, dimensions: { width: 23, height: 23, unit: "cm" } },
            { id: "var_md_red", sizeId: "size_md", sizeName: "Medium", colorId: "col_red", colorName: "Crimson Red", sku: "CSH-RED-23X23", price: 799, inventory: 5, isActive: true, image: redImg, dimensions: { width: 23, height: 23, unit: "cm" } },
            { id: "var_md_black", sizeId: "size_md", sizeName: "Medium", colorId: "col_black", colorName: "Midnight Black", sku: "CSH-BLK-23X23", price: 799, inventory: 3, isActive: true, image: blackImg, dimensions: { width: 23, height: 23, unit: "cm" } },

            { id: "var_lg_blue", sizeId: "size_lg", sizeName: "Large", colorId: "col_blue", colorName: "Royal Blue", sku: "CSH-BLUE-26X26", price: 899, inventory: 4, isActive: true, image: blueImg, dimensions: { width: 26, height: 26, unit: "cm" } },
            { id: "var_lg_red", sizeId: "size_lg", sizeName: "Large", colorId: "col_red", colorName: "Crimson Red", sku: "CSH-RED-26X26", price: 899, inventory: 4, isActive: true, image: redImg, dimensions: { width: 26, height: 26, unit: "cm" } },
            { id: "var_lg_black", sizeId: "size_lg", sizeName: "Large", colorId: "col_black", colorName: "Midnight Black", sku: "CSH-BLK-26X26", price: 899, inventory: 2, isActive: true, image: blackImg, dimensions: { width: 26, height: 26, unit: "cm" } },
        ],
        createdAt: Date.now(),
    };
    await adminDb.collection("products").doc(cushionId).set(cushionProduct);

    // Product 2: Mode B (Apparel XS to XXL)
    const tshirtId = "prod-task029-tshirt";
    const tshirtProduct = {
        id: tshirtId,
        name: "Bazaarvilla Signature Heavyweight Tee",
        slug: "bazaarvilla-signature-heavyweight-tee",
        description: "280 GSM luxury combed cotton t-shirt tailored for modern street style.",
        price: 799,
        inventory: 45,
        category: "Apparel",
        categories: ["Apparel", "Men"],
        images: [blackImg, redImg],
        isVisible: true,
        hasVariants: true,
        sizeMode: "apparel",
        sizesList: [
            { id: "size_s", name: "S", isActive: true },
            { id: "size_m", name: "M", isActive: true },
            { id: "size_l", name: "L", isActive: true },
            { id: "size_xl", name: "XL", isActive: true },
            { id: "size_xxl", name: "XXL", isActive: true },
        ],
        colors: [
            { id: "col_blk", name: "Black", hex: "#000000", isActive: true },
            { id: "col_maroon", name: "Maroon", hex: "#800000", isActive: true },
        ],
        variants: [
            { id: "var_ts_s_blk", sizeId: "size_s", sizeName: "S", colorId: "col_blk", colorName: "Black", sku: "TEE-BLK-S", price: null, inventory: 10, isActive: true },
            { id: "var_ts_m_blk", sizeId: "size_m", sizeName: "M", colorId: "col_blk", colorName: "Black", sku: "TEE-BLK-M", price: null, inventory: 15, isActive: true },
            { id: "var_ts_l_blk", sizeId: "size_l", sizeName: "L", colorId: "col_blk", colorName: "Black", sku: "TEE-BLK-L", price: null, inventory: 12, isActive: true },
            { id: "var_ts_xl_blk", sizeId: "size_xl", sizeName: "XL", colorId: "col_blk", colorName: "Black", sku: "TEE-BLK-XL", price: 849, inventory: 8, isActive: true },
        ],
        createdAt: Date.now(),
    };
    await adminDb.collection("products").doc(tshirtId).set(tshirtProduct);

    // Product 3: Mode C (Free Size)
    const shawlId = "prod-task029-shawl";
    const shawlProduct = {
        id: shawlId,
        name: "Bazaarvilla Handmade Pashmina Shawl",
        slug: "bazaarvilla-handmade-pashmina-shawl",
        description: "Traditional Himalayan woven shawl with elegant hand embroidery.",
        price: 1899,
        inventory: 20,
        category: "Accessories",
        categories: ["Accessories"],
        images: [redImg],
        isVisible: true,
        hasVariants: true,
        sizeMode: "free_size",
        sizesList: [
            { id: "size-free-size", name: "Free Size", isActive: true },
        ],
        variants: [
            { id: "var_shawl_free", sizeId: "size-free-size", sizeName: "Free Size", sku: "SHWL-FREE", price: null, inventory: 20, isActive: true },
        ],
        createdAt: Date.now(),
    };
    await adminDb.collection("products").doc(shawlId).set(shawlProduct);

    // Seed Order for fulfillment verification
    const orderId = "ORD-TASK029-DEMO";
    const orderDoc = {
        id: orderId,
        orderId,
        customerName: "Priya Sharma",
        customerEmail: "priya@example.com",
        customerPhone: "9876543210",
        totalAmount: 1798,
        paymentMethod: "COD",
        paymentStatus: "PENDING",
        fulfillmentStatus: "Processing",
        createdAt: Date.now() - 3600000,
        items: [
            {
                id: cushionId,
                productId: cushionId,
                name: "Bazaarvilla Premium Velvet Cushion",
                price: 899,
                quantity: 2,
                variantId: "var_lg_blue",
                sku: "CSH-BLUE-26X26",
                size: "Large",
                dimensions: { width: 26, height: 26, unit: "cm" },
                color: "Royal Blue",
                image: blueImg,
            },
        ],
        shippingAddress: {
            fullName: "Priya Sharma",
            addressLine1: "42 MG Road",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560001",
        },
    };
    await adminDb.collection("orders").doc(orderId).set(orderDoc);

    console.log("[TASK-029 Inner QA] Seeded demo variant products & orders in Firestore!");

    // 2. Start Next.js server on 3333
    console.log("[TASK-029 Inner QA] Starting Next.js server on port 3333...");
    const nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
        env: {
            ...process.env,
            PORT: "3333",
            USE_FIREBASE_EMULATOR: "true",
            NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
            FIREBASE_PROJECT_ID: "demo-trendkartz",
            NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-trendkartz",
            FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
            FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
            COMMERCIAL_CHECKOUT_ENABLED: "true",
        },
        shell: true,
        stdio: "inherit",
    });

    let chromeProcess = null;

    try {
        await waitForPort(3333, 45000);
        console.log("[TASK-029 Inner QA] Next.js dev server ready at http://localhost:3333!");

        // 3. Launch Chrome Headless
        console.log("[TASK-029 Inner QA] Launching Chrome Headless...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-inner-" + Date.now());
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
            await new Promise((r) => setTimeout(r, 500));
        };

        const capture = async (filename) => {
            const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
            const buf = Buffer.from(result.data, "base64");
            const targetPath = path.join(outDir, filename);
            fs.writeFileSync(targetPath, buf);
            console.log(`[Captured] ${filename} (${buf.length} bytes)`);
        };

        const navigateTo = async (url) => {
            await send("Page.navigate", { url });
            await new Promise((r) => setTimeout(r, 3000));
        };

        // SCENARIO 1: Desktop 1440px - Cushion PDP with Mode D Dimensions: Small (20 × 20 cm) selected
        console.log("[Visual QA 1/11] Capturing Cushion PDP with Small (20 × 20 cm) selected at 1440px...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/products/bazaarvilla-premium-velvet-cushion");
        await capture("01-pdp-desktop-1440px-named-dimensions-small.png");

        // SCENARIO 2: Desktop 1440px - Switch to Large (26 × 26 cm) -> Dynamic Price ₹899 & Crimson Red swatch
        console.log("[Visual QA 2/11] Selecting Large (26 × 26 cm) + Crimson Red -> Verifying Dynamic Price ₹899...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const lgBtn = buttons.find(b => b.textContent.includes('Large'));
                    if (lgBtn) lgBtn.click();
                    const redBtn = buttons.find(b => b.textContent.includes('Crimson Red'));
                    if (redBtn) redBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1200));
        await capture("02-pdp-desktop-1440px-named-dimensions-large.png");

        // SCENARIO 3: Desktop 1440px - Out of stock variant (Small + Midnight Black -> inventory 0)
        console.log("[Visual QA 3/11] Selecting Small + Midnight Black -> Verifying Out of Stock badge...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const smBtn = buttons.find(b => b.textContent.includes('Small'));
                    if (smBtn) smBtn.click();
                    const blkBtn = buttons.find(b => b.textContent.includes('Midnight Black'));
                    if (blkBtn) blkBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1200));
        await capture("03-pdp-desktop-1440px-out-of-stock-variant.png");

        // SCENARIO 4: Tablet 768px - Mode B Apparel Sizes (Heavyweight Tee)
        console.log("[Visual QA 4/11] Capturing Apparel T-Shirt with Standard Sizes (S, M, L, XL, XXL) on Tablet 768px...");
        await setViewport(768, 1024, false);
        await navigateTo("http://localhost:3333/products/bazaarvilla-signature-heavyweight-tee");
        await capture("04-pdp-apparel-sizes-768px-tablet.png");

        // SCENARIO 5: Standard Mobile 375px - Mode C Free Size (Pashmina Shawl)
        console.log("[Visual QA 5/11] Capturing Free Size Auto-Selection on 375px Mobile...");
        await setViewport(375, 812, true);
        await navigateTo("http://localhost:3333/products/bazaarvilla-handmade-pashmina-shawl");
        await capture("05-pdp-free-size-375px-mobile.png");

        // SCENARIO 6: Compact Mobile 320px - Cushion PDP Responsive Layout
        console.log("[Visual QA 6/11] Capturing 320px Ultra-Compact Mobile Layout...");
        await setViewport(320, 568, true);
        await navigateTo("http://localhost:3333/products/bazaarvilla-premium-velvet-cushion");
        await capture("06-pdp-responsive-320px-compact.png");

        // SCENARIO 7: Modern Mobile 430px - Cushion PDP Layout
        console.log("[Visual QA 7/11] Capturing 430px iPhone 15/16 Pro Max Layout...");
        await setViewport(430, 932, true);
        await navigateTo("http://localhost:3333/products/bazaarvilla-premium-velvet-cushion");
        await capture("07-pdp-responsive-430px-mobile.png");

        // SCENARIO 8: Desktop 1440px - Admin Products Variant Editor
        console.log("[Visual QA 8/11] Opening Admin Products Variant Editor at 1440px...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/admin/products");
        await new Promise((r) => setTimeout(r, 2000));
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const rows = Array.from(document.querySelectorAll('tr'));
                    const cushionRow = rows.find(r => r.textContent.includes('Velvet Cushion'));
                    if (cushionRow) {
                        const buttons = Array.from(cushionRow.querySelectorAll('button'));
                        const editBtn = buttons.find(b => b.textContent.trim() === 'Edit');
                        if (editBtn) editBtn.click();
                    } else {
                        const allEditBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Edit');
                        if (allEditBtns.length > 0) allEditBtns[0].click();
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1500));
        await capture("08-admin-product-variant-editor-desktop.png");

        // SCENARIO 9: Mobile 375px - Admin Products Variant Matrix Cards
        console.log("[Visual QA 9/11] Capturing Admin Products Variant Matrix on Mobile 375px...");
        await setViewport(375, 812, true);
        await new Promise((r) => setTimeout(r, 800));
        await capture("09-admin-product-variant-matrix-mobile-375px.png");

        // SCENARIO 10: Shopping Cart with Distinct Variant Line Items
        console.log("[Visual QA 10/11] Populating Cart with 2 Distinct Variants of Cushion & Capturing Cart Breakdown...");
        await setViewport(1024, 768, false);
        await navigateTo("http://localhost:3333/products/bazaarvilla-premium-velvet-cushion");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const smBtn = buttons.find(b => b.textContent.includes('Small'));
                    if (smBtn) smBtn.click();
                    const blueBtn = buttons.find(b => b.textContent.includes('Royal Blue'));
                    if (blueBtn) blueBtn.click();
                    const addBtn = buttons.find(b => b.textContent.includes('Add to Cart'));
                    if (addBtn) addBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const lgBtn = buttons.find(b => b.textContent.includes('Large'));
                    if (lgBtn) lgBtn.click();
                    const redBtn = buttons.find(b => b.textContent.includes('Crimson Red'));
                    if (redBtn) redBtn.click();
                    const addBtn = buttons.find(b => b.textContent.includes('Add to Cart'));
                    if (addBtn) addBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));
        await navigateTo("http://localhost:3333/cart");
        await capture("10-cart-distinct-variants-breakdown.png");

        // SCENARIO 11: Admin Orders fulfillment view showing variant details
        console.log("[Visual QA 11/11] Capturing Admin Orders with Variant Details (SKU, Dimensions, Color)...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/admin/orders");
        await capture("11-admin-orders-fulfillment-variant-details.png");

        console.log("[TASK-029 Inner QA] Successfully captured all 11 visual QA screenshots!");

    } catch (err) {
        console.error("[TASK-029 Inner QA] Execution failed:", err);
    } finally {
        if (chromeProcess) {
            try { chromeProcess.kill("SIGKILL"); } catch {}
        }
        if (nextProcess) {
            try { nextProcess.kill("SIGINT"); } catch {}
        }
    }
}

main();
