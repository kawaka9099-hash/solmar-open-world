// Solmar — an original 3D open-world crime game for make.fun gta6-01.
//
// Entry program (Node 22, standard library only). It hands the game in: the
// static files under game/ and the screenshots under screenshots/ are copied
// from this repository into the output directory, and dossier.json is written
// there with the kit's buildDossier, the summary the judge reads.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// The program is deterministic: two runs over the same repository write the
// same bytes.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// This repository's root, next to this file.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
// The grader writes to /output; anywhere else, MAKEFUN_OUTPUT_DIR stands in.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps for this competition: the dossier text cap shapes the
// bytes that are written; the other caps refuse an entry the scorer itself
// would refuse (too many or too large screenshots, game/ too big).
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyGameAndShots() {
  mkdirSync(outputDir, { recursive: true });
  cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
  const shotsDir = join(repoRoot, 'screenshots');
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  if (existsSync(shotsDir)) {
    cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
  }
}

function writeDossierFile() {
  const dossier = buildDossier(outputDir, dossierCaps);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
  return dossier.length;
}

copyGameAndShots();
const dossierBytes = writeDossierFile();
console.log(`Solmar entry written to ${outputDir} (dossier.json ${dossierBytes} bytes)`);
