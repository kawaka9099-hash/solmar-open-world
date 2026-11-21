[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/kawaka9099-hash/solmar-open-world/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/kawaka9099-hash/solmar-open-world/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Solmar

An original open-world crime game set in the coastal city of Solmar,
built with three.js. Play Dario "Daz" Ferran, a driver-for-hire who takes
jobs from the fixer Lena — and finds himself working against the crime
boss Viktor Hale. Drive, steal cars, dodge the police, fight, and work
through six story missions to recover the ledger that brings Hale down.

## How to run

```sh
node serve.ts        # or: node serve.ts 8080
```

Then open http://localhost:8080/ in a browser and click **Start**.

Build the competition output with:

```sh
node main.ts         # writes to $MAKEFUN_OUTPUT_DIR or /output
```

## Controls

- **W / A / S / D** — move / drive (Shift to sprint)
- **Mouse** — look around (click the game to capture the mouse)
- **Space** — jump (on foot) / handbrake (driving)
- **E** — get in / out of a car
- **Left click** — fire the pistol
- **F** — punch
- **R** — reload
- **P** — pause · **M** — mute · **F9** — screenshot

## The missions

1. **The Pickup** — drive a client to the marina ($250)
2. **The Lift** — steal a car and deliver it to the docks ($600)
3. **Dockside** — take the package back from Hale's thugs ($800)
4. **The Vault** — crack the bank safe, then lose the cops ($900)
5. **Dead Drops** — three drops around the city ($700)
6. **The Ledger** — face Hale at the docks and take his ledger ($900)

New jobs open at the safehouse — follow the yellow marker. Getting
busted or wasted fails the current job, but the job stays open: walk
back to the safehouse and try again.

## Wanted level

Crimes raise your wanted level from one to five stars: stealing cars,
gunfire, hurting bystanders, and shooting at the police all count.
Police cruisers chase, ram, and — on foot, when they corner you — bust
you (a $100 fine, or everything you have). Stay quiet and out of sight
and the heat fades.

## Notes

- Progress (cash, ammo, missions) saves to localStorage automatically.
- The game is fully procedural: no downloaded assets, no network.
- Screenshots for the dossier are staged with `?shot=street|mission|drive|chase|start`.
