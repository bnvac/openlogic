/* OpenLogic — signal values.
 *
 * Four-state logic. Z (high impedance) is what makes Tri-State buffers
 * mean something, and ERR is what makes a shorted bus visible instead of
 * silently picking a winner.
 */
(function (OL) {
  'use strict';

  var S = {
    LOW: 0,
    HIGH: 1,
    Z: 2,   // nothing is driving this net
    ERR: 3  // two drivers disagree
  };

  /* Anything that isn't a solid HIGH reads as false at a gate input.
     A floating input therefore behaves like a pulled-down one. */
  S.high = function (v) { return v === S.HIGH; };

  S.fromBool = function (b) { return b ? S.HIGH : S.LOW; };

  /* Collapse every driver on a net down to one value. */
  S.resolve = function (values) {
    var found = -1;
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (v === S.Z || v === undefined || v === null) continue;
      if (v === S.ERR) return S.ERR;
      if (found === -1) found = v;
      else if (found !== v) return S.ERR;
    }
    return found === -1 ? S.Z : found;
  };

  /* ERR is contagious: a gate fed by a shorted net can't produce a
     trustworthy answer, so it says so rather than guessing. */
  S.anyErr = function (values) {
    for (var i = 0; i < values.length; i++) if (values[i] === S.ERR) return true;
    return false;
  };

  S.label = function (v) {
    return v === S.HIGH ? '1' : v === S.LOW ? '0' : v === S.Z ? 'Z' : 'X';
  };

  OL.Signal = S;
})(window.OL = window.OL || {});
