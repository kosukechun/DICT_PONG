"""Build a self-contained, printable HTML guide without third-party packages."""
from pathlib import Path
import re
import html
import base64

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'docs/AWS_SETUP.md').read_text(encoding='utf-8')

def inline(text):
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', r'<a href="\2">\1</a>', text)
    return text

parts, paragraph, list_kind, code, headings = [], [], None, None, []
def flush():
    if paragraph:
        parts.append('<p>' + inline(' '.join(paragraph)) + '</p>')
        paragraph.clear()
def close_list():
    global list_kind
    if list_kind:
        parts.append('</' + list_kind + '>')
        list_kind = None

lines = source.splitlines()
i = 0
while i < len(lines):
    line = lines[i]
    if code is not None:
        if line.startswith('```'):
            parts.append('<pre><code>' + html.escape('\n'.join(code)) + '</code></pre>')
            code = None
        else:
            code.append(line)
        i += 1
        continue
    if line.startswith('```'):
        flush(); close_list(); code = []; i += 1; continue
    if not line.strip():
        flush(); close_list(); i += 1; continue
    image_match = re.fullmatch(r'!\[([^]]*)\]\(architecture.svg\)', line)
    if image_match:
        flush(); close_list()
        data = base64.b64encode((ROOT / 'docs/architecture.svg').read_bytes()).decode('ascii')
        parts.append('<figure><img style="width:100%;height:auto" alt="' + html.escape(image_match[1]) + '" src="data:image/svg+xml;base64,' + data + '"></figure>')
        i += 1; continue
    match = re.match(r'^(#{1,6}) (.+)$', line)
    if match:
        flush(); close_list()
        level, title = len(match[1]), match[2]
        anchor = 'section-' + str(i + 1)
        if level == 2:
            headings.append((anchor, title))
        parts.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
        i += 1; continue
    if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[ \-:|]+\|$', lines[i + 1]):
        flush(); close_list()
        cells = lambda s: [inline(c.strip()) for c in s.strip().strip('|').split('|')]
        headers = cells(line)
        parts.append('<div class="table-wrap"><table><thead><tr>' + ''.join('<th>' + c + '</th>' for c in headers) + '</tr></thead><tbody>')
        i += 2
        while i < len(lines) and lines[i].startswith('|'):
            parts.append('<tr>' + ''.join('<td>' + c + '</td>' for c in cells(lines[i])) + '</tr>'); i += 1
        parts.append('</tbody></table></div>')
        continue
    match = re.match(r'^(?:([0-9]+)\. |(-) )(.+)$', line)
    if match:
        flush()
        kind = 'ol' if match[1] else 'ul'
        if kind != list_kind:
            close_list(); parts.append('<ol start="' + match[1] + '">' if kind == 'ol' else '<ul>'); list_kind = kind
        parts.append('<li>' + inline(match[3]) + '</li>')
    else:
        close_list(); paragraph.append(line)
    i += 1
flush(); close_list()
toc = '<nav aria-label="目次"><strong>このガイドの内容</strong><ol>' + ''.join(f'<li><a href="#{anchor}">{inline(title)}</a></li>' for anchor, title in headings) + '</ol></nav>'
style = '''
:root{font-family:"Segoe UI","Yu Gothic",Meiryo,sans-serif;color:#25373d;background:#f1f3ed;line-height:1.9;font-size:15px}*{box-sizing:border-box}body{margin:0}header{background:#13282f;color:#f1f3e8;padding:42px max(24px,calc((100vw - 1000px)/2));border-top:6px solid #ff8055}header small{color:#cadb9d;letter-spacing:3px;font-size:12px}header h1{font-size:28px;margin:10px 0}header p{color:#b4c5c3;margin:0}main{max-width:1064px;margin:auto;background:#fff;padding:38px 48px 65px}h1{font-size:28px;line-height:1.6}main>h1{display:none}h2{font-size:23px;color:#123d47;border-bottom:2px solid #e2e7dd;padding-bottom:10px;margin:52px 0 20px;scroll-margin-top:20px}h3{font-size:17px;color:#305961;margin-top:30px}p{margin:15px 0}li{margin:8px 0}a{color:#13697a;text-underline-offset:3px}strong{color:#172f35}code{font-family:Consolas,monospace;font-size:.9em;background:#edf1ec;padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}pre{background:#172c34;color:#e1efdf;border-radius:9px;padding:20px;overflow:auto;font-size:12px;line-height:1.8}pre code{background:none;color:inherit;padding:0;white-space:pre;overflow-wrap:normal}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:12px 14px;border:1px solid #d7e0db;text-align:left}th{background:#eaf0e8;color:#294c4d}nav{border:1px solid #d7e1d5;background:#f5f7ef;border-radius:10px;padding:24px 28px;margin:25px 0}nav ol{columns:2;padding-left:22px;margin-bottom:0}nav li{break-inside:avoid;font-size:13px}nav a{text-decoration:none}footer{padding:26px;text-align:center;font-size:12px;color:#647b7e}.intro-tag{display:inline-block;background:#ecf1e3;border:1px solid #c9d8bb;padding:10px 15px;border-radius:6px;color:#3a573e;font-size:13px}@media(max-width:650px){main{padding:22px}header{padding:30px 22px}header h1{font-size:23px}h2{font-size:20px}nav{padding:20px}nav ol{columns:1}li{margin:10px 0}td,th{padding:9px;font-size:12px}}@media print{:root{background:white;font-size:10pt}header{background:white!important;color:#172c34;padding:15px 0}header p,header small{color:#345!important}main{padding:0;max-width:none}nav{display:none}h2,h3{break-after:avoid}table,pre{break-inside:avoid}pre{white-space:pre-wrap;background:#f3f3f3;color:#111}pre code{white-space:pre-wrap}footer{padding:15px}a{color:#234;text-decoration:none}}
'''
output = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DICT_PONG — AWS設置ガイド</title><style>' + style + '</style></head><body><header><small>DICT_PONG / AIR HOCKEY CLUB</small><h1>AWSコンソールで、コートを開こう。</h1><p>Git不要。ZIPとYAMLを手動アップロードする日本語ガイド。</p></header><main><div class="intro-tag">S3へZIP → CloudFormationへYAML → GameURLを開く</div>' + toc + ''.join(parts) + '</main><footer>DICT_PONG / AWS SETUP GUIDE / 2026-10-29</footer></body></html>'
(ROOT / 'docs/AWS_SETUP.html').write_text(output, encoding='utf-8')
print('Built docs/AWS_SETUP.html')
