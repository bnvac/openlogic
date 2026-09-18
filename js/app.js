/* OpenLogic — bootstrap and glue. */
(function (OL) {
  'use strict';

  var C = OL.Components;
  var Storage = OL.Storage;

  function App() {
    this.canvas = document.getElementById('canvas');
    this.renderer = new OL.Renderer(this.canvas);
    this.circuit = new OL.Circuit();
    this.sim = new OL.Simulator(this.circuit);
    this.history = new OL.History(80);
    this.selection = new Set();
    this.icons = [];
    this.dirty = true;
    this.filename = 'circuit.json';
    this.interaction = new OL.Interaction(this);
  }

  App.prototype.start = function () {
    var self = this;
    var prefs = Storage.prefs();

    this.applyTheme(prefs.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    this.renderer.showGrid = prefs.grid !== false;
    document.getElementById('btn-grid').setAttribute('aria-pressed', String(this.renderer.showGrid));

    OL.UI.buildPalette(this);
    OL.UI.repaintIcons(this);
    this.bindChrome();
    /* Measure before the first load so zoom-to-fit has real dimensions. */
    this.renderer.resize();

    var restored = Storage.loadAutosave();
    if (restored) {
      try { this.load(OL.Circuit.fromJSON(restored), { quiet: true }); }
      catch (e) { this.loadSample(); }
    } else {
      this.loadSample();
    }

    if (prefs.view) {
      this.renderer.view = prefs.view;
      this.onViewChanged();
    }

    /* The stage also changes size when the inspector opens or the palette
       wraps, neither of which fires a window resize — watch the element. */
    if (window.ResizeObserver) {
      new ResizeObserver(function () { self.resize(); }).observe(this.canvas);
    }
    window.addEventListener('resize', function () { self.resize(); });
    this.resize();

    var last = performance.now();
    function loop(now) {
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      var moved = self.sim.frame(dt);
      if (moved || self.dirty) {
        self.renderer.render(self.interaction.scene());
        self.dirty = false;
      }
      self.updateOscIndicator();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  };

  App.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    if (r.width === this.renderer.cssWidth &&
        r.height === this.renderer.cssHeight &&
        dpr === this.renderer.dpr) return;
    this.renderer.resize();
    /* Writing canvas.width blanks the backing store. Repaint synchronously
       rather than waiting for the next rAF: ResizeObserver callbacks run
       after layout but before paint, so this lands in the same frame.
       Deferring composites one empty frame, which reads as a flash every
       time the inspector opens or closes. */
    this.renderer.render(this.interaction.scene());
    this.dirty = false;
  };

  App.prototype.requestRender = function () { this.dirty = true; };

  /* --------------------------------------------------------- document */

  App.prototype.snapshot = function () { return JSON.stringify(this.circuit.toJSON()); };

  /* Every structural edit funnels through here: one history entry, one
     autosave, one inspector refresh. */
  App.prototype.commit = function () {
    this.circuit.touch();
    this.history.commit(this.snapshot());
    this.autosave();
    this.refreshInspector();
    this.updateHistoryButtons();
    this.requestRender();
  };

  /* Flipping a switch is running the circuit, not editing it — worth
     persisting, not worth an undo step. */
  App.prototype.touchState = function () {
    this.autosave();
    this.requestRender();
  };

  App.prototype.autosave = function () {
    var self = this;
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(function () {
      Storage.saveAutosave(self.circuit.toJSON());
    }, 300);
  };

  App.prototype.load = function (circuit, opts) {
    opts = opts || {};
    this.circuit = circuit;
    this.selection.clear();
    this.sim.setCircuit(circuit);
    this.history.init(this.snapshot());
    this.updateHistoryButtons();
    this.refreshInspector();
    this.requestRender();
    this.setStatus('');
    if (circuit.warnings && circuit.warnings.length) {
      this.toast(circuit.warnings[0], 'warn');
    } else if (!opts.quiet) {
      this.toast('Circuit loaded');
    }
    if (!opts.keepView) this.zoomToFit();
    this.autosave();
  };

  App.prototype.restore = function (json) {
    if (!json) return;
    var c = OL.Circuit.fromJSON(JSON.parse(json));
    this.circuit = c;
    this.selection.clear();
    this.sim.setCircuit(c);
    this.refreshInspector();
    this.updateHistoryButtons();
    this.autosave();
    this.requestRender();
  };

  App.prototype.undo = function () {
    var s = this.history.undo();
    if (s === null) return;
    this.restore(s);
    this.setStatus('Undo');
  };

  App.prototype.redo = function () {
    var s = this.history.redo();
    if (s === null) return;
    this.restore(s);
    this.setStatus('Redo');
  };

  App.prototype.newCircuit = function () {
    if (this.circuit.nodes.length &&
        !confirm('Clear the canvas? Anything unsaved is lost.')) return;
    this.load(new OL.Circuit(), { quiet: true, keepView: true });
    this.filename = 'circuit.json';
    this.toast('New circuit');
  };

  /* ------------------------------------------------------------ files */

  App.prototype.saveFile = function () {
    var name = prompt('Save circuit as:', this.filename);
    if (!name) return;
    if (!/\.json$/i.test(name)) name += '.json';
    this.filename = name;
    Storage.download(this.circuit.toJSON(), name);
    this.toast('Saved ' + name);
  };

  App.prototype.promptOpen = function () {
    document.getElementById('file-input').click();
  };

  App.prototype.openFile = function (file) {
    var self = this;
    Storage.readFile(file)
      .then(function (data) {
        var c = OL.Circuit.fromJSON(data);
        self.filename = file.name.replace(/\.[^.]+$/, '') + '.json';
        self.load(c);
      })
      .catch(function (err) { self.toast(err.message, 'warn'); });
  };

  App.prototype.exportPNG = function () {
    /* Render once with the selection cleared so marquees and dashed
       outlines don't end up in the image. */
    var keep = new Set(this.selection);
    this.selection.clear();
    this.renderer.render(this.interaction.scene());
    Storage.exportPNG(this.canvas, this.filename.replace(/\.json$/i, '') + '.png');
    keep.forEach(function (o) { this.selection.add(o); }, this);
    this.requestRender();
    this.toast('Exported PNG');
  };

  /* ------------------------------------------------------------- view */

  App.prototype.onViewChanged = function () {
    var pct = Math.round(this.renderer.view.scale * 100);
    document.getElementById('zoom-level').textContent = pct + '%';
    document.getElementById('zoom-range').value = String(this.renderer.view.scale);
    var self = this;
    clearTimeout(this._viewTimer);
    this._viewTimer = setTimeout(function () {
      var p = Storage.prefs();
      p.view = self.renderer.view;
      Storage.savePrefs(p);
    }, 400);
  };

  App.prototype.zoomToFit = function () {
    var nodes = this.circuit.nodes;
    if (!nodes.length) {
      this.renderer.view = { x: 80, y: 60, scale: 1 };
      this.onViewChanged();
      this.requestRender();
      return;
    }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach(function (n) {
      var b = C.worldBounds(n);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    });
    var pad = 60;
    var sw = this.renderer.cssWidth || this.canvas.clientWidth;
    var sh = this.renderer.cssHeight || this.canvas.clientHeight;
    /* Fit zooms out to reveal, never in past 1:1. */
    var scale = Math.min((sw - pad * 2) / (x1 - x0), (sh - pad * 2) / (y1 - y0), 1);
    scale = Math.max(0.25, Math.min(4, scale));
    this.renderer.view = {
      scale: scale,
      x: sw / 2 - (x0 + x1) / 2 * scale,
      y: sh / 2 - (y0 + y1) / 2 * scale
    };
    this.onViewChanged();
    this.requestRender();
  };

  /* ------------------------------------------------------------ chrome */

  App.prototype.setStatus = function (text) {
    document.getElementById('status').textContent = text || '';
  };

  App.prototype.toast = function (msg, kind) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  };

  App.prototype.refreshInspector = function () {
    OL.UI.buildInspector(this);
    if (!this.interaction.ghost) OL.UI.clearPaletteHighlight();
  };

  App.prototype.updateHistoryButtons = function () {
    document.getElementById('btn-undo').disabled = !this.history.canUndo();
    document.getElementById('btn-redo').disabled = !this.history.canRedo();
  };

  App.prototype.updateOscIndicator = function () {
    var warn = document.getElementById('osc-warning');
    var on = this.sim.oscillating && this.sim.running;
    if (warn.hidden === !on) return;
    warn.hidden = !on;
  };

  /* `chosen` marks a deliberate pick, which then outranks the OS setting
     for good — otherwise the next system theme change silently undoes it. */
  App.prototype.applyTheme = function (theme, chosen) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('btn-theme').setAttribute('aria-pressed', String(theme === 'dark'));
    var p = Storage.prefs();
    p.theme = theme;
    if (chosen) p.themeLocked = true;
    Storage.savePrefs(p);
    if (this.renderer) {
      this.renderer.refreshColors();
      if (this.icons.length) OL.UI.repaintIcons(this);
      this.requestRender();
    }
  };

  App.prototype.setRunning = function (run) {
    this.sim.running = run;
    var btn = document.getElementById('sim-play');
    btn.setAttribute('aria-pressed', String(run));
    btn.title = run ? 'Pause simulation' : 'Run simulation';
    /* SVGElement has no `hidden` IDL property, so toggle a class. */
    btn.querySelector('.i-play').classList.toggle('off', run);
    btn.querySelector('.i-pause').classList.toggle('off', !run);
    this.requestRender();
  };

  App.prototype.bindChrome = function () {
    var self = this;
    function on(id, fn) {
      var n = document.getElementById(id);
      if (n) n.addEventListener('click', fn);
      return n;
    }

    on('btn-new', function () { self.newCircuit(); });
    on('btn-open', function () { self.promptOpen(); });
    on('btn-save', function () { self.saveFile(); });
    on('btn-png', function () { self.exportPNG(); });
    on('btn-undo', function () { self.undo(); });
    on('btn-redo', function () { self.redo(); });
    on('btn-copy', function () { self.interaction.copy(); });
    on('btn-paste', function () { self.interaction.paste(); });
    on('btn-rotate', function () { self.interaction.rotateSelection(1); });
    on('btn-delete', function () { self.interaction.deleteSelection(); });
    on('btn-fit', function () { self.zoomToFit(); });

    on('btn-grid', function (e) {
      self.renderer.showGrid = !self.renderer.showGrid;
      e.currentTarget.setAttribute('aria-pressed', String(self.renderer.showGrid));
      var p = Storage.prefs();
      p.grid = self.renderer.showGrid;
      Storage.savePrefs(p);
      self.requestRender();
    });

    ['select', 'pan'].forEach(function (mode) {
      on('btn-' + mode, function () {
        self.interaction.mode = mode;
        document.getElementById('btn-select').setAttribute('aria-pressed', String(mode === 'select'));
        document.getElementById('btn-pan').setAttribute('aria-pressed', String(mode === 'pan'));
        self.canvas.classList.toggle('pannable', mode === 'pan');
      });
    });

    on('btn-theme', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      self.applyTheme(next, true);
    });

    var help = document.getElementById('help-dialog');
    on('btn-help', function () { help.showModal(); });
    on('help-close', function () { help.close(); });

    on('sim-play', function () { self.setRunning(!self.sim.running); });
    on('sim-step', function () { self.sim.step(); self.requestRender(); });
    on('sim-reset', function () {
      self.sim.reset();
      self.toast('Simulation reset');
      self.requestRender();
    });

    on('zoom-in', function () {
      self.renderer.setZoom(self.renderer.view.scale * 1.25);
      self.onViewChanged(); self.requestRender();
    });
    on('zoom-out', function () {
      self.renderer.setZoom(self.renderer.view.scale / 1.25);
      self.onViewChanged(); self.requestRender();
    });
    document.getElementById('zoom-range').addEventListener('input', function (e) {
      self.renderer.setZoom(parseFloat(e.target.value));
      self.onViewChanged(); self.requestRender();
    });

    document.getElementById('file-input').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) self.openFile(e.target.files[0]);
      e.target.value = '';
    });

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!Storage.prefs().themeLocked) self.applyTheme(e.matches ? 'dark' : 'light');
    });

    this.setRunning(true);
  };

  /* A half-adder, so the first thing you see is a working circuit rather
     than an empty grid. */
  App.prototype.loadSample = function () {
    var c = new OL.Circuit();
    var a = c.addNode('toggle', 60, 90);
    var b = c.addNode('toggle', 60, 190);
    var xor = c.addNode('xor', 220, 110);
    var and = c.addNode('and', 220, 210);
    var sum = c.addNode('bulb', 350, 116);
    var carry = c.addNode('bulb', 350, 216);
    c.addWire(a.id, 0, xor.id, 0);
    c.addWire(b.id, 0, xor.id, 1);
    c.addWire(a.id, 0, and.id, 0);
    c.addWire(b.id, 0, and.id, 1);
    c.addWire(xor.id, 0, sum.id, 0);
    c.addWire(and.id, 0, carry.id, 0);
    this.load(c, { quiet: true });
    this.setStatus('Half adder — click the switches');
  };

  document.addEventListener('DOMContentLoaded', function () {
    var app = new App();
    OL.app = app;
    app.start();
  });

  OL.App = App;
})(window.OL);
