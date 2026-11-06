# Gestion MM — iPhone

Application mobile iOS de gestion pour Entreprise Michel Maisonneuve. Elle
reprend l’application EntrepriseMM (clients, calendrier/rendez-vous, factures,
rappels, dépenses, taxes et outils) et l’emballe comme une application iOS
native avec Capacitor. Le code est **identique** à celui du PC
([`../pc_desktop`](../pc_desktop)) ; seul l’emballage change.

## Prérequis

- Node.js 20+
- macOS avec Xcode (pour compiler, lancer le simulateur ou signer l’application)
- Le PC allumé sur le même Wi‑Fi pour la synchronisation

## Développement web

```sh
npm install
npm run dev
```

## Synchronisation avec le PC

1. Sur le PC, lancez l’application Windows (le serveur démarre tout seul) ou
   `npm run sync` dans `pc_desktop/`. L’adresse s’affiche, par exemple
   `ws://192.168.0.20:8765/sync`.
2. Sur l’iPhone : **Réglages → Synchronisation PC ↔ mobile**.
3. Entrez `192.168.0.20:8765` (le port 8765 est ajouté automatiquement s’il
   manque), puis **Enregistrer et connecter**.
4. L’indicateur de l’en-tête passe à **« Synchronisé PC ↔ mobile »**.

Le téléphone et le PC doivent être sur le **même réseau Wi‑Fi**. Aucune donnée
ne passe par Internet ; il n’y a ni compte ni serveur dans le nuage.

Hors ligne, l’application continue de fonctionner : les modifications sont
envoyées dès que le PC redevient joignable.

## Créer et lancer l’application iOS

```sh
npm install
npm run build
npx cap add ios       # une seule fois (crée le projet ios/ si absent)
npx cap sync ios      # après chaque changement de l’application web
npx cap open ios      # ouvre le projet dans Xcode
```

Dans Xcode, choisissez un simulateur iPhone ou un appareil connecté puis Run.
Pour une distribution, configurez la signature dans Signing & Capabilities et
archivez l’application depuis Xcode. La compilation iOS nécessite macOS/Xcode.

### Accès au réseau local (obligatoire pour la synchronisation)

Le greffon natif **LanSocket** (`ios/App/App/Plugins/LanSocket/`) ouvre les
connexions vers le PC. Dans Xcode :

1. Ajoutez `LanSocketPlugin.swift` et `LanSocketPlugin.m` au groupe **App** de la
   cible (glisser-déposer, « Copy items if needed » **décoché**).
2. Dans **Signing & Capabilities**, vérifiez que l’application peut joindre le
   réseau local. iOS affiche alors « Gestion MM souhaite trouver et se connecter
   aux appareils de votre réseau local » : acceptez.
3. Si la demande n’apparaît pas, ajoutez `NSLocalNetworkUsageDescription` à
   `Info.plist` (texte proposé : « Pour synchroniser vos données avec
   l’ordinateur sur votre réseau Wi‑Fi. »).

Sans cette autorisation, la connexion reste « Hors ligne » : c’est la seule
étape qui demande un réglage manuel dans Xcode.

## Structure

- `src/` : l’application (identique à celle du PC).
- `src/nativeBridge.js` : branche le pont réseau natif quand l’application
  tourne sur iPhone ; sans effet dans un navigateur.
- `ios/App/App/Plugins/LanSocket/` : greffon WebSocket natif (Swift + pont JS).
- `../shared/` : moteur de fusion et panneau de synchronisation partagés avec
  le PC.

## Tests

```sh
npm run build
npm run sync:test     # tests du moteur de synchronisation
```

## Données et sauvegardes

Les données sont conservées localement sur l’appareil, dans le stockage de
l’application. La sauvegarde de l’iPhone (iCloud ou Finder) les inclut. La
synchronisation avec le PC ne remplace pas une sauvegarde.
