#!/bin/bash
# Invoked by CloudFormation user data; this file uses LF line endings.
set -euo pipefail
cd /opt/pong

# Use the verified official Node.js release; no external install script is executed.
NODE_VERSION=$(tr -d '\r\n ' < aws/node-version.txt)
NODE_ARCHIVE="node-v$NODE_VERSION-linux-x64.tar.xz"
curl --retry 5 --retry-delay 3 -fsS "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE" -o "/tmp/$NODE_ARCHIVE"
curl --retry 5 --retry-delay 3 -fsS "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o /tmp/pong-node-shasums.txt
cd /tmp
awk -v file="$NODE_ARCHIVE" '$2==file {print}' pong-node-shasums.txt > pong-node-selected.sha256
test -s pong-node-selected.sha256
sha256sum -c pong-node-selected.sha256
tar -xJf "$NODE_ARCHIVE" -C /opt
ln -sf "/opt/node-v$NODE_VERSION-linux-x64/bin/node" /usr/local/bin/node
cd /opt/pong

# Match the exact EBS serial so the root disk can never be selected by mistake.
VOLUME_SERIAL=$(printf '%s' "$PONG_DATA_VOLUME" | tr -d '-')
DATA_DEVICE=''
for attempt in $(seq 1 180); do
  DEVICE_NAME=$(lsblk -ndo NAME,SERIAL | awk -v serial="$VOLUME_SERIAL" '$2==serial {print $1}')
  if [ -n "$DEVICE_NAME" ]; then DATA_DEVICE="/dev/$DEVICE_NAME"; break; fi
  sleep 2
done
test -n "$DATA_DEVICE"
if ! blkid "$DATA_DEVICE"; then mkfs.ext4 -L pong-data "$DATA_DEVICE"; fi
test "$(blkid -s TYPE -o value "$DATA_DEVICE")" = 'ext4'
mkdir -p /var/lib/pong
DATA_UUID=$(blkid -s UUID -o value "$DATA_DEVICE")
if ! grep -q "UUID=$DATA_UUID " /etc/fstab; then
  printf 'UUID=%s /var/lib/pong ext4 defaults,nofail 0 2\n' "$DATA_UUID" >> /etc/fstab
fi
mount /var/lib/pong
mountpoint -q /var/lib/pong
id pong >/dev/null 2>&1 || useradd --system --home-dir /opt/pong --shell /sbin/nologin pong
chown pong:pong /var/lib/pong
chmod 750 /var/lib/pong

python3 - <<'PY'
import os, subprocess, shlex
secret = subprocess.check_output(['aws', 'secretsmanager', 'get-secret-value', '--secret-id', os.environ['PONG_ORIGIN_SECRET'], '--query', 'SecretString', '--output', 'text'], text=True).strip()
if not secret.isalnum(): raise RuntimeError('Unexpected origin secret format')
with open('/etc/pong.env', 'w') as f:
    f.write('HOST=127.0.0.1\nPORT=3000\nDATA_DIR=/var/lib/pong\nSECURE_COOKIE=true\nTRUST_PROXY=true\nORIGIN_KEY=' + secret + '\n')
os.chmod('/etc/pong.env', 0o600)
with open('/etc/pong-backup.env', 'w') as f:
    f.write('AWS_DEFAULT_REGION=' + os.environ['AWS_DEFAULT_REGION'] + '\nPONG_BACKUP_DEST=s3://' + os.environ['PONG_ASSET_BUCKET'] + '/backups/' + os.environ['PONG_STACK'] + '/\n')
os.chmod('/etc/pong-backup.env', 0o600)
with open('/etc/pong-deploy.env', 'w') as f:
    for key in ['AWS_DEFAULT_REGION', 'PONG_ASSET_BUCKET', 'PONG_ASSET_KEY']:
        f.write('export ' + key + '=' + shlex.quote(os.environ[key]) + '\n')
os.chmod('/etc/pong-deploy.env', 0o600)
PY

cat > /etc/systemd/system/pong.service <<'UNIT'
[Unit]
Description=DICT_PONG authoritative game server
After=network-online.target
RequiresMountsFor=/var/lib/pong
[Service]
Type=simple
User=pong
Group=pong
WorkingDirectory=/opt/pong
EnvironmentFile=/etc/pong.env
ExecStart=/usr/local/bin/node /opt/pong/server/index.js
Restart=always
RestartSec=3
TimeoutStopSec=8
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pong
MemoryMax=700M
LimitNOFILE=8192
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;
events { worker_connections 2048; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  server_tokens off;
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 32k;
    access_log off;
    location / {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Host $http_host;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_read_timeout 75s;
      proxy_send_timeout 75s;
      proxy_buffering off;
    }
  }
}
NGINX

install -m 755 /opt/pong/aws/backup.sh /usr/local/bin/pong-backup
install -m 644 /opt/pong/aws/pong-backup.service /etc/systemd/system/pong-backup.service
install -m 644 /opt/pong/aws/pong-backup.timer /etc/systemd/system/pong-backup.timer
systemctl daemon-reload
nginx -t
systemctl enable --now pong nginx
systemctl restart nginx
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1/health
systemctl enable --now pong-backup.timer
systemctl start pong-backup.service
