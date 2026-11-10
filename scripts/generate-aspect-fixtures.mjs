import sharp from "sharp";
import fs from "fs";
import path from "path";

const targetDir = path.join(process.cwd(), "public", "test-fixtures");
fs.mkdirSync(targetDir, { recursive: true });

function createSvgMarkup(width, height, label, color, ratioText) {
    const borderWidth = 16;
    const cornerSize = 120;
    return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1e293b" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
      </defs>
      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#bg)" />

      <!-- Outer Diagnostic Edge Border -->
      <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${width - borderWidth}" height="${height - borderWidth}" 
            fill="none" stroke="${color}" stroke-width="${borderWidth}" />

      <!-- Corner Rectangles to prove 100% full extent visibility -->
      <rect x="0" y="0" width="${cornerSize}" height="${cornerSize}" fill="#ef4444" />
      <text x="${cornerSize / 2}" y="${cornerSize / 2 + 6}" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">TL CORNER</text>

      <rect x="${width - cornerSize}" y="0" width="${cornerSize}" height="${cornerSize}" fill="#ef4444" />
      <text x="${width - cornerSize / 2}" y="${cornerSize / 2 + 6}" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">TR CORNER</text>

      <rect x="0" y="${height - cornerSize}" width="${cornerSize}" height="${cornerSize}" fill="#ef4444" />
      <text x="${cornerSize / 2}" y="${height - cornerSize / 2 + 6}" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">BL CORNER</text>

      <rect x="${width - cornerSize}" y="${height - cornerSize}" width="${cornerSize}" height="${cornerSize}" fill="#ef4444" />
      <text x="${width - cornerSize / 2}" y="${height - cornerSize / 2 + 6}" font-family="system-ui, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">BR CORNER</text>

      <!-- Edge Banners -->
      <text x="${width / 2}" y="42" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" fill="${color}" text-anchor="middle">▲▲ TOP EDGE ▲▲</text>
      <text x="${width / 2}" y="${height - 24}" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" fill="${color}" text-anchor="middle">▼▼ BOTTOM EDGE ▼▼</text>

      <!-- Side Edge Diagnostic Markers (Critically cropped when object-fit: cover is used on non-4:5) -->
      <g transform="translate(30, ${height / 2}) rotate(-90)">
        <text x="0" y="0" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" fill="#facc15" text-anchor="middle">◀◀ LEFT EDGE (CROPPED UNDER COVER) ◀◀</text>
      </g>
      <g transform="translate(${width - 30}, ${height / 2}) rotate(90)">
        <text x="0" y="0" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" fill="#facc15" text-anchor="middle">▶▶ RIGHT EDGE (CROPPED UNDER COVER) ▶▶</text>
      </g>

      <!-- Center Informational Card -->
      <rect x="${width / 2 - 320}" y="${height / 2 - 140}" width="640" height="280" rx="16" fill="#1e293b" stroke="${color}" stroke-width="4" />
      <text x="${width / 2}" y="${height / 2 - 70}" font-family="system-ui, sans-serif" font-size="28" font-weight="900" fill="#ffffff" text-anchor="middle">BAZAARVILLA DIAGNOSTIC</text>
      <text x="${width / 2}" y="${height / 2 - 20}" font-family="system-ui, sans-serif" font-size="22" font-weight="bold" fill="${color}" text-anchor="middle">${label}</text>
      <text x="${width / 2}" y="${height / 2 + 25}" font-family="system-ui, sans-serif" font-size="18" fill="#94a3b8" text-anchor="middle">Resolution: ${width} × ${height} px (${ratioText})</text>
      <text x="${width / 2}" y="${height / 2 + 70}" font-family="system-ui, sans-serif" font-size="16" font-weight="600" fill="#38bdf8" text-anchor="middle">Containment Target: Full Image Visible Without Cropping</text>
      <text x="${width / 2}" y="${height / 2 + 105}" font-family="system-ui, sans-serif" font-size="14" fill="#a855f7" text-anchor="middle">TASK-028 Regression Test Asset</text>
    </svg>
    `;
}

const fixtures = [
    {
        name: "landscape-16-9.png",
        width: 1600,
        height: 900,
        label: "Landscape 16:9 Aspect Ratio",
        color: "#10b981",
        ratioText: "16:9 Landscape",
    },
    {
        name: "square-1-1.png",
        width: 1200,
        height: 1200,
        label: "Square 1:1 Aspect Ratio",
        color: "#3b82f6",
        ratioText: "1:1 Square",
    },
    {
        name: "portrait-3-4.png",
        width: 900,
        height: 1200,
        label: "Portrait 3:4 Aspect Ratio",
        color: "#ec4899",
        ratioText: "3:4 Portrait",
    },
    {
        name: "portrait-4-5.png",
        width: 1200,
        height: 1500,
        label: "Portrait 4:5 Recommended Baseline",
        color: "#8b5cf6",
        ratioText: "4:5 Recommended Portrait",
    },
    {
        name: "tall-portrait-9-16.png",
        width: 900,
        height: 1600,
        label: "Tall Portrait 9:16 Aspect Ratio",
        color: "#f59e0b",
        ratioText: "9:16 Tall Portrait",
    },
];

async function generate() {
    for (const f of fixtures) {
        const svg = Buffer.from(createSvgMarkup(f.width, f.height, f.label, f.color, f.ratioText));
        const outPath = path.join(targetDir, f.name);
        await sharp(svg).png().toFile(outPath);
        console.log(`Generated fixture: ${outPath} (${f.width}x${f.height})`);
    }
}

generate().catch(err => {
    console.error("Failed to generate fixtures:", err);
    process.exit(1);
});
