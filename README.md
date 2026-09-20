# hearing_test

Two-screen live demo so Grandad can try distinguishing **fee** and **see**.

- Sister stays on the Mac (`index.html`)
- Grandad looks at the iPad (`him.html`) via Sidecar or Safari
- Headphones plug into the Mac. She talks into the lid mic.

## Run on a Mac

```bash
git clone https://github.com/joesmio/hearing_test.git
cd hearing_test
python3 server.py --port 8765
```

Or double-click `start.command`.

Then open:

- Sister: http://127.0.0.1:8765/
- Grandad: http://127.0.0.1:8765/him.html

## Tests

```bash
npm test
npm run test:e2e
```
