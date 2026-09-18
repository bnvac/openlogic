/* OpenLogic — pointer and keyboard editing.
 *
 * One small state machine drives everything on the canvas. The only
 * subtlety worth calling out: a press on a component starts a *potential*
 * drag, not a real one. Nothing moves until the pointer passes a few
 * pixels, which is what lets you click a toggle switch without nudging it.
 */
(function (OL) {
  'use strict';

  var C = OL.Components;
  var R = OL.Renderer;

  var DRAG_SLOP = 3;        // screen px before a press becomes a drag
  var PIN_RADIUS = 9;       // screen px pick tolerance
  var WIRE_RADIUS = 6;

  function Interaction(app) {
    this.app = app;
    this.canvas = app.canvas;
    this.mode = 'select';           // 'select' | 'pan'
    this.action = null;
    this.spaceDown = false;
    this.clipboard = null;
    this.ghost = null;
    this.pendingWire = null;
    this.hoverPin = null;
    this.marquee = null;
    this.pointers = new Map();
    this.pinch = null;
    this.bind();
  }

  /* -------------------------------------------------------- touch gestures
   * Two fingers pinch to zoom and drag to pan. A pinch cancels whatever the
   * first finger had started, so you never end up dragging a gate across the
   * canvas while trying to zoom. */

  Interaction.prototype.pinchState = function () {
    var pts = Array.from(this.pointers.values());
    var a = pts[0], b = pts[1];
    return {
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
  };

  Interaction.prototype.beginPinch = function () {
    this.action = null;
    this.pendingWire = null;
    this.marquee = null;
    this.dragNodes = null;
    this.pressedNode = null;
    this.pinch = this.pinchState();
    this.app.requestRender();
  };

  Interaction.prototype.updatePinch = function () {
    if (this.pointers.size < 2) return;
    var now = this.pinchState();
    var view = this.app.renderer.view;
    this.app.renderer.zoomAt(now.mid.x, now.mid.y, now.dist / this.pinch.dist);
    view.x += now.mid.x - this.pinch.mid.x;
    view.y += now.mid.y - this.pinch.mid.y;
    this.pinch = now;
    this.app.onViewChanged();
    this.app.requestRender();
  };

  Interaction.prototype.endPointer = function (e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      /* Wait for both fingers to lift so the remaining one doesn't
         immediately start dragging whatever is under it. */
      if (this.pointers.size === 0) this.pinch = null;
      return;
    }
    this.onUp(e);
  };

  /* ------------------------------------------------------------ picking */

  Interaction.prototype.pickPin = function (w) {
    var tol = PIN_RADIUS / this.app.renderer.view.scale;
    var nodes = this.app.circuit.nodes;
    /* Reverse order so the part drawn on top wins the pick. */
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      var ports = C.portsOf(n);
      var kinds = ['outputs', 'inputs'];
      for (var k = 0; k < 2; k++) {
        var list = ports[kinds[k]];
        for (var j = 0; j < list.length; j++) {
          var p = C.toWorld(n, list[j].x, list[j].y);
          if (Math.hypot(p.x - w.x, p.y - w.y) <= tol) {
            return { node: n, kind: kinds[k], index: j, port: list[j], world: p };
          }
        }
      }
    }
    return null;
  };

  Interaction.prototype.pickNode = function (w) {
    var nodes = this.app.circuit.nodes;
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (C.hitTest(nodes[i], w.x, w.y)) return nodes[i];
    }
    return null;
  };

  Interaction.prototype.pickWire = function (w) {
    var tol = WIRE_RADIUS / this.app.renderer.view.scale;
    var c = this.app.circuit;
    var byId = {};
    c.nodes.forEach(function (n) { byId[n.id] = n; });
    for (var i = c.wires.length - 1; i >= 0; i--) {
      var g = R.wireGeometry(c, c.wires[i], byId);
      if (g && R.distanceToWire(g, w.x, w.y) <= tol) return c.wires[i];
    }
    return null;
  };

  /* ----------------------------------------------------------- helpers */

  Interaction.prototype.eventPos = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  Interaction.prototype.snap = function (v, disable) {
    if (disable) return v;
    var g = this.app.renderer.gridSize;
    return Math.round(v / g) * g;
  };

  Interaction.prototype.selectedNodes = function () {
    var out = [];
    this.app.selection.forEach(function (o) { if (o.type) out.push(o); });
    return out;
  };

  Interaction.prototype.selectedWires = function () {
    var out = [];
    this.app.selection.forEach(function (o) { if (o.from) out.push(o); });
    return out;
  };

  /* -------------------------------------------------------- placement */

  Interaction.prototype.beginPlace = function (typeId) {
    var d = C.get(typeId);
    if (!d) return;
    this.cancel();
    this.ghost = {
      id: -1, type: typeId, x: -9999, y: -9999, rot: 0,
      props: Object.assign({}, d.defaults), state: {}, in: [], out: []
    };
    if (d.reset) d.reset(this.ghost);
    this.app.setStatus('Click to place ' + d.name + '  ·  Esc to cancel');
    this.app.requestRender();
  };

  Interaction.prototype.placeAt = function (world, alt) {
    var g = this.ghost;
    if (!g) return null;
    var s = C.sizeOf(g);
    var node = this.app.circuit.addNode(g.type, 0, 0, { rot: g.rot, props: g.props });
    node.x = this.snap(world.x - s.w / 2, alt);
    node.y = this.snap(world.y - s.h / 2, alt);
    this.app.selection.clear();
    this.app.selection.add(node);
    this.app.commit();
    return node;
  };

  Interaction.prototype.cancel = function () {
    this.ghost = null;
    this.pendingWire = null;
    this.marquee = null;
    this.action = null;
    this.app.setStatus('');
    this.app.requestRender();
  };

  /* ------------------------------------------------------------- input */

  Interaction.prototype.bind = function () {
    var self = this;
    var cv = this.canvas;

    cv.addEventListener('pointerdown', function (e) {
      self.pointers.set(e.pointerId, self.eventPos(e));
      if (self.pointers.size === 2) { self.beginPinch(); return; }
      if (self.pointers.size > 2) return;
      self.onDown(e);
    });
    cv.addEventListener('pointermove', function (e) {
      if (self.pointers.has(e.pointerId)) self.pointers.set(e.pointerId, self.eventPos(e));
      if (self.pinch) { self.updatePinch(); return; }
      self.onMove(e);
    });
    window.addEventListener('pointerup', function (e) { self.endPointer(e); });
    window.addEventListener('pointercancel', function (e) { self.endPointer(e); });
    cv.addEventListener('pointerleave', function () {
      if (self.ghost) { self.ghost.x = -9999; self.app.requestRender(); }
      self.hoverPin = null;
    });
    cv.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
    cv.addEventListener('dblclick', function (e) { self.onDoubleClick(e); });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', function (e) { self.onKeyDown(e); });
    window.addEventListener('keyup', function (e) { self.onKeyUp(e); });

    /* Drag a component in from the palette, or a .json file in from disk. */
    cv.addEventListener('dragover', function (e) { e.preventDefault(); });
    cv.addEventListener('drop', function (e) {
      e.preventDefault();
      var type = e.dataTransfer.getData('text/openlogic-type');
      if (type && C.get(type)) {
        self.beginPlace(type);
        self.placeAt(self.app.renderer.toWorld(self.eventPos(e).x, self.eventPos(e).y), e.altKey);
        self.ghost = null;
        self.app.setStatus('');
        return;
      }
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        self.app.openFile(e.dataTransfer.files[0]);
      }
    });
  };

  Interaction.prototype.onDown = function (e) {
    var app = this.app;
    this.canvas.setPointerCapture(e.pointerId);
    var pos = this.eventPos(e);
    var world = app.renderer.toWorld(pos.x, pos.y);
    this.downPos = pos;
    this.moved = false;

    var wantsPan = e.button === 1 || this.spaceDown || this.mode === 'pan' || e.button === 2;
    if (wantsPan) {
      this.action = 'pan';
      this.panStart = { x: app.renderer.view.x, y: app.renderer.view.y, px: pos.x, py: pos.y };
      this.canvas.classList.add('grabbing');
      return;
    }
    if (e.button !== 0) return;

    if (this.ghost) {
      this.placeAt(world, e.altKey);
      /* Shift keeps the ghost loaded so you can lay down a row of gates. */
      if (!e.shiftKey) { this.ghost = null; app.setStatus(''); }
      return;
    }

    var pin = this.pickPin(world);
    if (pin) {
      this.action = 'wire';
      this.pendingWire = { origin: pin, b: world };
      return;
    }

    var node = this.pickNode(world);
    if (node) {
      var d = C.get(node.type);
      if (d.onPointerDown && d.onPointerDown(node)) {
        this.pressedNode = node;
        app.touchState();
      }
      if (!app.selection.has(node)) {
        if (!e.shiftKey) app.selection.clear();
        app.selection.add(node);
      } else if (e.shiftKey) {
        app.selection.delete(node);
      }
      this.action = 'maybe-drag';
      this.dragNodes = this.selectedNodes().map(function (n) {
        return { node: n, dx: n.x - world.x, dy: n.y - world.y };
      });
      app.refreshInspector();
      app.requestRender();
      return;
    }

    var wire = this.pickWire(world);
    if (wire) {
      if (!e.shiftKey) app.selection.clear();
      if (app.selection.has(wire)) app.selection.delete(wire);
      else app.selection.add(wire);
      app.refreshInspector();
      app.requestRender();
      return;
    }

    if (!e.shiftKey) app.selection.clear();
    this.action = 'marquee';
    this.marqueeStart = world;
    this.marquee = { x: world.x, y: world.y, w: 0, h: 0 };
    app.refreshInspector();
    app.requestRender();
  };

  Interaction.prototype.onMove = function (e) {
    var app = this.app;
    var pos = this.eventPos(e);
    var world = app.renderer.toWorld(pos.x, pos.y);

    if (this.downPos && !this.moved) {
      if (Math.hypot(pos.x - this.downPos.x, pos.y - this.downPos.y) > DRAG_SLOP) this.moved = true;
    }

    if (this.ghost) {
      var s = C.sizeOf(this.ghost);
      this.ghost.x = this.snap(world.x - s.w / 2, e.altKey);
      this.ghost.y = this.snap(world.y - s.h / 2, e.altKey);
      app.requestRender();
      return;
    }

    if (this.action === 'pan') {
      app.renderer.view.x = this.panStart.x + (pos.x - this.panStart.px);
      app.renderer.view.y = this.panStart.y + (pos.y - this.panStart.py);
      app.requestRender();
      return;
    }

    if (this.action === 'wire') {
      this.pendingWire.b = world;
      var pin = this.pickPin(world);
      this.hoverPin = pin ? {
        world: pin.world,
        kind: this.validTarget(pin) ? 'ok' : 'bad'
      } : null;
      app.requestRender();
      return;
    }

    if (this.action === 'maybe-drag' && this.moved) this.action = 'drag';

    if (this.action === 'drag') {
      var self = this;
      this.dragNodes.forEach(function (d) {
        d.node.x = self.snap(world.x + d.dx, e.altKey);
        d.node.y = self.snap(world.y + d.dy, e.altKey);
      });
      app.circuit.touch();
      app.requestRender();
      return;
    }

    if (this.action === 'marquee') {
      var a = this.marqueeStart;
      this.marquee = {
        x: Math.min(a.x, world.x), y: Math.min(a.y, world.y),
        w: Math.abs(world.x - a.x), h: Math.abs(world.y - a.y)
      };
      app.requestRender();
      return;
    }

    /* Idle hover: light up a pin so it's obvious where wires attach. */
    var hp = this.pickPin(world);
    var changed = (!!hp) !== (!!this.hoverPin);
    this.hoverPin = hp ? { world: hp.world, kind: 'ok' } : null;
    this.canvas.classList.toggle('over-pin', !!hp);
    if (changed || hp) app.requestRender();
  };

  Interaction.prototype.validTarget = function (pin) {
    var o = this.pendingWire && this.pendingWire.origin;
    if (!o || !pin) return false;
    if (pin.node === o.node) return false;
    if (pin.kind === o.kind) return false;     // out->out or in->in is meaningless
    var from = o.kind === 'outputs' ? o : pin;
    var to = o.kind === 'outputs' ? pin : o;
    return this.app.circuit.canConnect(from.node.id, from.index, to.node.id, to.index);
  };

  Interaction.prototype.onUp = function (e) {
    var app = this.app;
    this.canvas.classList.remove('grabbing');

    if (this.pressedNode) {
      var d = C.get(this.pressedNode.type);
      if (d.onPointerUp) { d.onPointerUp(this.pressedNode); app.touchState(); }
      this.pressedNode = null;
    }

    if (this.action === 'wire') {
      var world = app.renderer.toWorld(this.eventPos(e).x, this.eventPos(e).y);
      var pin = this.pickPin(world);
      if (pin && this.validTarget(pin)) {
        var o = this.pendingWire.origin;
        var from = o.kind === 'outputs' ? o : pin;
        var to = o.kind === 'outputs' ? pin : o;
        app.circuit.addWire(from.node.id, from.index, to.node.id, to.index);
        app.commit();
      }
      this.pendingWire = null;
      this.hoverPin = null;
    } else if (this.action === 'drag') {
      app.commit();
    } else if (this.action === 'maybe-drag' && !this.moved) {
      /* A genuine click: let interactive parts respond. */
      var node = this.dragNodes && this.dragNodes.length === 1 ? this.dragNodes[0].node : null;
      if (node) {
        var def = C.get(node.type);
        if (def.onClick && def.onClick(node)) app.touchState();
      }
    } else if (this.action === 'marquee') {
      this.applyMarquee(e.shiftKey);
      this.marquee = null;
    }

    this.action = null;
    this.downPos = null;
    this.dragNodes = null;
    app.refreshInspector();
    app.requestRender();
  };

  Interaction.prototype.applyMarquee = function (additive) {
    var m = this.marquee;
    if (!m || (m.w < 2 && m.h < 2)) return;
    var app = this.app;
    if (!additive) app.selection.clear();
    app.circuit.nodes.forEach(function (n) {
      var b = C.worldBounds(n);
      if (b.x + b.w >= m.x && b.x <= m.x + m.w &&
          b.y + b.h >= m.y && b.y <= m.y + m.h) app.selection.add(n);
    });
  };

  Interaction.prototype.onWheel = function (e) {
    e.preventDefault();
    var pos = this.eventPos(e);
    var factor = Math.pow(0.9992, e.deltaY * (e.deltaMode === 1 ? 16 : 1));
    this.app.renderer.zoomAt(pos.x, pos.y, factor);
    this.app.onViewChanged();
    this.app.requestRender();
  };

  Interaction.prototype.onDoubleClick = function (e) {
    var world = this.app.renderer.toWorld(this.eventPos(e).x, this.eventPos(e).y);
    if (!this.pickNode(world) && !this.pickWire(world)) this.app.zoomToFit();
  };

  /* ------------------------------------------------------------ editing */

  Interaction.prototype.deleteSelection = function () {
    var app = this.app;
    if (!app.selection.size) return;
    this.selectedWires().forEach(function (w) { app.circuit.removeWire(w); });
    this.selectedNodes().forEach(function (n) { app.circuit.removeNode(n); });
    app.selection.clear();
    app.commit();
  };

  Interaction.prototype.rotateSelection = function (dir) {
    var nodes = this.selectedNodes();
    if (!nodes.length) return;
    nodes.forEach(function (n) {
      n.rot = (((n.rot || 0) + dir * 90) % 360 + 360) % 360;
    });
    this.app.circuit.touch();
    this.app.commit();
  };

  Interaction.prototype.copy = function () {
    var nodes = this.selectedNodes();
    if (!nodes.length) return;
    var ids = {};
    nodes.forEach(function (n) { ids[n.id] = true; });
    var full = this.app.circuit.toJSON();
    this.clipboard = {
      nodes: full.nodes.filter(function (n) { return ids[n.id]; }),
      /* Only wires fully inside the selection — a dangling wire has no
         meaningful paste target. */
      wires: full.wires.filter(function (w) { return ids[w.from[0]] && ids[w.to[0]]; })
    };
    this.app.setStatus(nodes.length + ' component' + (nodes.length > 1 ? 's' : '') + ' copied');
  };

  Interaction.prototype.paste = function () {
    var clip = this.clipboard;
    if (!clip || !clip.nodes.length) return;
    var app = this.app, map = {};
    app.selection.clear();
    clip.nodes.forEach(function (raw) {
      var n = app.circuit.addNode(raw.type, raw.x + 20, raw.y + 20, {
        rot: raw.rot || 0, props: raw.props, state: raw.state
      });
      map[raw.id] = n.id;
      app.selection.add(n);
    });
    clip.wires.forEach(function (w) {
      app.circuit.addWire(map[w.from[0]], w.from[1], map[w.to[0]], w.to[1]);
    });
    app.commit();
  };

  Interaction.prototype.onKeyDown = function (e) {
    var app = this.app;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    var mod = e.ctrlKey || e.metaKey;
    if (!e.key) return;

    if (e.key === ' ' && !this.spaceDown) {
      this.spaceDown = true;
      this.canvas.classList.add('pannable');
      e.preventDefault();
      return;
    }

    if (mod) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return;
        case 'y': e.preventDefault(); app.redo(); return;
        case 'a':
          e.preventDefault();
          app.selection.clear();
          app.circuit.nodes.forEach(function (n) { app.selection.add(n); });
          app.refreshInspector(); app.requestRender();
          return;
        case 'c': e.preventDefault(); this.copy(); return;
        case 'x': e.preventDefault(); this.copy(); this.deleteSelection(); return;
        case 'v': e.preventDefault(); this.paste(); return;
        case 'd': e.preventDefault(); this.copy(); this.paste(); return;
        case 's': e.preventDefault(); app.saveFile(); return;
        case 'o': e.preventDefault(); app.promptOpen(); return;
      }
      return;
    }

    switch (e.key) {
      case 'Delete':
      case 'Backspace': e.preventDefault(); this.deleteSelection(); break;
      case 'Escape': this.cancel(); app.selection.clear(); app.refreshInspector(); app.requestRender(); break;
      case 'r': case 'R': this.rotateSelection(e.shiftKey ? -1 : 1); break;
      case '+': case '=': app.renderer.setZoom(app.renderer.view.scale * 1.2); app.onViewChanged(); app.requestRender(); break;
      case '-': case '_': app.renderer.setZoom(app.renderer.view.scale / 1.2); app.onViewChanged(); app.requestRender(); break;
      case '0': app.zoomToFit(); break;
    }
  };

  Interaction.prototype.onKeyUp = function (e) {
    if (e.key === ' ') {
      this.spaceDown = false;
      this.canvas.classList.remove('pannable');
    }
  };

  /* What the renderer needs to draw the transient bits. */
  Interaction.prototype.scene = function () {
    var pending = null;
    if (this.pendingWire) {
      var o = this.pendingWire.origin;
      var dir = C.portDir(o.node, o.port);
      pending = { a: o.world, b: this.pendingWire.b, dir: dir };
    }
    return {
      circuit: this.app.circuit,
      selection: this.app.selection,
      ghost: this.ghost && this.ghost.x > -9000 ? this.ghost : null,
      pendingWire: pending,
      hoverPin: this.hoverPin,
      marquee: this.marquee
    };
  };

  OL.Interaction = Interaction;
})(window.OL);
