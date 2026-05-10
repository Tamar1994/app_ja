const AuditLog = require('../models/AuditLog');

async function logAudit(entry = {}) {
  try {
    const payload = {
      module: entry.module || 'general',
      action: entry.action || 'unknown_action',
      severity: entry.severity || 'normal',
      actorType: entry.actorType || 'system',
      actorAdminId: entry.actorAdminId || null,
      actorUserId: entry.actorUserId || null,
      targetType: entry.targetType || '',
      targetId: entry.targetId ? String(entry.targetId) : '',
      message: entry.message || '',
      metadata: entry.metadata || {},
    };
    await AuditLog.create(payload);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

module.exports = { logAudit };
