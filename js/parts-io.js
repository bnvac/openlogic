/* OpenLogic — input controls and output displays. */
(function (OL) {
  'use strict';

  var S = OL.Signal;
  var C = OL.Components;
  var H = C.helpers;
  var LEAD = C.LEAD;

  /* ------------------------------------------------------------- inputs */

  C.def({
    id: 'toggle',
    name: 'Toggle Switch',
    category: 'inputs',
    defaults: {},
    persist: ['on'],            // a saved circuit keeps its switch positions
    interactive: true,
    size: function () { return { w: 42, h: 24 }; },
    ports: function (node) {
      var s = this.size(node);
      return { inputs: [], outputs: [{ name: 'Y', x: s.w + LEAD, y: s.h / 2, dir: 'right' }] };
    },
    reset: function () { /* deliberately keeps its position across a reset */ },
    onClick: function (node) { node.state.on = !node.state.on; return true; },
    evaluate: function (node) { return [node.state.on ? S.HIGH : S.LOW]; },
    draw: function (ctx, node, env) {
      var s = this.size(node), on = !!node.state.on;
      var r = s.h / 2;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(s.w, 0, s.w, s.h, r);
      ctx.arcTo(s.w, s.h, 0, s.h, r);
      ctx.arcTo(0, s.h, 0, 0, r);
      ctx.arcTo(0, 0, s.w, 0, r);
      ctx.closePath();
      ctx.fillStyle = on ? env.colors.highSoft : env.colors.body;
      ctx.fill();
      ctx.strokeStyle = env.colors.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(on ? s.w - r : r, r, r - 4, 0, Math.PI * 2);
      ctx.fillStyle = on ? env.colors.high : env.colors.line;
      ctx.fill();
    }
  });

  C.def({
    id: 'button',
    name: 'Push Button',
    category: 'inputs',
    interactive: true,
    size: function () { return { w: 28, h: 28 }; },
    ports: function (node) {
      var s = this.size(node);
      return { inputs: [], outputs: [{ name: 'Y', x: s.w + LEAD, y: s.h / 2, dir: 'right' }] };
    },
    reset: function (node) { node.state.on = false; },
    onPointerDown: function (node) { node.state.on = true; return true; },
    onPointerUp: function (node) { node.state.on = false; return true; },
    evaluate: function (node) { return [node.state.on ? S.HIGH : S.LOW]; },
    draw: function (ctx, node, env) {
      var s = this.size(node), on = !!node.state.on;
      ctx.beginPath();
      ctx.arc(s.w / 2, s.h / 2, s.w / 2, 0, Math.PI * 2);
      ctx.fillStyle = env.colors.body;
      ctx.fill();
      ctx.strokeStyle = env.colors.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.w / 2, s.h / 2, s.w / 2 - (on ? 7 : 5), 0, Math.PI * 2);
      ctx.fillStyle = on ? env.colors.high : env.colors.lineSoft;
      ctx.fill();
    }
  });

  C.def({
    id: 'clock',
    name: 'Clock',
    category: 'inputs',
    defaults: { frequency: 2 },
    props: [{ key: 'frequency', label: 'Frequency (Hz)', type: 'number', min: 0.1, max: 60, step: 0.1 }],
    size: function () { return { w: 32, h: 28 }; },
    ports: function (node) {
      var s = this.size(node);
      return { inputs: [], outputs: [{ name: 'Y', x: s.w + LEAD, y: s.h / 2, dir: 'right' }] };
    },
    reset: function (node) { node.state.on = false; node.state.acc = 0; },
    /* The simulator ticks state.on; evaluate just reports it. */
    evaluate: function (node) { return [node.state.on ? S.HIGH : S.LOW]; },
    tick: function (node, dt) {
      var f = Math.max(0.05, Number(node.props.frequency) || 2);
      var halfPeriod = 0.5 / f;
      node.state.acc = (node.state.acc || 0) + dt;
      var flipped = false;
      /* Cap the catch-up so a backgrounded tab doesn't spin thousands of
         edges the moment it comes back. */
      var guard = 0;
      while (node.state.acc >= halfPeriod && guard++ < 64) {
        node.state.acc -= halfPeriod;
        node.state.on = !node.state.on;
        flipped = true;
      }
      if (guard >= 64) node.state.acc = 0;
      return flipped;
    },
    draw: function (ctx, node, env) {
      var s = this.size(node);
      ctx.beginPath();
      C.shapes.box(ctx, s.w, s.h);
      H.body(ctx, env);
      var on = !!node.state.on;
      ctx.beginPath();
      var y0 = 8, y1 = s.h - 8, m = s.w / 2;
      ctx.moveTo(6, y1); ctx.lineTo(6, y0); ctx.lineTo(m, y0);
      ctx.lineTo(m, y1); ctx.lineTo(s.w - 6, y1); ctx.lineTo(s.w - 6, y0);
      ctx.strokeStyle = on ? env.colors.high : env.colors.line;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'miter';
      ctx.stroke();
    }
  });

  function constant(id, name, value) {
    C.def({
      id: id,
      name: name,
      category: 'inputs',
      size: function () { return { w: 26, h: 26 }; },
      ports: function (node) {
        var s = this.size(node);
        return { inputs: [], outputs: [{ name: 'Y', x: s.w + LEAD, y: s.h / 2, dir: 'right' }] };
      },
      evaluate: function () { return [value]; },
      draw: function (ctx, node, env) {
        var s = this.size(node);
        ctx.beginPath();
        C.shapes.box(ctx, s.w, s.h);
        H.body(ctx, env);
        H.text(ctx, env, value === S.HIGH ? '1' : '0', s.w / 2, s.h / 2 + 0.5, 14,
          value === S.HIGH ? env.colors.high : env.colors.line);
      }
    });
  }
  constant('high', 'High Constant', S.HIGH);
  constant('low', 'Low Constant', S.LOW);

  /* ------------------------------------------------------------ outputs */

  C.def({
    id: 'bulb',
    name: 'Light Bulb',
    category: 'outputs',
    size: function () { return { w: 34, h: 28 }; },
    ports: function (node) {
      var s = this.size(node);
      return { inputs: [{ name: 'IN', x: -LEAD, y: s.h / 2, dir: 'left' }], outputs: [] };
    },
    evaluate: function () { return []; },
    draw: function (ctx, node, env) {
      var s = this.size(node);
      var v = node.in && node.in[0];
      var lit = v === S.HIGH;
      var bad = v === S.ERR;
      var cy = s.h / 2, cx = 21, r = 11.5;

      if (lit) {
        var g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r + 9);
        g.addColorStop(0, env.colors.glow);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
        ctx.fill();
      }

      /* Screw base and glass drawn as one outline so they read as a single
         object rather than a box next to a circle. */
      ctx.beginPath();
      ctx.moveTo(1, cy - 5);
      ctx.lineTo(8, cy - 5);
      ctx.lineTo(8, cy + 5);
      ctx.lineTo(1, cy + 5);
      ctx.closePath();
      ctx.fillStyle = env.colors.lineSoft;
      ctx.fill();
      ctx.strokeStyle = env.colors.line;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(1, cy - 1.5); ctx.lineTo(8, cy - 1.5);
      ctx.moveTo(1, cy + 1.5); ctx.lineTo(8, cy + 1.5);
      ctx.strokeStyle = env.colors.line;
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = bad ? env.colors.errSoft : lit ? env.colors.lit : env.colors.body;
      ctx.fill();
      ctx.strokeStyle = bad ? env.colors.err : env.colors.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      /* filament */
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy + 4);
      ctx.lineTo(cx - 4, cy - 1);
      ctx.lineTo(cx - 1.3, cy + 2.5);
      ctx.lineTo(cx + 1.3, cy - 1);
      ctx.lineTo(cx + 4, cy + 2.5);
      ctx.lineTo(cx + 5, cy + 4);
      ctx.strokeStyle = lit ? env.colors.filamentOn : env.colors.lineSoft;
      ctx.lineWidth = 1.3;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  });

  C.def({
    id: 'digit4',
    name: '4-Bit Digit',
    category: 'outputs',
    size: function () { return { w: 44, h: 60 }; },
    ports: function (node) {
      var s = this.size(node);
      var ys = H.spread(4, s.h);
      /* Most-significant bit at the top, matching how you'd read it. */
      var names = ['8', '4', '2', '1'];
      var ins = [];
      for (var i = 0; i < 4; i++) {
        ins.push({ name: names[i], x: -LEAD, y: ys[i], dir: 'left' });
      }
      return { inputs: ins, outputs: [] };
    },
    evaluate: function () { return []; },
    draw: function (ctx, node, env) {
      var s = this.size(node);
      var ins = node.in || [];
      var bad = S.anyErr(ins);
      var v = 0;
      for (var i = 0; i < 4; i++) if (ins[i] === S.HIGH) v |= (8 >> i);

      ctx.beginPath();
      C.shapes.box(ctx, s.w, s.h);
      H.body(ctx, env);
      H.text(ctx, env, bad ? 'X' : v.toString(16).toUpperCase(),
        s.w / 2, s.h / 2, 34, bad ? env.colors.err : env.colors.accent);

      /* pin weights, so it's obvious which input is which */
      var ys = H.spread(4, s.h);
      var names = ['8', '4', '2', '1'];
      for (i = 0; i < 4; i++) {
        H.text(ctx, env, names[i], 5, ys[i], 7, env.colors.muted, 'left');
      }
    }
  });
})(window.OL);
