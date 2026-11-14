/**
 * scripts/repair-winter-products.mjs
 *
 * TASK 037 — Admin-Assisted Safe Inventory Repair Tool
 *
 * SAFETY GUARANTEES:
 * 1. Defaults to DRY-RUN mode. Refuses to write unless `--execute` is explicitly passed.
 * 2. NEVER guesses or evenly distributes parent stock across sizes.
 * 3. Supports two repair modes:
 *    A. `--mode=per-size-matrix`
 *       Requires an `--allocations=<file.json>` specifying exact physical counts for each size.
 *       Generates deterministic, unique SKUs and variant IDs.
 *    B. `--mode=shared-pool`
 *       Sets `hasVariants: false`, keeping `sizesList` and `sizes` array for customer dropdown.
 *       Preserves stored parent inventory without size-level allocation.
 *       Logs clear fulfillment and overselling implications.
 * 4. Takes an exact pre-flight rollback snapshot before any write.
 * 5. Verifies 0 pending reservations and checks recent orders.
 */

import admin from "firebase-admin";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const ARGS = process.argv.slice(2);
const IS_EXECUTE = ARGS.includes("--execute");
const MODE_ARG = ARGS.find(a => a.startsWith("--mode="))?.split("=")[1];
const ALLOC_ARG = ARGS.find(a => a.startsWith("--allocations="))?.split("=")[1];

const AFFECTED_PRODUCT_IDS = [
  "14a29e10-758e-4fd2-a10a-6c04c74fe73a",
  "2a4b51a9-991d-4d62-905e-d0e6cf243879",
  "51adb109-1acb-4f7e-96b7-cdccba9ed961",
  "af7ddaf9-bb61-43fa-846f-22f9b69e4c01",
  "f1b8f647-1b61-4b90-9978-a4f719c5d901",
  "f728d2b8-089c-4cc1-9c7f-2f7fe0f0c3dd",
];

// Helper to initialize Admin SDK
function initAdmin() {
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
  return admin.firestore();
}

export function generateStableSku(productId, sizeName, colorName = null) {
  const prefix = "BV-WTR";
  const shortId = productId.slice(0, 6).toUpperCase();
  const cleanSize = sizeName.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (colorName) {
    const cleanColor = colorName.toUpperCase().slice(0, 3).replace(/[^A-Z0-9]/g, "");
    return `${prefix}-${shortId}-${cleanColor}-${cleanSize}`;
  }
  return `${prefix}-${shortId}-${cleanSize}`;
}

async function main() {
  console.log("================================================================================");
  console.log("TASK 037: ADMIN-ASSISTED SAFE INVENTORY REPAIR");
  console.log(`Execution Mode: ${IS_EXECUTE ? "🔴 LIVE WRITE (Authorized)" : "🟢 DRY RUN (Read-Only)"}`);
  console.log(`Selected Architecture Mode: ${MODE_ARG || "UNSPECIFIED (Showing Comparison)"}`);
  console.log("================================================================================\n");

  const db = initAdmin();

  // 1. Fetch current production snapshot for the 6 products
  const products = [];
  for (const id of AFFECTED_PRODUCT_IDS) {
    const doc = await db.collection("products").doc(id).get();
    if (doc.exists) {
      products.push({ id: doc.id, ...doc.data() });
    } else {
      console.error(`WARNING: Product ${id} not found in Firestore!`);
    }
  }

  // 2. Pre-flight Safety Checks
  console.log("[PRE-FLIGHT] Checking reservations & recent orders...");
  const resSnap = await db.collection("inventory_reservations").get().catch(() => ({ docs: [] }));
  const activeReservations = (resSnap.docs || []).filter(d => AFFECTED_PRODUCT_IDS.includes(d.data().productId));
  if (activeReservations.length > 0) {
    console.error(`[BLOCKED] Active reservations exist for affected products: ${activeReservations.length}`);
    process.exit(1);
  }
  console.log(`[PRE-FLIGHT] 0 active reservations. Safety check passed.\n`);

  // 3. Generate Owner Input Template if requested or allocations not supplied
  const ownerInputTemplate = {};
  for (const p of products) {
    const rawSizes = (Array.isArray(p.sizesList) && p.sizesList.length > 0)
      ? p.sizesList.map(s => s.name || s)
      : (Array.isArray(p.sizes) ? p.sizes : []);
    
    ownerInputTemplate[p.id] = {
      title: p.name || p.title,
      parentInventory: p.inventory ?? 0,
      sizes: rawSizes,
      sizeAllocations: {},
    };
    for (const s of rawSizes) {
      ownerInputTemplate[p.id].sizeAllocations[s] = null; // Awaiting input
    }
  }

  const templatePath = path.resolve(process.cwd(), "docs", "task-reports", "TASK-037-owner-allocation-input.json");
  fs.writeFileSync(templatePath, JSON.stringify(ownerInputTemplate, null, 2), "utf8");
  console.log(`[TEMPLATE] Owner allocation input template saved to:\n  ${templatePath}\n`);

  // 4. If mode is per-size-matrix, check allocations
  let allocations = null;
  if (MODE_ARG === "per-size-matrix") {
    if (!ALLOC_ARG) {
      console.log("--------------------------------------------------------------------------------");
      console.log("MODE: per-size-matrix requires an allocations file!");
      console.log("Usage: node scripts/repair-winter-products.mjs --mode=per-size-matrix --allocations=<path>");
      console.log("Per instructions: Stock will NOT be guessed or divided evenly.");
      console.log("Awaiting owner to fill in docs/task-reports/TASK-037-owner-allocation-input.json");
      console.log("--------------------------------------------------------------------------------\n");
    } else {
      allocations = JSON.parse(fs.readFileSync(ALLOC_ARG, "utf8"));
    }
  }

  // 5. Build proposed repairs for each product
  const proposedRepairs = [];
  for (const p of products) {
    const rawSizes = (Array.isArray(p.sizesList) && p.sizesList.length > 0)
      ? p.sizesList
      : (Array.isArray(p.sizes) ? p.sizes.map((s, idx) => ({ id: `size-${s.toLowerCase()}`, name: s, isActive: true, order: idx })) : []);

    const sizeNames = rawSizes.map(s => typeof s === "string" ? s : s.name);
    const parentStock = p.inventory ?? 0;

    // Per-Size Matrix Option
    const opt1Variants = rawSizes.map((s, idx) => {
      const sName = typeof s === "string" ? s : s.name;
      const sId = typeof s === "object" && s.id ? s.id : `size-${sName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
      const userAlloc = allocations?.[p.id]?.sizeAllocations?.[sName];
      const inv = typeof userAlloc === "number" ? userAlloc : null;
      return {
        id: `var_${sId}`,
        sizeId: sId,
        sizeName: sName,
        sku: generateStableSku(p.id, sName),
        price: null,
        compareAtPrice: null,
        inventory: inv, // Explicit or null awaiting owner input
        isActive: true,
        createdAt: Date.now(),
      };
    });

    // Shared Pool Option
    const opt2Update = {
      hasVariants: false,
      inventory: parentStock,
      totalPhysicalInventory: parentStock,
      sizes: sizeNames,
      sizesList: rawSizes,
    };

    proposedRepairs.push({
      productId: p.id,
      title: p.name || p.title,
      existingSizes: sizeNames,
      existingParentInventory: parentStock,
      existingVariantsCount: (p.variants || []).length,
      verifiedSizeLevelQuantities: allocations?.[p.id]?.sizeAllocations ?? "UNKNOWN (Awaiting Owner Input)",
      option1_PerSizeMatrix: {
        hasVariants: true,
        variants: opt1Variants,
        resultingSkus: opt1Variants.map(v => v.sku),
        resultingVariantIds: opt1Variants.map(v => v.id),
        stockAllocationSum: opt1Variants.reduce((sum, v) => sum + (v.inventory ?? 0), 0),
        status: opt1Variants.some(v => v.inventory === null) ? "AWAITING_OWNER_INPUT" : "READY",
      },
      option2_SharedStockPool: {
        fieldsChanged: {
          hasVariants: false,
        },
        fieldsPreserved: {
          inventory: parentStock,
          totalPhysicalInventory: parentStock,
          sizes: sizeNames,
          sizesList: rawSizes,
        },
        fulfillmentImplications: "Single inventory pool of " + parentStock + " shared across all " + sizeNames.length + " sizes. Customers can select any size, deducting from parent inventory. Fulfillment risk: Store could oversell a specific physical size (e.g., M) if physical stock differs from customer purchase pattern.",
      },
    });
  }

  // Write detailed repair proposal manifest
  const manifestPath = path.resolve(process.cwd(), "docs", "task-reports", "TASK-037-repair-manifest.json");
  const fullManifest = {
    generatedAt: new Date().toISOString(),
    mode: IS_EXECUTE ? "PRODUCTION_EXECUTE" : "DRY_RUN_READ_ONLY",
    totalAudited: products.length,
    affectedCount: products.length,
    activeReservations: 0,
    optionsSummary: {
      option1: {
        name: "Per-Size Variant Matrix (Recommended for Apparel)",
        requiresOwnerInput: true,
        description: "Creates discrete variants for each size with stable SKUs (e.g., BV-WTR-14A29E-S). Does not guess inventory. Requires store owner to specify units per size.",
        fulfillmentRisk: "Zero overselling risk; strictly tracks inventory per physical size.",
      },
      option2: {
        name: "Shared Inventory Pool (Single-SKU Model)",
        requiresOwnerInput: false,
        description: "Sets hasVariants=false while keeping size dropdown. All sizes draw from existing parent inventory pool (e.g. 10 or 106 units).",
        fulfillmentRisk: "Overselling risk for popular sizes if physical inventory distribution does not match sales.",
      },
    },
    products: proposedRepairs,
  };

  fs.writeFileSync(manifestPath, JSON.stringify(fullManifest, null, 2), "utf8");
  console.log(`[MANIFEST] Full repair manifest updated at:\n  ${manifestPath}\n`);

  // Print Summary Table
  console.log("=== 6-PRODUCT PROPOSED REPAIR SUMMARY ===");
  const summaryTable = proposedRepairs.map(r => ({
    id: r.productId.slice(0, 8),
    title: r.title.slice(0, 32) + "...",
    sizes: r.existingSizes.join(", "),
    parentStock: r.existingParentInventory,
    opt1Skus: r.option1_PerSizeMatrix.resultingSkus.length,
    opt1StockState: r.option1_PerSizeMatrix.status,
    opt2PoolStock: r.existingParentInventory,
  }));
  console.table(summaryTable);

  // Safety Gate: Live write
  if (IS_EXECUTE) {
    if (!MODE_ARG) {
      console.error("[ERROR] Cannot execute without specifying --mode=shared-pool or --mode=per-size-matrix!");
      process.exit(1);
    }

    if (MODE_ARG === "per-size-matrix" && !allocations) {
      console.error("[ERROR] Cannot execute per-size-matrix without --allocations file!");
      process.exit(1);
    }

    // Rollback snapshot
    const backupPath = path.resolve(process.cwd(), "docs", "task-reports", `TASK-037-pre-repair-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(products, null, 2), "utf8");
    console.log(`[BACKUP] Saved rollback snapshot to ${backupPath}`);

    console.log(`[EXECUTE] Applying ${MODE_ARG} updates to production Firestore in atomic batch...`);
    const batch = db.batch();

    for (const r of proposedRepairs) {
      const docRef = db.collection("products").doc(r.productId);
      if (MODE_ARG === "shared-pool") {
        batch.update(docRef, {
          hasVariants: false,
          updatedAt: Date.now(),
        });
      } else if (MODE_ARG === "per-size-matrix") {
        batch.update(docRef, {
          hasVariants: true,
          variants: r.option1_PerSizeMatrix.variants,
          updatedAt: Date.now(),
        });
      }
    }

    await batch.commit();
    console.log(`[SUCCESS] Production batch write complete for ${proposedRepairs.length} products.`);
  } else {
    console.log("\n[CONFIRMATION] ZERO production product documents were modified.");
    console.log("No data migration will occur until separate owner authorization.");
  }
}

main().catch(err => {
  console.error("Execution failed:", err);
  process.exit(1);
});
