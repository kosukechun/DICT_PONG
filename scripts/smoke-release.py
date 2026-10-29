"""Extract the produced ZIP into an isolated folder and start the actual shipped app."""
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
import shutil
import io

ROOT = Path(__file__).resolve().parent.parent
TOOLS = (ROOT / '.tools').resolve()
TOOLS.mkdir(exist_ok=True)
node = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else TOOLS / 'node-v24.22.1-win-x64/node.exe'
stage = Path(tempfile.mkdtemp(prefix='release-smoke-', dir=TOOLS)).resolve()
process = None
try:
    with zipfile.ZipFile(ROOT / '配布用/PONG-AWS-kit.zip') as kit:
        with zipfile.ZipFile(io.BytesIO(kit.read('pong-app.zip'))) as z:
            z.extractall(stage)
    assert not (stage / 'node_modules/jsdom').exists()
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
    env = dict(os.environ, PORT=str(port), HOST='127.0.0.1', DATA_DIR=str(stage / 'data'), ORIGIN_KEY='', SECURE_COOKIE='false', TRUST_PROXY='false')
    process = subprocess.Popen([str(node), 'server/index.js'], cwd=stage, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = f'http://127.0.0.1:{port}'
    for _ in range(100):
        try:
            with urllib.request.urlopen(base + '/health', timeout=1) as r:
                assert json.load(r)['ok']; break
        except Exception:
            if process.poll() is not None:
                raise RuntimeError(process.communicate()[1].decode())
            time.sleep(.05)
    else:
        raise RuntimeError('Packaged server failed readiness')
    for path, content in [('/', b'DICT_PONG'), ('/app.js', b'WebSocket'), ('/field.js', b'goalTop'), ('/movement.js', b'export function movePaddle'), ('/style.css', b'--blue'), ('/favicon.svg', b'<svg')]:
        with urllib.request.urlopen(base + path) as r:
            assert r.status == 200 and content in r.read(), path
    with urllib.request.urlopen(base + '/HTdR38qbIAA86Ob.webp') as r:
        assert r.headers['Content-Type'] == 'image/webp'
        assert r.read() == (ROOT / 'HTdR38qbIAA86Ob.webp').read_bytes()
    request = urllib.request.Request(base + '/api/login', data=json.dumps({'name': 'chun'}).encode(), headers={'Content-Type': 'application/json', 'Origin': base})
    with urllib.request.urlopen(request) as r:
        cookie = r.headers['Set-Cookie'].split(';')[0]
        assert json.load(r)['player']['name'] == 'chun'
    with urllib.request.urlopen(urllib.request.Request(base + '/api/admin', headers={'Cookie': cookie})) as r:
        data = json.load(r)
        assert r.status == 200 and data['settings']['paused'] is False
    print('Packaged ZIP starts with shipped runtime dependencies only; game assets, name login and name-only admin API all work.')
    verification = subprocess.run([str(node), '--test', '--test-concurrency=1', 'tests/online.test.js', 'tests/physics-stress.test.js'], cwd=stage, capture_output=True, text=True, encoding='utf-8', timeout=60)
    if verification.returncode:
        raise RuntimeError(verification.stdout + verification.stderr)
    print('Online regressions and physics stress tests also pass from the actual distributed ZIP (no development dependencies).')
finally:
    if process is not None:
        process.terminate()
        process.communicate(timeout=10)
    if not stage.is_relative_to(TOOLS) or stage == TOOLS:
        raise RuntimeError('Refusing cleanup outside isolated smoke-test folder')
    shutil.rmtree(stage)
