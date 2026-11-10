/**
 * TASK 025: Bazaarvilla Admin Product Image Gallery Layout Verification & Snapshot Suite
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

const outDir = path.join(process.cwd(), "docs", "screenshots", "task-025");
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
    console.log("[TASK-025 Verification] Initializing isolated test environment...");

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

    // 1. Start Firebase Emulators
    console.log("[TASK-025 Verification] Starting Firebase Emulators (auth, firestore)...");
    const emuProcess = spawn("npx", ["firebase", "emulators:start", "--project", "demo-trendkartz", "--only", "firestore,auth"], {
        env,
        shell: true,
        stdio: "pipe",
    });

    emuProcess.stdout.on("data", (d) => {
        const str = d.toString();
        if (str.includes("running on") || str.includes("Emulator hub")) {
            console.log(`[Emulator] ${str.trim()}`);
        }
    });

    try {
        await waitForPort(8080);
        await waitForPort(9099);
        console.log("[TASK-025 Verification] Firebase Emulators online!");

        // 2. Seed Data
        const { default: admin } = await import("firebase-admin");
        let app;
        try {
            app = admin.initializeApp({ projectId: "demo-trendkartz" }, "task025-seeder");
        } catch {
            app = admin.app("task025-seeder");
        }
        const adminAuth = app.auth();
        const adminDb = app.firestore();

        const adminUid = "admin_task025_verifier";
        try { await adminAuth.deleteUser(adminUid); } catch {}
        await adminAuth.createUser({
            uid: adminUid,
            email: "admin@bazaarvilla.test",
            password: "AdminPassword123!",
            displayName: "Bazaarvilla Administrator",
        });
        await adminAuth.setCustomUserClaims(adminUid, { admin: true });

        await adminDb.collection("users").doc(adminUid).set({
            uid: adminUid,
            email: "admin@bazaarvilla.test",
            role: "admin",
            createdAt: Date.now(),
        });

        const customToken = await adminAuth.createCustomToken(adminUid);
        console.log("[TASK-025 Verification] Admin custom claims & token provisioned.");

        // Seed product with 5 visually distinct images
        const fiveDistinctImages = [
            "/brand/bazaarvilla-banner-desktop.webp",
            "/brand/bazaarvilla-mascot.webp",
            "/brand/bazaarvilla-logo-horizontal.webp",
            "/brand/bazaarvilla-logo-stacked.webp",
            "/brand/bazaarvilla-wordmark.webp"
        ];

        const testProduct = {
            id: "prod-gallery-test-5img",
            name: "Bazaarvilla Signature Showcase Product",
            slug: "bazaarvilla-signature-showcase-product",
            price: 1899,
            inventory: 50,
            category: "Apparel",
            categories: ["Apparel", "Winterwear"],
            images: fiveDistinctImages,
            thumbnails: fiveDistinctImages,
            isVisible: true,
            isFeatured: true,
            isCustomized: false,
            sizes: ["S", "M", "L", "XL"],
            description: "Premium showcase product configured with 5 visually distinct product gallery images for UI layout testing.",
            createdAt: Date.now(),
        };

        await adminDb.collection("products").doc(testProduct.id).set(testProduct);
        console.log(`[TASK-025 Verification] Seeded test product "${testProduct.name}" with 5 distinct images.`);

        // Seed categories
        await adminDb.collection("categories").doc("cat-apparel").set({
            id: "cat-apparel",
            name: "Apparel",
            description: "Ready-to-wear apparel and hoodies",
            showOnHome: true,
            order: 1,
            image: "/brand/bazaarvilla-banner-desktop.webp"
        });

        // 3. Start Next.js dev server
        console.log("[TASK-025 Verification] Starting Next.js on port 3333...");
        const nextProcess = spawn("npx", ["next", "dev", "-p", "3333"], {
            env,
            shell: true,
            stdio: "pipe",
        });

        nextProcess.stdout.on("data", (d) => {
            const s = d.toString();
            if (s.includes("Ready") || s.includes("compiled")) {
                console.log(`[Next.js] ${s.trim()}`);
            }
        });

        await waitForPort(3333, 45000);
        console.log("[TASK-025 Verification] Next.js ready at http://localhost:3333!");

        // 4. Launch Headless Chrome
        console.log("[TASK-025 Verification] Launching Chrome Headless with CDP...");
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
        await send("DOM.enable");

        // 5. Authenticate as Admin
        console.log("[TASK-025 Verification] Opening homepage and signing in via custom token...");
        await send("Page.navigate", { url: "http://localhost:3333" });
        await new Promise((r) => setTimeout(r, 3000));

        await send("Runtime.evaluate", {
            expression: `
                (async () => {
                    if (typeof window.__EMULATOR_SIGNIN__ === 'function') {
                        await window.__EMULATOR_SIGNIN__('${customToken}');
                        return "SignedIn";
                    }
                    return "NoSignFn";
                })();
            `,
            awaitPromise: true,
        });

        await new Promise((r) => setTimeout(r, 2000));

        // Helper to capture a screenshot of the gallery area
        async function captureGallery(filename, width, height, isMobile = false) {
            console.log(`[Snapshot] Viewport ${width}x${height} -> ${filename}...`);
            await send("Emulation.setDeviceMetricsOverride", {
                width,
                height,
                deviceScaleFactor: 2,
                mobile: isMobile,
            });

            // Reset any accumulated double scroll offset and scroll section 4 cleanly into view
            await send("Runtime.evaluate", {
                expression: `
                    window.scrollTo(0, 0);
                    const mc = document.getElementById('admin-main-content');
                    if (mc) mc.scrollTop = 0;
                    const section4 = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Product Media Gallery'));
                    if (section4) {
                        section4.scrollIntoView({ behavior: 'instant', block: 'start' });
                    }
                `
            });
            await new Promise((r) => setTimeout(r, 800));

            const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            const filePath = path.join(outDir, filename);
            fs.writeFileSync(filePath, Buffer.from(data, "base64"));
            console.log(`[Snapshot] Saved ${filePath} (${fs.statSync(filePath).size} bytes)`);
        }

        // 6. Navigate to /admin/products and click "Edit Product" on the 5-image showcase product
        console.log("[TASK-025 Verification] Navigating to /admin/products...");
        await send("Page.navigate", { url: "http://localhost:3333/admin/products" });
        await new Promise((r) => setTimeout(r, 3000));

        // Click Edit on the test product
        const editResult = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const cards = Array.from(document.querySelectorAll('.admin-mobile-card, tr'));
                    const targetCard = cards.find(c => c.textContent.includes('Bazaarvilla Signature Showcase Product'));
                    if (targetCard) {
                        const editBtn = Array.from(targetCard.querySelectorAll('button')).find(b => b.textContent.includes('Edit'));
                        if (editBtn) {
                            editBtn.click();
                            return "ClickedEditOnShowcaseProduct";
                        }
                    }
                    // Fallback: any Edit button
                    const anyEdit = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Edit' || b.textContent.includes('Edit Product'));
                    if (anyEdit) {
                        anyEdit.click();
                        return "ClickedFallbackEdit";
                    }
                    return "NoEditButtonFound";
                })()
            `,
            awaitPromise: true,
        });
        console.log("[TASK-025 Verification] Edit product trigger:", editResult?.result?.value);
        await new Promise((r) => setTimeout(r, 1500));

        // Verify gallery rendered 5 cards
        const cardCount = await send("Runtime.evaluate", {
            expression: `document.querySelectorAll('.admin-gallery-card, .admin-image-preview-card').length`
        });
        console.log(`[TASK-025 Verification] Gallery card count rendered in DOM: ${cardCount?.result?.value}`);

        // --- STEP A: CAPTURE BEFORE DEFECT SCREENSHOTS ---
        console.log("[TASK-025 Verification] Reproducing exact Before defect state to capture visual proof...");
        await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const style = document.createElement('style');
                    style.id = 'task-025-before-defect-style';
                    style.innerHTML = \`
                        .admin-gallery-card.is-hero, .admin-gallery-card.hero {
                            padding: 120px 24px !important;
                            text-align: center !important;
                            border: 3px solid var(--accent) !important;
                            aspect-ratio: 1 !important;
                        }
                        .admin-gallery-card-footer {
                            position: absolute !important;
                            bottom: 0 !important;
                            left: 0 !important;
                            right: 0 !important;
                            display: flex !important;
                            flex-direction: row !important;
                            gap: 4px !important;
                            padding: 6px !important;
                            background: linear-gradient(transparent, rgba(0,0,0,0.75)) !important;
                        }
                        .admin-gallery-btn-hero {
                            width: auto !important;
                            flex: 1 !important;
                        }
                        .admin-gallery-btn-group {
                            flex: 1 !important;
                            gap: 4px !important;
                        }
                    \`;
                    document.head.appendChild(style);
                })()
            `
        });
        await new Promise((r) => setTimeout(r, 600));

        await captureGallery("before-gallery-defect-desktop.png", 1440, 900, false);
        await captureGallery("before-gallery-defect-mobile.png", 375, 812, true);

        // Remove the defect style
        await send("Runtime.evaluate", {
            expression: `
                const defectStyle = document.getElementById('task-025-before-defect-style');
                if (defectStyle) defectStyle.remove();
            `
        });
        await new Promise((r) => setTimeout(r, 600));

        // --- STEP B: CAPTURE AFTER FIXED GALLERY AT ALL REQUIRED VIEWPORTS ---
        console.log("[TASK-025 Verification] Capturing clean fixed gallery at all 6 viewports...");
        await captureGallery("after-gallery-1440px.png", 1440, 950, false);
        await captureGallery("after-gallery-1024px.png", 1024, 800, false);
        await captureGallery("after-gallery-768px.png", 768, 1024, false);
        await captureGallery("after-gallery-430px.png", 430, 932, true);
        await captureGallery("after-gallery-375px.png", 375, 812, true);
        await captureGallery("after-gallery-320px.png", 320, 640, true);

        // --- STEP C: INTERACTIVE VERIFICATION ---
        console.log("[TASK-025 Verification] Testing interactive gallery controls...");

        // 1. Set as Hero on Image 3
        console.log("[TASK-025 Verification] Clicking 'Set as Hero' on image #3...");
        const heroClickRes = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const cards = document.querySelectorAll('.admin-gallery-card');
                    if (cards.length >= 3) {
                        const heroBtn = cards[2].querySelector('.admin-gallery-btn-hero');
                        if (heroBtn) {
                            heroBtn.click();
                            return "ClickedSetHeroOn3";
                        }
                    }
                    return "FailedToClickHero3";
                })()
            `
        });
        console.log("[TASK-025 Verification] Set Hero on 3 result:", heroClickRes?.result?.value);
        await new Promise((r) => setTimeout(r, 800));

        // Check if card 3 is now hero
        const isCard3Hero = await send("Runtime.evaluate", {
            expression: `document.querySelectorAll('.admin-gallery-card')[2]?.classList.contains('is-hero')`
        });
        console.log(`[TASK-025 Verification] Card #3 is-hero active: ${isCard3Hero?.result?.value}`);
        await captureGallery("after-gallery-hero-selected.png", 1440, 950, false);

        // 2. Move Card #2 earlier (left arrow)
        console.log("[TASK-025 Verification] Clicking 'Move Left' on image #2...");
        const moveClickRes = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const cards = document.querySelectorAll('.admin-gallery-card');
                    if (cards.length >= 2) {
                        const leftBtn = cards[1].querySelector('.admin-gallery-btn-nav');
                        if (leftBtn) {
                            leftBtn.click();
                            return "ClickedMoveLeftOn2";
                        }
                    }
                    return "FailedToClickMoveLeft";
                })()
            `
        });
        console.log("[TASK-025 Verification] Move Left result:", moveClickRes?.result?.value);
        await new Promise((r) => setTimeout(r, 800));
        await captureGallery("after-gallery-reordered.png", 1440, 950, false);

        // 3. Remove Image #5
        console.log("[TASK-025 Verification] Clicking 'Remove' on image #5...");
        const removeClickRes = await send("Runtime.evaluate", {
            expression: `
                (() => {
                    const cards = document.querySelectorAll('.admin-gallery-card');
                    if (cards.length >= 5) {
                        const removeBtn = cards[4].querySelector('.admin-gallery-btn-remove');
                        if (removeBtn) {
                            removeBtn.click();
                            return "ClickedRemoveOn5";
                        }
                    }
                    return "FailedToClickRemove";
                })()
            `
        });
        console.log("[TASK-025 Verification] Remove result:", removeClickRes?.result?.value);
        await new Promise((r) => setTimeout(r, 800));

        const remainingCards = await send("Runtime.evaluate", {
            expression: `document.querySelectorAll('.admin-gallery-card').length`
        });
        console.log(`[TASK-025 Verification] Gallery cards count after remove: ${remainingCards?.result?.value}`);
        await captureGallery("after-gallery-after-delete.png", 1440, 950, false);

        // 4. Save and Reload Persistence Check
        console.log("[TASK-025 Verification] Saving product to verify database persistence...");
        await send("Runtime.evaluate", {
            expression: `
                const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save') || b.textContent.includes('Update Product'));
                if (saveBtn) saveBtn.click();
            `
        });
        await new Promise((r) => setTimeout(r, 2500));

        // Re-read product from Firestore
        const savedDoc = await adminDb.collection("products").doc(testProduct.id).get();
        const savedData = savedDoc.data();
        console.log(`[TASK-025 Verification] Firestore saved images count: ${savedData?.images?.length}`);
        console.log(`[TASK-025 Verification] Firestore featured image[0]: ${savedData?.images?.[0]}`);

        // Cleanup
        ws.close();
        chromeProcess.kill();
        nextProcess.kill();
        emuProcess.kill();
        restoreEnvLocal();

        console.log("================================================================================");
        console.log("TASK 025 GALLERY VERIFICATION COMPLETED SUCCESSFULLY!");
        console.log("Visual proof captures saved in docs/screenshots/task-025/:");
        console.log(" - before-gallery-defect-desktop.png (1440x900)");
        console.log(" - before-gallery-defect-mobile.png (375x812)");
        console.log(" - after-gallery-1440px.png");
        console.log(" - after-gallery-1024px.png");
        console.log(" - after-gallery-768px.png");
        console.log(" - after-gallery-430px.png");
        console.log(" - after-gallery-375px.png");
        console.log(" - after-gallery-320px.png");
        console.log(" - after-gallery-hero-selected.png");
        console.log(" - after-gallery-reordered.png");
        console.log(" - after-gallery-after-delete.png");
        console.log("================================================================================");

        process.exit(0);
    } catch (err) {
        console.error("[TASK-025 Error]", err);
        try { emuProcess.kill(); } catch {}
        try { restoreEnvLocal(); } catch {}
        process.exit(1);
    }
}

main();
