/* OpenLogic — canvas renderer.
 *
 * Colours are pulled from CSS custom properties so the light/dark switch is
 * a single attribute flip with no JS colour table to keep in sync.
 */
(function (OL) {
  'use strict';

  var S = OL.Signal;
  var C = OL.Components;

  var COLOR_KEYS = [
    'bg', 'grid', 'line', 'lineSoft', 'body', 'muted', 'accent', 'sel',
    'high', 'highSoft', 'low', 'z', 'err', 'errSoft', 'lit', 'glow', 'filamentOn'
  ];

  function cssVarName(key) {
    return '--c-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { x: 80, y: 60, scale: 1 };
    this.colors = {};
    this.gridSize = 10;
    this.showGrid = true;
    this.refreshColors();
  }

  Renderer.prototype.refreshColors = function () {
    var cs = getComputedStyle(document.documentElement);
    var c = {};
    COLOR_KEYS.forEach(function (k) {
      c[k] = cs.getPropertyValue(cssVarName(k)).trim() || '#888';
    });
    this.colors = c;
  };

  Renderer.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var r = this.canvas.getBoundingClientRect();
    this.cssWidth = r.width;
    this.cssHeight = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  };

  /* ------------------------------------------------------ coordinates */

  Renderer.prototype.toWorld = function (sx, sy) {
    var v = this.view;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  };

  Renderer.prototype.toScreen = function (wx, wy) {
    var v = this.view;
    return { x: wx * v.scale + v.x, y: wy * v.scale + v.y };
  };

  Renderer.prototype.zoomAt = function (sx, sy, factor) {
    var v = this.view;
    var next = Math.max(0.25, Math.min(4, v.scale * factor));
    if (next === v.scale) return;
    var w = this.toWorld(sx, sy);
    v.scale = next;
    v.x = sx - w.x * next;
    v.y = sy - w.y * next;
  };

  Renderer.prototype.setZoom = function (scale) {
    var cx = this.cssWidth / 2, cy = this.cssHeight / 2;
    this.zoomAt(cx, cy, Math.max(0.25, Math.min(4, scale)) / this.view.scale);
  };

  /* ------------------------------------------------------------ wires */

  function valueColor(colors, v) {
    if (v === S.HIGH) return colors.high;
    if (v === S.ERR) return colors.err;
    if (v === S.Z) return colors.z;
    return colors.low;
  }
  Renderer.valueColor = valueColor;

  /* A wire leaves each pin along that pin's own facing, so rotated parts
     still get sane-looking curves. */
  function wireGeometry(circuit, wire, nodeById) {
    var src = nodeById ? nodeById[wire.from.node] : circuit.node(wire.from.node);
    var dst = nodeById ? nodeById[wire.to.node] : circuit.node(wire.to.node);
    if (!src || !dst) return null;
    var ps = C.portsOf(src).outputs[wire.from.port];
    var pd = C.portsOf(dst).inputs[wire.to.port];
    if (!ps || !pd) return null;
    var a = C.toWorld(src, ps.x, ps.y);
    var b = C.toWorld(dst, pd.x, pd.y);
    var da = C.portDir(src, ps), db = C.portDir(dst, pd);
    var dist = Math.hypot(b.x - a.x, b.y - a.y);
    var k = Math.max(26, Math.min(110, dist * 0.45));
    return {
      a: a, b: b,
      c1: { x: a.x + da.x * k, y: a.y + da.y * k },
      c2: { x: b.x + db.x * k, y: b.y + db.y * k },
      value: src.out[wire.from.port]
    };
  }
  Renderer.wireGeometry = wireGeometry;

  function bezierAt(g, t) {
    var mt = 1 - t;
    var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return {
      x: a * g.a.x + b * g.c1.x + c * g.c2.x + d * g.b.x,
      y: a * g.a.y + b * g.c1.y + c * g.c2.y + d * g.b.y
    };
  }
  Renderer.bezierAt = bezierAt;

  Renderer.distanceToWire = function (g, wx, wy) {
    var best = Infinity, prev = g.a;
    for (var i = 1; i <= 20; i++) {
      var p = bezierAt(g, i / 20);
      best = Math.min(best, distToSegment(wx, wy, prev, p));
      prev = p;
    }
    return best;
  };

  function distToSegment(px, py, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = dx * dx + dy * dy;
    var t = len === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  /* ------------------------------------------------------------- draw */

  Renderer.prototype.drawGrid = function () {
    if (!this.showGrid) return;
    var ctx = this.ctx, v = this.view;
    var step = this.gridSize;
    /* Thin out the grid instead of drawing 4000 dots when zoomed out. */
    while (step * v.scale < 8) step *= 2;
    var x0 = Math.floor(-v.x / v.scale / step) * step;
    var y0 = Math.floor(-v.y / v.scale / step) * step;
    var x1 = x0 + this.cssWidth / v.scale + step * 2;
    var y1 = y0 + this.cssHeight / v.scale + step * 2;
    var r = v.scale >= 1.5 ? 1 : 0.8;

    ctx.fillStyle = this.colors.grid;
    for (var x = x0; x < x1; x += step) {
      for (var y = y0; y < y1; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, r / v.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  Renderer.prototype.strokeWire = function (g, opts) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.bezierCurveTo(g.c1.x, g.c1.y, g.c2.x, g.c2.y, g.b.x, g.b.y);
    if (opts.selected) {
      ctx.strokeStyle = this.colors.sel;
      ctx.lineWidth = 5 / this.view.scale + 2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash(g.value === S.Z ? [4, 4] : []);
    ctx.strokeStyle = opts.color || valueColor(this.colors, g.value);
    ctx.lineWidth = opts.width || (g.value === S.HIGH ? 2.4 : 2);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /* Draw one component: pin stubs and terminals first (shared for every
     type), then the type's own body drawing in local space. */
  Renderer.prototype.drawNode = function (node, opts) {
    var ctx = this.ctx;
    var d = C.get(node.type);
    var s = C.sizeOf(node);
    var ports = C.portsOf(node);
    var env = { colors: this.colors, scale: this.view.scale };

    ctx.save();
    ctx.translate(node.x + s.w / 2, node.y + s.h / 2);
    if (node.rot) ctx.rotate(node.rot * Math.PI / 180);
    ctx.translate(-s.w / 2, -s.h / 2);

    if (opts.selected) {
      var b = C.localBounds(node);
      ctx.beginPath();
      ctx.rect(b.x0 - 2, b.y0 - 2, b.x1 - b.x0 + 4, b.y1 - b.y0 + 4);
      ctx.strokeStyle = this.colors.sel;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.drawPins(ctx, node, ports.inputs, node.in, env);
    this.drawPins(ctx, node, ports.outputs, node.out, env);

    ctx.lineJoin = 'round';
    d.draw(ctx, node, env);
    ctx.restore();
  };

  var LEAD_VEC = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] };

  Renderer.prototype.drawPins = function (ctx, node, pins, values, env) {
    var lead = C.LEAD;
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      var L = p.lead == null ? lead : p.lead;
      var v = LEAD_VEC[p.dir || 'left'];
      var ex = p.x + v[0] * L, ey = p.y + v[1] * L;
      var val = values && values[i];
      var col = valueColor(this.colors, val === undefined ? S.Z : val);

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = env.colors.body;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  };

  Renderer.prototype.highlightPin = function (world, kind) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(world.x, world.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = kind === 'bad' ? this.colors.err : this.colors.accent;
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = kind === 'bad' ? this.colors.err : this.colors.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  Renderer.prototype.render = function (scene) {
    var ctx = this.ctx, v = this.view, dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, v.x * dpr, v.y * dpr);
    this.drawGrid();

    var circuit = scene.circuit;
    var byId = {};
    circuit.nodes.forEach(function (n) { byId[n.id] = n; });

    var self = this;
    circuit.wires.forEach(function (w) {
      var g = wireGeometry(circuit, w, byId);
      if (!g) return;
      self.strokeWire(g, { selected: scene.selection.has(w) });
    });

    if (scene.pendingWire) {
      var p = scene.pendingWire;
      this.strokeWire({
        a: p.a, b: p.b,
        c1: { x: p.a.x + p.dir.x * 40, y: p.a.y + p.dir.y * 40 },
        c2: { x: p.b.x - p.dir.x * 40, y: p.b.y - p.dir.y * 40 },
        value: S.Z
      }, { color: this.colors.accent, width: 2 });
    }

    circuit.nodes.forEach(function (n) {
      self.drawNode(n, { selected: scene.selection.has(n) });
    });

    if (scene.hoverPin) this.highlightPin(scene.hoverPin.world, scene.hoverPin.kind);

    if (scene.ghost) {
      ctx.globalAlpha = 0.55;
      this.drawNode(scene.ghost, { selected: false });
      ctx.globalAlpha = 1;
    }

    if (scene.marquee) {
      var m = scene.marquee;
      ctx.fillStyle = this.colors.accent;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.colors.accent;
      ctx.lineWidth = 1 / v.scale;
      ctx.strokeRect(m.x, m.y, m.w, m.h);
    }
  };

  OL.Renderer = Renderer;
})(window.OL);
