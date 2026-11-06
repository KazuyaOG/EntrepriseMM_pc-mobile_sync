// Pont réseau local pour l'application mobile native (Capacitor/iOS).
//
// WKWebView bloque les connexions « ws:// » vers le réseau local en HTTP simple
// (politique de contenu sécurisé). Le greffon natif « LanSocket » (dossier ios/)
// fournit une WebSocket native équivalente à l'API du navigateur. Sur le web
// (PC, navigateur, serveur intégré) on utilise directement la WebSocket standard.
//
// Ce module reproduit l'interface utilisée par client.js :
//   new WebSocket(url), onopen, onmessage({data}), onclose({code}), onerror,
//   send(text), close(code), readyState.

const OPEN = 1;
const CONNECTING = 0;
const CLOSING = 2;
const CLOSED = 3;

const nativeBridge = () => (typeof window !== 'undefined' && window.mmNative?.openSocket ? window.mmNative : null);

/** Vrai si l'application tourne dans la coque native (Capacitor). */
export const usesNativeSocket = () => Boolean(nativeBridge());

class LanSocket {
  constructor(url) {
    this.url = url;
    this.readyState = CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._id = '';
    this._bridge = nativeBridge();
    this._closedByUser = false;
    this._open();
  }

  async _open() {
    const bridge = this._bridge;
    if (!bridge) {
      this._fail('Synchronisation native indisponible.');
      return;
    }
    try {
      const result = await bridge.openSocket(this.url);
      if (!result || !result.ok) {
        this._fail(result?.message || 'Connexion refusée par l’appareil.');
        return;
      }
      this._id = result.id;
      this.readyState = OPEN;
      this.onopen?.({ type: 'open' });
    } catch (error) {
      this._fail(error?.message || 'Connexion impossible.');
    }
  }

  _fail(message) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onerror?.({ type: 'error', message });
    this.onclose?.({ code: 1006, reason: message, wasClean: false });
  }

  send(text) {
    if (this.readyState !== OPEN) throw new Error('Connexion fermée.');
    this._bridge?.sendSocket(this._id, String(text));
  }

  close(code) {
    this._closedByUser = true;
    if (this.readyState === CLOSED) return;
    if (this.readyState === OPEN && this._id) {
      this._bridge?.closeSocket(this._id);
    }
    this.readyState = CLOSED;
    this.onclose?.({ code: code || 1000, reason: '', wasClean: true });
  }

  // Appelées par le gestionnaire d'événements installé au démarrage.
  _deliver(payload) {
    if (this.readyState !== OPEN) return;
    this.onmessage?.({ type: 'message', data: payload });
  }

  _remoteClose(event) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onclose?.({ code: event?.code || 1006, reason: event?.reason || '', wasClean: Boolean(event?.wasClean) });
  }
}

const sockets = new Map();
let listenerInstalled = false;

function installListener() {
  if (listenerInstalled) return;
  const bridge = nativeBridge();
  if (!bridge?.onSocketEvent) return;
  listenerInstalled = true;
  bridge.onSocketEvent(event => {
    const socket = sockets.get(event?.id);
    if (!socket) return;
    if (event.type === 'message' && typeof event.text === 'string') socket._deliver(event.text);
    else if (event.type === 'closed') {
      sockets.delete(event.id);
      socket._remoteClose(event);
    } else if (event.type === 'error') {
      socket._deliver ? socket._remoteClose({ code: 1006, reason: event.message || '' }) : null;
    }
  });
}

function NativeWebSocket(url) {
  installListener();
  const socket = new LanSocket(url);
  const originalClose = socket.close.bind(socket);
  socket.close = code => {
    if (socket._id) sockets.delete(socket._id);
    originalClose(code);
  };
  const originalOpen = socket._open.bind(socket);
  socket._open = async () => {
    await originalOpen();
    if (socket._id) sockets.set(socket._id, socket);
  };
  return socket;
}
NativeWebSocket.CONNECTING = CONNECTING;
NativeWebSocket.OPEN = OPEN;
NativeWebSocket.CLOSING = CLOSING;
NativeWebSocket.CLOSED = CLOSED;

/**
 * Renvoie le constructeur à utiliser. Le client de synchronisation appelle
 * `socketFactory(url)` au lieu de `new WebSocket(url)`.
 */
export function socketFactory() {
  if (usesNativeSocket()) {
    return url => NativeWebSocket(url);
  }
  if (typeof WebSocket !== 'undefined') return url => new WebSocket(url);
  return null;
}

/** Message d'aide quand aucun socket n'est disponible. */
export const NO_SOCKET_MESSAGE = 'Ce navigateur ne permet pas la connexion au PC. Utilisez l’application PC ou l’application mobile.';
