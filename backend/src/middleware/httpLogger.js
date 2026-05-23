'use strict';

/**
 * Middleware de log de requisições HTTP.
 * Loga método, path, status code e duração quando a resposta é enviada.
 */

const logger = require('../utils/logger');

let counter = 0;

function httpLogger(req, res, next) {
  const reqId = ++counter;
  req.reqId = reqId;
  const start = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

    logger[level](`${req.method} ${req.path}`, {
      reqId,
      status,
      ms,
      uid: req.user?._id?.toString(),
      ip: req.ip,
    });
  });

  next();
}

module.exports = httpLogger;
