#!/bin/bash
cd "$(dirname "$0")"
PORT=8765
echo "Starting Fee or See on port $PORT"
python3 server.py --port "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
sleep 0.5
if command -v open >/dev/null; then
  open "http://127.0.0.1:${PORT}/"
  open "http://127.0.0.1:${PORT}/him.html"
fi
echo
echo "Sister stays on this Mac window."
echo "Drag the second window onto the iPad (Sidecar), or open him.html in iPad Safari."
echo "Headphones plug into the Mac. She talks into the lid."
echo "Press Ctrl+C when finished."
wait
