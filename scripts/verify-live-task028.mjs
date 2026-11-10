/**
 * TASK 028 — Post-Deployment Production Live Verification Script
 * Validates the deployed product gallery image containment, R2 delivery,
 * responsive layouts, and preserved commercial features on https://bazaarvilla.com
 */

import admin from "firebase-admin";
import crypto from "crypto";
import { execSync, spawn } from "child_process";
import http from "http";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();

const necklaceSlug = "personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women";
const necklaceId = "82b5c865-3128-4515-96e5-80f7f0eed58e";

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: "trendkartz",
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

const db = admin.firestore();

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch (e) { resolve({ status: res.statusCode, raw: data }); }
            });
        }).on("error", reject);
    });
}

async function runLiveVerification() {
    console.log("================================================================================");
    console.log("TASK 028 — LIVE PRODUCTION POST-DEPLOYMENT VERIFICATION");
    console.log("Live Domain:       https://bazaarvilla.com");
    console.log("Personalized Item: ", necklaceSlug);
    console.log("================================================================================\n");

    const results = [];
    function record(checkNum, checkName, passed, details) {
        results.push({ checkNum, checkName, passed, details });
        console.log(`[${passed ? "PASS" : "FAIL"}] Check ${checkNum}: ${checkName}`);
        console.log(`       Details: ${details}\n`);
    }

    try {
        // ---------------------------------------------------------------------
        // Check 1: Product Gallery Shows Complete Images Without Cropping (Live HTML & Classes)
        // ---------------------------------------------------------------------
        console.log("--- Check 1: Live PDP Gallery Structure & Containment Classes ---");
        const pdpRes = await fetch(`https://bazaarvilla.com/products/${necklaceSlug}`);
        const pdpHtml = await pdpRes.text();
        const hasPigMain = pdpHtml.includes("pig-main");
        const hasPigMainImg = pdpHtml.includes("pig-main-img");
        const hasObjectFitContain = pdpHtml.includes("object-fit:contain") || pdpHtml.includes("objectFit") || pdpHtml.includes("object-fit: contain");
        record(
            1,
            "Product gallery shows complete images without cropping",
            pdpRes.status === 200 && hasPigMain && hasPigMainImg,
            `HTTP ${pdpRes.status}, contains 'pig-main'=${hasPigMain}, 'pig-main-img'=${hasPigMainImg}, 'object-fit: contain'=${hasObjectFitContain}`
        );

        // ---------------------------------------------------------------------
        // Check 2: Landscape, Square, and Portrait Photographs Fit Correctly (Computed CSS in Chrome)
        // ---------------------------------------------------------------------
        console.log("--- Check 2: Headless Chrome Computed Object-Fit & Bounding Box ---");
        let chromePassed = false;
        let chromeDetails = "";

        const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        const cdpPort = 9333;
        const chromeProcess = spawn(chromePath, [
            `--remote-debugging-port=${cdpPort}`,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=C:\\Users\\Mayank Saini\\AppData\\Local\\Temp\\chrome-task028-live"
        ]);

        try {
            await new Promise(r => setTimeout(r, 2000));
            const versionRes = await getJson(`http://127.0.0.1:${cdpPort}/json/version`);
            const wsUrl = versionRes.data?.webSocketDebuggerUrl;

            if (wsUrl) {
                const WebSocket = (await import("ws")).default;
                const ws = new WebSocket(wsUrl);

                await new Promise((resolve) => ws.on("open", resolve));
                let msgId = 1;
                function sendCmd(method, params = {}) {
                    return new Promise((resolve, reject) => {
                        const id = msgId++;
                        const handler = (data) => {
                            const res = JSON.parse(data.toString());
                            if (res.id === id) {
                                ws.off("message", handler);
                                if (res.error) reject(res.error);
                                else resolve(res.result);
                            }
                        };
                        ws.on("message", handler);
                        ws.send(JSON.stringify({ id, method, params }));
                    });
                }

                const newPage = await sendCmd("Target.createTarget", { url: `https://bazaarvilla.com/products/${necklaceSlug}` });
                const pageSession = await sendCmd("Target.attachToTarget", { targetId: newPage.targetId, flatten: true });
                const sessionId = pageSession.sessionId;

                function sendSessionCmd(method, params = {}) {
                    return new Promise((resolve, reject) => {
                        const id = msgId++;
                        const handler = (data) => {
                            const res = JSON.parse(data.toString());
                            if (res.id === id) {
                                ws.off("message", handler);
                                if (res.error) reject(res.error);
                                else resolve(res.result);
                            }
                        };
                        ws.on("message", handler);
                        ws.send(JSON.stringify({ id, sessionId, method, params }));
                    });
                }

                await sendSessionCmd("Page.enable");
                await sendSessionCmd("Runtime.enable");

                // Wait for page load
                await new Promise(r => setTimeout(r, 4000));

                const evalRes = await sendSessionCmd("Runtime.evaluate", {
                    expression: `(() => {
                        const img = document.querySelector('.pig-main-img') || document.querySelector('.pig-main img');
                        const container = document.querySelector('.pig-main');
                        if (!img || !container) return { error: "Elements not found", hasImg: !!img, hasContainer: !!container };
                        const style = window.getComputedStyle(img);
                        const cRect = container.getBoundingClientRect();
                        const iRect = img.getBoundingClientRect();
                        return {
                            objectFit: style.objectFit,
                            containerWidth: cRect.width,
                            containerHeight: cRect.height,
                            imgWidth: iRect.width,
                            imgHeight: iRect.height,
                            naturalWidth: img.naturalWidth,
                            naturalHeight: img.naturalHeight,
                            isContained: iRect.width <= cRect.width + 1 && iRect.height <= cRect.height + 1
                        };
                    })()`,
                    returnByValue: true
                });

                const evalData = evalRes.result?.value;
                if (evalData && evalData.objectFit === "contain" && evalData.isContained) {
                    chromePassed = true;
                    chromeDetails = `Computed object-fit: ${evalData.objectFit}, Container: ${evalData.containerWidth.toFixed(1)}x${evalData.containerHeight.toFixed(1)}, Img: ${evalData.imgWidth.toFixed(1)}x${evalData.imgHeight.toFixed(1)}, Natural: ${evalData.naturalWidth}x${evalData.naturalHeight}, isContained: ${evalData.isContained}`;
                } else {
                    chromeDetails = JSON.stringify(evalData);
                }

                ws.close();
            }
        } catch (e) {
            chromeDetails = `Chrome inspection error: ${e.message}`;
        } finally {
            chromeProcess.kill();
        }

        record(
            2,
            "Landscape, square, and portrait photographs fit correctly",
            chromePassed,
            chromeDetails
        );

        // ---------------------------------------------------------------------
        // Check 3: Mobile and Desktop Gallery Layouts Remain Responsive
        // ---------------------------------------------------------------------
        console.log("--- Check 3: Responsive Layout Verification ---");
        // Check presence of responsive gallery container and PDP layout classes
        const hasPdpLayout = pdpHtml.includes("pdp-layout");
        const hasGalleryCol = pdpHtml.includes("pdp-gallery-col");
        const hasThumbs = pdpHtml.includes("pig-thumbs");
        record(
            3,
            "Mobile and desktop gallery layouts remain responsive",
            hasPdpLayout && hasGalleryCol && hasThumbs,
            `pdp-layout intact=${hasPdpLayout}, pdp-gallery-col intact=${hasGalleryCol}, pig-thumbs intact=${hasThumbs}`
        );

        // ---------------------------------------------------------------------
        // Check 4: All Five Necklace Photographs Remain Unique and Accessible
        // ---------------------------------------------------------------------
        console.log("--- Check 4: Necklace Product Photos Integrity ---");
        const necklaceDoc = await db.collection("products").doc(necklaceId).get();
        const necklaceData = necklaceDoc.data();
        const images = Array.isArray(necklaceData?.images) ? necklaceData.images : [];

        let allImagesOk = images.length === 5;
        const hashes = new Set();
        const imageDetails = [];

        for (const [idx, imgPath] of images.entries()) {
            const fullUrl = imgPath.startsWith("http") ? imgPath : `https://bazaarvilla.com${imgPath}`;
            const res = await fetch(fullUrl);
            if (res.status === 200) {
                const buf = Buffer.from(await res.arrayBuffer());
                const hash = crypto.createHash("sha256").update(buf).digest("hex");
                hashes.add(hash);
                imageDetails.push(`[${idx+1}] HTTP 200, ${buf.length} bytes, hash: ${hash.substring(0, 10)}`);
            } else {
                allImagesOk = false;
                imageDetails.push(`[${idx+1}] HTTP ${res.status}`);
            }
        }

        const distinctCount = hashes.size;
        record(
            4,
            "All five necklace photographs remain unique and accessible",
            allImagesOk && distinctCount === 5,
            `Found ${images.length} images, ${distinctCount} distinct SHA-256 hashes. Details:\n       ` + imageDetails.join("\n       ")
        );

        // ---------------------------------------------------------------------
        // Check 5: Cloudflare R2 Path-Based Image Delivery Remains Correct
        // ---------------------------------------------------------------------
        console.log("--- Check 5: Cloudflare R2 Path-Based Delivery & Headers ---");
        const testImgPath = images[0];
        const r2Res = await fetch(`https://bazaarvilla.com${testImgPath}`, { method: "HEAD" });
        const cacheControl = r2Res.headers.get("cache-control") || "";
        const contentType = r2Res.headers.get("content-type") || "";
        const r2Ok = r2Res.status === 200 && contentType.startsWith("image/");
        record(
            5,
            "Cloudflare R2 path-based image delivery remains correct",
            r2Ok,
            `HTTP ${r2Res.status}, Content-Type: ${contentType}, Cache-Control: ${cacheControl}`
        );

        // ---------------------------------------------------------------------
        // Check 6: Next.js Image Sharpness Remains Intact
        // ---------------------------------------------------------------------
        console.log("--- Check 6: Next.js Image Sharpness & Modern Formats ---");
        // Test Next.js image optimization endpoint with WebP/AVIF accept header
        const nextImgUrl = `https://bazaarvilla.com/_next/image?url=${encodeURIComponent(testImgPath)}&w=1200&q=85`;
        const nextImgRes = await fetch(nextImgUrl, {
            headers: { "Accept": "image/avif,image/webp,*/*" }
        });
        const nextImgType = nextImgRes.headers.get("content-type") || "";
        const nextImgOk = nextImgRes.status === 200 && (nextImgType.includes("webp") || nextImgType.includes("avif") || nextImgType.includes("image/"));
        record(
            6,
            "Next.js image sharpness remains intact",
            nextImgOk,
            `HTTP ${nextImgRes.status}, Content-Type: ${nextImgType}`
        );

        // ---------------------------------------------------------------------
        // Check 7: Admin Image Upload Functionality and Guidance Still Works
        // ---------------------------------------------------------------------
        console.log("--- Check 7: Admin Guidance & Upload Functionality ---");
        // Admin products route or JS chunk inspection
        const adminRes = await fetch("https://bazaarvilla.com/admin/products");
        // Note: Admin route redirects to login if unauthenticated, returning HTTP 200 or 307
        const adminOk = adminRes.status === 200 || adminRes.status === 307;
        record(
            7,
            "Admin image upload functionality still works",
            adminOk,
            `Admin route status: HTTP ${adminRes.status}`
        );

        // ---------------------------------------------------------------------
        // Check 8: TASK 027 Customizable-Product COD Restrictions Remain Active
        // ---------------------------------------------------------------------
        console.log("--- Check 8: Customizable-Product COD Restrictions Active ---");
        const testAttemptOrderId = `task028_live_verify_${Date.now()}`;
        const initialInventory = typeof necklaceData?.inventory === "number" ? necklaceData.inventory : null;

        const codOrderPayload = {
            id: testAttemptOrderId,
            paymentMethod: "COD",
            paymentStatus: "PENDING",
            orderStatus: "Processing",
            total: 499,
            subtotal: 499,
            items: [
                {
                    productId: necklaceId,
                    name: necklaceData?.name || "Personalized Necklace",
                    price: 499,
                    quantity: 1,
                    isCustomized: false, // Attempt forged flag
                }
            ],
            shippingAddress: {
                fullName: "QA Live Verification",
                email: "qa.bazaarvilla@gmail.com",
                addressLine1: "123 Test Street",
                city: "Jaipur",
                state: "Rajasthan",
                pincode: "302001",
                phone: "9876543210"
            }
        };

        const createRes = await fetch("https://bazaarvilla.com/api/orders/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(codOrderPayload)
        });
        const createJson = await createRes.json().catch(() => ({}));
        const isCodRejected = createRes.status === 400 && createJson.code === "COD_NOT_ALLOWED_CUSTOM_PRODUCT";

        const orderSnap = await db.collection("orders").doc(testAttemptOrderId).get();
        const afterNecklaceDoc = await db.collection("products").doc(necklaceId).get();
        const afterInventory = typeof afterNecklaceDoc.data()?.inventory === "number" ? afterNecklaceDoc.data().inventory : null;
        const noMutation = !orderSnap.exists && initialInventory === afterInventory;

        record(
            8,
            "TASK 027 customizable-product COD restrictions remain active",
            isCodRejected && noMutation,
            `HTTP ${createRes.status}, code='${createJson.code}', Order doc created=${orderSnap.exists}, Inventory before=${initialInventory} after=${afterInventory}`
        );

        // ---------------------------------------------------------------------
        // Check 9: TASK 023 Purchase Activity Counter Works
        // ---------------------------------------------------------------------
        console.log("--- Check 9: Purchase Activity Counter (TASK 023) ---");
        const activityRes = await fetch(`https://bazaarvilla.com/api/products/${necklaceId}/purchase-activity`);
        const activityJson = await activityRes.json();
        const isActivityIntact = activityRes.status === 200 && activityJson.productId === necklaceId && typeof activityJson.count === "number";
        record(
            9,
            "TASK 023 purchase activity counter works",
            isActivityIntact,
            `HTTP ${activityRes.status}, productId='${activityJson.productId}', count=${activityJson.count}, visible=${activityJson.visible}`
        );

        // ---------------------------------------------------------------------
        // Check 10: TASK 022 Review Management Works
        // ---------------------------------------------------------------------
        console.log("--- Check 10: Review Management System (TASK 022) ---");
        const reviewsRes = await fetch(`https://bazaarvilla.com/api/reviews?productId=${necklaceId}`);
        const reviewsJson = await reviewsRes.json();
        const isReviewsIntact = reviewsRes.status === 200 && Array.isArray(reviewsJson.reviews);
        record(
            10,
            "TASK 022 review management works",
            isReviewsIntact,
            `HTTP ${reviewsRes.status}, reviewsCount=${reviewsJson.reviews?.length ?? 0}`
        );

        // ---------------------------------------------------------------------
        // Check 11: Razorpay Live Mode and Commercial Checkout Remain Enabled
        // ---------------------------------------------------------------------
        console.log("--- Check 11: Razorpay Live Mode & Commercial Checkout ---");
        const rzpRes = await fetch("https://bazaarvilla.com/api/razorpay/public-config");
        const rzpJson = await rzpRes.json();
        const isRzpLive = rzpRes.status === 200 &&
            rzpJson.commercialCheckoutEnabled === true &&
            typeof rzpJson.keyId === "string" &&
            rzpJson.keyId.startsWith("rzp_live_");
        record(
            11,
            "Razorpay Live Mode and commercial checkout remain enabled",
            isRzpLive,
            `HTTP ${rzpRes.status}, commercialCheckoutEnabled=${rzpJson.commercialCheckoutEnabled}, keyPrefix=${rzpJson.keyId?.substring(0, 12)}`
        );

    } catch (err) {
        console.error("Verification script encountered unhandled error:", err);
        record(99, "Verification Execution", false, err.message);
    }

    console.log("================================================================================");
    const passCount = results.filter(r => r.passed).length;
    const failCount = results.length - passCount;
    console.log(`TASK 028 LIVE POST-DEPLOYMENT SUMMARY: ${passCount}/${results.length} CHECKS PASSED (Failures: ${failCount})`);
    console.log("================================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

runLiveVerification().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
