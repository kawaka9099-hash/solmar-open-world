// Solmar — main.ts
// The entry program (Node 22, standard library only). It hands the game
// in: it copies game/ (the playable game, plain static files) and
// screenshots/ (3 or 4 shots of the game itself) from this repository to
// the output directory, then writes /output/dossier.json with the
// vendored make.fun library — the summary the judge reads.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output; inside
// the grader the program writes to /output. The limits below are the
// scorer's own caps, so a build that passes here is shaped like an entry
// the gate accepts.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const gameDir = join(repoRoot, 'game');
if (!existsSync(gameDir)) {
  throw new Error('game/ is missing from the repository — nothing to hand in');
}
const shotsDir = join(repoRoot, 'screenshots');
if (!existsSync(shotsDir)) {
  throw new Error('screenshots/ is missing from the repository — the entry needs 3 or 4 shots');
}
const shotNames = readdirSync(shotsDir).filter((name) => !name.startsWith('.'));
if (shotNames.length < 3 || shotNames.length > 4) {
  throw new Error(`screenshots/ holds ${shotNames.length} images; the entry needs 3 or 4`);
}
for (const name of shotNames) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > 262144) {
    throw new Error(`screenshots/${name} is ${size} bytes; the cap is 256 KiB`);
  }
}

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`Solmar handed in: ${shotNames.length} screenshots, dossier written to ${join(outDir, 'dossier.json')}`);
