/* OpenLogic — component registry.
 *
 * Every component type lives here as a plain object: how big it is, where
 * its pins sit, what it computes, and how it draws. The renderer, the
 * palette and the simulator all read from this one table, so adding a part
 * is a single `def({...})` call and nothing else needs to know.
 *
 * Local coordinate space: the body occupies (0,0)-(w,h). Pins are placed in
 * that same space and may sit outside the body — a pin's (x,y) is the point
 * you actually click and where wires attach; `lead` is how far the stub runs
 * back toward the body.
 */
(function (OL) {
  'use strict';

  var S = OL.Signal;
  var high = S.high;

  var LEAD = 10;                 // default pin stub length
  var LETTERS = 'ABCDEFGH'.split('');

  var types = {};
  var order = [];

  var categories = [
    { id: 'inputs',    name: 'Input Controls' },
    { id: 'outputs',   name: 'Output Controls' },
    { id: 'gates',     name: 'Logic Gates' },
    { id: 'flipflops', name: 'Flip-Flops' }
  ];

  function def(o) {
    if (!o.size) throw new Error('component ' + o.id + ' needs a size');
    if (!o.ports) throw new Error('component ' + o.id + ' needs ports');
    o.props = o.props || [];
    o.defaults = o.defaults || {};
    types[o.id] = o;
    order.push(o.id);
    return o;
  }

  function get(id) { return types[id]; }

  /* ---------------------------------------------------------------- utils */

  function clampInt(v, lo, hi, fallback) {
    v = parseInt(v, 10);
    if (isNaN(v)) return fallback;
    return Math.max(lo, Math.min(hi, v));
  }

  /* Evenly spaced pin positions down an edge of height h. */
  function spread(n, h) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(Math.round(h * (i + 1) / (n + 1)));
    return a;
  }

  function inputCount(node) {
    return clampInt(node.props && node.props.inputs, 2, 8, 2);
  }

  /* ------------------------------------------------------------- geometry */

  var ROT = [0, 90, 180, 270];

  function rotVec(x, y, rot) {
    switch (((rot % 360) + 360) % 360) {
      case 90:  return { x: -y, y: x };
      case 180: return { x: -x, y: -y };
      case 270: return { x: y, y: -x };
      default:  return { x: x, y: y };
    }
  }

  function sizeOf(node) {
    var d = types[node.type];
    return typeof d.size === 'function' ? d.size(node) : d.size;
  }

  function portsOf(node) {
    var d = types[node.type];
    var p = d.ports(node);
    return { inputs: p.inputs || [], outputs: p.outputs || [] };
  }

  /* Local point -> world point, honouring rotation about the body centre. */
  function toWorld(node, px, py) {
    var s = sizeOf(node);
    var r = rotVec(px - s.w / 2, py - s.h / 2, node.rot || 0);
    return { x: node.x + s.w / 2 + r.x, y: node.y + s.h / 2 + r.y };
  }

  function worldPort(node, kind, index) {
    var p = portsOf(node)[kind][index];
    if (!p) return null;
    return toWorld(node, p.x, p.y);
  }

  /* Unit vector a wire should leave this pin along, in world space. */
  var DIRV = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  function portDir(node, port) {
    var v = DIRV[port.dir || 'left'];
    return rotVec(v[0], v[1], node.rot || 0);
  }

  /* Local bounding box covering body + every pin, with a little slack so
     thin parts stay grabbable. */
  function localBounds(node) {
    var s = sizeOf(node), p = portsOf(node);
    var b = { x0: 0, y0: 0, x1: s.w, y1: s.h };
    var all = p.inputs.concat(p.outputs);
    for (var i = 0; i < all.length; i++) {
      b.x0 = Math.min(b.x0, all[i].x); b.x1 = Math.max(b.x1, all[i].x);
      b.y0 = Math.min(b.y0, all[i].y); b.y1 = Math.max(b.y1, all[i].y);
    }
    b.x0 -= 3; b.y0 -= 3; b.x1 += 3; b.y1 += 3;
    return b;
  }

  function worldBounds(node) {
    var b = localBounds(node);
    var pts = [
      toWorld(node, b.x0, b.y0), toWorld(node, b.x1, b.y0),
      toWorld(node, b.x1, b.y1), toWorld(node, b.x0, b.y1)
    ];
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    return {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
      h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };
  }

  function hitTest(node, wx, wy) {
    var s = sizeOf(node);
    var cx = node.x + s.w / 2, cy = node.y + s.h / 2;
    /* Inverse-rotate the probe instead of rotating the box. */
    var r = rotVec(wx - cx, wy - cy, -(node.rot || 0));
    var lx = r.x + s.w / 2, ly = r.y + s.h / 2;
    var b = localBounds(node);
    return lx >= b.x0 && lx <= b.x1 && ly >= b.y0 && ly <= b.y1;
  }

  /* ---------------------------------------------------------------- paths */

  var shapes = {
    /* Flat back, domed front. */
    and: function (ctx, w, h) {
      var r = h / 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(w - r, 0);
      ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(0, h);
      ctx.closePath();
    },
    /* Concave back, pointed nose. */
    or: function (ctx, w, h) {
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(w * 0.62, 0, w, h / 2);
      ctx.quadraticCurveTo(w * 0.62, h, 0, h);
      ctx.quadraticCurveTo(w * 0.28, h / 2, 0, 0);
      ctx.closePath();
    },
    buf: function (ctx, w, h) {
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h / 2);
      ctx.lineTo(0, h);
      ctx.closePath();
    },
    box: function (ctx, w, h) {
      var r = 3;
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
    }
  };
  shapes.xor = shapes.or;

  function body(ctx, env) {
    ctx.fillStyle = env.colors.body;
    ctx.fill();
    ctx.strokeStyle = env.colors.line;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function bubble(ctx, env, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = env.colors.body;
    ctx.fill();
    ctx.strokeStyle = env.colors.line;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function text(ctx, env, str, x, y, size, color, align) {
    ctx.fillStyle = color || env.colors.line;
    ctx.font = (size || 9) + 'px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  OL.Components = {
    LEAD: LEAD,
    ROT: ROT,
    types: types,
    order: order,
    categories: categories,
    get: get,
    def: def,
    sizeOf: sizeOf,
    portsOf: portsOf,
    toWorld: toWorld,
    worldPort: worldPort,
    portDir: portDir,
    worldBounds: worldBounds,
    localBounds: localBounds,
    hitTest: hitTest,
    shapes: shapes,
    helpers: { body: body, bubble: bubble, text: text, spread: spread, clampInt: clampInt }
  };
})(window.OL = window.OL || {});
