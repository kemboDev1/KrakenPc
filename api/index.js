// Vercel entry point.
// vercel.json rewrites every path that is not a static file in /public to this
// function, so /catalog, /product/…, /settings, /api/… all reach the same
// request handler that `npm start` uses locally.
module.exports = require('../server.js');
