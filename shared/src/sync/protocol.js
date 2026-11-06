// Protocole commun entre les applications (PC et mobile) et le serveur de
// synchronisation. Aucune dépendance : utilisable dans le navigateur, Node,
// Electron et Capacitor.

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8765;
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
export const DEFAULT_ROOM = 'gestion-mm';
export const HEARTBEAT_MS = 20000;
export const HEARTBEAT_TIMEOUT_MS = 12000;
export const RECONNECT_MIN_MS = 1200;
export const RECONNECT_MAX_MS = 15000;

export const isNativeShell = () => typeof window !== 'undefined' && Boolean(window.mmNative?.isNative);
export const isDesktopShell = () => typeof window !== 'undefined' && Boolean(window.mmDesktop?.isDesktop);

/** Nom d'appareil proposé par défaut. */
export function defaultDeviceName() {
  if (typeof window === 'undefined') return 'Appareil';
  if (isDesktopShell()) return 'Ordinateur';
  if (isNativeShell()) return 'Téléphone';
  return 'Navigateur';
}

/**
 * Adresse du serveur de synchronisation proposée par défaut : l'hôte qui sert
 * déjà l'application (cas du serveur PC qui diffuse aussi l'application sur le
 * réseau local), sinon la machine locale.
 */
export function defaultServerUrl(port = DEFAULT_PORT) {
  let host = 'localhost';
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) && window.location.hostname) {
    host = window.location.hostname;
  }
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${host}:${port}`;
}

/** Accepte « 192.168.0.20 », « 192.168.0.20:8765 », « ws://… ». */
export function normalizeServerUrl(input, port = DEFAULT_PORT) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let candidate = raw;
  if (!/^wss?:\/\//i.test(candidate)) candidate = /^https?:\/\//i.test(candidate)
    ? candidate.replace(/^http/i, 'ws')
    : 'ws://' + candidate;
  let url;
  try { url = new URL(candidate); } catch { return ''; }
  if (!/^wss?:$/.test(url.protocol)) return '';
  if (!url.port) url.port = String(port);
  url.pathname = '/sync';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function normalizeRoom(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return DEFAULT_ROOM;
  const slug = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return (slug || DEFAULT_ROOM).slice(0, 48);
}

export const normalizeDeviceName = input => String(input || '').trim().slice(0, 40) || defaultDeviceName();

export const validPort = value => {
  const port = Number(value);
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : null;
};

/** Hôte local « probable » : permet d'afficher une aide ciblée. */
export const isLoopbackUrl = url => /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(url || ''));
