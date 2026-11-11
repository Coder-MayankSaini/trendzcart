/**
 * Inner Screenshot Capture for TASK 030
 * Executed inside `firebase emulators:exec`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task030");
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
    console.log("[TASK-030 QA] Emulator is running! Seeding Firestore data...");

    // 1. Seed data
    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task030-seeder-" + Date.now());
    } catch {
        app = admin.app("task030-seeder");
    }
    const adminAuth = app.auth();
    const adminDb = app.firestore();

    const adminUid = "admin_verified_task030";
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

    // Seed existing product to demonstrate Update & Conflict detection in preview
    const existingCushionId = "prod-existing-cushion";
    await adminDb.collection("products").doc(existingCushionId).set({
        id: existingCushionId,
        name: "Bazaarvilla Luxe Velvet Cushion",
        slug: "bazaarvilla-luxe-cushion",
        description: "Handcrafted cushion with velvet fabric.",
        price: 599,
        inventory: 15,
        category: "Home Decor",
        images: ["https://images.unsplash.com/photo-1584100936595-c0654b55a2e2"],
        isVisible: true,
        isCustomized: false,
        hasVariants: false,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 3600000,
    });

    // Seed a past audit batch for the Audit History view
    await adminDb.collection("productImportBatches").doc("batch-audit-sample-001").set({
        batchId: "batch-audit-sample-001",
        adminUid: adminUid,
        adminEmail: "admin@trendkartz.test",
        sourceFormat: "shopify_standard",
        mode: "create_and_update",
        fileChecksum: "a1b2c3d4e5f67890123456789abcdef0",
        totalRows: 12,
        totalProducts: 4,
        createdCount: 3,
        updatedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        r2ImagesIngested: 8,
        status: "completed",
        startedAt: Date.now() - 7200000,
        completedAt: Date.now() - 7195000,
        createdAt: Date.now() - 7200000,
        errors: [],
        warnings: [],
    });

    console.log("[TASK-030 QA] Seeded admin user, existing product, and audit batch.");

    // 2. Start Next.js dev server on port 3333
    console.log("[TASK-030 QA] Starting Next.js dev server on port 3333...");
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
        await waitForPort(3333, 45000);
        console.log("[TASK-030 QA] Next.js dev server ready at http://localhost:3333!");

        // 3. Launch Chrome Headless
        console.log("[TASK-030 QA] Launching Chrome Headless...");
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
            await new Promise((r) => setTimeout(r, 3500));
        };

        // Step A: Sign in as Admin via Homepage Auth Modal
        console.log("[TASK-030 QA] Navigating to homepage to authenticate as admin...");
        await setViewport(1440, 900, false);
        await navigateTo("http://localhost:3333/");

        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const signinBtn = document.querySelector('.login-btn') || Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Sign In'));
                    if (signinBtn) signinBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));

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

        // Step B: Navigate to Admin Products
        console.log("[TASK-030 QA] Navigating to /admin/products...");
        await navigateTo("http://localhost:3333/admin/products");
        await new Promise((r) => setTimeout(r, 2000));

        // SCENARIO 1: Desktop 1440px - Admin Products Catalog with "Import CSV" button
        console.log("[Visual QA 1/15] Capturing Admin Products Catalog with Import CSV button at 1440px...");
        await setViewport(1440, 900, false);
        await capture("01-admin-products-catalog-with-import-csv-desktop-1440px.png");

        // SCENARIO 2: Tablet 768px - Admin Products Catalog
        console.log("[Visual QA 2/15] Capturing Admin Products Catalog at Tablet 768px...");
        await setViewport(768, 1024, false);
        await capture("02-admin-products-catalog-tablet-768px.png");

        // SCENARIO 3: Mobile 375px - Admin Products Catalog
        console.log("[Visual QA 3/15] Capturing Admin Products Catalog at Mobile 375px...");
        await setViewport(375, 812, true);
        await capture("03-admin-products-catalog-mobile-375px.png");

        // SCENARIO 4: Ultra-Compact 320px - Admin Products Catalog
        console.log("[Visual QA 4/15] Capturing Admin Products Catalog at Ultra-Compact 320px...");
        await setViewport(320, 568, true);
        await capture("04-admin-products-catalog-mobile-320px.png");

        // SCENARIO 5: Desktop 1440px - Open Import Modal (Step 1: Upload CSV)
        console.log("[Visual QA 5/15] Opening Product Import Modal (Step 1) at 1440px...");
        await setViewport(1440, 900, false);
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const importBtn = buttons.find(b => b.textContent && b.textContent.includes('Import CSV'));
                    if (importBtn) importBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1000));
        await capture("05-import-modal-step1-upload-desktop-1440px.png");

        // SCENARIO 6: Mobile 375px - Import Modal Step 1
        console.log("[Visual QA 6/15] Capturing Import Modal Step 1 at Mobile 375px...");
        await setViewport(375, 812, true);
        await capture("06-import-modal-step1-upload-mobile-375px.png");

        // SCENARIO 7: Ultra-Compact 320px - Import Modal Step 1
        console.log("[Visual QA 7/15] Capturing Import Modal Step 1 at Ultra-Compact 320px...");
        await setViewport(320, 568, true);
        await capture("07-import-modal-step1-upload-mobile-320px.png");

        // SCENARIO 8: Modern Mobile 430px - Import Modal Step 1
        console.log("[Visual QA 8/15] Capturing Import Modal Step 1 at Modern Mobile 430px...");
        await setViewport(430, 932, true);
        await capture("08-import-modal-step1-mobile-430px.png");

        // SCENARIO 9: Tablet 1024px - Import Modal Step 1
        console.log("[Visual QA 9/15] Capturing Import Modal Step 1 at Tablet 1024px...");
        await setViewport(1024, 768, false);
        await capture("09-import-modal-step1-tablet-1024px.png");

        // SCENARIO 10: Step 2 Column Mapping & Format Detection (Desktop 1440px)
        console.log("[Visual QA 10/15] Supplying Shopify CSV and Analyzing Mapping...");
        await setViewport(1440, 900, false);
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const csvData = \`Handle,Title,Body (HTML),Vendor,Type,Tags,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Variant Inventory Qty,Image Src,Cost per item
bazaarvilla-luxe-cushion,Bazaarvilla Luxe Velvet Cushion,<p>Handmade cushion with velvet fabric.</p>,Bazaarvilla,Home Decor,"cushion, velvet",Size,Small (20x20 cm),Color,Royal Blue,LUX-SM-BLU,699,15,https://images.unsplash.com/photo-1584100936595-c0654b55a2e2,250
bazaarvilla-luxe-cushion,Bazaarvilla Luxe Velvet Cushion,<p>Handmade cushion with velvet fabric.</p>,Bazaarvilla,Home Decor,"cushion, velvet",Size,Large (26x26 cm),Color,Royal Blue,LUX-LG-BLU,899,20,https://images.unsplash.com/photo-1584100936595-c0654b55a2e2,350
bazaarvilla-signature-hoodie,Bazaarvilla Heavyweight Organic Hoodie,<p>100% heavy organic fleece cotton</p>,Bazaarvilla,Apparel,"hoodie, organic",Size,M,Color,Midnight Black,HOD-M-BLK,1999,25,https://images.unsplash.com/photo-1556905055-8f358a7a47b2,800
bazaarvilla-signature-hoodie,Bazaarvilla Heavyweight Organic Hoodie,<p>100% heavy organic fleece cotton</p>,Bazaarvilla,Apparel,"hoodie, organic",Size,L,Color,Midnight Black,HOD-L-BLK,1999,30,https://images.unsplash.com/photo-1556905055-8f358a7a47b2,800\`;

                    const file = new File([csvData], "shopify-catalog-export.csv", { type: "text/csv" });
                    const input = document.querySelector('input[type="file"][accept*="csv"]');
                    if (input) {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        input.files = dt.files;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));

        // Click "Analyze & Inspect Mapping"
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => b.textContent && b.textContent.includes('Analyze & Inspect Mapping'));
                    if (btn) btn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 2500));
        await capture("10-import-modal-step2-mapping-desktop-1440px.png");

        // SCENARIO 11: Step 3 Dry-Run Preview (Desktop 1440px)
        console.log("[Visual QA 11/15] Advancing to Step 3: Dry-Run Preview at 1440px...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => b.textContent && b.textContent.includes('Proceed to Dry-Run Preview'));
                    if (btn) btn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1200));
        await capture("11-import-modal-step3-preview-dryrun-desktop-1440px.png");

        // SCENARIO 12: Step 3 Dry-Run Preview (Mobile 375px)
        console.log("[Visual QA 12/15] Capturing Dry-Run Preview at Mobile 375px...");
        await setViewport(375, 812, true);
        await capture("12-import-modal-step3-preview-mobile-375px.png");

        // SCENARIO 13: Step 3 Dry-Run Preview (Ultra-Compact 320px)
        console.log("[Visual QA 13/15] Capturing Dry-Run Preview at Ultra-Compact 320px...");
        await setViewport(320, 568, true);
        await capture("13-import-modal-step3-preview-mobile-320px.png");

        // SCENARIO 14: Step 4 Confirmation Screen (Desktop 1440px)
        console.log("[Visual QA 14/15] Advancing to Step 4: Administrator Explicit Confirmation at 1440px...");
        await setViewport(1440, 900, false);
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => b.textContent && b.textContent.includes('Proceed to Confirmation'));
                    if (btn) btn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 1200));
        await capture("14-import-modal-step4-confirmation-desktop-1440px.png");

        // SCENARIO 15: Audit History View (Desktop 1440px)
        console.log("[Visual QA 15/15] Opening Audit History tab at 1440px...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const btn = buttons.find(b => b.textContent && b.textContent.includes('Audit History'));
                    if (btn) btn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 2000));
        await capture("15-import-modal-audit-history-desktop-1440px.png");

        console.log("[TASK-030 QA] Successfully captured all 15 visual QA screenshots!");

    } catch (err) {
        console.error("[TASK-030 QA] Screenshot capture error:", err);
        throw err;
    } finally {
        if (chromeProcess) {
            console.log("[TASK-030 QA] Terminating Chrome...");
            chromeProcess.kill();
        }
        if (nextProcess) {
            console.log("[TASK-030 QA] Terminating Next.js dev server...");
            nextProcess.kill();
        }
    }
}

main().catch((err) => {
    console.error("[TASK-030 QA] Fatal:", err);
    process.exit(1);
});
