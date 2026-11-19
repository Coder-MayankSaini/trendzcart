// scripts/inspect-live-admin.mjs
async function test() {
  const res = await fetch("https://bazaarvilla.com/admin/dashboard", {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" }
  });
  const html = await res.text();
  console.log("Admin Dashboard HTTP Status:", res.status);
  
  const linkMatches = html.match(/<link[^>]+>/g) || [];
  console.log("All Link tags:", linkMatches);

  // Check all link hrefs for .css
  const cssLinks = linkMatches
    .map(l => {
      const m = l.match(/href="([^"]+\.css[^"]*)"/);
      return m ? m[1] : null;
    })
    .filter(Boolean);

  console.log("CSS Links found:", cssLinks);

  for (const cssLink of cssLinks) {
    const fullUrl = cssLink.startsWith("http") ? cssLink : `https://bazaarvilla.com${cssLink}`;
    const cssRes = await fetch(fullUrl);
    const cssContent = await cssRes.text();
    console.log(`CSS file ${cssLink}: length=${cssContent.length}`);
    console.log(`  - contains .admin-header:`, cssContent.includes("admin-header"));
    console.log(`  - contains .admin-mobile-drawer:`, cssContent.includes("admin-mobile-drawer"));
    console.log(`  - contains .admin-mobile-card:`, cssContent.includes("admin-mobile-card"));
    console.log(`  - contains .admin-kpi-grid:`, cssContent.includes("admin-kpi-grid"));
    console.log(`  - contains .admin-form-sticky-bar:`, cssContent.includes("admin-form-sticky-bar"));
  }
}

test();
