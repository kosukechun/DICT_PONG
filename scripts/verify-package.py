"""Check the exact release ZIP without opening a browser or an AWS account."""
from pathlib import Path
from html.parser import HTMLParser
from collections import Counter
import json
import re
import zipfile
import hashlib

ROOT = Path(__file__).resolve().parent.parent
DISTRIBUTION = ROOT / '配布用'
class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.ids = []; self.links = []
    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if 'id' in attrs: self.ids.append(attrs['id'])
        if 'href' in attrs: self.links.append(attrs['href'])

for path in ['public/index.html', 'docs/AWS_SETUP.html']:
    page = Page(); page.feed((ROOT / path).read_text(encoding='utf-8'))
    duplicates = [key for key, n in Counter(page.ids).items() if n > 1]
    assert not duplicates, (path, duplicates)
    assert all(link[1:] in page.ids for link in page.links if link.startswith('#')), path
    if path.startswith('public'):
        code = (ROOT / 'public/app.js').read_text(encoding='utf-8')
        used = re.findall(r"\$\('([^']+)'\)", code)
        assert set(used).issubset(page.ids), set(used) - set(page.ids)

with zipfile.ZipFile(ROOT / 'release/pong-app.zip') as z:
    assert z.testzip() is None
    names = z.namelist()
    required = ['package.json', 'package-lock.json', 'public/index.html', 'public/app.js', 'public/field.js', 'public/movement.js', 'public/style.css', 'public/HTdR38qbIAA86Ob.webp', 'server/index.js', 'server/store.js', 'server/physics.js', 'aws/bootstrap.sh', 'aws/update.sh', 'aws/configure-monitoring.sh', 'aws/pong-stack.yaml', 'aws/node-version.txt', 'node_modules/ws/package.json', 'node_modules/ws/LICENSE', 'docs/AWS_SETUP.html', 'docs/architecture.svg', 'README.md', 'start-local.cmd', 'scripts/start-local.ps1', 'scripts/package.ps1', 'tests/ui.test.js']
    assert set(required).issubset(names), set(required) - set(names)
    assert all('\\' not in n and not n.startswith('/') and '..' not in Path(n).parts for n in names)
    assert all(not n.startswith(('.tools/', '.runtime/', 'data/', 'release/', '.git/')) for n in names)
    assert '.env' not in names
    assert all(n.startswith('node_modules/ws/') for n in names if n.startswith('node_modules/'))
    for name in [n for n in names if n.endswith('.sh')]:
        assert b'\r' not in z.read(name), f'{name} must have LF endings'
    package = json.loads(z.read('package.json'))
    ws = json.loads(z.read('node_modules/ws/package.json'))
    assert package['dependencies']['ws'] == ws['version']
    assert z.read('aws/pong-stack.yaml') == (ROOT / 'release/pong-stack.yaml').read_bytes()
with zipfile.ZipFile(ROOT / 'release/PONG-AWS-kit.zip') as z:
    assert set(z.namelist()) == {'pong-app.zip', 'pong-stack.yaml', 'AWS_SETUP.html', 'AWS_SETUP.md', 'ARCHITECTURE.svg'}
    assert z.testzip() is None
assert (DISTRIBUTION / 'PONG-AWS-kit.zip').read_bytes() == (ROOT / 'release/PONG-AWS-kit.zip').read_bytes()
assert (DISTRIBUTION / 'AWS_SETUP.html').read_bytes() == (ROOT / 'docs/AWS_SETUP.html').read_bytes()
assert (DISTRIBUTION / 'はじめに.txt').read_bytes() == (ROOT / 'docs/DISTRIBUTION_README.txt').read_bytes()
assert (DISTRIBUTION / 'SHA256SUMS.txt').read_text().split()[0] == hashlib.sha256((DISTRIBUTION / 'PONG-AWS-kit.zip').read_bytes()).hexdigest()
print('Verified HTML IDs / TOC, all client IDs, ZIP layout, required files, LF scripts, dependency version, and absence of runtime data/secrets.')
