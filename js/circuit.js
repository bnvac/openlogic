/* OpenLogic — the document model.
 *
 * A circuit is just nodes + wires. Wires always run output -> input; the
 * editor normalises direction at draw time so you can drag either way.
 * An input pin may take more than one wire — that's how a tri-state bus
 * works — and the simulator resolves the resulting net.
 */
(function (OL) {
  'use strict';

  var C = OL.Components;

  var FORMAT = 'openlogic-circuit';
  var VERSION = 1;

  function Circuit() {
    this.nodes = [];
    this.wires = [];
    this.nextId = 1;
    this.revision = 0;          // bumped on any structural change
  }

  Circuit.prototype.touch = function () { this.revision++; };

  Circuit.prototype.addNode = function (type, x, y, opts) {
    var d = C.get(type);
    if (!d) throw new Error('unknown component type: ' + type);
    var node = {
      id: this.nextId++,
      type: type,
      x: x, y: y,
      rot: (opts && opts.rot) || 0,
      props: Object.assign({}, d.defaults, (opts && opts.props) || {}),
      state: Object.assign({}, (opts && opts.state) || {}),
      in: [],
      out: []
    };
    if (d.reset) d.reset(node);
    if (opts && opts.state) Object.assign(node.state, opts.state);
    this.nodes.push(node);
    this.touch();
    return node;
  };

  Circuit.prototype.node = function (id) {
    for (var i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].id === id) return this.nodes[i];
    }
    return null;
  };

  Circuit.prototype.removeNode = function (node) {
    var i = this.nodes.indexOf(node);
    if (i < 0) return;
    this.nodes.splice(i, 1);
    this.wires = this.wires.filter(function (w) {
      return w.from.node !== node.id && w.to.node !== node.id;
    });
    this.touch();
  };

  /* Reject self-loops on the same pin and exact duplicates; everything else
     (fan-out, multiple drivers) is legal and meaningful. */
  Circuit.prototype.canConnect = function (fromId, fromPort, toId, toPort) {
    if (fromId === toId) return false;
    for (var i = 0; i < this.wires.length; i++) {
      var w = this.wires[i];
      if (w.from.node === fromId && w.from.port === fromPort &&
          w.to.node === toId && w.to.port === toPort) return false;
    }
    return true;
  };

  Circuit.prototype.addWire = function (fromId, fromPort, toId, toPort) {
    if (!this.canConnect(fromId, fromPort, toId, toPort)) return null;
    var w = {
      id: this.nextId++,
      from: { node: fromId, port: fromPort },
      to: { node: toId, port: toPort }
    };
    this.wires.push(w);
    this.touch();
    return w;
  };

  Circuit.prototype.removeWire = function (wire) {
    var i = this.wires.indexOf(wire);
    if (i >= 0) { this.wires.splice(i, 1); this.touch(); }
  };

  /* Drop wires whose pin no longer exists — e.g. after shrinking an AND
     gate from 5 inputs back to 2. */
  Circuit.prototype.prune = function () {
    var self = this;
    var before = this.wires.length;
    this.wires = this.wires.filter(function (w) {
      var a = self.node(w.from.node), b = self.node(w.to.node);
      if (!a || !b) return false;
      var pa = C.portsOf(a), pb = C.portsOf(b);
      return !!pa.outputs[w.from.port] && !!pb.inputs[w.to.port];
    });
    if (this.wires.length !== before) this.touch();
  };

  Circuit.prototype.toJSON = function () {
    return {
      format: FORMAT,
      version: VERSION,
      nodes: this.nodes.map(function (n) {
        var d = C.get(n.type);
        var o = { id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y) };
        if (n.rot) o.rot = n.rot;
        if (Object.keys(n.props).length) o.props = Object.assign({}, n.props);
        if (d.persist && d.persist.length) {
          var st = {};
          d.persist.forEach(function (k) { if (n.state[k] !== undefined) st[k] = n.state[k]; });
          if (Object.keys(st).length) o.state = st;
        }
        return o;
      }),
      wires: this.wires.map(function (w) {
        return { id: w.id, from: [w.from.node, w.from.port], to: [w.to.node, w.to.port] };
      })
    };
  };

  /* Tolerant loader: skips anything it doesn't recognise rather than
     throwing away the whole file. Returns a list of warnings. */
  Circuit.fromJSON = function (data) {
    if (!data || typeof data !== 'object') throw new Error('Not a circuit file.');
    if (data.format && data.format !== FORMAT) {
      throw new Error('Unrecognised format: ' + data.format);
    }
    if (!Array.isArray(data.nodes)) throw new Error('Circuit file has no nodes.');

    var c = new Circuit();
    var warnings = [];
    var maxId = 0;
    var byOldId = {};

    data.nodes.forEach(function (raw) {
      var d = C.get(raw.type);
      if (!d) { warnings.push('Skipped unknown component "' + raw.type + '".'); return; }
      var node = {
        id: raw.id,
        type: raw.type,
        x: Number(raw.x) || 0,
        y: Number(raw.y) || 0,
        rot: C.ROT.indexOf(raw.rot) >= 0 ? raw.rot : 0,
        props: Object.assign({}, d.defaults, raw.props || {}),
        state: {},
        in: [],
        out: []
      };
      if (d.reset) d.reset(node);
      if (raw.state) Object.assign(node.state, raw.state);
      maxId = Math.max(maxId, node.id | 0);
      byOldId[node.id] = node;
      c.nodes.push(node);
    });

    (data.wires || []).forEach(function (raw) {
      var f = raw.from, t = raw.to;
      if (!f || !t) return;
      var a = byOldId[f[0]], b = byOldId[t[0]];
      if (!a || !b) { warnings.push('Dropped a wire with a missing endpoint.'); return; }
      var pa = C.portsOf(a), pb = C.portsOf(b);
      if (!pa.outputs[f[1]] || !pb.inputs[t[1]]) {
        warnings.push('Dropped a wire pointing at a pin that no longer exists.');
        return;
      }
      var id = raw.id | 0;
      maxId = Math.max(maxId, id);
      c.wires.push({ id: id || ++maxId, from: { node: f[0], port: f[1] }, to: { node: t[0], port: t[1] } });
    });

    c.nextId = maxId + 1;
    c.warnings = warnings;
    return c;
  };

  Circuit.prototype.clone = function () {
    return Circuit.fromJSON(this.toJSON());
  };

  Circuit.FORMAT = FORMAT;
  Circuit.VERSION = VERSION;
  OL.Circuit = Circuit;
})(window.OL);
