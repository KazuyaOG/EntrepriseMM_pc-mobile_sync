import { mergeData, stampChanges, fingerprint, createdSince } from './merge.js';
import {
  PROTOCOL_VERSION,
  DEFAULT_PORT,
  RECONNECT_MIN_MS,
  RECONNECT_MAX_MS,
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
  DEFAULT_ROOM,
  defaultServerUrl,
  defaultDeviceName,
  normalizeServerUrl,
  normalizeRoom,
  normalizeDeviceName
} from './protocol.js';
import { socketFactory, NO_SOCKET_MESSAGE } from './lan.js';

export const CONFIG_KEY = 'mm-sync-config-v1';
export const OUTBOX_KEY = 'mm-sync-outbox-v1';
export const BASE_KEY = 'mm-sync-base-v1';
export const DATA_KEY = 'mm-data-v1';

/** Délai minimal entre deux envois, pour ne pas inonder le serveur. */
const SEND_INTERVAL_MS = 120;
const MAX_PUSH_BURST = 6;

function safeStorage() {
  try {
    const probe = '__mm_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let seed = 0;
function randomId() {
  seed += 1;
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'dev-' + Date.now().toString(36) + seed.toString(36) + '-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function defaultConfig() {
  return {
    url: defaultServerUrl(DEFAULT_PORT),
    port: DEFAULT_PORT,
    room: DEFAULT_ROOM,
    enabled: true,
    deviceId: randomId(),
    deviceName: defaultDeviceName(),
    lastSyncAt: 0,
    lastError: ''
  };
}

export const readConfig = storage => ({ ...defaultConfig(), ...(readJson(storage, CONFIG_KEY) || {}) });

export function saveConfig(storage, config) {
  try { storage?.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* stockage plein */ }
  return config;
}

const OFFLINE_API = {
  enabled: false,
  config: defaultConfig(),
  saveConfig: () => OFFLINE_API.config,
  commit: next => next,
  restoreLocal: () => null,
  stop: () => {},
  connect: () => {},
  disconnect: () => {},
  syncNow: () => {},
  noteLocalChange: () => {},
  apply: () => {},
  value: () => ({ status: 'off', label: 'Synchronisation indisponible (stockage bloqué)', peers: 0 }),
  subscribe: listener => { listener(OFFLINE_API.value()); return () => {}; }
};

/**
 * Session de synchronisation d'une fenêtre de l'application.
 *
 * @param {object} options
 * @param {() => object} options.getData     lit l'état courant de l'application
 * @param {(data: object) => void} [options.apply] remplace l'état de l'application
 * @param {() => boolean} [options.isPristine] vrai si les données locales sont encore celles de démonstration
 */
export function createSyncSession({ getData, apply, isPristine = () => false } = {}) {
  const storage = safeStorage();
  if (!storage) return OFFLINE_API;

  const config = readConfig(storage);
  const listeners = new Set();
  let onApply = typeof apply === 'function' ? apply : null;
  let state = {
    status: config.enabled ? 'connecting' : 'off',
    label: config.enabled ? 'Connexion…' : 'Synchronisation désactivée',
    deviceName: config.deviceName,
    room: config.room,
    url: config.url,
    lastSyncAt: config.lastSyncAt || 0,
    lastError: config.lastError || '',
    peers: 0
  };

  const makeSocket = socketFactory();
  let socket = null;
  let attempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let lastSeen = 0;
  let lastSend = 0;
  let closedByUser = false;
  let inFlight = false;
  let dirty = true;
  let burst = 0;
  let applying = false;
  let lastLocal = typeof getData === 'function' ? getData() : null;
  let lastSentSignature = '';
  let flushTimer = null;

  const emit = () => { for (const listener of listeners) listener(state); };
  const setState = patch => {
    const next = { ...state, ...patch };
    const changed = Object.keys(patch).some(key => next[key] !== state[key]);
    state = next;
    if (changed) emit();
  };

  const readOutbox = () => readJson(storage, OUTBOX_KEY) || { seq: 0, data: null };
  const readBase = () => readJson(storage, BASE_KEY);
  const writeOutbox = (seq, data) => {
    try { storage.setItem(OUTBOX_KEY, JSON.stringify({ seq, data })); } catch { /* ignore */ }
  };
  const queueOutbox = data => writeOutbox(readOutbox().seq + 1, data);
  const clearOutbox = () => writeOutbox(readOutbox().seq, null);
  const writeBase = data => {
    try {
      if (data === null) storage.removeItem(BASE_KEY);
      else storage.setItem(BASE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  };

  function persistConfig(patch) {
    Object.assign(config, patch);
    saveConfig(storage, config);
    setState({ deviceName: config.deviceName, room: config.room, url: config.url });
  }

  function currentData() {
    const value = typeof getData === 'function' ? getData() : lastLocal;
    if (value) lastLocal = value;
    return value;
  }

  function applyToApp(data) {
    applying = true;
    try { onApply?.(data); } finally { applying = false; }
    lastLocal = data;
    dirty = false;
  }

  /** Toutes les écritures locales passent ici : horodatage + file d'attente. */
  function commit(next) {
    if (applying) { lastLocal = next; return next; }
    const previous = lastLocal;
    const stamped = stampChanges(previous, next, Date.now());
    if (stamped === previous) {
      // Contenu identique : aucune écriture, aucun envoi, aucune boucle.
      lastLocal = next;
      return next;
    }
    lastLocal = stamped;
    dirty = true;
    queueOutbox(stamped);
    scheduleFlush();
    return stamped;
  }

  function scheduleFlush() {
    if (!socket || socket.readyState !== 1) return;
    if (inFlight) return;
    const wait = SEND_INTERVAL_MS - (Date.now() - lastSend);
    if (wait <= 0) { flush(); return; }
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (socket && socket.readyState === 1) flush();
    }, Math.min(wait, 250));
  }

  function flush() {
    if (!socket || socket.readyState !== 1 || inFlight) return;
    if (!lastSend) lastSend = 0;
    let local = currentData();
    if (!local) return;
    // Sans base connue, c'est le premier échange : on envoie tout, le serveur
    // fusionne et renvoie l'état commun qui deviendra la base.
    const sessionBase = readBase();
    if (!lastSentSignature) {
      // Données existantes jamais synchronisées : elles n'ont pas d'horodatage.
      // On les estampille pour que le serveur puisse arbitrer entre deux
      // versions (sinon l'entreprise et les réglages seraient ignorés).
      local = stampChanges({}, local, Date.now());
      lastLocal = local;
    }
    inFlight = true;
    lastSend = Date.now();
    burst += 1;
    try {
      lastSentSignature = fingerprint(local);
      socket.send(JSON.stringify({
        type: 'push',
        room: config.room,
        base: sessionBase,
        data: local,
        created: sessionBase ? createdSince(sessionBase, local) : {}
      }));
      setState({ status: 'syncing', label: 'Envoi des changements…' });
    } catch (error) {
      inFlight = false;
      setState({ lastError: 'Envoi impossible : ' + (error?.message || 'erreur inconnue') });
      return;
    }
    if (burst > MAX_PUSH_BURST) {
      // Garde-fou : ne jamais boucler indéfiniment si les deux copies divergent.
      burst = 0;
      setState({ lastError: 'Synchronisation instable : vérifiez l’heure des deux appareils.' });
    }
  }

  function setOnline(peers, savedAt) {
    burst = 0;
    setState({
      status: 'online',
      label: 'Synchronisé',
      lastSyncAt: savedAt || Date.now(),
      peers: peers ?? state.peers,
      lastError: ''
    });
  }

  /**
   * Intègre l'état du serveur. `serverCreated` liste les enregistrements que le
   * serveur a créés depuis la dernière base connue de cet appareil.
   */
  function absorb(serverData, serverCreated, peers, savedAt) {
    const sessionBase = readBase();
    if (!serverData) {
      // Le serveur n'a encore aucun état (premier appareil) : on publie le nôtre.
      setOnline(peers, savedAt);
      dirty = true;
      scheduleFlush();
      return;
    }
    const local = currentData();
    const pending = readOutbox().data;
    let merged;
    if (!local) {
      merged = serverData;
    } else if (!sessionBase && isPristine(local) && !pending) {
      // Première installation sans historique : on adopte l'état du PC tel quel
      // (évite de fusionner les données de démonstration avec les vraies).
      merged = serverData;
    } else {
      try {
        merged = mergeData(local, serverData, {
          localCreated: sessionBase ? createdSince(sessionBase, local) : {},
          remoteCreated: serverCreated || {},
          now: Date.now()
        });
      } catch (error) {
        setState({ status: 'error', label: 'Fusion impossible', lastError: error?.message || 'Données illisibles.' });
        return;
      }
    }
    writeBase(merged);
    clearOutbox();
    const changed = !local || fingerprint(local) !== fingerprint(merged);
    if (changed) applyToApp(merged);
    else dirty = false;
    setOnline(peers, savedAt);
    // Ce que l'on connaît encore seulement localement doit être envoyé.
    if (fingerprint(merged) !== fingerprint(serverData)) {
      dirty = true;
      scheduleFlush();
    }
  }

  function sendHello() {
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        room: config.room,
        deviceId: config.deviceId,
        deviceName: config.deviceName
      }));
    } catch { /* ignore */ }
  }

  function closeSocket() {
    const current = socket;
    socket = null;
    inFlight = false;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (!current) return;
    current.onclose = null;
    current.onerror = null;
    current.onmessage = null;
    try { current.close(); } catch { /* déjà fermé */ }
  }

  function stop() {
    closedByUser = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearTimeout(flushTimer);
    flushTimer = null;
    closeSocket();
    burst = 0;
    setState({ status: 'off', label: 'Synchronisation désactivée', peers: 0 });
  }

  function scheduleReconnect(reason) {
    if (closedByUser || !config.enabled) return;
    attempt += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(attempt - 1, 5)) + Math.random() * 350;
    setState({
      status: 'offline',
      label: reason === 'not-found' ? 'Serveur introuvable — nouvel essai…'
        : reason === 'timeout' ? 'Connexion perdue — nouvel essai…'
          : 'Hors ligne — nouvel essai…',
      peers: 0,
      lastError: reason === 'not-found' ? 'Aucun serveur de synchronisation ne répond à cette adresse.' : state.lastError
    });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    if (closedByUser || !config.enabled) return;
    const url = normalizeServerUrl(config.url, config.port);
    if (!url) {
      setState({ status: 'error', label: 'Adresse du serveur invalide', lastError: 'Adresse invalide.' });
      scheduleReconnect('invalid');
      return;
    }
    closeSocket();
    setState({ status: 'connecting', label: attempt === 0 ? 'Connexion au PC…' : 'Reconnexion…' });

    if (!makeSocket) {
      setState({ status: 'error', label: 'Connexion impossible', lastError: NO_SOCKET_MESSAGE });
      return;
    }
    let ws;
    try {
      ws = makeSocket(url);
    } catch {
      scheduleReconnect('invalid');
      return;
    }
    socket = ws;

    ws.onopen = () => {
      lastSeen = Date.now();
      attempt = 0;
      burst = 0;
      setState({ status: 'syncing', label: 'Synchronisation…', lastError: '' });
      sendHello();
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== 1) return;
        if (Date.now() - lastSeen > HEARTBEAT_MS + HEARTBEAT_TIMEOUT_MS) {
          const dead = socket;
          socket = null;
          try { dead.close(); } catch { /* ignore */ }
          inFlight = false;
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          scheduleReconnect('timeout');
          return;
        }
        try { socket.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
      }, HEARTBEAT_MS);
    };

    ws.onmessage = event => {
      lastSeen = Date.now();
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.type !== 'string') return;

      if (message.type === 'welcome') {
        if (message.protocol !== PROTOCOL_VERSION) {
          setState({ status: 'error', label: 'Version du serveur incompatible', lastError: 'Mettez à jour les deux applications.' });
          stop();
          return;
        }
        inFlight = false;
        absorb(message.data, message.created, message.peers, message.savedAt);
        if (message.data) scheduleFlush();
        return;
      }

      if (message.type === 'state') {
        absorb(message.data, message.created, message.peers, message.savedAt);
        return;
      }

      if (message.type === 'applied') {
        inFlight = false;
        if (message.data) writeBase(message.data);
        absorb(message.data, message.created, message.peers, message.savedAt);
        if (message.data && fingerprint(currentData()) !== fingerprint(message.data)) scheduleFlush();
        return;
      }

      if (message.type === 'rejected') {
        inFlight = false;
        if (message.code === 'NO_BASE' || message.code === 'BAD_BASE') {
          sendHello();
        } else if (message.code === 'ROOM_FULL') {
          setState({ status: 'error', label: 'Serveur saturé', lastError: message.message || 'Le PC est saturé.' });
        } else {
          setState({ lastError: 'Refus du PC : ' + (message.message || message.code || 'inconnu') });
          clearOutbox();
          dirty = false;
        }
        return;
      }

      if (message.peers !== undefined) setState({ peers: message.peers });
      if (message.type === 'error') setState({ lastError: message.message || 'Erreur du serveur.' });
    };

    ws.onclose = event => {
      if (socket !== ws) return;
      socket = null;
      inFlight = false;
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (closedByUser || !config.enabled) return;
      scheduleReconnect(event?.code === 4004 ? 'not-found' : 'closed');
    };

    ws.onerror = event => {
      if (event?.message) setState({ lastError: event.message });
      /* onclose enchaîne la reconnexion */
    };
  }

  const api = {
    enabled: config.enabled,
    get config() { return { ...config }; },
    saveConfig(patch = {}) {
      const next = { ...config, ...patch };
      next.port = Number(next.port) || DEFAULT_PORT;
      next.url = normalizeServerUrl(next.url, next.port) || next.url;
      next.room = normalizeRoom(next.room);
      next.deviceName = normalizeDeviceName(next.deviceName);
      if (!next.deviceId) next.deviceId = randomId();
      const enabledChanged = Boolean(next.enabled) !== Boolean(config.enabled);
      const targetChanged = next.url !== config.url || next.room !== config.room;
      persistConfig(next);
      if (targetChanged) {
        // Nouvelle cible : la base connue ne vaut plus rien, mais les
        // modifications locales en attente sont conservées et renvoyées.
        writeBase(null);
        dirty = true;
      }
      if (enabledChanged || targetChanged) {
        attempt = 0;
        if (config.enabled) {
          closedByUser = false;
          connect();
        } else {
          stop();
        }
      } else if (!config.enabled) {
        stop();
      }
      return { ...config };
    },
    connect() {
      if (!config.enabled) persistConfig({ enabled: true });
      closedByUser = false;
      attempt = 0;
      connect();
    },
    disconnect() { stop(); },
    /** Force une nouvelle prise de contact : le serveur renvoie son état complet. */
    syncNow() {
      if (!socket || socket.readyState !== 1) {
        closedByUser = false;
        attempt = 0;
        connect();
        return;
      }
      // Le serveur renvoie son état complet ; la fusion rattrape tout écart.
      sendHello();
    },
    commit,
    stop,
    apply(handler) { onApply = typeof handler === 'function' ? handler : onApply; },
    setPristineCheck(fn) { if (typeof fn === 'function') isPristine = fn; },
    value: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    noteLocalChange(data) {
      if (applying) return;
      if (data) lastLocal = data;
      dirty = true;
      if (socket && socket.readyState === 1) scheduleFlush();
    },
    /** Utilisé par l'application pour savoir si un envoi est en attente. */
    hasPendingChanges: () => Boolean(readOutbox().data)
  };

  if (config.enabled) {
    closedByUser = false;
    // Laisser l'interface s'afficher avant la première connexion.
    setTimeout(connect, 150);
  }

  return api;
}
