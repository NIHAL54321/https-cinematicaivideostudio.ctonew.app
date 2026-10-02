#!/bin/bash
# Restart the product app on :3100 only. :3000 belongs to the platform's site
# dev server — never bind it and never kill that process.
cd /home/team/app || exit 1
pkill -f "next-server" 2>/dev/null
pkill -f "next start" 2>/dev/null
sleep 2
setsid nohup bunx next start -p 3100 > /tmp/cavs3100.log 2>&1 &
code=""
for _ in $(seq 1 30); do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:3100/api/health" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "health=$code"
