/* OpenLogic — the simulation engine.
 *
 * Delta-cycle settling: each pass computes every input net from the
 * currently-published outputs, then evaluates every component from those
 * inputs. Repeat until nothing changes. Feedback that never settles (a NOT
 * gate wired to itself) hits the iteration cap and is reported as
 * oscillating rather than hanging the frame.
 */
(function (OL) {
  'use strict';

  var S = OL.Signal;
  var C = OL.Components;

  var MAX_PASSES = 64;

  function Simulator(circuit) {
    this.circuit = circuit;
    this.running = true;
    this.oscillating = false;
    this.indexRevision = -1;
    this.drivers = null;         // [nodeIndex][portIndex] -> array of wires
  }

  Simulator.prototype.setCircuit = function (circuit) {
    this.circuit = circuit;
    this.indexRevision = -1;
    this.reset();
  };

  /* Rebuilding is O(wires); we only do it when the circuit actually
     changed, which is what `revision` is for. */
  Simulator.prototype.reindex = function () {
    var c = this.circuit;
    if (this.indexRevision === c.revision) return;

    var slot = {};
    c.nodes.forEach(function (n) {
      var p = C.portsOf(n);
      n._nIn = p.inputs.length;
      n._nOut = p.outputs.length;
      while (n.in.length < n._nIn) n.in.push(S.Z);
      n.in.length = n._nIn;
      while (n.out.length < n._nOut) n.out.push(S.Z);
      n.out.length = n._nOut;
      slot[n.id] = n;
    });

    var drivers = {};
    c.wires.forEach(function (w) {
      var src = slot[w.from.node], dst = slot[w.to.node];
      if (!src || !dst) return;
      w._src = src;
      var key = w.to.node + ':' + w.to.port;
      (drivers[key] || (drivers[key] = [])).push(w);
    });

    this.drivers = drivers;
    this.nodeById = slot;
    this.indexRevision = c.revision;
  };

  Simulator.prototype.reset = function () {
    var c = this.circuit;
    c.nodes.forEach(function (n) {
      var d = C.get(n.type);
      if (d.reset) d.reset(n);
      for (var i = 0; i < n.in.length; i++) n.in[i] = S.Z;
      for (i = 0; i < n.out.length; i++) n.out[i] = S.Z;
    });
    this.oscillating = false;
    this.indexRevision = -1;
    this.settle();
  };

  /* One delta cycle. Returns true if anything moved. */
  Simulator.prototype.pass = function () {
    var c = this.circuit, drivers = this.drivers;
    var i, j, n;

    for (i = 0; i < c.nodes.length; i++) {
      n = c.nodes[i];
      for (j = 0; j < n.in.length; j++) {
        var list = drivers[n.id + ':' + j];
        if (!list) { n.in[j] = S.Z; continue; }
        if (list.length === 1) {
          var w = list[0];
          n.in[j] = w._src.out[w.from.port];
          if (n.in[j] === undefined) n.in[j] = S.Z;
        } else {
          var vals = [];
          for (var k = 0; k < list.length; k++) {
            vals.push(list[k]._src.out[list[k].from.port]);
          }
          n.in[j] = S.resolve(vals);
        }
      }
    }

    var changed = false;
    for (i = 0; i < c.nodes.length; i++) {
      n = c.nodes[i];
      var out = C.get(n.type).evaluate(n, n.in);
      if (!out) continue;
      for (j = 0; j < out.length; j++) {
        if (n.out[j] !== out[j]) { n.out[j] = out[j]; changed = true; }
      }
    }
    return changed;
  };

  Simulator.prototype.settle = function () {
    this.reindex();
    for (var p = 0; p < MAX_PASSES; p++) {
      if (!this.pass()) { this.oscillating = false; return p; }
    }
    this.oscillating = true;
    return MAX_PASSES;
  };

  /* Advance wall-clock-driven parts (currently just Clock). */
  Simulator.prototype.advance = function (dt) {
    var c = this.circuit, moved = false;
    for (var i = 0; i < c.nodes.length; i++) {
      var d = C.get(c.nodes[i].type);
      if (d.tick && d.tick(c.nodes[i], dt)) moved = true;
    }
    return moved;
  };

  /* Returns true if anything moved, so the app can skip repainting an
     idle circuit instead of burning a frame on an identical picture. */
  Simulator.prototype.frame = function (dt) {
    this.reindex();
    if (this.running) this.advance(Math.min(dt, 0.25));
    return this.settle() > 0;
  };

  /* Single-step while paused: jump to the next clock edge if there is one,
     otherwise just run one more settling pass. */
  Simulator.prototype.step = function () {
    this.reindex();
    var c = this.circuit, best = Infinity;
    c.nodes.forEach(function (n) {
      if (n.type !== 'clock') return;
      var f = Math.max(0.05, Number(n.props.frequency) || 2);
      var halfPeriod = 0.5 / f;
      var remaining = halfPeriod - (n.state.acc || 0);
      if (remaining > 0 && remaining < best) best = remaining;
    });
    if (best !== Infinity) this.advance(best + 1e-6);
    this.settle();
  };

  Simulator.MAX_PASSES = MAX_PASSES;
  OL.Simulator = Simulator;
})(window.OL);
