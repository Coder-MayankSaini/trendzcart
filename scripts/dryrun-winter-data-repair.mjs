/**
 * TASK 037 — Production Product Data Repair Dry-Run Script
 *
 * STRICTLY READ-ONLY: Connects to production Firestore, reads the 6 Winter Special
 * products with empty variants arrays, generates proposed repair manifests
 * for Option 1 (Matrix Generation) and Option 2 (Legacy Size Selector),
 * and saves the dry-run diff manifest to docs/task-reports/TASK-037-repair-manifest.json.
 *
 * NO WRITES OR MUTATIONS ARE PERFORMED.
 */

import admin from "firebase-admin";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { generateVariantMatrix } from "../src/lib/products/variants.ts";

const clientEmail = execSync("npx netlify env:get FIREBASE_CLIENT_EMAIL", { encoding: "utf8" }).trim();
const privateKey = execSync("npx netlify env:get FIREBASE_PRIVATE_KEY", { encoding: "utf8" }).trim();

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: "trendkartz",
            clientEmail,
            privateKey: privateKey.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
        }),
    });
}

const db = admin.firestore();

async function runDryRun() {
    console.log("================================================================================");
    console.log("TASK 037: WINTER COLLECTION PRODUCT DATA REPAIR DRY RUN (READ ONLY)");
    console.log("Firestore Project: trendkartz (PRODUCTION)");
    console.log("================================================================================\n");

    const winterCategoryId = "ace36311-21a9-43ce-b377-e7a0852d3fd1";
    const allProdsSnap = await db.collection("products").get();
    
    const winterDocs = allProdsSnap.docs.filter(doc => {
        const data = doc.data();
        return data.categoryId === winterCategoryId || 
               data.category === winterCategoryId || 
               (typeof data.category === "string" && data.category.toLowerCase().includes("winter")) ||
               (typeof data.categoryName === "string" && data.categoryName.toLowerCase().includes("winter"));
    });

    console.log(`Found ${winterDocs.length} products matching category 'Winter Special' (${winterCategoryId})\n`);

    const repairManifest = {
        generatedAt: new Date().toISOString(),
        mode: "DRY_RUN_READ_ONLY",
        totalProductsAudited: winterDocs.length,
        affectedProductsCount: 0,
        options: {
            option1_description: "Variant Matrix Model (Recommended for apparel): Generates deterministic variants for each size with allocated stock, SKU, and active status.",
            option2_description: "Legacy Sized Product Model: Sets hasVariants=false, preserving sizes array for customer selection with single root inventory pool.",
        },
        products: [],
    };

    let tableRows = [];

    for (const doc of winterDocs) {
        const data = doc.data();
        const isAffected = data.hasVariants === true && (!data.variants || data.variants.length === 0);

        if (isAffected) {
            repairManifest.affectedProductsCount++;
        }

        const rawSizes = (Array.isArray(data.sizesList) && data.sizesList.length > 0)
            ? data.sizesList
            : (Array.isArray(data.sizes) ? data.sizes : []);
            
        const sizeOptions = rawSizes.map((s, idx) => {
            const name = typeof s === "string" ? s : (s?.name || `Size-${idx + 1}`);
            const id = typeof s === "object" && s?.id ? s.id : `size-${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
            return {
                id,
                name,
                isActive: true,
            };
        });

        // Generate Option 1 Variants Matrix
        const baseSku = data.sku || `BV-WTR-${doc.id.slice(0, 6).toUpperCase()}`;
        const totalStock = typeof data.inventory === "number" ? data.inventory : 10;
        const stockPerSize = sizeOptions.length > 0 ? Math.floor(totalStock / sizeOptions.length) : totalStock;
        const remainder = sizeOptions.length > 0 ? totalStock % sizeOptions.length : 0;

        const { variants: generatedVariants } = generateVariantMatrix(sizeOptions, [], {
            baseSku,
            basePrice: data.price,
            baseCompareAtPrice: data.compareAtPrice,
            defaultStock: stockPerSize,
        });

        // Distribute remainder stock to first variant so sum strictly equals stored parent inventory
        if (generatedVariants.length > 0 && remainder > 0) {
            generatedVariants[0].inventory += remainder;
        }

        const productAudit = {
            id: doc.id,
            title: data.name,
            isAffected,
            availabilityStatus: isAffected ? "DEFECTIVE_UNAVAILABLE" : "HEALTHY_AVAILABLE",
            currentStoredData: {
                hasVariants: data.hasVariants,
                variantCount: (data.variants || []).length,
                variants: data.variants || [],
                sizesList: data.sizesList || [],
                sizes: data.sizes || [],
                price: data.price,
                compareAtPrice: data.compareAtPrice,
                inventory: data.inventory,
                totalPhysicalInventory: data.totalPhysicalInventory ?? null,
                sku: data.sku || null,
                isVisible: data.isVisible,
                categoryId: data.categoryId,
                categoryName: data.category || data.categoryName,
            },
            proposedOption1_VariantMatrix: isAffected ? {
                hasVariants: true,
                variants: generatedVariants,
                inventory: totalStock,
                totalPhysicalInventory: totalStock,
                allocatedStockSum: generatedVariants.reduce((sum, v) => sum + v.inventory, 0),
            } : null,
            proposedOption2_LegacySizedProduct: isAffected ? {
                hasVariants: false,
                inventory: totalStock,
                sizes: rawSizes.map(s => typeof s === "string" ? s : s?.name),
            } : null,
            justification: isAffected
                ? "Product was saved with hasVariants=true but empty variants[] matrix. Storefront PDP requires a matched variant to enable Add to Cart/Buy Now, resulting in 100% false-positive 'Unavailable' state despite genuine positive stock."
                : "Product has hasVariants=false with legacy sizes array. Already available for purchase."
        };

        repairManifest.products.push(productAudit);

        tableRows.push({
            id: doc.id.slice(0, 8),
            name: data.name.slice(0, 36) + "...",
            status: isAffected ? "❌ DEFECTIVE (Unavailable)" : "✅ HEALTHY (Available)",
            price: `₹${data.price}`,
            storedStock: data.inventory,
            storedVariants: (data.variants || []).length,
            sizes: rawSizes.map(s => typeof s === "string" ? s : (s?.name || JSON.stringify(s))).join(", "),
            opt1Variants: isAffected ? generatedVariants.length : "-",
            opt1StockSum: isAffected ? generatedVariants.reduce((sum, v) => sum + v.inventory, 0) : "-",
        });
    }

    console.table(tableRows);

    // Save manifest to docs
    const outputPath = path.resolve(process.cwd(), "docs", "task-reports", "TASK-037-repair-manifest.json");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(repairManifest, null, 2), "utf-8");

    console.log(`\n[SUCCESS] Dry run manifest written to: ${outputPath}`);
    console.log(`Summary: ${winterDocs.length} products audited, ${repairManifest.affectedProductsCount} defective/affected, 0 modified.`);
    console.log("Awaiting store owner approval before applying changes to production Firestore.");
}

runDryRun().catch(err => {
    console.error("Dry run failed:", err);
    process.exit(1);
});
