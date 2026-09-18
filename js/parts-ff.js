/* OpenLogic — flip-flops.
 *
 * All four are rising-edge triggered. PRE/CLR on the D flip-flop are
 * ACTIVE HIGH, not active low as on a 7474: an unconnected pin reads LOW,
 * so active-high means "leave it floating and it does nothing" instead of
 * "leave it floating and the part is permanently held in reset".
 */
(function (OL) {
  'use strict';

  var S = OL.Signal;
  var C = OL.Components;
  var H = C.helpers;
  var LEAD = C.LEAD;
  var high = S.high;

  var W = 58, HGT = 62;

  function makeFF(spec) {
    var d = {
      id: spec.id,
      name: spec.name,
      category: 'flipflops',
      clkIndex: spec.clkIndex,
      size: function () { return { w: W, h: HGT }; },
      ports: function () {
        var ins = spec.pins.map(function (p) {
          return { name: p.name, x: -LEAD, y: p.y, dir: 'left' };
        });
        if (spec.preclr) {
          ins.push({ name: 'PRE', x: W / 2, y: -LEAD, dir: 'up' });
          ins.push({ name: 'CLR', x: W / 2, y: HGT + LEAD, dir: 'down' });
        }
        return {
          inputs: ins,
          outputs: [
            { name: 'Q',  x: W + LEAD, y: spec.qy,  dir: 'right' },
            { name: "Q'", x: W + LEAD, y: spec.nqy, dir: 'right' }
          ]
        };
      },
      reset: function (node) { node.state.q = false; node.state.prevClk = false; },
      evaluate: function (node, ins) {
        var st = node.state;
        var clk = high(ins[spec.clkIndex]);
        var rising = clk && !st.prevClk;
        st.prevClk = clk;

        var pre = spec.preclr && high(ins[spec.pins.length]);
        var clr = spec.preclr && high(ins[spec.pins.length + 1]);

        if (pre) st.q = true;             // preset wins a PRE+CLR tie
        else if (clr) st.q = false;
        else if (rising) st.q = spec.next(ins, !!st.q);

        return st.q ? [S.HIGH, S.LOW] : [S.LOW, S.HIGH];
      },
      draw: function (ctx, node, env) {
        ctx.beginPath();
        C.shapes.box(ctx, W, HGT);
        H.body(ctx, env);

        spec.pins.forEach(function (p, i) {
          if (i === spec.clkIndex) {
            /* the edge-trigger wedge */
            ctx.beginPath();
            ctx.moveTo(1, p.y - 5);
            ctx.lineTo(9, p.y);
            ctx.lineTo(1, p.y + 5);
            ctx.strokeStyle = env.colors.line;
            ctx.lineWidth = 1.5;
            ctx.lineJoin = 'miter';
            ctx.stroke();
          } else {
            H.text(ctx, env, p.name, 5, p.y, 10, env.colors.line, 'left');
          }
        });

        if (spec.preclr) {
          H.text(ctx, env, 'PRE', W / 2, 9, 7.5, env.colors.muted);
          H.text(ctx, env, 'CLR', W / 2, HGT - 9, 7.5, env.colors.muted);
        }

        H.text(ctx, env, 'Q', W - 6, spec.qy, 10, env.colors.line, 'right');
        H.text(ctx, env, 'Q', W - 6, spec.nqy, 10, env.colors.line, 'right');
        /* overbar for Q-not */
        var m = ctx.measureText('Q').width;
        ctx.beginPath();
        ctx.moveTo(W - 6 - m, spec.nqy - 6);
        ctx.lineTo(W - 6, spec.nqy - 6);
        ctx.strokeStyle = env.colors.line;
        ctx.lineWidth = 1.1;
        ctx.stroke();

        H.text(ctx, env, spec.badge, W / 2, HGT / 2, 11, env.colors.muted);
      }
    };
    return C.def(d);
  }

  makeFF({
    id: 'sr', name: 'SR Flip-Flop', badge: 'SR',
    pins: [{ name: 'S', y: 15 }, { name: '>', y: 31 }, { name: 'R', y: 47 }],
    clkIndex: 1, qy: 18, nqy: 44,
    next: function (ins, q) {
      var s = high(ins[0]), r = high(ins[2]);
      if (s && !r) return true;
      if (r && !s) return false;
      return q;                            // S=R=1 is undefined; hold instead
    }
  });

  makeFF({
    id: 'dff', name: 'D Flip-Flop', badge: 'D', preclr: true,
    pins: [{ name: 'D', y: 18 }, { name: '>', y: 44 }],
    clkIndex: 1, qy: 18, nqy: 44,
    next: function (ins) { return high(ins[0]); }
  });

  makeFF({
    id: 'jk', name: 'JK Flip-Flop', badge: 'JK',
    pins: [{ name: 'J', y: 15 }, { name: '>', y: 31 }, { name: 'K', y: 47 }],
    clkIndex: 1, qy: 18, nqy: 44,
    next: function (ins, q) {
      var j = high(ins[0]), k = high(ins[2]);
      if (j && k) return !q;
      if (j) return true;
      if (k) return false;
      return q;
    }
  });

  makeFF({
    id: 'tff', name: 'T Flip-Flop', badge: 'T',
    pins: [{ name: 'T', y: 18 }, { name: '>', y: 44 }],
    clkIndex: 1, qy: 18, nqy: 44,
    next: function (ins, q) { return high(ins[0]) ? !q : q; }
  });
})(window.OL);
