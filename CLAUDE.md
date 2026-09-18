# OpenLogic — architecture rules

A logic circuit simulator. Vanilla HTML/CSS/JS, no build step, no dependencies,
no package manager. It must keep working when opened straight from `file://`.

## Hard constraints

These are load-bearing. Breaking one breaks the point of the project.

1. **No build step, ever.** No bundler, no transpiler, no `npm install` to run
   it. `index.html` + `css/` + `js/` copied to a static host is the whole
   deployment.
2. **Classic `<script>` tags, not ES modules.** Modules fail on `file://`, and
   double-clicking `index.html` has to work. Each file is an IIFE that hangs
   its export off the shared `window.OL` namespace. New files get a `<script>`
   tag in `index.html`, in dependency order.
3. **No network requests after page load.** No CDNs, no fonts, no analytics.
   The app is offline-capable by construction, not by service worker.
4. **Colours live in CSS custom properties**, never in JS literals. The
   renderer reads `--c-*` off `:root` at runtime, which is why the theme
   switch is one attribute flip. A hard-coded colour in a `draw()` function
   is a bug: it won't invert in dark mode.

## Layout

| File | Owns |
| --- | --- |
| `js/signal.js` | The four signal values and net resolution |
| `js/components.js` | Registry, geometry, hit-testing, shared path helpers |
| `js/parts-*.js` | The component definitions themselves |
| `js/circuit.js` | Document model, serialize/deserialize |
| `js/simulator.js` | Delta-cycle settling, clocks |
| `js/renderer.js` | All canvas drawing |
| `js/interaction.js` | Pointer/keyboard state machine |
| `js/ui.js` | Palette and inspector DOM |
| `js/history.js` | Snapshot undo/redo |
| `js/storage.js` | Download/upload, localStorage |
| `js/app.js` | Bootstrap, rAF loop, toolbar wiring |

`components.js` must not import from `renderer.js` or `interaction.js`. The
registry is the bottom of the stack; everything reads from it.

## Adding a component

One `def({...})` call in a `parts-*.js` file. It needs `size`, `ports`,
`evaluate` and `draw`; the palette icon, hit-testing, rotation and
serialization all fall out of that automatically. Never special-case a
component type inside the renderer or the simulator — if a part needs
behaviour the registry can't express, extend the registry contract instead.

Pins are placed in the body's local space, where the body occupies
`(0,0)-(w,h)`. A pin's `(x,y)` is the clickable attach point, which may sit
outside the body; `lead` is how far the stub runs back toward it; `dir` is the
side it faces, which is also the direction wires leave along.

## Conventions worth keeping

- **Edits go through `app.commit()`.** One history entry, one autosave, one
  inspector refresh. Running the circuit (flipping a switch) goes through
  `app.touchState()` instead — persisted, but not an undo step.
- **Undo is whole-document snapshots.** Don't replace it with per-operation
  inverses unless there's a measured reason; correctness is free this way.
- **The settling loop is capped** at `Simulator.MAX_PASSES`. A circuit that
  won't settle is reported as oscillating, never allowed to hang a frame.
- **`circuit.touch()` after any structural change.** The simulator's driver
  index rebuilds off `revision`; forget this and the sim runs on a stale
  topology.
- **Don't render an unchanged scene.** `sim.frame()` reports whether anything
  moved; the rAF loop skips the repaint when nothing did and nothing is dirty.

## Testing

No test framework. Playwright drives the real page against a
`python3 -m http.server`. Checks worth keeping green: half-adder truth table,
T flip-flop divide-by-2, tri-state Z/conflict resolution, oscillation
detection, save→load roundtrip, undo/redo, and a `file://` boot.
