const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const outDir = path.join(__dirname, '..', 'assets');

async function main() {
  const svg = fs.readFileSync(svgPath);

  // Generate PNG at multiple sizes
  const sizes = [16, 32, 48, 64, 128, 256, 512];
  for (const size of sizes) {
    await sharp(svg, { density: 300 })
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`  Generated icon-${size}.png`);
  }

  // Copy 512 as the main icon.png
  await sharp(svg, { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon.png'));
  console.log('  Generated icon.png (512x512)');

  // Generate ICO (Windows) with multiple sizes
  const icoSizes = [16, 32, 48, 256];
  const pngBuffers = await Promise.all(
    icoSizes.map((size) =>
      sharp(svg, { density: 300 }).resize(size, size).png().toBuffer(),
    ),
  );
  const ico = await toIco(pngBuffers);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log('  Generated icon.ico');

  console.log('Done!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
