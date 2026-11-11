async function check() {
    const res = await fetch("https://bazaarvilla.com/products");
    const html = await res.text();
    const matches = [...html.matchAll(/href="\/products\/([^"]+)"/g)].map(m => m[1]);
    const uniqueSlugs = [...new Set(matches)];
    console.log("Live unique product slugs count:", uniqueSlugs.length);
    console.log("Live product slugs:", uniqueSlugs);
}
check();
