#!/bin/bash
# Safe to rerun from bootstrap, application updates, or the SSM repair document.
set -euo pipefail
source /etc/pong-deploy.env
test -n "${PONG_LOG_GROUP:-}"
dnf install -y amazon-cloudwatch-agent logrotate
install -d -m 750 /var/log/pong /etc/systemd/system/pong.service.d
touch /var/log/pong/application.log
chmod 640 /var/log/pong/application.log
cat > /etc/systemd/system/pong.service.d/logging.conf <<'UNIT'
[Service]
StandardOutput=append:/var/log/pong/application.log
StandardError=append:/var/log/pong/application.log
UNIT
cat > /etc/logrotate.d/pong <<'ROTATE'
/var/log/pong/application.log {
  daily
  maxsize 2M
  rotate 3
  compress
  missingok
  notifempty
  copytruncate
  su root root
}
ROTATE
python3 - <<'PY'
import json, os
config = {
    'agent': {'region': os.environ['AWS_DEFAULT_REGION'], 'usage_data': False},
    'logs': {
        'force_flush_interval': 15,
        'logs_collected': {'files': {'collect_list': [
            {'file_path': '/var/log/pong/application.log', 'log_group_name': os.environ['PONG_LOG_GROUP'], 'log_stream_name': '{instance_id}/application'},
            {'file_path': '/var/log/nginx/error.log', 'log_group_name': os.environ['PONG_LOG_GROUP'], 'log_stream_name': '{instance_id}/nginx-error'}
        ]}}
    }
}
with open('/opt/aws/amazon-cloudwatch-agent/etc/pong.json', 'w') as f:
    json.dump(config, f)
PY
systemctl daemon-reload
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/pong.json
systemctl enable amazon-cloudwatch-agent
if systemctl is-active --quiet pong; then systemctl restart pong; fi
echo 'CloudWatch log collection configured. Usage is logged once per minute.'
