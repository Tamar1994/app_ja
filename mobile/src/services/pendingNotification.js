/**
 * pendingNotification.js — Armazena job recebido via tap em notificação
 * 
 * Quando o profissional toca na notificação (app fechado ou background),
 * os dados do job ficam aqui para o DashboardScreen buscar ao montar.
 */

let pendingJob = null;

export function setPendingNotification(data) {
  pendingJob = data;
}

export function getPendingNotification() {
  return pendingJob;
}

export function clearPendingNotification() {
  pendingJob = null;
}
