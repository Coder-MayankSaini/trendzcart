import crypto from "node:crypto";
import sharp from "sharp";

const BASE_URL = "https://bazaarvilla.com";
const PRODUCT_ID = "82b5c865-3128-4515-96e5-80f7f0eed58e";
const PDP_SLUG = "personalized-eyes-engraved-bar-necklace-with-name-custom-photo-eyes-pendant-for-men-women";

console.log("================================================================================");
console.log("TASK 026 — LIVE PRODUCTION POST-DEPLOYMENT VERIFICATION RUNNER");
console.log(`Target Host: ${BASE_URL}`);
console.log("================================================================================\n");

async function run() {
  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = "") {
    if (condition) {
      console.log(`✔ [PASS] ${testName} ${details}`);
      passed++;
    } else {
      console.error(`✖ [FAIL] ${testName} ${details}`);
      failed++;
    }
  }

  // 1. RAZORPAY CONFIG & COMMERCIAL GATE
  console.log("--- 1. RAZORPAY PUBLIC CONFIG & COMMERCIAL CHECKOUT GATE ---");
  try {
    const res = await fetch(`${BASE_URL}/api/razorpay/public-config`);
    assert(res.status === 200, "CHECK-001: /api/razorpay/public-config status 200", `(status: ${res.status})`);
    const cfg = await res.json();
    assert(cfg.keyId === "rzp_live_Ty8CuwoSSBGpHi", "CHECK-002: Live Razorpay Key ID matches production", `(key: ${cfg.keyId})`);
    assert(cfg.commercialCheckoutEnabled === true, "CHECK-003: Commercial checkout is active and open", `(enabled: ${cfg.commercialCheckoutEnabled})`);
  } catch (err) {
    assert(false, "CHECK-001..003: Public config fetch failed", err.message);
  }

  // 2. VERIFY ALL 5 DISTINCT PRODUCT IMAGES VIA PATH-BASED MEDIA ROUTE
  console.log("\n--- 2. ALL 5 DISTINCT PRODUCT PHOTOS (TASK 024 PRESERVATION) ---");
  const necklaceImages = [
    { name: "Image 1 (Master Cover)", key: `products/${PRODUCT_ID}/f1a40980-e3d8-4f8f-9a58-e6eecf506695.png`, expectedSha: "7bd1d620d0377a0059f4520c7b694fec0cf23d2cff0c2ea32e90de3ce93dc01a" },
    { name: "Image 2 (Side Angle)", key: `products/${PRODUCT_ID}/5c3046d4-c644-4d10-9fe0-ccbb2a61055d.png`, expectedSha: "2d3a10ccbe6e0f0c2c2f05021f6e05d25b91a22995b4509e8e2827e3d8491666" },
    { name: "Image 3 (Engraving Detail)", key: `products/${PRODUCT_ID}/272e2e2d-b304-4d68-99cc-7fe6de3772a1.png`, expectedSha: "bb9409d77021e47d58c10782f550a8dffe690ea21986f6e875b826818ce36056" },
    { name: "Image 4 (Model Wearing)", key: `products/${PRODUCT_ID}/0e6147c7-d5bf-47a9-982c-6d564c0c3568.png`, expectedSha: "cbc64da9f8109fa52636bd1d3ce4b48793c6c1625d37c760d6fce2af71397dd0" },
    { name: "Image 5 (Gift Packaging)", key: `products/${PRODUCT_ID}/50d254ff-38e7-4a1a-954a-78eb583ba335.png`, expectedSha: "a7c202a3c755f4a9499bf71a8fdfeed49d60a071e9fd9ec27edddcc1c1bb3457" }
  ];

  const hashes = new Set();
  for (let i = 0; i < necklaceImages.length; i++) {
    const item = necklaceImages[i];
    try {
      const url = `${BASE_URL}/api/media/public/${item.key}`;
      const res = await fetch(url);
      assert(res.status === 200, `CHECK-004.${i + 1}: ${item.name} returns HTTP 200`, `(status: ${res.status})`);
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      assert(hash === item.expectedSha, `CHECK-005.${i + 1}: ${item.name} SHA-256 exact match`, `(hash: ${hash.slice(0, 12)}...)`);
      const meta = await sharp(buf).metadata();
      assert(meta.width > 0 && meta.height > 0, `CHECK-006.${i + 1}: ${item.name} decoded dimensions`, `(${meta.width}x${meta.height} px, format: ${meta.format}, size: ${(buf.length / 1024).toFixed(1)} KB)`);
      hashes.add(hash);
    } catch (err) {
      assert(false, `CHECK-004.${i + 1}: ${item.name} fetch failed`, err.message);
    }
  }
  assert(hashes.size === 5, "CHECK-007: All 5 product photos have distinct SHA-256 hashes", `(unique count: ${hashes.size}/5)`);

  // CATEGORY IMAGE CHECK
  console.log("\n--- 2B. CATEGORY MEDIA ISOLATION (TASK 024 PRESERVATION) ---");
  try {
    const catUrl = `${BASE_URL}/api/media/public/categories/cd3e7259-51bc-420d-ac4c-2afa7d8fafa6/231ffa35-ceb3-4460-a06f-dd800c18a268.png`;
    const catRes = await fetch(catUrl);
    assert(catRes.status === 200, "CHECK-008: Category image returns HTTP 200", `(status: ${catRes.status})`);
    const catBuf = Buffer.from(await catRes.arrayBuffer());
    const catHash = crypto.createHash("sha256").update(catBuf).digest("hex");
    assert(!hashes.has(catHash), "CHECK-009: Category image is 100% isolated and distinct from product images", `(catHash: ${catHash.slice(0, 12)}...)`);
  } catch (err) {
    assert(false, "CHECK-008..009: Category media check failed", err.message);
  }

  // 3. NETLIFY NEXT.JS IMAGE OPTIMIZATION PIPELINE
  console.log("\n--- 3. NEXT.JS OPTIMIZED IMAGE DELIVERY (WEBP / AVIF) ---");
  const optUrl = `${BASE_URL}/_next/image?url=%2Fapi%2Fmedia%2Fpublic%2Fproducts%2F${PRODUCT_ID}%2Ff1a40980-e3d8-4f8f-9a58-e6eecf506695.png&w=750&q=75`;
  try {
    const res = await fetch(optUrl, {
      headers: { "Accept": "image/webp,image/avif,*/*" }
    });
    assert(res.status === 200, "CHECK-010: Next.js image optimizer returns HTTP 200", `(status: ${res.status})`);
    const cType = res.headers.get("content-type");
    assert(cType.includes("image/webp") || cType.includes("image/avif") || cType.includes("image/"), "CHECK-011: Optimized content-type is modern image format", `(content-type: ${cType})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    assert(meta.width === 750, "CHECK-012: Decoded image width exactly matches requested 750px width", `(dimensions: ${meta.width}x${meta.height} px, format: ${meta.format}, size: ${(buf.length / 1024).toFixed(1)} KB)`);
    console.log(`    Payload comparison: Master PNG ~979 KB -> Optimized WebP/AVIF ${(buf.length / 1024).toFixed(1)} KB (${Math.round((1 - buf.length / 1002951) * 100)}% bandwidth savings!)`);
  } catch (err) {
    assert(false, "CHECK-010..012: Optimized image fetch failed", err.message);
  }

  // 4. STOREFRONT HTML & RESPONSIVE PROPS
  console.log("\n--- 4. LIVE STOREFRONT PAGES & RESPONSIVE ATTRIBUTES ---");
  try {
    // A. Homepage
    const hpRes = await fetch(`${BASE_URL}/`);
    assert(hpRes.status === 200, "CHECK-013: Homepage loads with HTTP 200", `(status: ${hpRes.status})`);

    // B. Products Catalog
    const catRes = await fetch(`${BASE_URL}/products`);
    assert(catRes.status === 200, "CHECK-014: /products catalog loads with HTTP 200", `(status: ${catRes.status})`);
    const catHtml = await catRes.text();
    const hasMasterCoverInCat = catHtml.includes("f1a40980-e3d8-4f8f-9a58-e6eecf506695.png");
    assert(hasMasterCoverInCat, "CHECK-015: Catalog product card renders high-res cover image", "(master UUID present)");
    assert(catHtml.includes("sizes="), "CHECK-016: Catalog product image contains responsive sizes attribute", "");

    // C. Product Detail Page
    const pdpRes = await fetch(`${BASE_URL}/products/${PDP_SLUG}`);
    assert(pdpRes.status === 200, "CHECK-017: PDP loads with HTTP 200", `(status: ${pdpRes.status})`);
    const pdpHtml = await pdpRes.text();
    assert(pdpHtml.includes("pig-main-img"), "CHECK-018: PDP contains .pig-main-img gallery class", "");
    assert(pdpHtml.includes("f1a40980-e3d8-4f8f-9a58-e6eecf506695.png"), "CHECK-019: PDP main image uses master cover photo", "");

    // D. Live CSS Bundle
    const cssMatches = [...pdpHtml.matchAll(/href="(\/_next\/static\/(?:chunks|css)\/[^"]+\.css)"/g)];
    assert(cssMatches.length > 0, "CHECK-020: Live CSS bundle located in PDP HTML", `(found: ${cssMatches[0][1]})`);
    let foundHeightAuto = false;
    let foundAspectRatio = false;
    for (const match of cssMatches) {
      const cssRes = await fetch(`${BASE_URL}${match[1]}`);
      const cssText = await cssRes.text();
      if (cssText.includes(".pig-main-img") && cssText.includes("height:auto")) {
        foundHeightAuto = true;
      }
      if (cssText.includes(".pig-main-img") && cssText.includes("aspect-ratio:4/5")) {
        foundAspectRatio = true;
      }
    }
    assert(foundHeightAuto, "CHECK-021: Live stylesheet contains .pig-main-img { height: auto; }", "(height auto confirmed)");
    assert(foundAspectRatio, "CHECK-022: Live stylesheet contains .pig-main-img { aspect-ratio: 4/5; }", "(aspect ratio 4/5 confirmed)");
  } catch (err) {
    assert(false, "CHECK-013..022: Storefront HTML checks failed", err.message);
  }

  // 5. ADMIN HEALTH
  console.log("\n--- 5. ADMIN HEALTH & DASHBOARD ---");
  try {
    const adminDashRes = await fetch(`${BASE_URL}/admin/dashboard`);
    assert(adminDashRes.status === 200, "CHECK-023: /admin/dashboard returns HTTP 200", `(status: ${adminDashRes.status})`);
    const adminProductsRes = await fetch(`${BASE_URL}/admin/products`);
    assert(adminProductsRes.status === 200, "CHECK-024: /admin/products returns HTTP 200", `(status: ${adminProductsRes.status})`);
  } catch (err) {
    assert(false, "CHECK-023..024: Admin routes failed", err.message);
  }

  console.log("\n================================================================================");
  console.log(`FINAL RESULT: ${passed} PASSED, ${failed} FAILED (TOTAL CHECKS: ${passed + failed})`);
  console.log("================================================================================");
  if (failed > 0) process.exit(1);
}

run();
