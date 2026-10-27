# Verified CarRace deployment — October 27, 2026

**Live URL:** https://streakchat.app/carrace/

**Production application revision:** `06764f5a0f121df6439469bb8e4b10b3e7b389e4`

**Repository:** https://github.com/IslandPlumber/CarRace

**Administrator backup:** `/var/backups/carrace-deploy-20261027-XeDvxW`

## Isolation

CarRace runs as `carrace` from `/home/carrace/app`, with its own Node binary at `/home/carrace/runtime/bin/node`, SQLite data at `/home/carrace/data/game.sqlite`, and enabled `carrace.service`. Its listener is only `127.0.0.1:8771`. Memory is capped at 144 MiB, with 96 MiB pressure handling, 30% CPU quota, and low scheduling priority. The service cannot read Laravel, MySQL, john's home, or HorseRace files.

The HTTPS host changed only by this additional include:

```nginx
    include /etc/nginx/snippets/carrace-location.conf;
```

Removing that exact added line from the current host produces the original SHA256 `52967fa4e3a1632f989c0bef651862446102b350721e24a799b16aed6040ebbf`. Nginx was gracefully reloaded; its master process was not restarted.

## Existing applications

The installer verified protected Laravel, hosting, certificate, and schedule hashes before/after installation, and compared the existing service PIDs. Independent follow-up checks confirmed:

- Nginx PID `2151510`, PHP 8.0 PID `2291714`, PHP 8.1 PID `2291728`, MySQL PID `2291840`, cron PID `2291681`, and HorseRace PID `3486702` stayed unchanged and active.
- Laravel `.env` SHA256 remained `3a9c4d500c454fabc65bea94a0a094d5bb3cb5649f1c870e4970335aa1bd7b93`.
- Global Nginx config, other enabled hosts, and HorseRace's snippet and service unit hashes stayed unchanged.
- `/`, `/login`, `/picks`, and `/ai-leaderboard` returned 200. Protected `/leaderboard` returned its expected 302. `/horserace/api/health` returned 200.
- Laravel remained at revision `071af692b68922b55d0a9bc54018432300df15cf`. Its scheduler log continued updating.
- Both `streakchat.app/carrace/` and `www.streakchat.app/carrace/` returned 200 over verified HTTPS.

## Verification

All **84 automated tests passed**, including real movement effects, causal live history, private results, authentication, purchases, bets, exactly-once settlement, SQLite reopening, and workshop balance. A separate local browser test passed two independent desktop/mobile sessions under a rejecting `/carrace/` prefix proxy.

Live browser verification completed at **2026-10-27 05:06:19 UTC**. Two independent sessions registered, selected different stock cars, shared a private room, bought an engine upgrade, placed Win/Show tickets, and used both paid abilities once. Both clients observed the same official race. Final balances matched actual finish prizes and ticket returns; both of this run's tickets lost correctly. Guaranteed winning-ticket returns are covered by the passing backend tests. Reload restored the saved account balance and upgrade. History contained only races with a ticket. The verification players left the room afterward.

Live race ID: `b57c6549-dc7c-4d9c-a9b3-d31a147860f7`. No browser errors, mobile horizontal overflow, or requests outside `/carrace/` were observed. CarRace recorded zero automatic failure restarts during verification. Its memory remained below the configured limit.

Local evidence, excluded from Git: `review/unit-tests.log`, `review/browser-report.json`, `review/live/report.json`, screenshots under `review/live/`, and `review/deployment-after.log`.

The initial installer should **not** be rerun on this installed server. Preserve `/home/carrace/data` during future releases. Daily/off-server database backups and password reset are not configured in this version.
