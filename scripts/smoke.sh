#!/usr/bin/env bash
# End-to-end smoke test against a running RaveWall server.
#
#   PORT=3999 bash scripts/smoke.sh
#
# Covers the launch acceptance path: health, static shell, anonymous reach,
# signup/login/logout, business setup, slug uniqueness, submission, the pending
# state, approve/reject/delete, public wall visibility, cross-tenant isolation
# and rate limiting.
#
# Run it against an instance whose rate-limit window is clear. The submission and
# auth counters live in Postgres and survive a restart, so either start the
# server against a fresh database or wait out RATE_LIMIT_SUBMIT_WINDOW_MS. For a
# local run, an in-memory database guarantees both a clean schema and a clean
# window:
#
#   PGLITE_DIR=memory PORT=3999 node scripts/dev-server.mjs
#
# The script detects an exhausted window, says so, and exits 2 rather than
# reporting misleading failures.
set -u

# Bypass any HTTP proxy configured in the environment — a proxy would intercept
# requests to loopback and break every check.
curl() { command curl --noproxy '*' "$@"; }

BASE="http://127.0.0.1:${PORT:-3999}"
SLUG="smoke-$RANDOM"
EMAIL="smoke-$RANDOM@example.com"
PASSWORD='Passw0rd!'
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ok   $label ($actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $label — expected $expected, got $actual"
    FAIL=$((FAIL + 1))
  fi
}

contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  ok   $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $label — '$needle' not found"
    FAIL=$((FAIL + 1))
  fi
}

absent() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "  ok   $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $label — '$needle' should not be present"
    FAIL=$((FAIL + 1))
  fi
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

not_ready() {
  echo
  echo "environment not ready: $1"
  echo "start the server against a fresh database (PGLITE_DIR=memory) and re-run."
  exit 2
}

# ---------------------------------------------------------------------------
echo "== health and static shell =="
check "GET /api/health" 200 "$(code "$BASE/api/health")"
HEALTH=$(curl -s "$BASE/api/health")
contains "health reports the database" '"database":"ok"' "$HEALTH"
check "GET /" 200 "$(code "$BASE/")"
check "GET /dashboard (SPA fallback)" 200 "$(code "$BASE/dashboard")"
check "GET /t/demo (SPA fallback)" 200 "$(code "$BASE/t/demo")"
check "GET /api/unknown" 404 "$(code "$BASE/api/unknown")"

HEADERS=$(curl -s -D - -o /dev/null "$BASE/")
contains "CSP header" "default-src 'self'" "$HEADERS"
contains "nosniff" "nosniff" "$HEADERS"
absent "no server banner" "X-Powered-By" "$HEADERS"

echo "== anonymous access is blocked =="
check "GET /api/testimonials unauthenticated" 401 "$(code "$BASE/api/testimonials")"
check "PATCH testimonial unauthenticated" 401 "$(code -X PATCH "$BASE/api/testimonials/00000000-0000-0000-0000-000000000000" \
  -H 'Content-Type: application/json' -d '{"status":"approved"}')"

echo "== signup =="
JAR="$(mktemp)"
SIGNUP=$(code -c "$JAR" -X POST "$BASE/api/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke Tester\"}")
[[ "$SIGNUP" == "429" ]] && not_ready "the auth rate limit for this IP is already exhausted."
check "POST /api/auth/signup" 201 "$SIGNUP"
check "GET /api/auth/me after signup" 200 "$(code -b "$JAR" "$BASE/api/auth/me")"
ME=$(curl -s -b "$JAR" "$BASE/api/auth/me")
contains "session identifies the account" "$EMAIL" "$ME"
absent "session response hides the password hash" 'passwordHash' "$ME"

echo "== login and logout =="
check "POST /api/auth/logout" 204 "$(code -b "$JAR" -X POST "$BASE/api/auth/logout")"
check "queue is closed after logout" 401 "$(code -b "$JAR" "$BASE/api/testimonials")"
check "POST /api/auth/login" 200 "$(code -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
# The business does not exist yet, so an owner endpoint that only requires a
# session is the right probe here.
check "authenticated after login" 200 "$(code -b "$JAR" "$BASE/api/business")"
ME2=$(curl -s -b "$JAR" "$BASE/api/auth/me")
contains "login restored the session" "$EMAIL" "$ME2"
check "login with a wrong password" 401 "$(code -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Wrong123\"}")"

echo "== business setup and slug uniqueness =="
check "POST /api/business" 201 "$(code -b "$JAR" -X POST "$BASE/api/business" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Studio\",\"slug\":\"$SLUG\",\"accentColor\":\"#0ea5e9\"}")"
check "POST /api/business again (conflict)" 409 "$(code -b "$JAR" -X POST "$BASE/api/business" \
  -H 'Content-Type: application/json' -d '{"name":"Other","slug":"other-name"}')"
TAKEN=$(curl -s -b "$JAR" "$BASE/api/business/slug-available?slug=$SLUG")
contains "taken slug is reported unavailable" '"available":false' "$TAKEN"

echo "== public submission =="
check "POST /api/public/submit valid" 201 "$(code -X POST "$BASE/api/public/submit/$SLUG" \
  -H 'Content-Type: application/json' \
  -d '{"rating":5,"name":"Priya Raman","company":"Cobalt Labs","text":"Fast, thoughtful and genuinely useful work."}')"
check "POST /api/public/submit invalid rating" 400 "$(code -X POST "$BASE/api/public/submit/$SLUG" \
  -H 'Content-Type: application/json' \
  -d '{"rating":9,"name":"A","text":"This body is long enough to pass validation."}')"
check "POST /api/public/submit short text" 400 "$(code -X POST "$BASE/api/public/submit/$SLUG" \
  -H 'Content-Type: application/json' -d '{"rating":5,"name":"A","text":"nope"}')"
check "POST /api/public/submit honeypot is discarded" 201 "$(code -X POST "$BASE/api/public/submit/$SLUG" \
  -H 'Content-Type: application/json' \
  -d '{"rating":5,"name":"Bot","text":"A perfectly plausible testimonial body.","website":"https://spam.example.com"}')"
check "POST /api/public/submit unknown slug" 404 "$(code -X POST "$BASE/api/public/submit/nope-nope" \
  -H 'Content-Type: application/json' \
  -d '{"rating":5,"name":"A","text":"This body is long enough to pass validation."}')"

echo "== moderation is required before publishing =="
PENDING=$(curl -s -b "$JAR" "$BASE/api/testimonials?status=pending")
contains "one pending submission" '"pending":1' "$PENDING"
contains "honeypot stored nothing" '"total":1' "$PENDING"
WALL=$(curl -s "$BASE/api/public/wall/$SLUG")
contains "wall is empty while pending" '"testimonials":[]' "$WALL"
absent "pending text is not public" 'Priya Raman' "$WALL"

ID=$(printf '%s' "$PENDING" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
if [[ -z "$ID" ]]; then
  echo "  FAIL could not extract testimonial id"
  FAIL=$((FAIL + 1))
else
  check "PATCH approve" 200 "$(code -b "$JAR" -X PATCH "$BASE/api/testimonials/$ID" \
    -H 'Content-Type: application/json' -d '{"status":"approved"}')"
fi

WALL2=$(curl -s "$BASE/api/public/wall/$SLUG")
contains "wall now shows the approved testimonial" 'Priya Raman' "$WALL2"
contains "wall average rating" '"averageRating":5' "$WALL2"
absent "wall hides moderation metadata" '"status"' "$WALL2"

echo "== reject, privacy and delete =="
check "submit a second testimonial" 201 "$(code -X POST "$BASE/api/public/submit/$SLUG" \
  -H 'Content-Type: application/json' \
  -d '{"rating":2,"name":"Reject Me","company":"Nowhere","text":"This submission should never reach the public wall."}')"
PENDING2=$(curl -s -b "$JAR" "$BASE/api/testimonials?status=pending")
ID2=$(printf '%s' "$PENDING2" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
if [[ -z "$ID2" ]]; then
  echo "  FAIL could not extract second testimonial id"
  FAIL=$((FAIL + 1))
else
  check "PATCH reject" 200 "$(code -b "$JAR" -X PATCH "$BASE/api/testimonials/$ID2" \
    -H 'Content-Type: application/json' -d '{"status":"rejected"}')"
  WALL3=$(curl -s "$BASE/api/public/wall/$SLUG")
  absent "rejected testimonial stays private" 'Reject Me' "$WALL3"
  contains "only the approved testimonial is public" '"count":1' "$WALL3"
  REJECTED=$(curl -s -b "$JAR" "$BASE/api/testimonials?status=rejected")
  contains "rejected testimonial is in the queue" 'Reject Me' "$REJECTED"

  check "DELETE testimonial" 200 "$(code -b "$JAR" -X DELETE "$BASE/api/testimonials/$ID2")"
  AFTER=$(curl -s -b "$JAR" "$BASE/api/testimonials?status=all")
  absent "deleted testimonial is gone" 'Reject Me' "$AFTER"
  contains "one testimonial remains" '"total":1' "$AFTER"
fi

echo "== cross-tenant isolation =="
# Every account and slug is unique per run so the script can be re-run against
# the same database.
JAR2="$(mktemp)"
curl -s -o /dev/null -c "$JAR2" -X POST "$BASE/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"intruder-$RANDOM@example.com\",\"password\":\"$PASSWORD\",\"name\":\"Intruder\"}"
curl -s -o /dev/null -b "$JAR2" -X POST "$BASE/api/business" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Intruder Co\",\"slug\":\"intruder-$RANDOM\"}"
check "other tenant cannot approve" 404 "$(code -b "$JAR2" -X PATCH "$BASE/api/testimonials/$ID" \
  -H 'Content-Type: application/json' -d '{"status":"rejected"}')"
check "other tenant cannot delete" 404 "$(code -b "$JAR2" -X DELETE "$BASE/api/testimonials/$ID")"
OTHER_LIST=$(curl -s -b "$JAR2" "$BASE/api/testimonials?status=all")
contains "other tenant sees an empty queue" '"items":[]' "$OTHER_LIST"
contains "other tenant queue excludes foreign rows" '"total":0' "$OTHER_LIST"
OTHER_WALL=$(curl -s "$BASE/api/public/wall/$SLUG")
contains "owner's wall is unaffected" 'Priya Raman' "$OTHER_WALL"
check "other tenant's wall is separate" 200 "$(code "$BASE/api/public/wall/$(curl -s -b "$JAR2" "$BASE/api/business" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p' | head -1)")"

echo "== rate limiting =="
# Deliberately last: this exhausts the auth window for the run.
LIMITED=0
for _ in $(seq 1 12); do
  STATUS=$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Wrong123\"}")
  [[ "$STATUS" == "429" ]] && LIMITED=$((LIMITED + 1))
done
if [[ "$LIMITED" -gt 0 ]]; then
  echo "  ok   repeated failed logins are rate limited ($LIMITED blocked)"
  PASS=$((PASS + 1))
else
  echo "  FAIL repeated failed logins were never rate limited"
  FAIL=$((FAIL + 1))
fi

rm -f "$JAR" "$JAR2"
echo
echo "passed: $PASS   failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
