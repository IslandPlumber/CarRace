# CarRace — StreakChat Speedway

A standalone stock-car racing club live at **[streakchat.app/carrace/](https://streakchat.app/carrace/)**, built from the HorseRace game engine. Seven fictional drivers race original numbered stock cars with signature abilities. The cast takes its cues from classic stock-car liveries and personalities, including the black No. 03, red No. 88, rainbow No. 24, orange No. 20, cobalt No. 48, candy-green No. 18, and royal-blue No. 43.

## Play

- **Practice race:** no account needed; one free ability per exhibition race.
- **Race club:** register for 1,000 free coins; join the main room or share a private room code. Seven seats, with CPU cars filling empty places.
- **Race:** the host opens 30 seconds of optional betting, then the server starts the race. Use your signature move after the starting lights. It costs 75 free coins, once per race; garage upgrades can reduce that to 50.
- **Win / Place / Show:** 4× / 2× / 1.5× returns including stake, for first / top two / top three. One ticket per type, 10–500 coins. Past bets shows only races you placed a bet on.
- **Garage:** persistent engine, handling, chassis, team, and power upgrades. Finishing prizes and points are awarded once. No purchases or cash-out.
- **Cameras:** Overview, Chase, Trackside. Optional synthesized engine sound.

The new **1.52-mile speedway** is approximately six times the original lap length. It has 24° turns, 4° straights, smooth banking transitions, a flat apron, double yellow lines, pit road, grandstands, retaining walls, and catch fencing. Cars follow the road surface in height, pitch, and roll. New club rounds freeze the course when betting opens; older pending and in-flight rounds retain their original circuit through a server upgrade.

| Fictional driver | Stock car | Signature move |
|---|---|---|
| Duke Ironhart | Midnight Thunder · 03 | Bump & Run: boost and disrupt nearby rivals |
| Redline Junior | Cherry Bomb · 88 | Family Draft: boost yourself and the last-place car |
| Jett Prism | Full Spectrum · 24 | Prism Break: pressure the leader and surge forward |
| Troy Smoke | Orange Outlaw · 20 | Smoke Screen: slow nearby rivals |
| Miles Seven | Cobalt Dynasty · 48 | Seven-Time Surge: sustained speed boost |
| Rowdy Candy | Sugar Rush · 18 | Sugar Rush: a big straight-line burst |
| Ricky Crown | Royal Blue · 43 | King's Command: slow the leader |

The stock-car base is **[Stock Camry NS by WiyantoID](https://wiyantoid.itch.io/stock-camry-ns)**, released under **CC0**. The original source and license are retained, with our refined runtime mesh, fictional liveries, numbers, materials, and rendered preview images. See [model credits](assets/CREDITS.md). The team graphics and synthesized engine audio are original. No driver photographs, real voices, or official team sponsor artwork are included. The game is an independent parody, unaffiliated with NASCAR. Inspiration reference: [NASCAR's 75 Greatest Drivers](https://www.nascar.com/nascar75-greatest-drivers-timeline/).

The **Garage showroom** lets you rotate and zoom each car and select it for racing. The runtime model has 10,356 triangles and is shared by all seven cars through one 582,992-byte download. Wheels turn from actual race distance; the visuals cannot change race results.

`tools/prepare-car.py` refines the retained source in Blender 5.2 with small body-edge bevels and weighted panel normals. `tools/render-car-thumbnails.mjs` renders the seven previews from the local Garage. `npm run test:models` checks the showroom, car selection, shared download, racing view, phone layout, and browser errors against the local running game.

## Run locally

Requires Node.js 24.13 or newer (built-in SQLite).

```powershell
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:8771/`. Set `GAME_DB`, `HOST`, and `PORT` to override the local defaults. The default database is `server/data/game.sqlite`; it is excluded from Git. Production uses `/home/carrace/data/game.sqlite`, outside every application release. CarRace accounts and coins are separate from HorseRace and Laravel.

```powershell
npm test
npm run test:browser
```

Browser tests use installed Chrome and exercise a prefix-rejecting proxy at `/carrace/`, two independent desktop/mobile sessions, upgrades, bets, synchronized races, paid abilities, exactly-once settlement, account persistence after reopening SQLite, and phone layouts. Temporary browser accounts and databases are local fixtures, never copied to production. Screenshots and reports are in ignored `review/`.

`node tests/live.mjs` is a separate live-site verification. It creates two verification accounts with free coins, uses a private room, follows a complete race on the real server clock, verifies fees and payouts, and leaves the room afterward. It retains those accounts and their legitimate race history. See [deployment status](deploy/STATUS.md) for the verified release.

`node tests/speedway-browser.mjs` checks the enlarged course and a 24° corner during practice, including Chase, Trackside, and mobile views. `tests/speedway.test.js` covers continuous road frames, banking validation, causal race inputs, and legacy/pending race compatibility.

`npm run test:playback` sends deliberately uneven, delayed room/account responses to the real renderer and checks continuous movement, bounded playback speed, confirmed-history limits and a paid ability while polling overlaps. Live playback buffers confirmed movement, adjusts its pace without seeking, ignores older snapshots and plays through the final buffered finish. Static venue structures share drawing batches, and finish crossings are cached per snapshot.

## Deployment

The administrator installer in `deploy/install-carrace.sh` is prepared for the inspected Ubuntu/Nginx host. It refuses to proceed if the existing hosting file or Laravel environment hash has changed, if `/carrace/` is already configured, or if port 8771 is occupied. This is an **initial-install script**, not an update script.

**Visual-only updates:** run `npm run build`, then `node package-visuals.mjs`. Upload `review/visuals-deploy/` to `/home/john/carrace-visuals/` and run `sudo bash /home/john/carrace-visuals/update-visuals.sh`. The script copies licensed assets and immutable hashed JavaScript/CSS, then atomically replaces only CarRace's HTML entry point. It preserves old scripts/styles for already-open tabs and does not restart any service, change hosting configuration, modify the backend, or touch player data. It verifies protected hashes and all existing service PIDs before/after. The recorded HTML backup is sufficient to restore the previous presentation.

**Speedway backend update:** after a build and commit, `node package-speedway.mjs` prepares the release. Upload `review/speedway-deploy/` to `/home/john/carrace-speedway/` and run `sudo bash /home/john/carrace-speedway/update-speedway.sh`. This creates a private online SQLite backup, preflights the new server against a private copy on loopback port 8772, selects the new application release, and restarts only `carrace.service`. It adds the `race_tracks` table without rewriting existing accounts or race records. Hosting, Laravel, HorseRace, and schedules stay unchanged. Refresh existing browser tabs for the new speedway view.

1. Build and test. Commit the intended source.
2. Run `node package-release.mjs` to create the production-only archive and checksums under `review/deploy/`.
3. Upload those files to `/home/john/carrace-deploy/`.
4. Run `sudo bash /home/john/carrace-deploy/install-carrace.sh` on the server.

CarRace gets its own unprivileged `carrace` account, `/home/carrace` directory, copied Node binary, database, loopback listener at `127.0.0.1:8771`, and systemd service. It is capped at 144 MiB and 30% of one CPU, with low scheduling priority. Its process cannot access Laravel, MySQL, or HorseRace files. No global runtime installation or package-manager changes occur.

Nginx receives exactly one additional include for the new `/carrace/` prefix, then a graceful reload. Laravel files, `.env`, database, services, cron jobs, certificates, and HorseRace stay intact. The installer snapshots protected file hashes and existing service PIDs, then verifies the same values after installation. Failed installation restores the previous host configuration and stops only CarRace; new data is retained for diagnosis.

Hosting rollback: restore the recorded `/var/backups/carrace-deploy-*/streakchat.app.before` to its original path, validate Nginx, gracefully reload it, and disable only `carrace.service`. Preserve `/home/carrace/data`. Do not copy a running WAL database without its journal or a SQLite backup operation.

This version has no password-reset workflow. Daily/off-server database backups are not yet configured.
