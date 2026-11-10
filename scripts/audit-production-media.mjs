import admin from "firebase-admin";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Load .env.local for R2 credentials
function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [key, ...rest] = trimmed.split("=");
        if (key && rest.length) {
            const val = rest.join("=").replace(/^['"]|['"]$/g, "").trim();
            if (!process.env[key.trim()]) {
                process.env[key.trim()] = val;
            }
        }
    }
}
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

console.log("Retrieving Firebase Admin credentials from Netlify...");
const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: "trendkartz",
        clientEmail,
        privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
    })
});

const db = admin.firestore();

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "bazaarvilla-media";
const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

const s3Client = (accountId && accessKeyId && secretAccessKey) ? new S3Client({
    region: "auto",
    endpoint,
    credentials: {
        accessKeyId,
        secretAccessKey,
    }
}) : null;

function extractStorageKey(input) {
    if (!input || typeof input !== "string") return null;
    const trimmed = input.trim();
    if (
        trimmed.startsWith("customizations/") ||
        trimmed.startsWith("products/") ||
        trimmed.startsWith("categories/") ||
        trimmed.startsWith("reviews/")
    ) {
        return trimmed.split("?")[0];
    }
    const mediaProxyMatch = trimmed.match(/\/api\/media\/(?:public|download)\?key=([^&#]+)/i);
    if (mediaProxyMatch && mediaProxyMatch[1]) {
        return decodeURIComponent(mediaProxyMatch[1]);
    }
    return null;
}

async function verifyR2Object(key) {
    if (!s3Client || !key) return { exists: false, error: "No client or key" };
    try {
        const cmd = new HeadObjectCommand({ Bucket: bucketName, Key: key });
        const res = await s3Client.send(cmd);
        return { exists: true, size: res.ContentLength, contentType: res.ContentType };
    } catch (err) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
            return { exists: false, error: "404 NotFound" };
        }
        return { exists: false, error: err.message };
    }
}

async function runAudit() {
    console.log("================================================================================");
    console.log("BAZAARVILLA — PRODUCTION MEDIA & DATA INTEGRITY AUDIT (READ-ONLY)");
    console.log(`Bucket: ${bucketName}`);
    console.log(`Endpoint: ${endpoint}`);
    console.log("================================================================================\n");

    const [productsSnap, categoriesSnap] = await Promise.all([
        db.collection("products").get(),
        db.collection("categories").get()
    ]);

    console.log(`Total Products in Firestore:   ${productsSnap.size}`);
    console.log(`Total Categories in Firestore: ${categoriesSnap.size}\n`);

    const keyUsageMap = new Map(); // key -> [{ entityType, entityId, name, field }]
    const productsData = [];
    const categoriesData = [];

    // Audit Products
    for (const doc of productsSnap.docs) {
        const d = doc.data();
        const images = Array.isArray(d.images) ? d.images : (d.images ? [d.images] : []);
        const thumbnails = Array.isArray(d.thumbnails) ? d.thumbnails : [];

        const prodInfo = {
            id: doc.id,
            name: d.name || "Untitled",
            category: d.category || (d.categories && d.categories[0]) || "N/A",
            isVisible: d.isVisible !== false,
            isFeatured: !!d.isFeatured,
            rawImages: images,
            rawThumbnails: thumbnails,
            imageKeys: [],
            thumbnailKeys: [],
            duplicateKeysInProduct: false,
        };

        const seenKeysInProd = new Set();
        images.forEach((imgUrl, idx) => {
            const k = extractStorageKey(imgUrl);
            if (k) {
                prodInfo.imageKeys.push(k);
                if (seenKeysInProd.has(k)) {
                    prodInfo.duplicateKeysInProduct = true;
                }
                seenKeysInProd.add(k);

                if (!keyUsageMap.has(k)) keyUsageMap.set(k, []);
                keyUsageMap.get(k).push({ entityType: "product", entityId: doc.id, name: d.name, field: `images[${idx}]` });
            } else {
                prodInfo.imageKeys.push(`EXTERNAL/LEGACY: ${imgUrl ? imgUrl.slice(0, 50) : "EMPTY"}`);
            }
        });

        thumbnails.forEach((thumbUrl, idx) => {
            const k = extractStorageKey(thumbUrl);
            if (k) {
                prodInfo.thumbnailKeys.push(k);
                if (!keyUsageMap.has(k)) keyUsageMap.set(k, []);
                keyUsageMap.get(k).push({ entityType: "product", entityId: doc.id, name: d.name, field: `thumbnails[${idx}]` });
            }
        });

        productsData.push(prodInfo);
    }

    // Audit Categories
    for (const doc of categoriesSnap.docs) {
        const d = doc.data();
        const catInfo = {
            id: doc.id,
            name: d.name || "Untitled",
            description: d.description || "",
            showOnHome: !!d.showOnHome,
            rawImage: d.image || "",
            imageKey: extractStorageKey(d.image || ""),
        };

        if (catInfo.imageKey) {
            if (!keyUsageMap.has(catInfo.imageKey)) keyUsageMap.set(catInfo.imageKey, []);
            keyUsageMap.get(catInfo.imageKey).push({ entityType: "category", entityId: doc.id, name: d.name, field: "image" });
        }

        categoriesData.push(catInfo);
    }

    // Cross-Entity Sharing Analysis
    console.log("--- KEY COLLISION & CROSS-ENTITY SHARING ANALYSIS ---");
    let sharedKeyCount = 0;
    for (const [key, usages] of keyUsageMap.entries()) {
        const distinctEntities = new Set(usages.map(u => `${u.entityType}:${u.entityId}`));
        if (distinctEntities.size > 1) {
            sharedKeyCount++;
            console.log(`[SHARED KEY DETECTED]: ${key}`);
            usages.forEach(u => console.log(`  - ${u.entityType.toUpperCase()} "${u.name}" (${u.entityId}) -> ${u.field}`));
        }
    }
    if (sharedKeyCount === 0) {
        console.log("✓ No cross-entity storage key collisions detected.");
    }
    console.log();

    // R2 Object Existence Verification
    console.log("--- R2 OBJECT EXISTENCE VERIFICATION ---");
    const uniqueKeys = Array.from(keyUsageMap.keys());
    console.log(`Verifying ${uniqueKeys.length} unique storage keys in bucket '${bucketName}'...`);
    let missingObjectCount = 0;
    const r2StatusMap = new Map();

    for (const key of uniqueKeys) {
        const status = await verifyR2Object(key);
        r2StatusMap.set(key, status);
        if (!status.exists) {
            missingObjectCount++;
            console.log(`[MISSING R2 OBJECT]: ${key} (${status.error})`);
            const usages = keyUsageMap.get(key) || [];
            usages.forEach(u => console.log(`  referenced by: ${u.entityType} "${u.name}" (${u.entityId})`));
        }
    }
    console.log(`R2 Verification complete: ${uniqueKeys.length - missingObjectCount} found, ${missingObjectCount} missing.\n`);

    // Product Catalog Detail Table
    console.log("=== PRODUCT CATALOG DETAIL ===");
    for (const p of productsData) {
        console.log(`Product: "${p.name}" (ID: ${p.id})`);
        console.log(`  Category: ${p.category} | Visible: ${p.isVisible} | Featured: ${p.isFeatured}`);
        console.log(`  Images (${p.rawImages.length}):`);
        p.rawImages.forEach((img, i) => {
            const key = p.imageKeys[i];
            const r2 = r2StatusMap.get(key);
            console.log(`    [${i}] ${img} -> Key: ${key} [R2: ${r2?.exists ? `EXISTS (${r2.size} bytes)` : (r2?.error || "N/A")}]`);
        });
        if (p.rawThumbnails.length > 0) {
            console.log(`  Thumbnails (${p.rawThumbnails.length}):`);
            p.rawThumbnails.forEach((th, i) => {
                const key = p.thumbnailKeys[i];
                const r2 = r2StatusMap.get(key);
                console.log(`    [${i}] ${th} -> Key: ${key} [R2: ${r2?.exists ? `EXISTS (${r2.size} bytes)` : (r2?.error || "N/A")}]`);
            });
        }
        if (p.duplicateKeysInProduct) {
            console.log(`  ⚠ WARNING: Duplicate image keys found inside this product's images array!`);
        }
        console.log();
    }

    // Category Detail Table
    console.log("=== CATEGORY CATALOG DETAIL ===");
    for (const c of categoriesData) {
        const r2 = r2StatusMap.get(c.imageKey);
        console.log(`Category: "${c.name}" (ID: ${c.id})`);
        console.log(`  Description: ${c.description || "None"} | ShowOnHome: ${c.showOnHome}`);
        console.log(`  Image: ${c.rawImage || "None"} -> Key: ${c.imageKey || "None"} [R2: ${r2?.exists ? `EXISTS (${r2.size} bytes)` : (r2?.error || "None")}]`);
        console.log();
    }
}

runAudit().catch(err => {
    console.error("Audit failed:", err);
    process.exit(1);
});
