#!/usr/bin/env python3
"""Minimal static file server for the Breathe app (no os.getcwd needed)."""
import sys, functools, http.server, socketserver

DIRECTORY = "/Users/mohammadelmekkawy/Documents/breathing app"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


with Server(("127.0.0.1", PORT), Handler) as httpd:
    print(f"Serving {DIRECTORY} at http://127.0.0.1:{PORT}")
    httpd.serve_forever()
