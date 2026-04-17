/**
 * Generate PWA icons as PNG from an inline SVG template.
 * Run: node scripts/generate-icons.mjs
 *
 * Uses sharp (bundled with Next.js) for SVG→PNG conversion.
 */

import sharp from "sharp";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "public", "icons");

mkdirSync(ICONS_DIR, { recursive: true });

const sizes = [192, 512];

function makeSvg(size) {
  const bookSize = size * 0.55;
  const cx = size / 2;
  const cy = size / 2;
  const sw = Math.max(2, size * 0.04);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.12}" fill="#1a1a1a"/>
  <g transform="translate(${cx}, ${cy})">
    <rect x="${-bookSize * 0.32}" y="${-bookSize * 0.35}" width="${bookSize * 0.64}" height="${bookSize * 0.7}" rx="${bookSize * 0.06}" fill="none" stroke="#818cf8" stroke-width="${sw}" stroke-linejoin="round"/>
    <line x1="0" y1="${-bookSize * 0.35}" x2="0" y2="${bookSize * 0.35}" stroke="#818cf8" stroke-width="${sw * 0.75}"/>
  </g>
</svg>`;
}

function makeMaskableSvg(size) {
  const bookSize = size * 0.38; // smaller for safe zone
  const cx = size / 2;
  const cy = size / 2;
  const sw = Math.max(2, size * 0.04);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1a1a"/>
  <g transform="translate(${cx}, ${cy})">
    <rect x="${-bookSize * 0.32}" y="${-bookSize * 0.35}" width="${bookSize * 0.64}" height="${bookSize * 0.7}" rx="${bookSize * 0.06}" fill="none" stroke="#818cf8" stroke-width="${sw}" stroke-linejoin="round"/>
    <line x1="0" y1="${-bookSize * 0.35}" x2="0" y2="${bookSize * 0.35}" stroke="#818cf8" stroke-width="${sw * 0.75}"/>
  </g>
</svg>`;
}

async function generate() {
  for (const size of sizes) {
    const svg = Buffer.from(makeSvg(size));
    const out = join(ICONS_DIR, `icon-${size}x${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(out);
    console.log(`✓ ${out}`);
  }

  // Apple touch icon (180×180)
  const appleSvg = Buffer.from(makeSvg(180));
  const appleOut = join(ICONS_DIR, "apple-touch-icon.png");
  await sharp(appleSvg).resize(180, 180).png().toFile(appleOut);
  console.log(`✓ ${appleOut}`);

  // Maskable icon (512×512)
  const maskSvg = Buffer.from(makeMaskableSvg(512));
  const maskOut = join(ICONS_DIR, "maskable-icon-512x512.png");
  await sharp(maskSvg).resize(512, 512).png().toFile(maskOut);
  console.log(`✓ ${maskOut}`);

  console.log("\nDone! PNG icons generated in public/icons/");
}

generate();
