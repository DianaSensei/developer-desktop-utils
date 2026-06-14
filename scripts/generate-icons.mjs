import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(__dir, 'icon-source.svg'));
const out = join(__dir, '../src-tauri/icons');
mkdirSync(out, { recursive: true });

const sizes = [
  { file: '32x32.png',      size: 32  },
  { file: '128x128.png',    size: 128 },
  { file: '128x128@2x.png', size: 256 },
  { file: 'icon-1024.png',  size: 1024 },
];

for (const { file, size } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(join(out, file));
  console.log(`✓ ${file}`);
}

// icon.ico — embed 16, 32, 48, 256 inside one ICO
// sharp doesn't write ICO natively; we'll write each size as PNG first
// and let `tauri icon` handle ICO/ICNS generation from icon-1024.png
console.log('\nDone. Run: npx tauri icon src-tauri/icons/icon-1024.png');
