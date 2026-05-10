// Gera os ícones da extensão (16/32/48/128) a partir do logo.png raiz.
// Idempotente: pula se o destino existe e é mais novo que o source.

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const SOURCE = resolve(ROOT, 'logo.png');
const OUT_DIR = resolve(__dirname, '..', 'public', 'icon');

const SIZES = [16, 32, 48, 128];

if (!existsSync(SOURCE)) {
  console.error(`[gen-icons] source not found: ${SOURCE}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const sourceMtime = statSync(SOURCE).mtimeMs;

for (const size of SIZES) {
  const outPath = resolve(OUT_DIR, `${size}.png`);
  const upToDate = existsSync(outPath) && statSync(outPath).mtimeMs >= sourceMtime;
  if (upToDate) {
    console.log(`[gen-icons] ${size}.png up-to-date`);
    continue;
  }
  await sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`[gen-icons] wrote ${outPath}`);
}
