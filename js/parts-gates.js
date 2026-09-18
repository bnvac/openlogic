/* OpenLogic — logic gates. */
(function (OL) {
  'use strict';

  var S = OL.Signal;
  var C = OL.Components;
  var H = C.helpers;
  var LEAD = C.LEAD;
  var high = S.high;
  var LETTERS = 'ABCDEFGH'.split('');

  function gateSize(node, d) {
    var n = d.fixedInputs || H.clampInt(node.props && node.props.inputs, 2, 8, 2);
    return { w: 46, h: Math.max(36, (n - 1) * 16 + 20) };
  }

  /* Gate pins: inputs down the left edge, one output off the nose. The OR
     family gets a longer stub so it reaches past the concave back. */
  function gatePorts(node, d) {
    var s = d.size(node);
    var n = d.fixedInputs || H.clampInt(node.props && node.props.inputs, 2, 8, 2);
    var ys = H.spread(n, s.h);
    var lead = (d.shape === 'or' || d.shape === 'xor') ? LEAD + 6 : LEAD;
    var ins = [];
    for (var i = 0; i < n; i++) {
      ins.push({ name: LETTERS[i], x: -LEAD, y: ys[i], dir: 'left', lead: lead });
    }
    var nose = s.w + (d.inverted ? 9 : 0);
    return {
      inputs: ins,
      outputs: [{ name: 'Y', x: nose + LEAD, y: s.h / 2, dir: 'right' }]
    };
  }

  function gateDraw(ctx, node, env, d) {
    var s = d.size(node), w = s.w, h = s.h;
    ctx.beginPath();
    C.shapes[d.shape](ctx, w, h);
    H.body(ctx, env);
    if (d.shape === 'xor') {
      /* The second back-arc that tells XOR apart from OR. */
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.quadraticCurveTo(w * 0.28 - 7, h / 2, -7, h);
      ctx.strokeStyle = env.colors.line;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (d.inverted) H.bubble(ctx, env, w + 4.5, h / 2);
  }

  function makeGate(spec) {
    var d = {
      id: spec.id,
      name: spec.name,
      category: 'gates',
      shape: spec.shape,
      inverted: !!spec.inverted,
      fixedInputs: spec.fixedInputs || 0,
      defaults: spec.fixedInputs ? {} : { inputs: 2 },
      props: spec.fixedInputs ? [] :
        [{ key: 'inputs', label: 'Inputs', type: 'int', min: 2, max: 8 }],
      logic: spec.logic
    };
    d.size = function (node) { return gateSize(node, d); };
    d.ports = function (node) { return gatePorts(node, d); };
    d.draw = function (ctx, node, env) { return gateDraw(ctx, node, env, d); };
    d.evaluate = function (node, ins) {
      if (S.anyErr(ins)) return [S.ERR];
      var n = 0;
      for (var i = 0; i < ins.length; i++) if (high(ins[i])) n++;
      var out = d.logic(n, ins.length, ins);
      return [S.fromBool(d.inverted ? !out : out)];
    };
    return C.def(d);
  }

  makeGate({ id: 'buffer', name: 'Buffer',    shape: 'buf', fixedInputs: 1, logic: function (n) { return n === 1; } });
  makeGate({ id: 'not',    name: 'NOT Gate',  shape: 'buf', fixedInputs: 1, inverted: true, logic: function (n) { return n === 1; } });
  makeGate({ id: 'and',    name: 'AND Gate',  shape: 'and', logic: function (n, t) { return n === t; } });
  makeGate({ id: 'nand',   name: 'NAND Gate', shape: 'and', inverted: true, logic: function (n, t) { return n === t; } });
  makeGate({ id: 'or',     name: 'OR Gate',   shape: 'or',  logic: function (n) { return n > 0; } });
  makeGate({ id: 'nor',    name: 'NOR Gate',  shape: 'or',  inverted: true, logic: function (n) { return n > 0; } });
  makeGate({ id: 'xor',    name: 'XOR Gate',  shape: 'xor', logic: function (n) { return n % 2 === 1; } });
  makeGate({ id: 'xnor',   name: 'XNOR Gate', shape: 'xor', inverted: true, logic: function (n) { return n % 2 === 1; } });

  /* Tri-state buffer: the one part that can hand a net back to nobody. */
  C.def({
    id: 'tristate',
    name: 'Tri-State',
    category: 'gates',
    size: function () { return { w: 40, h: 34 }; },
    ports: function (node) {
      var s = this.size(node);
      return {
        inputs: [
          { name: 'IN', x: -LEAD, y: s.h / 2, dir: 'left' },
          { name: 'EN', x: s.w / 2, y: -LEAD - 4, dir: 'up', lead: LEAD + 4 }
        ],
        outputs: [{ name: 'Y', x: s.w + LEAD, y: s.h / 2, dir: 'right' }]
      };
    },
    evaluate: function (node, ins) {
      if (S.anyErr(ins)) return [S.ERR];
      if (!high(ins[1])) return [S.Z];
      return [S.fromBool(high(ins[0]))];
    },
    draw: function (ctx, node, env) {
      var s = this.size(node);
      ctx.beginPath();
      C.shapes.buf(ctx, s.w, s.h);
      H.body(ctx, env);
    }
  });
})(window.OL);
