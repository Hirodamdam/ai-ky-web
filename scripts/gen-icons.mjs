import fs from "fs";
import sharp from "sharp";

const src = "./logo.png";
const outDir = "./public/icons";

if (!fs.existsSync(src)) {
  console.error(`Missing ${src}. Put your source logo at project root as logo.png`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// 192x192
await sharp(src)
  .resize(192, 192, { fit: "cover" })
  .png()
  .toFile(`${outDir}/icon-192.png`);

// 512x512
await sharp(src)
  .resize(512, 512, { fit: "cover" })
  .png()
  .toFile(`${outDir}/icon-512.png`);

// apple touch icon (180x180)
await sharp(src)
  .resize(180, 180, { fit: "cover" })
  .png()
  .toFile(`${outDir}/apple-touch-icon.png`);

// maskable icon (safe area 80%)
await sharp(src)
  .resize(410, 410, { fit: "contain" })
  .extend({
    top: 51,
    bottom: 51,
    left: 51,
    right: 51,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(`${outDir}/icon-512-maskable.png`);

console.log("Icons generated successfully:");
console.log(`${outDir}/icon-192.png`);
console.log(`${outDir}/icon-512.png`);
console.log(`${outDir}/icon-512-maskable.png`);
console.log(`${outDir}/apple-touch-icon.png`);
