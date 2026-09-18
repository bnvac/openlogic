# NOTES

Running log of decisions and open threads. See `CLAUDE.md` for the rules that
came out of these.

<!-- MEMORY_UPDATE_START -->
### Update: 2026-09-18
* **Decisions/Changes**:
  * Built OpenLogic from an empty repo — a static, dependency-free replacement
    for paid desktop logic simulators. 20 component types, canvas editor,
    delta-cycle simulator, JSON save/load.
  * **Classic scripts over ES modules.** Modules break on `file://`; the
    failure mode is a blank page that looks like a broken app. Everything
    hangs off a `window.OL` namespace instead. Verified booting from
    `file:///…/index.html` with no server.
  * **Canvas 2D over SVG.** One transform stack covers zoom/pan/rotate, and
    gate silhouettes are path math either way.
  * **Four signal states (0/1/Z/conflict), not booleans.** Without `Z` the
    Tri-State part is decorative; without a conflict state a shorted bus
    resolves silently to a wrong answer. Gates read `Z` as 0, so an
    unconnected pin behaves like a pulled-down one.
  * **Input pins accept multiple wires** and resolve as a net. That's what
    makes a tri-state bus expressible.
  * **Flip-flop PRE/CLR are active high**, unlike a 7474. Active-low plus
    "floating reads as 0" would hold the part in permanent reset the moment
    you left a pin unconnected.
  * **Undo is whole-document JSON snapshots.** Exact, and cheap at this scale.
    Flipping a switch autosaves but does *not* create an undo step — undo is
    for edits, not for running the circuit.
  * localStorage is framed as a crash net, not a save mechanism; every access
    is try/catch'd because it throws in some private-mode/`file://` contexts.
* **Bugs found and fixed during the build**:
  * Canvas backing store went stale when the inspector opened — the stage
    resizes without a window resize. Fixed with a `ResizeObserver` on the
    canvas plus a no-op guard so it can't thrash.
  * `SVGElement` doesn't reflect the `hidden` IDL property, so the play/pause
    button rendered both icons at once. Now a CSS class.
  * A manual dark/light pick was silently overridden by the next OS theme
    change. Added `themeLocked`.
  * Zoom-to-fit slammed a two-gate circuit to 200%; capped at 1:1.
* **Known Bugs/Gaps**:
  * No sub-circuits / user-defined component packaging. This is the biggest
    functional gap versus commercial tools and the obvious next feature.
  * Wires are point-to-point beziers only — no manual routing, no junction
    dots on shared nets, no orthogonal routing mode.
  * No labels/annotations layer for documenting a circuit.
  * `C.portsOf()` allocates fresh arrays on every call and runs per-node
    per-frame in the renderer. Fine at current scale; memoize by
    `(type, props, revision)` if large circuits get choppy.
  * Undo restores flip-flop state to reset rather than preserving it, since
    snapshots only persist what `def.persist` lists. Acceptable, slightly
    surprising.
  * Rotated components draw their text labels rotated too.
  * No pinch-gesture tests beyond synthetic pointer events; untested on real
    iOS/Android hardware.
<!-- MEMORY_UPDATE_END -->

<!-- MEMORY_UPDATE_START -->
### Update: 2026-09-18 (follow-up)
* **Decisions/Changes**:
  * Fixed a visible flash on every component placement. Root cause was the
    `ResizeObserver` added earlier the same day: placing a part selects it,
    which opens the inspector, which shrinks the stage. `renderer.resize()`
    writes `canvas.width` — **that blanks the backing store** — and then only
    set the dirty flag, so the repaint waited for the next rAF and the browser
    composited one fully empty canvas.
  * Fix: repaint synchronously inside `App.prototype.resize()`. ResizeObserver
    callbacks run after layout but *before* paint, so the draw lands in the
    same frame. Safe from observer loops because drawing can't change element
    size, and the existing "dimensions unchanged" guard still short-circuits.
  * Added a regression test that samples the canvas every animation frame
    across a place/deselect/resize session and asserts no frame is blank.
    A one-frame artifact is invisible to a screenshot test, so it needed a
    per-frame probe rather than an end-state assertion.
* **Known Bugs/Gaps**: unchanged from the entry above, minus the flash.
  Worth noting: the inspector opening still narrows the canvas viewport by
  226px on every selection. Content doesn't move (`view.x` is untouched), only
  the visible window narrows. If that turns out to be annoying in practice,
  the alternative is floating the inspector over the canvas so the stage never
  resizes at all.
<!-- MEMORY_UPDATE_END -->
