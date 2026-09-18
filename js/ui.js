/* OpenLogic — palette, inspector and chrome.
 *
 * Palette icons are drawn with the same code path as the canvas, so a part
 * can never look one way in the tray and another way once placed.
 */
(function (OL) {
  'use strict';

  var C = OL.Components;
  var Renderer = OL.Renderer;

  var ICON_W = 78, ICON_H = 46;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function sampleNode(typeId) {
    var d = C.get(typeId);
    var node = {
      id: -1, type: typeId, x: 0, y: 0, rot: 0,
      props: Object.assign({}, d.defaults), state: {}, in: [], out: []
    };
    if (d.reset) d.reset(node);
    var p = C.portsOf(node);
    /* Tray icons show pins at rest; gold "floating" pins are canvas-only
       feedback and just read as noise in the palette. */
    node.in = new Array(p.inputs.length).fill(OL.Signal.LOW);
    node.out = new Array(p.outputs.length).fill(OL.Signal.LOW);
    return node;
  }

  function renderIcon(canvas, typeId, colors) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = ICON_W * dpr;
    canvas.height = ICON_H * dpr;
    canvas.style.width = ICON_W + 'px';
    canvas.style.height = ICON_H + 'px';

    var ctx = canvas.getContext('2d');
    var node = sampleNode(typeId);
    var b = C.localBounds(node);
    var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var scale = Math.min((ICON_W - 8) / bw, (ICON_H - 8) / bh, 1);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ICON_W, ICON_H);
    ctx.translate(ICON_W / 2, ICON_H / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(b.x0 + bw / 2), -(b.y0 + bh / 2));

    var shim = Object.create(Renderer.prototype);
    shim.ctx = ctx;
    shim.colors = colors;
    shim.view = { scale: scale };
    shim.drawNode(node, { selected: false });
  }

  /* --------------------------------------------------------- palette */

  function buildPalette(app) {
    var root = document.getElementById('palette-body');
    root.innerHTML = '';
    var prefs = OL.Storage.prefs();
    var collapsed = prefs.collapsed || {};

    C.categories.forEach(function (cat) {
      var section = el('section', 'cat');
      var head = el('button', 'cat-head');
      head.type = 'button';
      head.innerHTML = '<span>' + cat.name + '</span><svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
      var grid = el('div', 'cat-grid');

      C.order.forEach(function (id) {
        var d = C.get(id);
        if (d.category !== cat.id) return;

        var item = el('button', 'part');
        item.type = 'button';
        item.draggable = true;
        item.dataset.type = id;
        item.title = d.name;

        var cv = el('canvas', 'part-icon');
        item.appendChild(cv);
        item.appendChild(el('span', 'part-name', d.name));

        item.addEventListener('click', function () {
          app.interaction.beginPlace(id);
          highlight(root, item);
        });
        item.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/openlogic-type', id);
          e.dataTransfer.effectAllowed = 'copy';
        });

        grid.appendChild(item);
        app.icons.push({ canvas: cv, type: id });
      });

      if (collapsed[cat.id]) section.classList.add('collapsed');
      head.addEventListener('click', function () {
        section.classList.toggle('collapsed');
        var p = OL.Storage.prefs();
        p.collapsed = p.collapsed || {};
        p.collapsed[cat.id] = section.classList.contains('collapsed');
        OL.Storage.savePrefs(p);
      });

      section.appendChild(head);
      section.appendChild(grid);
      root.appendChild(section);
    });

    var search = document.getElementById('palette-search');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      root.querySelectorAll('.part').forEach(function (p) {
        var d = C.get(p.dataset.type);
        p.hidden = !!q && d.name.toLowerCase().indexOf(q) < 0 && d.id.indexOf(q) < 0;
      });
      root.querySelectorAll('.cat').forEach(function (s) {
        var any = Array.prototype.some.call(s.querySelectorAll('.part'), function (p) { return !p.hidden; });
        s.hidden = !any;
        if (q) s.classList.remove('collapsed');
      });
    });
  }

  function highlight(root, item) {
    root.querySelectorAll('.part.active').forEach(function (p) { p.classList.remove('active'); });
    if (item) item.classList.add('active');
  }

  function clearPaletteHighlight() {
    var root = document.getElementById('palette-body');
    if (root) highlight(root, null);
  }

  function repaintIcons(app) {
    app.icons.forEach(function (i) { renderIcon(i.canvas, i.type, app.renderer.colors); });
  }

  /* ------------------------------------------------------- inspector */

  function buildInspector(app) {
    var panel = document.getElementById('inspector');
    var body = document.getElementById('inspector-body');
    var title = document.getElementById('inspector-title');
    var nodes = [];
    app.selection.forEach(function (o) { if (o.type) nodes.push(o); });
    var wires = [];
    app.selection.forEach(function (o) { if (o.from) wires.push(o); });

    if (!nodes.length && !wires.length) { panel.hidden = true; return; }
    panel.hidden = false;
    body.innerHTML = '';

    if (nodes.length === 1 && !wires.length) {
      var node = nodes[0];
      var d = C.get(node.type);
      title.textContent = d.name;

      d.props.forEach(function (p) {
        var row = el('label', 'field');
        row.appendChild(el('span', 'field-label', p.label));
        var input = el('input');
        input.type = 'number';
        input.value = node.props[p.key];
        if (p.min != null) input.min = p.min;
        if (p.max != null) input.max = p.max;
        input.step = p.step || 1;
        input.addEventListener('change', function () {
          var v = p.type === 'int' ? parseInt(input.value, 10) : parseFloat(input.value);
          if (isNaN(v)) { input.value = node.props[p.key]; return; }
          if (p.min != null) v = Math.max(p.min, v);
          if (p.max != null) v = Math.min(p.max, v);
          input.value = v;
          node.props[p.key] = v;
          app.circuit.touch();
          /* Shrinking a gate can orphan wires — drop them explicitly so
             the model never carries a dangling reference. */
          app.circuit.prune();
          app.commit();
        });
        row.appendChild(input);
        body.appendChild(row);
      });

      var pins = C.portsOf(node);
      var info = el('div', 'pinout');
      pins.inputs.forEach(function (p, i) { info.appendChild(pinRow(p.name, node.in[i], 'in')); });
      pins.outputs.forEach(function (p, i) { info.appendChild(pinRow(p.name, node.out[i], 'out')); });
      if (pins.inputs.length || pins.outputs.length) {
        body.appendChild(el('div', 'field-label mt', 'Live pin values'));
        body.appendChild(info);
      }
    } else {
      var bits = [];
      if (nodes.length) bits.push(nodes.length + ' component' + (nodes.length > 1 ? 's' : ''));
      if (wires.length) bits.push(wires.length + ' wire' + (wires.length > 1 ? 's' : ''));
      title.textContent = bits.join(' · ');
    }

    var actions = el('div', 'inspector-actions');
    if (nodes.length) {
      var rot = el('button', 'btn', 'Rotate');
      rot.type = 'button';
      rot.addEventListener('click', function () { app.interaction.rotateSelection(1); });
      actions.appendChild(rot);
    }
    var del = el('button', 'btn danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', function () { app.interaction.deleteSelection(); });
    actions.appendChild(del);
    body.appendChild(actions);
  }

  function pinRow(name, value, dir) {
    var row = el('div', 'pin-row');
    row.appendChild(el('span', 'pin-name', name));
    var v = el('span', 'pin-val v' + (value === undefined ? 2 : value), OL.Signal.label(value === undefined ? OL.Signal.Z : value));
    row.appendChild(v);
    row.appendChild(el('span', 'pin-dir', dir));
    return row;
  }

  OL.UI = {
    el: el,
    buildPalette: buildPalette,
    buildInspector: buildInspector,
    repaintIcons: repaintIcons,
    renderIcon: renderIcon,
    clearPaletteHighlight: clearPaletteHighlight
  };
})(window.OL);
