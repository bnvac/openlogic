/* OpenLogic — undo/redo.
 *
 * Whole-document snapshots as JSON strings. A circuit big enough for that
 * to matter would be well past what this editor is for, and it buys exact
 * correctness for free: no per-operation inverse to get subtly wrong.
 */
(function (OL) {
  'use strict';

  function History(limit) {
    this.limit = limit || 80;
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
  }

  History.prototype.init = function (snapshot) {
    this.current = snapshot;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  };

  History.prototype.commit = function (snapshot) {
    if (snapshot === this.current) return false;
    if (this.current !== null) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.current = snapshot;
    this.redoStack.length = 0;
    return true;
  };

  History.prototype.canUndo = function () { return this.undoStack.length > 0; };
  History.prototype.canRedo = function () { return this.redoStack.length > 0; };

  History.prototype.undo = function () {
    if (!this.undoStack.length) return null;
    this.redoStack.push(this.current);
    this.current = this.undoStack.pop();
    return this.current;
  };

  History.prototype.redo = function () {
    if (!this.redoStack.length) return null;
    this.undoStack.push(this.current);
    this.current = this.redoStack.pop();
    return this.current;
  };

  OL.History = History;
})(window.OL);
