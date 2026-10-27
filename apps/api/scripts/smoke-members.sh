#!/usr/bin/env bash
# Curl-able members/groups smoke against a running API (default http://localhost:3001).
# Prerequisites: migrate + seed admin, API listening.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
ADMIN_USER="${SEED_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-ChangeMeAdmin1!}"

echo "== login as admin =="
LOGIN=$(curl -sS -X POST "$BASE_URL/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
TOKEN=$(node -e 'const j=JSON.parse(process.argv[1]); if(!j.accessToken) process.exit(1); process.stdout.write(j.accessToken)' "$LOGIN")

echo "== create member (DRC) =="
MEMBER=$(curl -sS -X POST "$BASE_URL/members" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"displayName":"Smoke Member","e164":"+243911111111"}')
echo "$MEMBER" | tee /tmp/bcp-member.json
MEMBER_ID=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/bcp-member.json","utf8")); process.stdout.write(j.member.id)')

echo
echo "== create group + add member =="
GROUP=$(curl -sS -X POST "$BASE_URL/groups" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Smoke Group","description":"smoke"}')
echo "$GROUP" | tee /tmp/bcp-group.json
GROUP_ID=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/bcp-group.json","utf8")); process.stdout.write(j.group.id)')

curl -sS -X POST "$BASE_URL/groups/$GROUP_ID/members" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"memberIds\":[\"$MEMBER_ID\"]}" | tee /tmp/bcp-group-add.json
echo

echo "== resolve phones =="
curl -sS "$BASE_URL/groups/$GROUP_ID/phones" -H "authorization: Bearer $TOKEN" | tee /tmp/bcp-phones.json
echo

echo "== CSV import =="
curl -sS -X POST "$BASE_URL/members/import" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: text/csv' \
  --data-binary $'displayName,e164,countryCode,groupName\nCSV Member,+243922222222,CD,Smoke Group\n' \
  | tee /tmp/bcp-import.json
echo

echo "== list members (paginated) =="
curl -sS "$BASE_URL/members?limit=5" -H "authorization: Bearer $TOKEN" | tee /tmp/bcp-members.json
echo

echo "Smoke members/groups complete."
