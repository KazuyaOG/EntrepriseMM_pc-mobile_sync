# LanSocket — WebSocket natif iOS

WKWebView refuse les connexions `ws://` non sécurisées vers une adresse IP du
réseau local. Ce greffon fournit la même chose côté natif et transmet les trames
au JavaScript sous forme d’évènements `socketEvent`.

## Installation dans Xcode

1. Ouvrez le projet (`npm run ios:open`).
2. Glissez `LanSocketPlugin.swift` et `LanSocketPlugin.m` dans le groupe **App**
   de la cible (décochez « Copy items if needed »).
3. Compilez : `npm run ios:sync` puis Run.

Les méthodes exposées sont `openSocket`, `sendSocket` et `closeSocket` ; le code
JavaScript correspondant se trouve dans `LanSocket.js`, branché par
`src/nativeBridge.js`. L’acceptation de l’accès au réseau local (iOS) est
demandée au premier lancement ; sinon, ajoutez `NSLocalNetworkUsageDescription`
à `Info.plist`.
