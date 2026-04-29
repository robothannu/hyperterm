// CommonJS shim for renderer scripts compiled with module: "commonjs".
// Loaded before dashboard.js so that `exports.X = X` and `Object.defineProperty(exports, ...)`
// don't throw ReferenceError. Without this, the renderer aborts before wiring up handlers.
var exports = {};
var module = { exports: exports };
