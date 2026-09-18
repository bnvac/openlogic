# Tests

The app itself has no dependencies. These tests do — Playwright, dev-only.
Nothing here is needed to run or deploy OpenLogic.

```sh
npm install --no-save playwright
npx playwright install chromium

python3 -m http.server 8777 &
node tests/run.mjs
```

`tests/run.mjs` drives the real page in a real browser. There's no unit-test
layer because there's no build step to hang one off, and the things most worth
protecting — hit-testing, settling, file roundtrips — only mean anything
against a live DOM and canvas.

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `OPENLOGIC_URL` | Page under test (default `http://localhost:8777/index.html`) |
| `CHROME_PATH` | Chromium binary, if Playwright's bundled one isn't usable |

## What it covers

- Clicking a toggle switch, placing from the palette, grid snapping
- Dragging pin-to-pin to wire, and output fan-out
- Undo / redo, select-all, delete
- Serialize → parse → serialize stability, and switch positions surviving it
- Rotation moving pins in world space
- T flip-flop dividing a clock by two
- Tri-state: undriven `Z`, driven, released, and two drivers conflicting
- Unsettleable feedback being reported rather than hanging the frame
- Shrinking a gate pruning wires to pins that no longer exist
- Inspector editing a gate's input count
- A real file download, and uploading it back
- A corrupt file failing gracefully
- No horizontal page scroll on a narrow viewport
- No blank frame composited when the stage resizes (the inspector opening
  reallocates the canvas backing store, which blanks it)
- Booting from a `file://` URL with no server
