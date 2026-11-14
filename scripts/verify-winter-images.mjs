// scripts/verify-winter-images.mjs
import fs from "fs";

const products = JSON.parse(fs.readFileSync("scripts/winter-products-audit.json", "utf8"));

async function run() {
  console.log("=== VERIFYING WINTER PRODUCTS IMAGES ON LIVE SITE ===");
  for (const p of products) {
    console.log(`\nChecking images for: ${p.name}`);
    for (const imgUrl of (p.images || [])) {
      const fullUrl = imgUrl.startsWith("http") ? imgUrl : `https://bazaarvilla.com${imgUrl}`;
      try {
        const res = await fetch(fullUrl, { method: "HEAD" });
        const contentType = res.headers.get("content-type");
        const contentLength = res.headers.get("content-length");
        console.log(`  HTTP ${res.status} | Type: ${contentType} | Size: ${contentLength} | URL: ${fullUrl}`);
      } catch (err) {
        console.error(`  ERROR: ${fullUrl} - ${err.message}`);
      }
    }
  }
}

run().catch(console.error);
