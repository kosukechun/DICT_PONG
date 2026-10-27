#!/bin/bash
set -euo pipefail
BACKUP_DIR=$(mktemp -d /tmp/pong-backup.XXXXXX)
trap 'rm -f "$BACKUP_DIR/pong.sqlite" "$BACKUP_DIR/pong.sqlite.gz"; rmdir "$BACKUP_DIR"' EXIT
export PONG_TEMP_DB="$BACKUP_DIR/pong.sqlite"
python3 - <<'PY'
import os, sqlite3
with sqlite3.connect('file:/var/lib/pong/pong.sqlite?mode=ro', uri=True) as source:
    with sqlite3.connect(os.environ['PONG_TEMP_DB']) as target:
        source.backup(target)
PY
gzip -n "$BACKUP_DIR/pong.sqlite"
BACKUP_NAME="pong-$(date -u +%Y%m%dT%H%M%SZ).sqlite.gz"
aws s3 cp "$BACKUP_DIR/pong.sqlite.gz" "$PONG_BACKUP_DEST$BACKUP_NAME" --only-show-errors --sse AES256
