# shared — moteur de synchronisation PC ↔ mobile

Ce dossier contient tout ce qui est commun aux deux applications. Il est
**partagé**, pas dupliqué : une correction dans `shared/` profite
automatiquement au PC et au mobile.

```
shared/
├── src/sync/
│   ├── merge.js        moteur de fusion déterministe (aucune dépendance)
│   ├── protocol.js     constantes et validation (adresse, port, salle, appareil)
│   ├── client.js       session de synchronisation côté application (navigateur/iOS)
│   ├── lan.js          pont WebSocket natif iOS + sélection du socket
│   ├── SyncPanel.jsx   panneau « Synchronisation PC ↔ mobile » des réglages
│   └── sync.css        styles du panneau
├── server/
│   ├── server.js       serveur WebSocket + fichiers statiques
│   └── cli.js          lancement en ligne de commande (mm-sync)
└── test/                37 tests (npm test)
    ├── merge.test.js    fusion : conflits, suppressions, convergence
    ├── protocol.test.js adresses, salles, noms d'appareil, ports
    ├── server.test.js   serveur : diffusion, persistance, santé
    ├── client.test.js   deux applications complètes qui se synchronisent,
    │                    dont une coupure réseau suivie d'une reconnexion
    └── app.test.js      compatibilité avec la logique métier existante
```

## Configurer la synchronisation

Dans les deux applications : **Réglages → Synchronisation PC ↔ mobile**.

| Réglage | Rôle |
| --- | --- |
| Adresse du PC | `192.168.0.20:8765`, ou l'adresse complète `ws://…/sync` |
| Nom de cet appareil | affiché dans le journal du serveur (« Ordinateur », « Téléphone ») |
| Salle de synchronisation | isole plusieurs groupes ; identique sur les deux appareils |
| Synchroniser automatiquement | active/désactive la connexion |

L'identifiant d'appareil est créé une fois puis conservé : le serveur reconnaît
le même appareil d'une session à l'autre. La configuration est enregistrée au
premier lancement, même si la synchronisation est désactivée.

## Modèle de données

Les données de l’application (`mm-data-v1`) sont complétées par trois champs
techniques, invisibles dans l’interface :

| Champ | Rôle |
| --- | --- |
| `enregistrement.updatedAt` | horodatage de la dernière modification de la fiche |
| `data.meta.<champ>` | horodatage de `company`, `settings` et `notes` |
| `data.tombstones` | suppressions mémorisées (`clients\|0042` → horodatage) |
| `data.meta` | horodatages des champs uniques (`company`, `settings`, `notes`) |

Une copie sans ces champs reste parfaitement lisible : ils sont ajoutés à la
première modification. C’est ce qui rend la fonction rétrocompatible avec les
données déjà présentes sur les appareils.

## Algorithme de fusion

`mergeData(local, remote, { localCreated, remoteCreated })` applique, dans
l’ordre :

1. **Collisions de création.** Si les deux appareils ont créé un enregistrement
   avec le même identifiant depuis leur dernière base commune, le plus ancien
   garde son numéro et le plus récent est **renuméroté** vers le premier
   identifiant libre. Les rendez-vous qui pointent vers la facture déplacée sont
   mis à jour. La décision ne dépend pas de l’ordre des arguments.
2. **Union des enregistrements.** Pour chaque identifiant : présent des deux
   côtés → le plus récent `updatedAt` gagne ; présent d’un seul côté → il est
   gardé, sauf si l’autre côté possède une pierre tombale plus récente.
3. **Champs uniques.** `company`, `settings` et `notes` suivent `meta.<champ>`.
4. **Ordre canonique.** Factures et dépenses du plus récent au plus ancien, le
   reste par ordre croissant : les deux appareils affichent la même liste.
5. **Nettoyage.** Les pierres tombales de plus de 180 jours (ou au-delà de
   2 000) sont oubliées.

`stampChanges(previous, next)` horodate uniquement ce qui a bougé et enregistre
les suppressions ; il ne touche jamais aux enregistrements identiques. Les
horodatages ne reculent jamais, même si l’horloge de l’appareil est déréglée.

Propriétés vérifiées par les tests : idempotence (`merge(a, b)` stable),
commutativité du résultat final (les deux appareils convergent), et
convergence à trois appareils quel que soit l’ordre.

## Protocole (WebSocket, version 1)

Textes JSON, une trame par message. `room` isole des groupes d’appareils
(« gestion-mm » par défaut).

| Sens | Message | Contenu |
| --- | --- | --- |
| client → serveur | `hello` | `protocol`, `room`, `deviceId`, `deviceName` |
| serveur → client | `welcome` | `data` (état complet ou `null`), `peers`, `savedAt` |
| client → serveur | `push` | `data` (état complet), `base` (dernier état connu), `created` |
| serveur → client | `applied` | `data` fusionné, `savedAt`, `peers` |
| serveur → client | `state` | état diffusé aux **autres** appareils |
| serveur → client | `rejected` | `code`, `message` (`NO_BASE`, `BAD_DATA`, `ROOM_FULL`…) |
| client → serveur | `ping` / serveur → client | `pong` |
| serveur → client | `peer` | nombre d’appareils connectés |

Le client envoie l’état complet : les jeux de données d’une entreprise de
nettoyage restent petits (quelques dizaines de Ko), et cela évite toute
divergence par message perdu. Une garde-fou limite les envois en rafale
(6 poussées) pour ne jamais boucler.

## Serveur

```sh
node server/cli.js --port 8765 --app ../pc_desktop/dist
```

| Route | Accès | Rôle |
| --- | --- | --- |
| `ws://…/sync` | réseau local | synchronisation temps réel |
| `GET /health` | réseau local | état du serveur, adresses, nombre d’appareils |
| `GET /` et fichiers | réseau local | sert l’application web compilée (`--app`) |
| `GET /sync/state` | **ordinateur seulement** | instantané JSON (secours) |
| `POST /sync/push` | **ordinateur seulement** | secours quand les WebSocket sont bloqués |

Sécurité : les origines autorisées sont limitées (`http`, `https`, `file`,
`capacitor`) ; les routes de secours sont refusées depuis le réseau ; la taille
des messages est plafonnée à 8 Mo ; 24 appareils et 32 salles au maximum ; les
fichiers servis restent confinés dans le dossier de l’application.

L’état partagé est écrit de façon atomique (`room-<salle>.json` + renommage)
dans :

- Windows : `%APPDATA%\Gestion MM\sync`
- macOS : `~/Library/Application Support/Gestion MM/sync`
- Linux : `~/.local/share/gestion-mm/sync`
- variable `MM_SYNC_DIR` pour forcer un autre dossier

## Première synchronisation

Les données déjà présentes sur un appareil n'ont pas d'horodatage. Au premier
envoi, le client les estampille (`stampChanges({}, données)`) : sans cela, le
serveur ne pourrait pas arbitrer entre deux versions et les champs uniques
(entreprise, réglages) seraient ignorés.

Cas traités :

- **Appareil neuf, aucune donnée locale** : il adopte l'état du PC tel quel.
- **Appareil neuf avec le jeu de démonstration intact** : il l'adopte aussi
  (les fiches fictives ne polluent pas les vraies données). L'application le
  détecte avec `isDemoData()`.
- **Appareil déjà utilisé** : ses fiches sont fusionnées avec celles du PC,
  rien n'est perdu, et l'utilisateur peut effacer les exemples d'un bouton
  (`resetToBlank()`).

## Ajouter la synchronisation à un nouvel écran

Rien à faire : tous les écrans écrivent dans le même état `data`, et c’est cet
état qui est horodaté et synchronisé. Une nouvelle collection doit simplement
être ajoutée à `COLLECTIONS` dans `merge.js` pour bénéficier des suppressions et
des collisions d’identifiants.
