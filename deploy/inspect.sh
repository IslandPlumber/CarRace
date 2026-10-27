#!/bin/bash
set -euo pipefail
for p in / /login /picks /ai-leaderboard /leaderboard /horserace/api/health /carrace/api/health; do
 curl --max-time 20 --silent --show-error -o /dev/null -w "$p %{http_code}\n" "https://streakchat.app$p"
done
systemctl show nginx php8.0-fpm php8.1-fpm mysql cron horserace carrace -p Id -p ActiveState -p MainPID -p MemoryCurrent
sha256sum /var/www/game/.env /etc/nginx/nginx.conf /etc/nginx/sites-enabled/game /etc/nginx/sites-enabled/digitalocean /etc/nginx/snippets/horserace-location.conf /etc/systemd/system/horserace.service
stat -c 'scheduler last write: %y' /var/www/game/storage/logs/scheduler.log
free -m
ss -H -ltn 'sport = :8771'
