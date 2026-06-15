import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(__dir, 'icon-source.svg'));
const out = join(__dir, '../src-tauri/icons');
mkdirSync(out, { recursive: true });

const sizes = [
  { file: '32x32.png',              size: 32   },
  { file: '128x128.png',            size: 128  },
  { file: '128x128@2x.png',         size: 256  },
  { file: 'icon.png',               size: 512  },
  { file: 'icon-1024.png',          size: 1024 },
  // Windows Store / MSIX tiles
  { file: 'StoreLogo.png',          size: 50   },
  { file: 'Square30x30Logo.png',    size: 30   },
  { file: 'Square44x44Logo.png',    size: 44   },
  { file: 'Square71x71Logo.png',    size: 71   },
  { file: 'Square89x89Logo.png',    size: 89   },
  { file: 'Square107x107Logo.png',  size: 107  },
  { file: 'Square142x142Logo.png',  size: 142  },
  { file: 'Square150x150Logo.png',  size: 150  },
  { file: 'Square284x284Logo.png',  size: 284  },
  { file: 'Square310x310Logo.png',  size: 310  },
];

for (const { file, size } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(join(out, file));
  console.log(`✓ ${file} (${size}×${size})`);
}

console.log('\nAll PNGs done.');
console.log('Next: run  pnpm tauri icon src-tauri/icons/icon-1024.png');
console.log('That regenerates icon.icns (macOS) and icon.ico (Windows) from the 1024px source.');
