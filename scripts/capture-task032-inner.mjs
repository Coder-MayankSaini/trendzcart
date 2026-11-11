/**
 * Inner Screenshot Capture for TASK 032
 * Executed inside `firebase emulators:exec`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const outDir = path.join(process.cwd(), "docs", "screenshots", "task032");
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
    console.log("[TASK-032 QA] Emulator is running! Seeding Firestore data...");

    // 1. Seed data
    const { default: admin } = await import("firebase-admin");
    let app;
    try {
        app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task032-seeder-" + Date.now());
    } catch {
        app = admin.app("task032-seeder");
    }
    const adminAuth = app.auth();
    const adminDb = app.firestore();

    const adminUid = "admin_verified_task032";
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

    // Seed multiple products to demonstrate search and selection
    const sampleProducts = [
        {
            id: "bazaarvilla-cramease-pro-massager-belt",
            name: "CrampEase Pro Period Pain Relief Massager Belt",
            slug: "crampease-pro-period-pain-relief-massager-belt",
            description: "Advanced thermal heating and multi-frequency vibration massage belt designed for rapid abdominal and lower back menstrual pain relief. Features intelligent temperature control and rechargeable battery.",
            price: 1499,
            inventory: 85,
            category: "Wellness & Personal Care",
            images: ["https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            reviewCount: 12,
            averageRating: 4.8,
            createdAt: Date.now() - 86400000,
        },
        {
            id: "bazaarvilla-luxe-velvet-cushion-cover",
            name: "Bazaarvilla Luxe Velvet Cushion Cover (Set of 2)",
            slug: "bazaarvilla-luxe-velvet-cushion-cover",
            description: "Handcrafted premium velvet cushion covers with invisible zipper and reinforced stitching.",
            price: 699,
            inventory: 40,
            category: "Home Decor",
            images: ["https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isCustomized: false,
            hasVariants: false,
            reviewCount: 5,
            averageRating: 4.6,
            createdAt: Date.now() - 172800000,
        },
        {
            id: "bazaarvilla-classic-cotton-hoodie",
            name: "Bazaarvilla Signature Heavyweight Cotton Hoodie",
            slug: "bazaarvilla-signature-heavyweight-cotton-hoodie",
            description: "380 GSM brushed fleece cotton hoodie with double-stitched kangaroo pocket and brass drawstring eyelets.",
            price: 1899,
            inventory: 60,
            category: "Apparel",
            images: ["https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80"],
            isVisible: true,
            isCustomized: false,
            hasVariants: true,
            sizes: ["S", "M", "L", "XL"],
            colors: [{ name: "Forest Green", hex: "#1B4D3E" }, { name: "Onyx Black", hex: "#000000" }],
            reviewCount: 8,
            averageRating: 4.9,
            createdAt: Date.now() - 259200000,
        },
    ];

    for (const p of sampleProducts) {
        await adminDb.collection("products").doc(p.id).set(p);
    }

    console.log("[TASK-032 QA] Seeded admin user and 3 catalog products.");

    // 2. Start Next.js dev server on port 3333
    console.log("[TASK-032 QA] Starting Next.js dev server on port 3333...");
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
        console.log("[TASK-032 QA] Next.js dev server ready at http://localhost:3333!");

        // 3. Launch Chrome Headless
        console.log("[TASK-032 QA] Launching Chrome Headless...");
        const chromeProfile = path.join(process.cwd(), ".chrome-profile-task032-" + Date.now());
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
        console.log("[TASK-032 QA] Navigating to homepage to authenticate as admin...");
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

        // Step B: Navigate to Admin Reviews
        console.log("[TASK-032 QA] Navigating to /admin/reviews...");
        await navigateTo("http://localhost:3333/admin/reviews");
        await new Promise((r) => setTimeout(r, 2000));

        // SCENARIO 1: Desktop 1440px - Admin Reviews Overview with Product Selector and Generator Toolbar
        console.log("[Visual QA 1/9] Capturing Admin Reviews Overview at 1440px...");
        await setViewport(1440, 900, false);
        await capture("01-admin-review-generator-overview-desktop-1440px.png");

        // SCENARIO 2: Product Search Filtering
        console.log("[Visual QA 2/9] Capturing Product Search Filtering...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const searchInput = document.getElementById('product-search');
                    if (searchInput) {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(searchInput, "CrampEase");
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));
        await capture("02-admin-product-search-filtering-desktop-1440px.png");

        // Clear search for subsequent scenarios
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const searchInput = document.getElementById('product-search');
                    if (searchInput) {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(searchInput, "");
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 500));

        // SCENARIO 3: Open AI Prompt Preview Modal
        console.log("[Visual QA 3/9] Capturing AI Prompt Preview Modal...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const viewPromptBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('View Prompt'));
                    if (viewPromptBtn) viewPromptBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));
        await capture("03-admin-review-prompt-modal-desktop-1440px.png");

        // Close prompt modal
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const closeBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && (b.textContent.includes('Close') || b.textContent.includes('×')));
                    if (closeBtns.length > 0) closeBtns[closeBtns.length - 1].click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));

        // SCENARIO 4: Load JSON Template into Editor
        console.log("[Visual QA 4/9] Capturing Load Template into Editor...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const loadBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Load into Editor'));
                    if (loadBtn) loadBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 800));
        await capture("04-admin-template-loaded-into-editor-desktop-1440px.png");

        // SCENARIO 5: Validate Template with Placeholder Detection
        console.log("[Visual QA 5/9] Capturing Validation Placeholder Detection...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const validateBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Validate Review Batch'));
                    if (validateBtn) validateBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 2000));
        await capture("05-admin-validation-placeholder-detection-desktop-1440px.png");

        // SCENARIO 6: Genuine Reviews Batch (Valid & Eligible)
        console.log("[Visual QA 6/9] Capturing Genuine Customer Feedback Validation...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const select = document.getElementById('product-select');
                    const productId = select ? select.value : 'bazaarvilla-cramease-pro-massager-belt';
                    const genuineBatch = {
                        productId: productId,
                        reviews: [
                            {
                                externalReviewId: "OFFLINE-EXPO-101",
                                reviewerDisplayName: "Ananya Iyer",
                                rating: 5,
                                title: "Instant Relief During Travel",
                                body: "Bought this at the Bangalore wellness pop-up. The heating mode relaxes cramping within 5 minutes. Battery lasts all day.",
                                reviewedAt: "2026-11-08",
                                source: "offline-customer-feedback",
                                sourceReference: "EXPO-RECEIPT-BLR-101",
                                customerConsentConfirmed: true
                            },
                            {
                                externalReviewId: "WA-FEEDBACK-204",
                                reviewerDisplayName: "Sneha Nair",
                                rating: 5,
                                title: "Very Comfortable & Discreet",
                                body: "Lightweight enough to wear under work clothes. Vibration modes are quiet and soothing.",
                                reviewedAt: "2026-11-09",
                                source: "offline-customer-feedback",
                                sourceReference: "WA-CHAT-ORD-8821",
                                customerConsentConfirmed: true
                            }
                        ]
                    };
                    const textarea = document.getElementById('json-textarea');
                    if (textarea) {
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        setter.call(textarea, JSON.stringify(genuineBatch, null, 2));
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 500));

        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const validateBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Validate Review Batch'));
                    if (validateBtn) validateBtn.click();
                })()
            `,
        });
        await new Promise((r) => setTimeout(r, 2000));
        await capture("06-admin-genuine-batch-validation-eligible-desktop-1440px.png");

        // SCENARIO 7: Tablet 768px View
        console.log("[Visual QA 7/9] Capturing Tablet 768px View...");
        await setViewport(768, 1024, false);
        await capture("07-admin-review-generator-tablet-768px.png");

        // SCENARIO 8: Mobile 375px View
        console.log("[Visual QA 8/9] Capturing Mobile 375px View...");
        await setViewport(375, 812, true);
        await capture("08-admin-review-generator-mobile-375px.png");

        // SCENARIO 9: Ultra-Compact 320px View
        console.log("[Visual QA 9/9] Capturing Mobile 320px View...");
        await setViewport(320, 568, true);
        await capture("09-admin-review-generator-mobile-320px.png");

        console.log("[TASK-032 QA] All 9 visual QA screenshots captured successfully!");
    } finally {
        if (chromeProcess) {
            chromeProcess.kill();
        }
        if (nextProcess) {
            nextProcess.kill();
        }
    }
}

main().catch((err) => {
    console.error("[TASK-032 QA Fatal Error]:", err);
    process.exit(1);
});
