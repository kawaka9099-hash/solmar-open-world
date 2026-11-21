# Solmar

An original 3D open-world crime game for the make.fun **gta6-01** bounty —
a sun-soaked coastal city you explore on foot and by car, with traffic,
pedestrians, car theft, a wanted system with police chases, six story
missions, combat, a HUD with a live minimap, and a save system. Everything
in it is original: the city of Solmar, its people, vehicles, names, story,
art, sounds and music. Nothing is taken from any commercial game.

## The story

Dario "Daz" Ferran is a wheelman trying to go straight in Solmar — until
his old friend Lena Cross calls in a debt and the Hale syndicate starts
squeezing the whole city. Six missions take Daz from a first fare at the
marina to the fall of Viktor Hale's compound, earning money and unlocking
the next job as the story unfolds.

## How to run it

No build step. Serve `game/` with any static server and open
`game/index.html` in a desktop browser:

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

or serve `game/` with any other static file server. The game makes no
network requests at runtime — three.js is vendored under
`game/vendor/`, and every sound and piece of music is generated in code.

## Controls

| Input | Action |
| --- | --- |
| W / A / S / D | Move / drive (W accelerate, S brake & reverse) |
| Mouse | Look around (click the game to lock the mouse) |
| Shift | Sprint on foot |
| Space | Jump on foot / handbrake while driving |
| E | Enter or exit a car |
| Left click | Fire the pistol |
| F | Punch (melee) |
| R | Reload |
| M | Toggle music |
| P or Esc | Pause |
| C | Toggle camera distance |

Stealing a car, hitting a pedestrian or shooting raises your wanted level
(1–5 stars). Police cars chase you and officers on foot will try to arrest
you. Lose them — stay out of sight and out of trouble — and the heat cools
down. Get arrested and you are busted; run out of health and you are
wasted. Either way the current mission fails and you can retry it.

## Missions

1. **First Fare** — drive Lena's client to the marina.
2. **Hot Wheels** — steal the red sports car and deliver it to the chop shop.
3. **Dockside Debt** — clear Hale's thugs off the docks and take the package.
4. **The Getaway** — a timed bank job and escape with the police on your tail.
5. **Three Drops** — pick up three packages across the city before the clock runs out.
6. **Hale's Fall** — storm Hale's compound, take the ledger, and get out.

Mission markers show as a beam of light in the world, a blip on the
minimap, and a distance readout on the HUD. Rewards are paid in cash on
completion and the game saves automatically.

## Systems

- **City** — a procedural grid city with downtown towers, a beach and
  marina, docks, a dealership, a chop shop and Hale's walled compound;
  day lighting with shadows, palms, street lamps and neon signs.
- **Traffic & pedestrians** — cars drive the road grid and stop for each
  other; pedestrians walk the sidewalks and flee from danger.
- **Police** — wanted stars drive police car and on-foot officer spawns,
  chases, ramming, arrests and heat decay.
- **Combat** — pistol with ammo and pickups, melee punches, enemy shooters
  with health, car damage and explosions.
- **HUD** — health, cash, ammo, wanted stars, speed, objective text and a
  live minimap with player, traffic, police and mission blips.
- **Sound** — WebAudio effects (engine, gunfire, sirens, impacts, pickups)
  and a procedural music loop, all synthesized in code.
- **Save** — progress, cash and position are saved to localStorage; the
  start screen offers Continue when a save exists.

## Layout

```
main.ts                  entry program: copies game/ + screenshots/ to
                         /output and writes dossier.json (Node 22)
serve.ts                 tiny static server for local play
game/
  index.html             page, HUD, menus, import map
  vendor/
    three.module.min.js  three.js r160 (vendored library)
  src/
    config.js            tuning, city layout, mission data
    util.js              small math / random helpers
    audio.js             WebAudio effects + procedural music
    input.js             keyboard + mouse + pointer lock
    world.js             city generation, ground, props, collision
    actors.js            player, pedestrians, officers, enemies
    vehicles.js          car factory, traffic, police cars, driving
    combat.js            shooting, melee, damage, explosions
    wanted.js            wanted stars, police spawning, heat decay
    missions.js          mission state machine, markers, rewards
    hud.js               HUD, minimap, menus, mission cards
    save.js              localStorage save / load
    shots.js             staging helpers for screenshots & tests
    game.js              orchestration: loop, camera, interaction
    main.js              bootstrap
screenshots/            4 renders of the game (first is the cover)
```

## Entry

`main.ts` (Node 22, standard library only) hands the game in:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

It copies `game/` and `screenshots/` to the output directory and writes
`dossier.json` with the kit's `buildDossier` from `vendor/makefun-game.ts`.

## License

MIT — see `LICENSE`.
