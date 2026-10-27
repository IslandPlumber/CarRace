#!/bin/bash
# Isolated CarRace release: back up its database, preflight a private clone,
# atomically select the release, then restart only carrace.service.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
payload=/home/john/carrace-speedway
cd "$payload"
sha256sum --check --strict release.sha256
previous=$(readlink -f /home/carrace/app)
case "$previous" in /home/carrace/releases/*) ;; *) echo 'Unexpected application path.' >&2; exit 1;; esac
test "$(systemctl is-active carrace)" = active
test -z "$(ss -H -ltn 'sport = :8772')"
backup=$(mktemp -d /var/backups/carrace-speedway-20261027-XXXXXX)
sha256sum /var/www/game/.env /etc/nginx/nginx.conf /etc/nginx/sites-available/streakchat.app /etc/nginx/snippets/carrace-location.conf /etc/nginx/snippets/horserace-location.conf /etc/systemd/system/carrace.service /etc/systemd/system/horserace.service > "$backup/protected.sha256"
find /var/spool/cron/crontabs /etc/cron.d /etc/cron.daily /etc/letsencrypt/renewal -maxdepth 1 -type f -exec sha256sum {} + > "$backup/schedules.sha256"
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace -p Id -p MainPID -p ActiveState > "$backup/services.before"
printf '%s\n' "$previous" > "$backup/previous-app"
python3 - "$backup/game.sqlite" <<'PY'
import sqlite3,sys
with sqlite3.connect('file:/home/carrace/data/game.sqlite?mode=ro',uri=True) as source:
    with sqlite3.connect(sys.argv[1]) as dest:
        source.backup(dest)
        assert dest.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
print('Private online SQLite backup verified.')
PY
hash=$(sha256sum carrace-release.tar.gz | cut -d' ' -f1)
release="/home/carrace/releases/speedway-${hash:0:16}"
test ! -e "$release"
install -d -m 750 -o root -g carrace "$release"
python3 - "$payload/carrace-release.tar.gz" "$release" <<'PY'
from pathlib import PurePosixPath
import tarfile,sys
with tarfile.open(sys.argv[1],'r:gz') as archive:
    for m in archive.getmembers():
        p=PurePosixPath(m.name)
        assert not p.is_absolute() and '..' not in p.parts and not m.issym() and not m.islnk()
        assert m.isfile() or m.isdir()
        assert p.parts[0] in {'server','site','package.json','race-core.js','track.js','powers.js','betting.js','progression.js','REVISION'}
    archive.extractall(sys.argv[2])
PY
chown -R root:carrace "$release"
find "$release" -type d -exec chmod 750 {} +
find "$release" -type f -exec chmod 640 {} +
candidate_db="/home/carrace/data/preflight-${hash:0:16}.sqlite"
install -m 600 -o carrace -g carrace "$backup/game.sqlite" "$candidate_db"
candidate=''
changed=0
stop_candidate(){ if test -n "$candidate"; then kill "$candidate" 2>/dev/null || true; wait "$candidate" 2>/dev/null || true; candidate=''; fi; }
rollback(){ code=$?; trap - ERR; stop_candidate; if test "$changed" = 1; then ln -s "$previous" /home/carrace/.app-rollback; mv -Tf /home/carrace/.app-rollback /home/carrace/app; systemctl restart carrace.service; fi; echo "CarRace update stopped. Previous application retained. Private data backup: $backup/game.sqlite" >&2; exit "$code"; }
trap rollback ERR
# Check the new runtime against the private DB clone before touching the live service.
runuser -u carrace -- env HOST=127.0.0.1 PORT=8772 GAME_DB="$candidate_db" TRUST_PROXY=1 NODE_OPTIONS=--max-old-space-size=80 /home/carrace/runtime/bin/node "$release/server/start.js" > "$backup/preflight.log" 2>&1 &
candidate=$!
for n in $(seq 1 20); do curl --max-time 2 --fail --silent http://127.0.0.1:8772/api/health >/dev/null && break; sleep 1; done
curl --max-time 5 --fail --silent --show-error http://127.0.0.1:8772/api/health
curl --max-time 5 --fail --silent --show-error http://127.0.0.1:8772/ -o "$backup/preflight-index.html"
grep -q showroom-canvas "$backup/preflight-index.html"
stop_candidate
for n in $(seq 1 10); do test -z "$(ss -H -ltn 'sport = :8772')" && break; sleep 1; done
test -z "$(ss -H -ltn 'sport = :8772')"
ln -s "$release" /home/carrace/.app-speedway-next
mv -Tf /home/carrace/.app-speedway-next /home/carrace/app
changed=1
systemctl restart carrace.service
for n in $(seq 1 20); do curl --max-time 2 --fail --silent http://127.0.0.1:8771/api/health >/dev/null && break; sleep 1; done
curl --max-time 5 --fail --silent --show-error https://streakchat.app/carrace/api/health
for p in / /login /picks /ai-leaderboard /horserace/api/health; do
 test "$(curl --max-time 20 --fail --silent --show-error -o /dev/null -w '%{http_code}' "https://streakchat.app$p")" = 200
done
sha256sum --check --strict "$backup/protected.sha256"
sha256sum --check --strict "$backup/schedules.sha256"
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace -p Id -p MainPID -p ActiveState > "$backup/services.after"
cmp "$backup/services.before" "$backup/services.after"
test "$(systemctl is-active carrace)" = active
trap - ERR
printf '\nLarger banked speedway published. Only CarRace restarted.\nPlayer data retained; previous races keep their frozen track.\nBackup: %s\n' "$backup"
systemctl show carrace -p MainPID -p ActiveState -p NRestarts -p MemoryCurrent
