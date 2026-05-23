'use strict';

/**
 * Logger estruturado para o backend.
 * Emite JSON por linha — compatível com Render, Railway, Heroku e qualquer
 * sistema de log que processe stdout/stderr linha a linha.
 *
 * Níveis (do mais crítico ao mais verboso):
 *   error | warn | info | debug
 *
 * Controle via variável de ambiente:
 *   LOG_LEVEL=debug  → tudo
 *   LOG_LEVEL=info   → info, warn, error (padrão)
 *   LOG_LEVEL=warn   → warn e error
 *   LOG_LEVEL=error  → só erros
 *
 * Também sobrescreve console.error / console.warn / console.log para que
 * código legado já existente emita JSON com timestamp automaticamente.
 */

const LEVEL_VALUES = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_LEVEL = LEVEL_VALUES[process.env.LOG_LEVEL || 'debug'] ?? 3;

// Captura os métodos originais ANTES de qualquer patch
const _stderr = console.error.bind(console);
const _stdwarn = console.warn.bind(console);
const _stdout = console.log.bind(console);

function emit(level, msg, meta) {
  if (LEVEL_VALUES[level] > MAX_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    msg,
  };

  if (meta && typeof meta === 'object') {
    // Serializa Errors de forma legível
    if (meta.err instanceof Error) {
      meta = { ...meta, err: { message: meta.err.message, stack: meta.err.stack } };
    }
    Object.assign(entry, meta);
  }

  const fn = level === 'error' ? _stderr : level === 'warn' ? _stdwarn : _stdout;
  try {
    fn(JSON.stringify(entry));
  } catch {
    // Proteção contra referências circulares
    fn(JSON.stringify({ ts: entry.ts, level: entry.level, msg: entry.msg, err: 'log_serialize_error' }));
  }
}

const logger = {
  error: (msg, meta) => emit('error', msg, meta),
  warn:  (msg, meta) => emit('warn',  msg, meta),
  info:  (msg, meta) => emit('info',  msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
};

/**
 * Substitui console.error / console.warn / console.log do Node.js para que
 * todo código legado (sem logger explícito) também emita JSON com timestamp.
 * Deve ser chamado UMA vez no startup (server.js).
 */
logger.patchConsole = function patchConsole() {
  console.error = (...args) => {
    const msg = args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ');
    emit('error', msg);
  };
  console.warn = (...args) => {
    const msg = args.map((a) => String(a)).join(' ');
    emit('warn', msg);
  };
  console.log = (...args) => {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    emit('info', msg);
  };
};

module.exports = logger;
