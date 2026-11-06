// Pont natif iOS : rend la WebSocket native disponible à la synchronisation.
// Ce fichier ne fait rien dans un navigateur ni dans l'application PC.
import { Capacitor } from '@capacitor/core';
import { nativeLan } from '../ios/App/App/Plugins/LanSocket/LanSocket.js';

let installed = false;

/** @returns {boolean} vrai si l'application tourne dans la coque iOS native. */
export function installNativeBridge() {
  if (installed) return Boolean(window.mmNative);
  installed = true;
  // Deux conditions : plateforme native ET greffon réellement enregistré.
  const platformNative = typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform();
  const native = platformNative && nativeLan.isNative;
  if (native) {
    window.mmNative = nativeLan;
    document.documentElement.classList.add('native-app');
  }
  return native;
}

installNativeBridge();
