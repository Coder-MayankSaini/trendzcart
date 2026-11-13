import fs from "node:fs";

const products = JSON.parse(fs.readFileSync("tests/fixtures/gillkart-products.json", "utf8"));
console.log("Total Products:", products.length);

let totalImages = 0;
products.forEach((p, i) => {
    totalImages += p.images.length;
    const optSummary = (p.options || []).map(o => `${o.name}=${o.values.join("/")}`).join(", ");
    console.log(`${i + 1}. [${p.handle}] "${p.title}" | Imgs: ${p.images.length} | Price: ${p.variants?.[0]?.price} | Compare: ${p.variants?.[0]?.compare_at_price} | Opts: ${optSummary}`);
});

console.log("Total Images across all products:", totalImages);
