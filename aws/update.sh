#!/bin/bash
# Executed as root by the stack's Systems Manager command document.
set -euo pipefail
source /etc/pong-deploy.env
if [ -e /opt/pong-staging ] || [ -e /opt/pong-failed ]; then
  echo 'A staging/failed release already exists. Inspect it before updating again.' >&2
  exit 1
fi
WORK_DIR=$(mktemp -d /tmp/pong-update.XXXXXX)
trap 'rm -f "$WORK_DIR/pong-app.zip"; rmdir "$WORK_DIR"' EXIT
aws s3 cp "s3://$PONG_ASSET_BUCKET/$PONG_ASSET_KEY" "$WORK_DIR/pong-app.zip" --only-show-errors
# Reject archives with path traversal before writing their contents as root.
python3 - "$WORK_DIR/pong-app.zip" <<'PY'
import sys, zipfile, pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
    for info in z.infolist():
        path = pathlib.PurePosixPath(info.filename)
        if path.is_absolute() or '..' in path.parts or '\\' in info.filename or ':' in info.filename:
            raise RuntimeError('Unsafe ZIP path')
    for name in ['server/index.js', 'public/index.html', 'node_modules/ws/package.json', 'aws/node-version.txt']:
        if name not in z.namelist(): raise RuntimeError('Invalid app package: ' + name)
PY
mkdir /opt/pong-staging
unzip -q "$WORK_DIR/pong-app.zip" -d /opt/pong-staging
chmod -R go-w /opt/pong-staging
/usr/local/bin/node --check /opt/pong-staging/server/index.js
/usr/local/bin/node --check /opt/pong-staging/public/app.js
if [ "$(/usr/local/bin/node --version)" != "v$(tr -d '\r\n ' < /opt/pong-staging/aws/node-version.txt)" ]; then
  echo 'Runtime version differs. This simple update supports application changes with the same Node version.' >&2
  exit 1
fi
systemctl start pong-backup.service
systemctl stop pong
# Retain one prior version; the data disk is never touched by this script.
if [ -d /opt/pong-previous ]; then rm -rf -- /opt/pong-previous; fi
mv /opt/pong /opt/pong-previous
mv /opt/pong-staging /opt/pong
systemctl start pong
MONITORING_READY=true
if [ -n "${PONG_LOG_GROUP:-}" ]; then
  if ! bash /opt/pong/aws/configure-monitoring.sh; then MONITORING_READY=false; fi
fi
HEALTHY=false
for attempt in $(seq 1 15); do
  if [ "$MONITORING_READY" = true ] && curl -fsS http://127.0.0.1:3000/health > /dev/null; then HEALTHY=true; break; fi
  sleep 2
done
if [ "$HEALTHY" != true ]; then
  systemctl stop pong
  mv /opt/pong /opt/pong-failed
  mv /opt/pong-previous /opt/pong
  systemctl start pong
  echo 'Update failed; restored previous code. Inspect /opt/pong-failed.' >&2
  exit 1
fi
echo 'PONG updated successfully. Persistent player data and settings were kept.'
