# CarRace — StreakChat Speedway

A standalone stock-car racing club at **`/carrace/`**, built from the HorseRace game engine. Seven fictional drivers race original numbered stock cars with signature abilities. The cast takes its cues from classic stock-car liveries and personalities, including the black No. 03, red No. 88, rainbow No. 24, orange No. 20, cobalt No. 48, candy-green No. 18, and royal-blue No. 43.

## Play

- **Practice race:** no account needed; one free ability per exhibition race.
- **Race club:** register for 1,000 free coins; join the main room or share a private room code. Seven seats, with CPU cars filling empty places.
- **Race:** the host opens 30 seconds of optional betting, then the server starts the race. Use your signature move after the starting lights. It costs 75 free coins, once per race; garage upgrades can reduce that to 50.
- **Win / Place / Show:** 4× / 2× / 1.5× returns including stake, for first / top two / top three. One ticket per type, 10–500 coins. Past bets shows only races you placed a bet on.
- **Garage:** persistent engine, handling, chassis, team, and power upgrades. Finishing prizes and points are awarded once. No purchases or cash-out.
- **Cameras:** Overview, Chase, Trackside. Optional synthesized engine sound.

| Fictional driver | Stock car | Signature move |
|---|---|---|
| Duke Ironhart | Midnight Thunder · 03 | Bump & Run: boost and disrupt nearby rivals |
| Redline Junior | Cherry Bomb · 88 | Family Draft: boost yourself and the last-place car |
| Jett Prism | Full Spectrum · 24 | Prism Break: pressure the leader and surge forward |
| Troy Smoke | Orange Outlaw · 20 | Smoke Screen: slow nearby rivals |
| Miles Seven | Cobalt Dynasty · 48 | Seven-Time Surge: sustained speed boost |
| Rowdy Candy | Sugar Rush · 18 | Sugar Rush: a big straight-line burst |
| Ricky Crown | Royal Blue · 43 | King's Command: slow the leader |

The cars, team logos, graphics and engine audio are original procedural assets. No driver photographs, real voices, sponsor logos, or imported car models. The game is an independent parody, unaffiliated with NASCAR. Inspiration reference: [NASCAR's 75 Greatest Drivers](https://www.nascar.com/nascar75-greatest-drivers-timeline/).

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

## Deployment

The administrator installer in `deploy/install-carrace.sh` is prepared for the inspected Ubuntu/Nginx host. It refuses to proceed if the existing hosting file or Laravel environment hash has changed, if `/carrace/` is already configured, or if port 8771 is occupied. This is an **initial-install script**, not an update script.

1. Build and test. Commit the intended source.
2. Run `node package-release.mjs` to create the production-only archive and checksums under `review/deploy/`.
3. Upload those files to `/home/john/carrace-deploy/`.
4. Run `sudo bash /home/john/carrace-deploy/install-carrace.sh` on the server.

CarRace gets its own unprivileged `carrace` account, `/home/carrace` directory, copied Node binary, database, loopback listener at `127.0.0.1:8771`, and systemd service. It is capped at 144 MiB and 30% of one CPU, with low scheduling priority. Its process cannot access Laravel, MySQL, or HorseRace files. No global runtime installation or package-manager changes occur.

Nginx receives exactly one additional include for the new `/carrace/` prefix, then a graceful reload. Laravel files, `.env`, database, services, cron jobs, certificates, and HorseRace stay intact. The installer snapshots protected file hashes and existing service PIDs, then verifies the same values after installation. Failed installation restores the previous host configuration and stops only CarRace; new data is retained for diagnosis.

Hosting rollback: restore the recorded `/var/backups/carrace-deploy-*/streakchat.app.before` to its original path, validate Nginx, gracefully reload it, and disable only `carrace.service`. Preserve `/home/carrace/data`. Do not copy a running WAL database without its journal or a SQLite backup operation.

This version has no password-reset workflow. Daily/off-server database backups are not yet configured.
