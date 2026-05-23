/**
 * activeChatTracker.js — Rastreia se o SupportChatScreen está aberto
 *
 * Usado pelo notification handler para suprimir push notifications de suporte
 * quando o usuário já está visualizando o chat (recebe via socket em tempo real).
 */

let _supportChatOpen = false;

export function markSupportChatOpen() {
  _supportChatOpen = true;
}

export function markSupportChatClosed() {
  _supportChatOpen = false;
}

export function isSupportChatOpen() {
  return _supportChatOpen;
}
