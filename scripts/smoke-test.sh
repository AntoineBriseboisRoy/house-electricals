#!/bin/sh
# Run from inside an alpine container on the house-electricals_internal network.
# Verifies upload + fetch of a floor-plan image via the nginx web service.
set -e
apk add --no-cache curl jq >/dev/null 2>&1

PID=$(curl -sS http://web/api/v1/panels | jq -r '.data[0].id')
echo "Panel id: $PID"

echo "--- Upload PNG ---"
curl -sS -X POST -F "file=@/data/icon-192.png" "http://web/api/v1/panels/$PID/floor-plan" | jq -c .

FILE=$(curl -sS "http://web/api/v1/panels/$PID" | jq -r '.data.floorPlan.filename')
echo "filename stored in DB: $FILE"

echo "--- Fetch via nginx alias ---"
curl -sS -o /tmp/dl.png -w 'HTTP %{http_code}  size %{size_download}  type %{content_type}\n' "http://web/files/floor-plans/$FILE"

echo "--- Verify bytes match (host source vs nginx download) ---"
cmp /data/icon-192.png /tmp/dl.png && echo "OK: bytes identical"
