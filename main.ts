// Solmar — build script (main.ts)
// Copies the game and its screenshots into the output directory and writes
// the dossier the competition reads. Standard library only; the dossier
// rules come from the kit's vendor/makefun-game.ts.
//
// Usage: node main.ts            (writes to $MAKEFUN_OUTPUT_DIR or /output)

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDossier } from './vendor/makefun-game.ts';

const repo = resolve(import.meta.dirname);
const out = process.env.MAKEFUN_OUTPUT_DIR || '/output';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const gameDir = join(repo, 'game');
if (existsSync(gameDir)) cpSync(gameDir, join(out, 'game'), { recursive: true });

const shotsDir = join(repo, 'screenshots');
if (existsSync(shotsDir)) cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// buildDossier returns the dossier bytes; the caller writes them out.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);

console.log(`Solmar build written to ${out}`);
