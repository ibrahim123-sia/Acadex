// express.Router() whose handlers may be async: a rejected promise is passed to next(err)
// instead of becoming an unhandled rejection (which crashes Node). Express 5 does this
// natively; this shim goes away when we upgrade in Phase 0B.
const express = require('express');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

function wrap(fn) {
  if (typeof fn !== 'function' || fn.length === 4 || fn.stack) return fn; // error handlers, sub-routers
  return function asyncSafe(req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

function Router(options) {
  const router = express.Router(options);
  for (const m of METHODS) {
    const original = router[m].bind(router);
    router[m] = (...args) => original(...args.map((a) => (Array.isArray(a) ? a.map(wrap) : wrap(a))));
  }
  return router;
}

module.exports = { Router, wrap };
