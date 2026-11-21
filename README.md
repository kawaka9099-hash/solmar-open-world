# Solmar — an open-world crime game in the browser

Solmar is a complete, original open-world crime game that runs offline
from its own static files in a desktop browser. No Rockstar names, maps,
characters or assets: the city, the people, the cars, the story, the art
and the sound are all built from scratch in code.

You are Dario "Daz" Ferran, new in the sun-soaked city of Solmar and
short on cash. Lena, a fixer, has work for you — six jobs, from driving
a client to the marina to taking down Viktor Hale and recovering his
ledger. Between jobs the city is yours: steal cars, outrun the Solmar
PD, and mind the wanted stars.

## What is in the game

- **A city** — a procedural 5×5 grid with roads, sidewalks, a park, a
  marina with docks and boats, a bank, a safehouse and a hospital.
- **On foot and by car** — walk, sprint and jump, or steal any car on
  the street and drive it with arcade physics, handbrake drifts included.
- **Traffic and pedestrians** — cars cruise the roads, people stroll the
  sidewalks and scatter when shots are fired.
- **A wanted system and police** — crimes raise your heat from 1 to 5
  stars; patrol cars chase, ram, and try to bust you on foot. Lay low
  and the heat fades.
- **Missions and a story** — six jobs from Lena with markers, objectives,
  payouts and fail states, tracked on the HUD and the minimap.
- **Combat** — a pistol (aim, shoot, reload) and a punch, against
  armed thugs, guards and Hale himself.
- **A HUD with a live minimap** — money, health, ammo, speed, wanted
  stars, mission objectives and a top-down map of the city.
- **A start screen and a save** — progress (cash, ammo, jobs done) is
  kept in localStorage; closing the tab and coming back continues the story.
- **Sound** — fully procedural WebAudio: engine hum, sirens, gunshots,
  footsteps and a looping music bed. No audio files.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Mouse | Look (click the game to lock the pointer) |
| Shift | Sprint |
| Space | Jump / handbrake |
| E | Enter or exit a car |
| Click | Shoot |
| F | Punch |
| R | Reload |
| M | Mute |
| P | Pause |
| F9 | Save a screenshot (PNG download) |

## Play it

```sh
node serve.ts        # game/ on http://localhost:8080
```

Then open http://localhost:8080 in a desktop browser. The game needs
no network: three.js is vendored under `game/vendor/`.

Staged screenshots for the dossier: open the game with
`?shot=street`, `?shot=mission`, `?shot=drive` or `?shot=chase`
(`?shot=start` leaves the title screen up).

## Build the dossier

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies `game/` and `screenshots/` to `out/` and writes
`out/dossier.json` with the vendored make.fun library. It needs
Node 22+ and no packages.

## Layout

- `game/index.html` — the page and the HUD markup
- `game/src/main.js` — boot, camera, movement, frame loop
- `game/src/game.js` — state machine, traffic, pedestrians, HUD view
- `game/src/missions.js` — the six story jobs
- `game/src/wanted.js` — wanted level and police AI
- `game/src/combat.js` — pistol, punch, enemies, pickups
- `game/src/hud.js` — HUD, minimap, screens, toasts
- `game/src/save.js` — localStorage save
- `game/src/shots.js` — screenshot helper and staged shots
- `game/src/config.js`, `util.js`, `input.js`, `audio.js`, `world.js`,
  `vehicles.js`, `actors.js` — engine: tuning, helpers, input,
  procedural sound, city, cars, people
- `game/vendor/three.module.min.js` — three.js r160
- `main.ts` — the entry program (copies game + screenshots, writes the dossier)
- `serve.ts` — the local dev server
- `vendor/makefun-game.ts` — the make.fun dossier library (unchanged)

## License

MIT. See LICENSE.
