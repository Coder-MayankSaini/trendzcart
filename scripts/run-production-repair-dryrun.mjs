// scripts/run-production-repair-dryrun.mjs
// TASK 036 — Production Media Repair Read-Only Dry-Run Audit
import admin from "firebase-admin";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Load .env.local for R2 credentials
if (fs.existsSync(".env.local")) {
  const envContent = fs.readFileSync(".env.local", "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const [k, ...rest] = trimmed.split("=");
      process.env[k.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

import { auditCatalogMedia } from "../src/lib/products/import/mediaRepair.ts";

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

async function runDryRun() {
  console.log("================================================================================");
  console.log("BAZAARVILLA (trendkartz) — PRODUCTION MEDIA REPAIR READ-ONLY DRY-RUN");
  console.log("Database: production Firestore (trendkartz)");
  console.log("Mode:     100% READ-ONLY (DRY-RUN)");
  console.log("================================================================================");

  const referenceCsvPath = path.join(process.cwd(), "shopify_products_www-gillkart-com.csv");
  const referenceCsvText = fs.readFileSync(referenceCsvPath, "utf8");

  const { auditEntries, affectedProducts } = await auditCatalogMedia({
    db,
    referenceCsvText,
  });

  console.log(`\nAudit Summary:`);
  console.log(`- Total Catalog Products Audited: ${auditEntries.length}`);
  console.log(`- Healthy Products (Valid Media):  ${auditEntries.length - affectedProducts.length}`);
  console.log(`- Affected Products (Need Repair): ${affectedProducts.length}`);

  console.log("\nProposed Production Repair Manifest (Dry-Run):");
  for (const prod of affectedProducts) {
    console.log("--------------------------------------------------------------------------------");
    console.log(`Product ID:       ${prod.productId}`);
    console.log(`Title:            ${prod.title}`);
    console.log(`Handle/Slug:      ${prod.slug}`);
    console.log(`Category:         ${prod.category}`);
    console.log(`Price:            Rs ${prod.price}`);
    console.log(`Storefront Visible: ${prod.isVisible}`);
    console.log(`Current Images:   ${JSON.stringify(prod.currentImages)}`);
    console.log(`Audit Reasons:    ${prod.reasons.join("; ")}`);
    console.log(`Source URLs:      ${JSON.stringify(prod.sourceImageUrls)}`);
    console.log(`Proposed Action:  ${prod.proposedAction}`);
    console.log(`Status:           DRY-RUN SIMULATED (Zero production mutations performed)`);
    console.log("--------------------------------------------------------------------------------");
  }

  console.log("\n[DRY-RUN AUDIT COMPLETED SUCCESSFULLY — NO PRODUCTION WRITES PERFORMED]");
}

runDryRun().catch(console.error);
