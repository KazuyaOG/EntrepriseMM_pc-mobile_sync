# Gestion MM — PC ↔ mobile synchronisés

Application de gestion pour **Entretien Michel Maisonneuve**, réunie dans un seul
dépôt :

| Dossier | Application | Technologie |
| --- | --- | --- |
| [`pc_desktop/`](pc_desktop/) | Application de bureau (Windows) + version web | React + Vite + Electron |
| [`mobile/`](mobile/) | Application iPhone | React + Vite + Capacitor (iOS) |
| [`shared/`](shared/) | Moteur de synchronisation, serveur local, panneau de réglages | JavaScript sans dépendance (hors `ws`) |

Les deux applications sont **les mêmes** : mêmes écrans, mêmes données, mêmes
calculs (clients, calendrier, factures, dépenses, taxes, outils). La seule
différence est l’enveloppe (fenêtre Windows contre application iOS) et les
fonctions propres à chaque appareil (sauvegarde USB sur le PC, pont réseau natif
sur l’iPhone).

## La synchronisation en une minute

Les deux appareils se parlent **directement sur votre réseau Wi‑Fi**, sans
compte, sans serveur dans le nuage et sans passer par Internet. Le PC fait
office de serveur ; le téléphone s’y connecte.

```
   ┌──────────────────────┐            ┌──────────────────────┐
   │   pc_desktop (PC)    │  Wi-Fi LAN │     mobile (iPhone)  │
   │  interface + serveur │◀──────────▶│  interface + client  │
   │   état partagé       │  WebSocket │                      │
   └──────────────────────┘            └──────────────────────┘
              │
       disque du PC : copie de sécurité de l'état partagé
```

1. **Sur le PC**, démarrez l’application Windows (le serveur démarre tout seul)
   ou, pour le serveur seul, `npm run sync`. Il écoute sur le port **8765** et
   affiche l’adresse à utiliser, par exemple `ws://192.168.0.20:8765/sync`.
2. **Sur l’iPhone**, ouvrez l’application → **Réglages** → **Synchronisation
   PC ↔ mobile**, entrez `192.168.0.20:8765`, puis **Enregistrer et connecter**.
3. Les deux écrans passent à **« Synchronisé »**. Toute modification faite d’un
   côté apparaît de l’autre en moins d’une seconde.

Le même panneau existe sur le PC (Réglages → Synchronisation), avec l’adresse
déjà remplie.

> **Premier lancement.** Dans l’application Windows et sur iPhone, la
> synchronisation est déjà active : il ne reste qu’à saisir l’adresse. Dans un
> simple `npm run dev` (version web de développement), elle est inactive et
> s’active d’un clic, pour ne pas afficher « hors ligne » avant qu’un serveur
> existe.

### Ce qui est synchronisé

Clients, rendez-vous, factures, dépenses, rappels, informations d’entreprise,
réglages d’affichage et note libre. Les deux appareils affichent donc la même
liste, dans le même ordre.

### Fonctionnement hors ligne

Chaque appareil garde ses données sur lui. Si le Wi‑Fi tombe, l’application
continue de fonctionner normalement ; les modifications s’accumulent puis sont
envoyées automatiquement à la reconnexion.

## Garanties de la fusion

La synchronisation utilise un moteur de fusion déterministe (testé) qui règle
les cas difficiles :

- **Chacun modifie un élément différent** : les deux modifications sont gardées.
- **Les deux modifient le même élément** : la modification la plus récente gagne
  (horodatage en millisecondes, jamais régressif).
- **Une fiche supprimée** ne revient jamais, même depuis une vieille copie.
- **Deux factures créées en même temps avec le même numéro** (par exemple la
  facture 1004 sur les deux appareils) : la plus ancienne garde son numéro, la
  plus récente reçoit le numéro suivant, et son rendez-vous suit la facture.
- **Trois appareils ou plus** convergent vers le même état, quel que soit
  l’ordre des synchronisations.

Détails techniques et cas limites : [`shared/README.md`](shared/README.md).

## Démarrage rapide

### PC (Windows)

```sh
cd pc_desktop
npm install
npm run dev          # version web de développement : http://localhost:5173
npm run desktop      # fenêtre Windows (Electron)
npm run build && npm run windows   # installeur Windows (electron-builder)
```

L’application Electron démarre automatiquement le serveur de synchronisation et
sert aussi l’application web : depuis le téléphone, ouvrez
`http://adresse-du-pc:8765` pour installer l’application.

Pour lancer le serveur seul (sans la fenêtre Windows) :

```sh
cd pc_desktop
npm run sync          # équivaut à : node ../shared/server/cli.js --app dist
```

### iPhone

```sh
cd mobile
npm install
npm run dev          # version web de développement
npm run ios:add      # une seule fois, sur un Mac avec Xcode
npm run ios:sync     # après chaque changement
npm run ios:open     # ouvre Xcode → Run
```

La compilation iOS exige un Mac avec Xcode ; le développement web, lui, marche
partout.

## Sauvegardes

- **PC** : la sauvegarde sur clé USB reste disponible (Réglages → Sauvegarde sur
  clé USB), et le serveur conserve en plus une copie de l’état partagé sur le
  disque du PC.
- **Mobile** : les données restent dans le stockage de l’application ; la
  sauvegarde de l’iPhone (iCloud / Finder) les inclut.

La synchronisation ne remplace pas une sauvegarde : elle relie deux appareils
qui restent maîtres de leurs données.

## Tests

```sh
cd shared && npm test              # 37 tests : fusion, protocole, serveur, aller-retour
cd pc_desktop && npm run test:ui   # tests d’interface (Playwright, application lancée)
```

## Repartir de données réelles

Les applications sont livrées avec des clients, factures et rendez-vous
**fictifs** pour la démonstration. Avant un usage réel, deux options :

- **Repartir à zéro** : Réglages → Synchronisation → **Effacer les exemples**.
  La fiche d’entreprise est conservée, les fiches fictives sont supprimées (et
  la suppression se propage à l’autre appareil).
- **Tout effacer** : Réglages → *Stockage* du navigateur / réinstallation pour
  l’application Windows, ou suppression de l’application sur l’iPhone.

Un avertissement apparaît dans les réglages tant que des données de
démonstration sont présentes : elles seraient sinon synchronisées comme de
vraies fiches.

## Confidentialité

Aucune donnée ne quitte le réseau local. Le serveur n’écoute que sur votre
Wi‑Fi/Ethernet ; il n’y a ni compte, ni service externe, ni envoi automatique de
courriels. Utilisez un réseau de confiance et protégez la session Windows du PC.

## Documentation

- [`shared/README.md`](shared/README.md) — protocole, serveur, fusion, sécurité.
- [`pc_desktop/DEMARRAGE_RAPIDE.md`](pc_desktop/DEMARRAGE_RAPIDE.md) — guide du PC.
- [`mobile/README.md`](mobile/README.md) — guide iPhone.
