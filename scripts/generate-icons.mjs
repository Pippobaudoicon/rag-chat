/**
 * Generate PWA icons from an inline SVG template.
 * Run: node scripts/generate-icons.mjs
 *
 * Uses only Node built-ins — no extra dependencies.
 * Produces simple solid-color icons with a book symbol.
 * For production you'd swap in a real design tool or sharp.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, "..", "public", "icons");

mkdirSync(ICONS_DIR, { recursive: true });

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

function makeSvg(size) {
  const pad = Math.round(size * 0.18);
  const bookSize = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.12; // corner radius

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#1a1a1a"/>
  <g transform="translate(${cx}, ${cy})">
    <rect x="${-bookSize * 0.32}" y="${-bookSize * 0.35}" width="${bookSize * 0.64}" height="${bookSize * 0.7}" rx="${bookSize * 0.06}" fill="none" stroke="#818cf8" stroke-width="${Math.max(2, size * 0.04)}" stroke-linejoin="round"/>
    <line x1="0" y1="${-bookSize * 0.35}" x2="0" y2="${bookSize * 0.35}" stroke="#818cf8" stroke-width="${Math.max(1.5, size * 0.03)}"/>
  </g>
</svg>`;
}

for (const size of sizes) {
  const svg = makeSvg(size);
  const path = join(ICONS_DIR, `icon-${size}x${size}.svg`);
  writeFileSync(path, svg);
  console.log(`✓ ${path}`);
}

// Also write the apple-touch-icon (180×180)
writeFileSync(join(ICONS_DIR, "apple-touch-icon.svg"), makeSvg(180));
console.log(`✓ apple-touch-icon.svg`);

// Write a maskable icon (512 with extra padding)
function makeMaskableSvg(size) {
  const safeZone = size * 0.1; // 10% safe zone for maskable
  const innerSize = size - safeZone * 2;
  const cx = size / 2;
  const cy = size / 2;
  const bookSize = innerSize * 0.65;
  const r = size * 0.12;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#1a1a1a"/>
  <g transform="translate(${cx}, ${cy})">
    <rect x="${-bookSize * 0.32}" y="${-bookSize * 0.35}" width="${bookSize * 0.64}" height="${bookSize * 0.7}" rx="${bookSize * 0.06}" fill="none" stroke="#818cf8" stroke-width="${Math.max(2, size * 0.04)}" stroke-linejoin="round"/>
    <line x1="0" y1="${-bookSize * 0.35}" x2="0" y2="${bookSize * 0.35}" stroke="#818cf8" stroke-width="${Math.max(1.5, size * 0.03)}"/>
  </g>
</svg>`;
}

writeFileSync(join(ICONS_DIR, "maskable-icon-512x512.svg"), makeMaskableSvg(512));
console.log(`✓ maskable-icon-512x512.svg`);

console.log("\nDone! Icons generated as SVG in public/icons/");
console.log("For production PNG icons, convert with: npx svg2png-many public/icons/*.svg");
