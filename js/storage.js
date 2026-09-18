/* OpenLogic — files in, files out.
 *
 * No server, no account: a circuit is a .json file you own. localStorage is
 * only a crash net so a refresh doesn't cost you work — it is not the
 * save mechanism, and the UI says so.
 */
(function (OL) {
  'use strict';

  var AUTOSAVE_KEY = 'openlogic:autosave';
  var PREFS_KEY = 'openlogic:prefs';

  function safeLocal(fn, fallback) {
    /* Private-mode Safari and file:// in some browsers throw on access. */
    try { return fn(); } catch (e) { return fallback; }
  }

  var Storage = {
    download: function (data, filename) {
      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'circuit.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      /* Revoke late: Firefox cancels an in-flight download otherwise. */
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    readFile: function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          try { resolve(JSON.parse(String(reader.result))); }
          catch (e) { reject(new Error("That file isn't valid JSON.")); }
        };
        reader.onerror = function () { reject(new Error("Couldn't read that file.")); };
        reader.readAsText(file);
      });
    },

    exportPNG: function (canvas, filename) {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename || 'circuit.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }, 'image/png');
    },

    saveAutosave: function (data) {
      safeLocal(function () {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
      });
    },

    loadAutosave: function () {
      return safeLocal(function () {
        var raw = localStorage.getItem(AUTOSAVE_KEY);
        return raw ? JSON.parse(raw) : null;
      }, null);
    },

    clearAutosave: function () {
      safeLocal(function () { localStorage.removeItem(AUTOSAVE_KEY); });
    },

    prefs: function () {
      return safeLocal(function () {
        return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      }, {}) || {};
    },

    savePrefs: function (obj) {
      safeLocal(function () { localStorage.setItem(PREFS_KEY, JSON.stringify(obj)); });
    }
  };

  OL.Storage = Storage;
})(window.OL);
