# Solmar — an open-world crime game

You are Dario "Daz" Ferran, a driver fresh out of the marina lock-up with
$50 and a borrowed pistol. The city of Solmar is yours: five districts, a
working waterfront, traffic, pedestrians, and the Solmar Police Department
watching everything you do. Take jobs from the fixer Lena, stay ahead of
the law, and take back the ledger from the developer Viktor Hale.

## How to play

```
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. No network, no
build step — every file the game loads sits under `game/`.

| Key | Action |
| --- | ------ |
| WASD / arrows | Move / drive |
| Mouse | Look (click the game to capture the mouse) |
| E | Enter or exit a car · start a job at the safehouse |
| Click | Shoot the pistol |
| F | Punch |
| R | Reload |
| Shift | Sprint / handbrake while driving |
| Space | Jump / brake |
| P | Pause |
| M | Mute |
| F9 | Save a PNG screenshot of the canvas |

## The story — six jobs

1. **The Pickup** ($250) — meet Lena's client and drive them to the marina.
2. **Hot Wheels** ($600) — steal the sport car by the bank, deliver it to the docks.
3. **Dockside Trouble** ($800) — clear Hale's thugs from the docks and bring the package home.
4. **The Bank Job** ($900) — crack the bank safe, then lose a three-star manhunt.
5. **Dead Drops** ($700) — three drops at the hospital, the marina and the docks.
6. **The Ledger** ($900) — take down Hale and his guards, recover the ledger.

Jobs unlock in order from the yellow marker at the safehouse. Getting
busted or wasted fails the active job — you keep your money minus the
fine (busted) or the hospital cut (wasted) and can try again.

## The city

Stealing a car, shooting, or hitting a pedestrian raises your wanted
level (1–5 stars). Police cruisers spawn, chase and ram; on foot, an
officer standing next to you for a few seconds busts you. Lay low and the
heat fades. Progress, cash and ammo save to the browser automatically.

## Tech

- three.js r160 (vendored under `game/vendor/`), plain ES modules.
- Procedural everything: the city, the car and character models, the
  WebAudio sound effects and music bed. No external assets.
- `main.ts` (Node 22, standard library only) copies `game/` and
  `screenshots/` to `/output` and writes `dossier.json` with the vendored
  `vendor/makefun-game.ts` library. Run it with
  `MAKEFUN_OUTPUT_DIR=out node main.ts` and compare two runs: the bytes
  are identical.

## Layout

- `game/index.html` — the page, HUD and import map.
- `game/src/config.js` — every tuning constant in one place.
- `game/src/world.js` — the procedural city (roads, marina, bank, safehouse, hospital).
- `game/src/vehicles.js` — arcade car physics and boxy car models.
- `game/src/actors.js` — the player character and pedestrians.
- `game/src/game.js` — the state machine, main loop, traffic AI.
- `game/src/missions.js` — the six story jobs.
- `game/src/wanted.js` — wanted stars and police pursuit.
- `game/src/combat.js` — pistol, fists, enemies, cash pickups.
- `game/src/hud.js` — panels, toasts, screens and the live minimap.
- `game/src/save.js` — versioned localStorage saves.
- `game/src/shots.js` — F9 capture and staged `?shot=` setups.
- `screenshots/` — four renders of the game itself (cover first).
