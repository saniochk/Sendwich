// Sendwich - (c) 2026 Saniochk. MIT License, see LICENSE.
// Minimal CEP wrapper (instead of the full CSInterface.js)
window.CSI = {
  available: !!window.__adobe_cep__,
  evalScript: function (script, cb) {
    if (!this.available) { if (cb) cb("EvalScript error."); return; }
    window.__adobe_cep__.evalScript(script, cb || function () {});
  },
  getSystemPath: function (type) {
    var p = decodeURI(window.__adobe_cep__.getSystemPath(type));
    if (/^file:\/\/\/[A-Za-z]:/.test(p)) return p.replace("file:///", "");
    return p.replace(/^file:\/\//, "");
  }
};
