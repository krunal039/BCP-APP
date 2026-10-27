#!/usr/bin/env bash
# Curl-able auth/RBAC smoke against a running API (default http://localhost:3001).
# Prerequisites: migrate + seed admin, API listening.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
ADMIN_USER="${SEED_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-ChangeMeAdmin1!}"

echo "== health =="
curl -sS "$BASE_URL/health" | tee /tmp/bcp-health.json
echo

echo "== login as admin =="
LOGIN=$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
echo "$LOGIN" | tee /tmp/bcp-login.json
TOKEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/bcp-login.json","utf8")); if(!j.accessToken) process.exit(1); process.stdout.write(j.accessToken)')

echo
echo "== /auth/me =="
curl -sS "$BASE_URL/auth/me" -H "authorization: Bearer $TOKEN" | tee /tmp/bcp-me.json
echo

echo "== create sender =="
CREATE=$(curl -sS -X POST "$BASE_URL/users" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"username":"smoke_sender","password":"SenderPass1234","displayName":"Smoke Sender","roles":["sender"],"urgentBypass":false}')
echo "$CREATE" | tee /tmp/bcp-create.json
echo

echo "== sender login + rbac probes =="
SLOGIN=$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"smoke_sender","password":"SenderPass1234"}')
STOKEN=$(node -e "const j=JSON.parse(process.argv[1]); process.stdout.write(j.accessToken)" "$SLOGIN")

echo "sender route:" 
curl -sS -o /tmp/bcp-sender.json -w "%{http_code}\n" "$BASE_URL/rbac/sender" -H "authorization: Bearer $STOKEN"
echo "approver route (expect 403):"
curl -sS -o /tmp/bcp-approver.json -w "%{http_code}\n" "$BASE_URL/rbac/approver" -H "authorization: Bearer $STOKEN"

echo
echo "== logout sender =="
curl -sS -X POST "$BASE_URL/auth/logout" -H "authorization: Bearer $STOKEN"
echo
echo "me after logout (expect 401):"
curl -sS -o /tmp/bcp-me2.json -w "%{http_code}\n" "$BASE_URL/auth/me" -H "authorization: Bearer $STOKEN"

echo
echo "Smoke complete."
