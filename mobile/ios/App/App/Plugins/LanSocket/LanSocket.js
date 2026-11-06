import { registerPlugin } from '@capacitor/core';

/**
 * Pont vers la WebSocket native iOS (voir LanSocketPlugin.swift).
 * Utilisé uniquement dans la coque native ; le web garde sa propre WebSocket.
 */
const LanSocket = registerPlugin('LanSocket');

const listeners = [];
const ready = new Map();

// Sur le web (navigateur, PC), Capacitor fabrique un objet factice dont chaque
// méthode renvoie une promesse rejetée (« plugin is not implemented on web »).
// On installe donc l'écoute avec précaution : toute erreur reste silencieuse et
// le web continue d'utiliser sa propre WebSocket.
function installListener() {
  try {
    const call = LanSocket.addListener('socketEvent', event => {
      for (const listener of listeners) listener(event);
    });
    if (call && typeof call.then === 'function') call.then(null, () => {});
  } catch { /* pas de greffon natif */ }
}
installListener();

function waitOpen(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ready.delete(id);
      reject(new Error('Le PC ne répond pas. Vérifiez le Wi-Fi et l’adresse.'));
    }, 15000);
    ready.set(id, { resolve, reject, timer });
    listeners.push(event => {
      if (event.id !== id) return;
      if (event.type === 'opened') {
        const pending = ready.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          ready.delete(id);
          pending.resolve();
        }
      } else if (event.type === 'closed' && ready.has(id)) {
        const pending = ready.get(id);
        clearTimeout(pending.timer);
        ready.delete(id);
        pending.reject(new Error(event.reason || 'Connexion fermée.'));
      }
    });
  });
}

export const nativeLan = {
  // Renseigné par nativeBridge.js après vérification de la plateforme réelle.
  isNative: true,
  async openSocket(url) {
    try {
      const { id } = await LanSocket.openSocket({ url });
      await waitOpen(id);
      return { ok: true, id };
    } catch (error) {
      return { ok: false, message: error?.message || 'Connexion impossible.' };
    }
  },
  async sendSocket(id, text) {
    try { await LanSocket.sendSocket({ id, text }); } catch { /* la fermeture suivra */ }
  },
  async closeSocket(id) {
    try { await LanSocket.closeSocket({ id }); } catch { /* déjà fermé */ }
  },
  onSocketEvent(handler) {
    if (available) LanSocket.addListener('socketEvent', handler);
  }
};
