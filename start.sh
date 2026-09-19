#!/bin/bash
cd "$(dirname "$0")"
PORT="${PORT:-8765}"
exec python3 server.py --port "$PORT"
