#!/usr/bin/env python3
"""Static files plus a tiny two-screen sync for sister / him."""

from __future__ import annotations

import json
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
STATE = {"listener": None, "seq": 0, "answers": []}


def lan_urls(port: int) -> list[str]:
    urls = [f"http://127.0.0.1:{port}/"]
    try:
        conn = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        conn.connect(("8.8.8.8", 80))
        ip = conn.getsockname()[0]
        conn.close()
        if ip and not ip.startswith("127."):
            urls.append(f"http://{ip}:{port}/")
    except OSError:
        pass
    return urls


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def _json(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/sync":
            q = parse_qs(parsed.query)
            answers = []
            if q.get("takeAnswers", [""])[0] in {"1", "true"}:
                answers = STATE["answers"]
                STATE["answers"] = []
            return self._json(
                {"listener": STATE["listener"], "seq": STATE["seq"], "answers": answers}
            )
        if parsed.path == "/where":
            host, port = self.server.server_address
            return self._json({"urls": lan_urls(port if isinstance(port, int) else 8765)})
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._json({"error": "bad json"}, 400)
        if parsed.path == "/sync":
            if "listener" in data:
                STATE["listener"] = data["listener"]
            STATE["seq"] = data.get("seq", STATE["seq"] + 1)
            return self._json({"ok": True, "seq": STATE["seq"]})
        if parsed.path == "/sync/answer":
            word = data.get("word")
            if word in {"fee", "see"}:
                STATE["answers"].append(word)
            return self._json({"ok": True})
        return self._json({"error": "not found"}, 404)


def main():
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print("Fee or See")
    for url in lan_urls(args.port):
        print("  sister ", url)
        print("  him    ", url + "him.html")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
