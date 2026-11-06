# Gestion MM — Démarrage rapide

Application React en français québécois pour Entretien Michel Maisonneuve.

## 1. Lancer l’application

Installez Node.js 22 LTS et ouvrez un terminal dans le dossier du projet :

```sh
npm install
npm run dev
```

Ouvrez l’adresse affichée par Vite (habituellement http://localhost:5173).
Gardez le terminal ouvert. Pour arrêter : Ctrl+C.

## 2. Premier essai (5 minutes)

1. Sur l’accueil, choisissez **Gestion Client**. Les rendez-vous fictifs apparaissent à la date du premier lancement.
2. Ouvrez **Clients**, puis une fiche pour consulter ses coordonnées, ses notes et l’historique des factures.
3. Dans **Facturation**, cliquez sur **Créer une facture**, choisissez un client et saisissez les services. TPS : 5 %, TVQ : 9,975 %, taxes arrondies au cent sur le sous-total.
4. Enregistrez la facture puis rouvrez-la pour générer le PDF. Les liens courriel et SMS ouvrent les applications de votre appareil. **La pièce jointe PDF doit être ajoutée manuellement au courriel.** Aucun envoi automatique n’est effectué.
5. Passez à **Gestion Entreprise** : renseignez les vrais numéros de taxes et l’adresse Interac avant d’envoyer des factures réelles.
6. Testez les dépenses, le rapport de taxes par mois, trimestre ou année, et le calculateur de soumission.
7. Dans l’application Windows, ouvrez les réglages et exportez une copie de sécurité sur une clé USB. La restauration cherche les copies reconnues sur la clé et remplace les données après confirmation.

Les clients, adresses, factures et rendez-vous de départ sont fictifs. Les courriels utilisent example.com. Ne contactez pas les numéros de démonstration.

## 3. Synchroniser avec le téléphone

L’application PC est le serveur : le téléphone s’y connecte sur le même Wi‑Fi.

1. Lancez l’application Windows (`npm run desktop`) ou, pour le serveur seul,
   `npm run sync`. La fenêtre affiche l’adresse à utiliser, par exemple
   `ws://192.168.0.20:8765/sync`.
2. Sur le téléphone : **Réglages → Synchronisation PC ↔ mobile**, entrez
   `192.168.0.20:8765` puis **Enregistrer et connecter**.
3. Les deux appareils affichent **« Synchronisé »**. Chaque modification faite
   d’un côté apparaît de l’autre.

Depuis le téléphone, `http://192.168.0.20:8765` ouvre aussi l’application web
(utile pour l’installer sans passer par un câble).

**À savoir**

- Aucune donnée ne passe par Internet : tout reste sur votre réseau local. Il
  n’y a ni compte ni service externe.
- Hors ligne, chaque appareil continue de fonctionner ; les modifications
  s’envoient à la reconnexion.
- Le PC conserve une copie de l’état partagé sur son disque, en plus de la
  sauvegarde sur clé USB.
- Si les deux appareils modifient la même fiche, la plus récente gagne ; les
  modifications de fiches différentes sont toutes gardées.
- Le Wi‑Fi doit autoriser les communications entre appareils (« isolation des
  clients » désactivée sur certaines box). En cas de doute, essayez le partage
  de connexion du téléphone : le PC s’y connecte et l’adresse affichée par le
  serveur change.

Détails techniques : [`../shared/README.md`](../shared/README.md).

## 4. Sauvegarde et confidentialité

Les données sont conservées dans le stockage local du navigateur ou du profil Electron, pour cet appareil. La synchronisation PC ↔ mobile décrite ci-dessus relie vos appareils sur votre réseau local, sans serveur dans le nuage ni compte. Effacer les données de navigation peut supprimer les informations. Les données du navigateur et celles de l’application Windows sont séparées.

Dans **l’application Windows**, utilisez **Réglages → Exporter une copie de sécurité**. Insérez une clé USB; l’application la détecte et vous demande de la choisir si plusieurs clés sont branchées. Sans clé, elle demande d’en insérer une et vérifie automatiquement sa connexion. La copie est écrite dans **Sauvegardes MM** à la racine de la clé, avec la date du jour et un suffixe si nécessaire. Aucun sélecteur de dossier interne ni téléchargement de secours n’est proposé, et une copie existante n’est pas écrasée.

**Restaurer une copie JSON** cherche les fichiers JSON MM valides dans **Sauvegardes MM** et à la racine de la clé. Choisissez la copie, puis confirmez le remplacement des données actuelles. Les fichiers non reconnus sont ignorés. Les anciennes copies exportées ailleurs peuvent être copiées à la racine de la clé pour être reconnues. Limite de lecture : 25 Mo par fichier; les 200 premières copies valides sont proposées.

**Dans un navigateur**, ces deux boutons expliquent que l’accès direct aux lecteurs USB nécessite l’application Windows. Le navigateur ne peut pas garantir qu’un dossier choisi est une clé USB; aucun téléchargement ou importation depuis le disque interne n’est proposé à la place. Pour passer d’une ancienne version navigateur à Windows, placez une ancienne copie JSON valide sur la clé et restaurez-la dans Windows. Les données déjà présentes uniquement dans le navigateur ne sont pas transférées automatiquement.

Les données ne sont pas chiffrées : protégez votre session Windows et vos sauvegardes. Cette version est destinée à un usage local, individuel, pas à un service public multiutilisateur.

La météo utilise Open-Meteo sur demande (Internet requis); seules les coordonnées approximatives de la ville sont transmises. La carte ouvre Google Maps avec l’adresse choisie. Les polices Google sont téléchargées si Internet est disponible; une police système prend le relais hors ligne.

## 5. Construire l’application web

```sh
npm run build
```

Les fichiers sont créés dans `dist/`. Pour un déploiement réel, utiliser un hébergement statique HTTPS. Cette version conserve toujours les données localement sur chaque appareil.

## 6. Application Windows (Electron)

Sur un ordinateur **Windows 10/11 64 bits**, avec Node.js installé :

```sh
npm install
npm run build
npm run desktop
```

Pour produire l’installateur Windows :

```sh
npm run windows
```

L’installateur NSIS est écrit dans `release/`. Il inclut le moteur de synchronisation partagé (`shared/`). La fenêtre Windows démarre automatiquement le serveur de synchronisation et sert l’application web sur le port 8765.

Les premiers téléchargements Electron peuvent nécessiter Internet. Un installateur non signé peut déclencher SmartScreen : pour une distribution publique, prévoir un certificat et une signature de code.

**La compilation web a été vérifiée dans l’environnement de développement. L’exécutable Windows n’a pas été compilé ni testé ici.** Tester l’installation, les téléchargements PDF, les associations mail/SMS et la sauvegarde sur le poste Windows cible.

## 7. Fiscalité : périmètre et limites

Les taux standards TPS 5 % et TVQ 9,975 % sont automatisés. Les rapports incluent les factures selon leur date, payées ou non, et les dépenses marquées admissibles. Les crédits CTI/RTI sont des estimations basées sur l’hypothèse d’un achat entièrement taxable et professionnel. Les achats partiellement admissibles, exonérations, restrictions de véhicule, ajustements et méthodes fiscales particulières ne sont pas gérés de manière exhaustive.

Le calcul inverse à partir d’un total utilise 1,14975 et peut différer d’un reçu de quelques cents selon les arrondis. Comparez les montants aux reçus. Les échéances du calendrier sont indicatives, configurables par fréquence dans les réglages; elles ne traitent pas tous les reports, jours fériés ou particularités des déclarants annuels. **Aucune conformité ARC/Revenu Québec n’est certifiée. Faites valider avant usage comptable réel.**

Le statut de facture se sélectionne manuellement : vérifiez les retards. Les rappels sont des cases à cocher dans l’application, pas des notifications automatiques. Les données sont stockées localement sans historique d’audit. Les corrections sont possibles sans recréer la facture.

## 8. Architecture

- `src/main.jsx` : navigation par URL hash, état et sauvegarde locale, accueil, clients, rappels, réglages.
- `src/UI.jsx` : logo vectoriel, champs, fenêtre modale, titres et recherche.
- `src/Calendar.jsx` : calendrier mensuel / hebdomadaire et agenda.
- `src/Forms.jsx` : formulaires clients, factures et rendez-vous.
- `src/Business.jsx` : entreprise, dépenses, rapports, météo, soumission, notes.
- `src/data.js` : données fictives et calculs monétaires.
- `src/pdf.js` : exports PDF.
- `src/style.css` : interface responsive sauge / vert forêt.
- `electron/main.cjs`, `preload.cjs`, `usb.cjs`, `backup.cjs` : fenêtre Windows, pont sécurisé, détection des volumes USB amovibles et lecture/écriture des sauvegardes.
- `src/UsbBackup.jsx` : parcours USB dans les réglages, messages d’insertion, choix de clé/copie et confirmation.
- `electron/sync.cjs` : démarrage du serveur de synchronisation avec l’application.
- `../shared/src/sync/` : moteur de fusion, protocole, session de synchronisation et panneau de réglages **partagés avec l’application mobile**.
- `../shared/server/` : serveur WebSocket du réseau local, qui sert aussi l’application web pour l’installer sur le téléphone.

Le monogramme MM est **provisoire**. Pour intégrer le logo officiel, remplacez le SVG du composant `Logo` dans `src/UI.jsx` et adaptez l’en-tête de `src/pdf.js`.

## 9. Vérifications conseillées avant usage réel

- Remplacer toutes les données fictives et compléter l’entreprise.
- Vérifier une facture de 100 $ avant taxes : TPS 5 $, TVQ 9,98 $, total 114,98 $.
- Tester un PDF multi-services et les coordonnées de paiement.
- Sur Windows avec une vraie clé USB : exporter sans clé (message d’insertion), brancher la clé, exporter, puis restaurer la copie après confirmation. Vérifier aussi le choix entre deux clés, une clé pleine ou protégée en écriture et le retrait pendant l’opération.
- Valider les rapports et les échéances avec le comptable.
- Auditer et actualiser les dépendances avant diffusion; tester sur le poste Windows cible.

## Numéros fiscaux obligatoires sur les factures

Les numéros TPS et TVQ sont affichés sur la fiche facture, dans les messages courriel/SMS et sur chaque page du PDF. La génération PDF et les liens d’envoi sont bloqués si l’un des numéros manque. Les brouillons peuvent être enregistrés. Entrez les vrais numéros une fois dans Information d’entreprise; ils sont repris lors de la génération, y compris pour les factures existantes. Les anciens PDF téléchargés ne sont pas modifiés : régénérez-les.

## Mise à jour — Menu latéral et rapport de dépenses

Le bouton ☰ affiche les noms des onglets à côté des icônes; une nouvelle pression masque les noms et garde les icônes. Ce comportement fonctionne aussi sur petit écran (menu initialement réduit). Le menu déplié peut nécessiter un défilement horizontal sur un téléphone étroit.

Dans **Gestion Entreprise → Dépenses**, le bloc **Rapport détaillé des dépenses** permet de choisir les dates de début et de fin (incluses), d’exporter un PDF paysage ou d’ouvrir une version imprimable. L’aperçu comporte un bouton d’impression. Le rapport contient les fournisseurs, catégories, montants avant taxes, TPS/TVQ estimées, total estimé, crédits CTI/RTI estimés, totaux de période et répartition par catégorie. Les dépenses non admissibles sont incluses dans les achats mais exclues des crédits. Vérifiez toujours les taxes estimées contre les reçus.

Validation : compilation web réussie et test Chromium automatisé du basculement du menu mobile/ordinateur, du téléchargement PDF et de la visibilité du rapport en mode impression, sans erreur JavaScript. Test de régression facultatif (serveur `npm run dev` actif sur le port 5173) :

```sh
npm install --no-save @playwright/test
npx playwright install --with-deps chromium
node tests/smoke.mjs
```

## Animation d’ouverture

Au lancement ou au rechargement, une introduction de 2,4 secondes anime le monogramme MM sur fond vert forêt, révèle le nom de l’entreprise et s’efface pour laisser place à l’application. Le bouton **Passer** ou la touche **Échap** ferme immédiatement l’introduction. La préférence système **Réduire les animations** désactive l’introduction. La navigation interne ne la relance pas. Aucune attente artificielle liée au chargement des données.

Le visuel utilise le monogramme provisoire de l’application; le logo officiel reste à fournir. Composants : `src/LaunchScreen.jsx` et `src/launch.css`. Test Chromium : `node tests/launch.mjs` (mêmes prérequis que le test du menu).

## Calendrier — factures groupées et feuille de route

Dans **Votre calendrier → Préparer les travaux & impressions**, choisissez une date dans la période et le mode Semaine (lundi à dimanche) ou Mois complet. Le bouton « Date sélectionnée au calendrier » recale la période sur le jour sélectionné; les flèches du bloc déplacent la période du rapport indépendamment de la grille.

- **Factures de la semaine — PDF groupé** : télécharge un seul PDF contenant les factures liées aux travaux de la semaine, une nouvelle page par facture. Les dates des factures peuvent être différentes des dates des travaux. Les factures payées sont incluses et les doublons retirés. Ouvrez le fichier pour imprimer toutes les factures. TPS/TVQ obligatoires sur chaque page.
- **Voir / imprimer la feuille de route** : aperçu hebdomadaire ou mensuel classé par jour et heure, avec client, entreprise, adresse, téléphone, travail, facture et statut, notes privées, case Terminé et espace de notes manuscrites. Le bouton Imprimer permet aussi d’enregistrer un PDF via la fenêtre d’impression. Les cases Terminé sont un aide-mémoire de la feuille, pas un statut de travail sauvegardé.
- Chaque nouveau rendez-vous doit être associé à une facture du même client. Choisissez une facture ou utilisez **Créer la facture pour ce travail** directement dans le formulaire du rendez-vous. La facture est enregistrée avant le rendez-vous; si celui-ci est annulé, elle reste dans Facturation.
- Les anciens rendez-vous sans lien sont affichés dans une liste « facture à associer ». Aucun lien n’est deviné. Le lot est bloqué tant que ces associations ne sont pas complétées. La feuille de route reste consultable.

Les notes privées sont imprimées uniquement sur la feuille de route interne, jamais sur les factures. Ne remettez pas la feuille de route aux clients. Il n’y a pas d’optimisation géographique des trajets. Les mentions liées aux factures reflètent les données enregistrées au moment de la génération.

Test de régression : `node tests/calendar.mjs` (Playwright et serveur local requis, comme indiqué précédemment). La compilation web, les exports groupés, les vues hebdomadaire/mensuelle, les notes, la visibilité imprimable et l’association obligatoire ont été vérifiés sous Chromium.

## Estimations ponctuelles hors suivi

Le calendrier est réservé aux travaux facturés : une facture associée est obligatoire pour enregistrer un rendez-vous. Les anciennes données sans association explicite doivent être reliées à la bonne facture, sans suppression ni création automatique arbitraire.

L’ancien calculateur de soumission est remplacé dans **Gestion Entreprise → Outils divers** par **Feuille d’estimation professionnelle**. Saisissez le destinataire, les services, quantités, prix et conditions; affichez la feuille puis utilisez **Imprimer / enregistrer en PDF**. Le document est clairement marqué « Estimation », non facturable, avec sous-total et taxes estimées, et ne crée ni client, ni facture, ni rendez-vous. Aucun enregistrement, historique, suivi ou conversion d’estimation n’est prévu dans l’application. Le contenu temporaire est perdu à la fermeture ou au rechargement; seule une copie imprimée ou enregistrée par vous subsiste. Aucun numéro de facture n’est attribué.

Validation Chromium : aperçu imprimable, total pour 100 $ = 114,98 $, stockage local inchangé et formulaire remis à zéro à la réouverture (`node tests/estimate.mjs`).

## Repères visuels des sections

Chaque écran dispose maintenant d’un bandeau de titre contrasté et d’une couleur d’accent discrète : calendrier vert, facturation bleu pétrole, clients olive, rappels ambre, entreprise ardoise, dépenses terre cuite, taxes mauve et outils turquoise. Les blocs d’impression, formulaires, tableaux et notes sont séparés par des fonds, bordures et titres plus lisibles. Les intitulés restent visibles : la couleur n’est jamais le seul repère. Aucun changement aux données ni aux calculs. Styles centralisés dans `src/sections.css`.

## Parcours client simplifié — prix et rotation

**Clients → Ajouter un client** comporte désormais trois blocs :
1. Nom, téléphone, courriel et adresse.
2. Service habituel, prix avant taxes et rotation.
3. Première date de travail et heure habituelle.

Les détails entreprise/type et notes privées sont regroupés sous « Autres détails (facultatif) ». À l’enregistrement, l’application crée ensemble les travaux récurrents et leurs factures datées du jour prévu, jusqu’à trois mois à partir d’aujourd’hui. Les factures sont « En attente », sans envoi automatique. Le prix et le service sont repris sans ressaisie; ils restent modifiables par facture. Les nouvelles factures manuelles reprennent également le prix du client sélectionné.

Rotations : ponctuel, chaque semaine, toutes les deux semaines, toutes les quatre semaines, chaque mois, tous les deux/trois/six mois et chaque année. Une rotation mensuelle sur le 31 est ramenée au dernier jour des mois plus courts puis revient au 31 quand possible. Les dates de travail ne sont pas décalées pour les fins de semaine ou jours fériés.

La fenêtre de planification est prolongée au démarrage/rechargement de l’application, sans tâche de fond lorsque l’application est fermée. Les anciennes occurrences passées non générées ne sont pas recréées. Une première date au-delà de trois mois n’apparaît au calendrier que lorsqu’elle entre dans cette fenêtre. Un travail existant pour le même client à la même date évite la création d’un doublon.

**Important : modifier le prix, la rotation, la date ou l’heure du client ne modifie ni ne supprime les travaux/factures déjà créés.** Corrigez les entrées déjà planifiées individuellement si nécessaire; les nouveaux paramètres servent aux prochaines occurrences non générées. Aucun changement n’est appliqué automatiquement aux anciens clients de démonstration tant que leur prix, rotation et première date n’ont pas été complétés.

Les rapports de taxes existants filtrent les factures sur leur date; les travaux futurs apparaissent donc dans leur période future. Vérifiez votre méthode comptable avant de vous servir des factures anticipées pour une déclaration.

Tests : `node tests/recurrence.mjs` (calcul des rotations et absence de doublons) et `node tests/client-flow.mjs` (création client → travaux + factures, persistance et rechargement).

## Travail ponctuel : créer une facture unique

Le bouton « Nouveau rendez-vous » du calendrier et l’ajout de travail depuis la fiche client ont été retirés. Le point d’entrée d’un travail sans récurrence est désormais **Facturation → Créer une facture unique**. Choisissez le client, la date du travail, son heure et les services/prix. La date de facture et l’échéance de paiement restent des champs distincts de la date d’intervention.

**Créer la facture unique et le travail** enregistre ensemble une facture et une seule intervention au calendrier, sans rotation. Le service/prix habituel du client est prérempli et reste ajustable. Enregistrez d’abord, puis rouvrez la facture pour télécharger le PDF ou utiliser les liens d’envoi; cela évite de sortir une facture ponctuelle sans entrée de travail. Modifier cette facture ne crée aucune nouvelle intervention. La date et l’heure du travail déjà créé se corrigent depuis « Modifier le rendez-vous » dans l’agenda.

Les travaux récurrents continuent d’être planifiés automatiquement avec leurs factures à partir de la fiche client. Test : `node tests/unique-invoice.mjs`.

## Mise à jour — Sauvegarde et restauration sur clé USB

Les réglages n’utilisent plus le téléchargement navigateur ni le sélecteur de fichier JSON pour les copies de sécurité. Les deux actions passent par un pont Electron limité aux lecteurs USB amovibles détectés par Windows (bus USB avec lettre de lecteur). Le disque interne, les lecteurs réseau et les chemins arbitraires ne sont pas proposés. Chaque opération revérifie la clé sélectionnée avant d’accéder aux fichiers.

La détection Windows utilise PowerShell et les informations CIM de Windows, sans module natif supplémentaire. Les clés doivent être montées et accessibles dans l’explorateur Windows. Les lecteurs BitLocker verrouillés doivent être déverrouillés dans Windows avant utilisation. Les disques USB externes déclarés « fixes » par Windows ne sont pas assimilés à une clé amovible.

Validation dans l’environnement de développement : compilation web, tests Node du format JSON, des chemins autorisés, de la découverte racine/dossier, du refus des fichiers invalides et de l’export sans écrasement (`node test/usb-backup.mjs`). Test Chromium avec pont USB simulé : absence de repli navigateur, insertion automatique, export USB et restauration seulement après confirmation (`npm install --no-save @playwright/test`, serveur Vite actif, puis `node test/usb-ui.mjs`). **La détection matérielle PowerShell et les opérations sur une vraie clé USB n’ont pas pu être exécutées sur cet environnement Linux : les valider sur le poste Windows cible avant usage réel.**
