#!/bin/bash
# Initial installation only, prepared for the inspected streakchat.app server.
# No Laravel commands, credentials, source writes, database changes or restarts.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run this installer with sudo.' >&2; exit 1; }
payload=/home/john/carrace-deploy
site=/etc/nginx/sites-available/streakchat.app
test "$(readlink -f /etc/nginx/sites-enabled/streakchat.app)" = "$site"
test "$(sha256sum "$site" | cut -d' ' -f1)" = 52967fa4e3a1632f989c0bef651862446102b350721e24a799b16aed6040ebbf
test "$(sha256sum /var/www/game/.env | cut -d' ' -f1)" = 3a9c4d500c454fabc65bea94a0a094d5bb3cb5649f1c870e4970335aa1bd7b93
test "$(sha256sum /home/horserace/runtime/bin/node | cut -d' ' -f1)" = e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb
test ! -e /etc/systemd/system/carrace.service
test ! -e /etc/nginx/snippets/carrace-location.conf
test ! -e /home/carrace
test -z "$(getent passwd carrace)"
test -z "$(ss -H -ltn 'sport = :8771')"
cd "$payload"
sha256sum --check --strict payload.sha256
test "$(curl --max-time 20 --fail --silent --show-error -o /dev/null -w '%{http_code}' https://streakchat.app/)" = 200
test "$(curl --max-time 20 --fail --silent --show-error -o /dev/null -w '%{http_code}' https://streakchat.app/horserace/api/health)" = 200
nginx -t
backup=$(mktemp -d /var/backups/carrace-deploy-20261027-XXXXXX)
chmod 700 "$backup"
cp -a "$site" "$backup/streakchat.app.before"
# Only hashes leave these protected files; their contents are never exposed.
sha256sum /var/www/game/.env /etc/nginx/nginx.conf /etc/nginx/sites-enabled/game /etc/nginx/sites-enabled/digitalocean /etc/nginx/snippets/horserace-location.conf /etc/systemd/system/horserace.service /etc/letsencrypt/live/streakchat.app/fullchain.pem /etc/letsencrypt/live/streakchat.app/privkey.pem > "$backup/protected-before.sha256"
find /var/spool/cron/crontabs /etc/cron.d /etc/cron.daily /etc/letsencrypt/renewal -maxdepth 1 -type f -exec sha256sum {} + > "$backup/schedules-before.sha256"
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace -p Id -p MainPID -p ActiveState > "$backup/services-before.txt"
git -c safe.directory=/var/www/game -C /var/www/game rev-parse HEAD > "$backup/laravel-revision.before"
git -c safe.directory=/var/www/game -C /var/www/game status --porcelain --untracked-files=no > "$backup/laravel-status.before"
changed=0
rollback(){
 code=$?
 trap - ERR
 echo "Installation stopped. Rolling back only CarRace hosting. Backup: $backup" >&2
 systemctl disable --now carrace.service >/dev/null 2>&1 || true
 if test "$changed" = 1; then cp -a "$backup/streakchat.app.before" "$site"; nginx -t && systemctl reload nginx; fi
 # Keep the new application and any new player data for diagnosis; no data deletion.
 exit "$code"
}
trap rollback ERR
useradd --system --user-group --create-home --home-dir /home/carrace --shell /usr/sbin/nologin carrace
chmod 750 /home/carrace
install -d -m 750 -o root -g carrace /home/carrace/releases /home/carrace/runtime /home/carrace/runtime/bin
install -d -m 700 -o carrace -g carrace /home/carrace/data /home/carrace/data/backups
# Copy the already-tested binary into a separate runtime. Do not change any global Node installation.
install -m 755 -o root -g root /home/horserace/runtime/bin/node /home/carrace/runtime/bin/node
archive_hash=$(sha256sum carrace-release.tar.gz | cut -d' ' -f1)
release="/home/carrace/releases/${archive_hash:0:16}"
install -d -m 750 -o root -g carrace "$release"
python3 - "$payload/carrace-release.tar.gz" "$release" <<'PY'
import sys,tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1],'r:gz') as archive:
    for member in archive.getmembers():
        p=PurePosixPath(member.name)
        assert not p.is_absolute() and '..' not in p.parts and not member.issym() and not member.islnk()
        assert member.isfile() or member.isdir()
        assert p.parts[0] in {'server','site','package.json','race-core.js','track.js','powers.js','betting.js','progression.js','REVISION'}
    archive.extractall(sys.argv[2])
PY
chown -R root:carrace "$release"
find "$release" -type d -exec chmod 750 {} +
find "$release" -type f -exec chmod 640 {} +
ln -s "$release" /home/carrace/app
install -m 644 -o root -g root carrace.service /etc/systemd/system/carrace.service
install -m 644 -o root -g root carrace-location.conf /etc/nginx/snippets/carrace-location.conf
systemd-analyze verify /etc/systemd/system/carrace.service
systemctl daemon-reload
systemctl enable --now carrace.service
for n in $(seq 1 20); do curl --max-time 3 --fail --silent http://127.0.0.1:8771/api/health >/dev/null && break; sleep 1; done
curl --max-time 5 --fail --silent --show-error http://127.0.0.1:8771/api/health
python3 - "$site" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);text=p.read_text()
anchor='    include /etc/nginx/snippets/horserace-location.conf;'
assert text.count(anchor)==1 and '/carrace' not in text
p.write_text(text.replace(anchor,anchor+'\n    include /etc/nginx/snippets/carrace-location.conf;',1))
PY
changed=1
nginx -t
# Graceful reload only: keep the Nginx master and all Laravel services running.
systemctl reload nginx
for n in $(seq 1 30); do code=$(curl --max-time 3 --silent -o /dev/null -w '%{http_code}' https://streakchat.app/carrace/api/health || true); test "$code" = 200 && break; sleep 1; done
test "$code" = 200
curl --max-time 15 --fail --silent --show-error https://streakchat.app/carrace/api/health
curl --max-time 15 --fail --silent --show-error -o "$backup/carrace-index.html" https://streakchat.app/carrace/
grep -q 'StreakChat Speedway' "$backup/carrace-index.html"
for p in / /login /picks /ai-leaderboard /horserace/api/health; do
 test "$(curl --max-time 20 --fail --silent --show-error -o /dev/null -w '%{http_code}' "https://streakchat.app$p")" = 200
done
test "$(curl --max-time 15 --silent -o /dev/null -w '%{http_code}' https://streakchat.app/leaderboard)" = 302
sha256sum --check --strict "$backup/protected-before.sha256"
sha256sum --check --strict "$backup/schedules-before.sha256"
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace -p Id -p MainPID -p ActiveState > "$backup/services-after.txt"
cmp "$backup/services-before.txt" "$backup/services-after.txt"
git -c safe.directory=/var/www/game -C /var/www/game rev-parse HEAD > "$backup/laravel-revision.after"
cmp "$backup/laravel-revision.before" "$backup/laravel-revision.after"
git -c safe.directory=/var/www/game -C /var/www/game status --porcelain --untracked-files=no > "$backup/laravel-status.after"
cmp "$backup/laravel-status.before" "$backup/laravel-status.after"
python3 - "$site" "$backup/streakchat.app.before" <<'PY'
from pathlib import Path
import sys
after=Path(sys.argv[1]).read_bytes();before=Path(sys.argv[2]).read_bytes()
addition=b'\n    include /etc/nginx/snippets/carrace-location.conf;'
assert after.count(addition)==1 and after.replace(addition,b'',1)==before
PY
trap - ERR
printf '\nCarRace installed: https://streakchat.app/carrace/\nExisting Laravel and HorseRace service PIDs and protected file hashes match.\nBackup: %s\n' "$backup"
systemctl show carrace.service -p ActiveState -p MainPID -p MemoryCurrent -p MemoryMax
