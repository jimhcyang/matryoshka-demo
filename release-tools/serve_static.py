"""Serve a staged site at a project subpath. No inference or API backend required."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import json
import re
from urllib.parse import unquote, urlsplit


def server(site, *, port=0, prefix='/matryoshka-demo/', logs=None, datasets_root=None):
    site = Path(site).absolute()
    assert site.resolve() == site and site.is_dir()
    assert re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)+', prefix), 'Literal local project prefix required'
    manifest = site / 'data/dataset-delivery.json'
    delivery = json.loads(manifest.read_bytes()) if manifest.exists() else None
    allowed = {r['path']:r for r in delivery['files']} if delivery else {}
    datasets = Path(datasets_root).absolute() if datasets_root else site.parent / 'datasets'
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            path = urlsplit(self.path).path
            if self.path == '/':
                self.send_response(302)
                self.send_header('Location', prefix)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            if path.startswith('/datasets/'):
                parsed = urlsplit(self.path)
                relative = path.lstrip('/')
                if parsed.query or parsed.fragment or not re.fullmatch(r'datasets/(cib|iran|vietnam)/[a-f0-9]{64}\.json\.gz', relative) or relative not in allowed:
                    self.send_error(404)
                    return
                target = datasets / relative[len('datasets/'):]
                if target.resolve() != target or not target.is_file():
                    self.send_error(404)
                    return
                raw = target.read_bytes()
                if hashlib.sha256(raw).hexdigest() != allowed[relative]['wire_sha256']:
                    self.send_error(409, 'Dataset wire hash differs')
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'application/gzip')
                self.send_header('Content-Length', str(len(raw)))
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                self.end_headers()
                self.wfile.write(raw)
                return
            if not path.startswith(prefix):
                self.send_error(404)
                return
            if logs is not None and path[len(prefix):].startswith('api/'):
                logs.append(self.path)
            decoded = unquote(path[len(prefix):])
            if '\\' in decoded or '\x00' in decoded or '..' in decoded.split('/'):
                self.send_error(404)
                return
            target = site / decoded
            if target.resolve() != target or not target.is_relative_to(site):
                self.send_error(404)
                return
            self.path = self.path[len(prefix) - 1:]
            return super().do_GET()

    return ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(site)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, default=Path(__file__).resolve().parents[1] / 'site')
    parser.add_argument('--datasets-root', type=Path, help='Explicit read-only QA mirror; installed default is site/../datasets')
    parser.add_argument('--port', type=int, default=8976)
    args = parser.parse_args()
    http = server(args.site, port=args.port, datasets_root=args.datasets_root)
    print('http://127.0.0.1:' + str(http.server_port) + '/matryoshka-demo/', flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http.server_close()
