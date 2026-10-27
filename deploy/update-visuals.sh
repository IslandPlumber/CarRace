#!/bin/bash
# Publish CarRace's static presentation without restarting any application.
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
payload=/home/john/carrace-visuals
cd "$payload"
sha256sum --check --strict visuals.sha256
app=$(readlink -f /home/carrace/app)
case "$app" in /home/carrace/releases/*) ;; *) echo 'Unexpected CarRace application path' >&2; exit 1;; esac
web="$app/site"
test -d "$web" && test ! -L "$web"
test "$(systemctl is-active carrace)" = active
test "$(systemctl is-active horserace)" = active
backup=$(mktemp -d /var/backups/carrace-visuals-20261027-XXXXXX)
cp -a "$web/index.html" "$backup/index.html.before"
sha256sum /var/www/game/.env /etc/nginx/nginx.conf /etc/nginx/sites-available/streakchat.app /etc/nginx/snippets/carrace-location.conf /etc/nginx/snippets/horserace-location.conf /etc/systemd/system/carrace.service /etc/systemd/system/horserace.service > "$backup/protected.sha256"
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace carrace -p Id -p MainPID -p ActiveState > "$backup/services.before"
sha256sum "$app/server/"*.js > "$backup/server.sha256"
sha256sum "$web/app.js" "$web/style.css" > "$backup/legacy-web.sha256"
stage=$(mktemp -d /home/carrace/visuals-stage-XXXXXX)
chmod 750 "$stage"
chown root:carrace "$stage"
rollback(){ code=$?; trap - ERR; cp -a "$backup/index.html.before" "$web/index.html"; echo "Visual update stopped; previous CarRace page restored. Backup: $backup" >&2; exit "$code"; }
trap rollback ERR
python3 - "$payload/carrace-visuals.tar.gz" "$stage" "$web" <<'PY'
import os,re,sys,tarfile,shutil
from pathlib import Path,PurePosixPath
archive,stage,web=sys.argv[1],Path(sys.argv[2]),Path(sys.argv[3])
with tarfile.open(archive,'r:gz') as tar:
    for m in tar.getmembers():
        p=PurePosixPath(m.name)
        assert not p.is_absolute() and '..' not in p.parts and not m.issym() and not m.islnk()
        assert m.isfile() or m.isdir()
        assert p.parts[0]=='site'
    tar.extractall(stage)
source=stage/'site'
html=(source/'index.html').read_text()
js=re.findall(r'src="\./(app-[a-f0-9]{12}\.js)"',html)
css=re.findall(r'href="\./(style-[a-f0-9]{12}\.css)"',html)
assert len(js)==len(css)==1
assert (source/'assets/cars/stock-car.glb').is_file()
# Asset names in the page are immutable hashes. Keep the original app.js and
# style.css available to tabs still using the previous HTML.
shutil.copytree(source/'assets',web/'assets',dirs_exist_ok=True)
for name in js+css:
    shutil.copy2(source/name,web/name)
for folder,dirs,files in os.walk(web/'assets'):
    os.chown(folder,0,__import__('grp').getgrnam('carrace').gr_gid);os.chmod(folder,0o750)
    for name in files:
        p=Path(folder)/name;os.chown(p,0,__import__('grp').getgrnam('carrace').gr_gid);os.chmod(p,0o640)
for name in js+css:
    os.chown(web/name,0,__import__('grp').getgrnam('carrace').gr_gid);os.chmod(web/name,0o640)
temporary=web/'.index-visuals.tmp'
shutil.copy2(source/'index.html',temporary)
os.chown(temporary,0,__import__('grp').getgrnam('carrace').gr_gid);os.chmod(temporary,0o640)
os.replace(temporary,web/'index.html')
PY
curl --max-time 20 --fail --silent --show-error https://streakchat.app/carrace/ -o "$backup/live-index.html"
grep -q showroom-canvas "$backup/live-index.html"
for p in / /login /picks /ai-leaderboard /horserace/api/health /carrace/api/health /carrace/assets/cars/stock-car.glb; do
 test "$(curl --max-time 20 --fail --silent --show-error -o /dev/null -w '%{http_code}' "https://streakchat.app$p")" = 200
done
sha256sum --check --strict "$backup/protected.sha256"
sha256sum --check --strict "$backup/server.sha256"
sha256sum --check --strict "$backup/legacy-web.sha256"
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace carrace -p Id -p MainPID -p ActiveState > "$backup/services.after"
cmp "$backup/services.before" "$backup/services.after"
trap - ERR
echo "CarRace models published. No service restarted, hosting configuration changed, or database touched."
echo "Rollback HTML: $backup/index.html.before"
