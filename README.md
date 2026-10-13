# PMO Reporting : Reporting Tasks

Application web interne qui remplace la feuille **Reporting Tasks** du classeur TEAM 1. Les données sont lues directement dans Jira DC (ticketing.be-ys.com) et affichées dans le navigateur, accessibles à toute l'équipe.

## Démarrage rapide (Windows, sur ton poste)

Prérequis : Python 3.10 ou plus récent ([python.org](https://www.python.org/downloads/), cocher « Add to PATH »).

| Pour… | Double-cliquer sur |
|---|---|
| Tester **sans VPN**, avec les données du classeur | `lancer_demo.bat` |
| Utiliser **Jira en direct** (VPN ou Wi-Fi entreprise) | `lancer.bat` |

Le premier lancement installe les dépendances (environ 1 minute), puis ouvre http://localhost:8000.

### Brancher Jira

1. Dans Jira, clique sur ton avatar → **Profil** → **Jetons d'accès personnels** → **Créer un jeton** (lecture suffit).
2. Ouvre le fichier `.env`, créé au premier lancement, et colle le jeton : `JIRA_TOKEN=xxxxxxxx`.
3. Relance `lancer.bat`.
4. Pour vérifier la connexion : http://localhost:8000/api/check-jira doit afficher ton nom.

## Paramétrage : page « Paramètres » (http://localhost:8000/parametres)

Les réglages de l'outil se modifient dans l'application, sans toucher au code ni redémarrer :
sprint (dates, Freeze Code, fin de test), filtres Jira, chantiers, FEAT par défaut, statuts, types,
Tempo (équipe, scrum events, rôles), affectations par chantier et présences sur le sprint.

- Les paramètres sont stockés dans **MongoDB**. Chaque modification est tracée : qui, quand, valeur avant et après.
- Enregistrer demande le **code administrateur** (`ADMIN_CODE` dans `.env`). Sans code, la page est en lecture seule.
- Une valeur incohérente (fin de test avant le Freeze Code, affectation au-delà de 100 %…) est refusée, avec le champ en cause signalé.
- L'historique quotidien des tâches (comparaison jour par jour, burndown) est lui aussi rangé dans MongoDB.
- Les secrets restent dans `.env` : jeton Jira, adresse MongoDB, code administrateur. Ils ne sont jamais en base.
- L'adresse de Jira et la vérification de son certificat ne se modifient pas depuis la page (le jeton Jira y est envoyé) : dans `.env` (`JIRA_BASE_URL`, `JIRA_VERIFY_SSL`), qui l'emporte sur la base.
- Après 5 codes administrateur faux, l'adresse est bloquée 5 minutes.

**MongoDB est obligatoire** : c'est la seule source des paramètres (il n'y a plus de fichier `config.yaml`).
Si la base est injoignable, les pages affichent la raison au lieu de travailler avec des réglages périmés, et l'outil réessaie seul chaque minute.

### Base MongoDB

La base de l'équipe est sur **MongoDB Atlas** (`pmo-reporting.mzdrvzh.mongodb.net`, base `pmo_reporting`). Dans `.env` :
```
MONGODB_URI=mongodb+srv://<utilisateur>:<mot de passe>@pmo-reporting.mzdrvzh.mongodb.net/
MONGO_DB=pmo_reporting
ADMIN_CODE=<un code connu des seules personnes autorisées>
```
Atlas n'accepte que les adresses IP autorisées : depuis un nouveau poste ou réseau (VPN, bureau, VM), l'ajouter dans **Security → Network Access**.
Symptôme d'une adresse refusée : `TLSV1_ALERT_INTERNAL_ERROR` dans les journaux et « MongoDB injoignable » dans l'outil.

## Navigation

Trois onglets : **Synthèse** (vue manager), **Pilotage** et **Paramètres** (sur téléphone : trois boutons en bas d'écran).

**Pilotage** regroupe sept sous-vues : **Tâches** (`/`, ex-Reporting Tasks), **Capacité** (`/capa`, ex-Capa vs RAF), **Temps** (`/temps`, ex-Temps passé), **Effort** (`/effort`, planifié vs consommé), **Scrum events** (`/scrum`), **Anomalies** (`/anomalies`) et **Cadrage** (`/cadrage`). Toutes les sous-vues proposent la **même liste de personnes** (équipe Tempo et personnes assignées dans Jira ; celles sans donnée sur la vue sont regroupées à la fin) et le **même classement** : DEV, QA ou TL / PO (un TL / PO qui a du reste à faire est affiché « TL / PO · réalise du DEV », sa capacité reste comptée côté DEV). Le **chantier**, la **personne** et le **profil** choisis suivent d'une sous-vue à l'autre, ainsi que le jour affiché ; l'onglet Pilotage rouvre la dernière sous-vue consultée avec ses filtres. Les adresses restent valables (un lien partagé fonctionne toujours).

## Ce que fait la page

- **Bandeau sprint** : Freeze Code, fin de test, jours restants, avancement du sprint.
- **Filtres** : chantier, FEAT mère, personne, état, type, recherche, alertes, masquer les terminées. Ils sont repris dans l'URL, donc un lien filtré se partage tel quel.
- **Indicateurs** : RAF DEV, RAF QA, tâches ouvertes, retards, alertes.
- **Tableau Chantier → US → tâches**, avec les totaux RAF et les échéances maximales. Chaque clé renvoie au ticket Jira.
- **Totaux par chantier** et **RAF par personne**.
- **Alertes** :
  - 🔴 en retard (sauf statuts Ready for QA / Merge Request : travail livré, réglable via `no_delay_statuses`), bloquée, échéance DEV après le Freeze Code, échéance QA après la fin de test ;
  - 🟠 sans échéance, sans estimation (tâche En progression, Ouverte ou Ready to develop sans estimation initiale ni restante, réglable via `estimate_required_statuses`), RAF à estimer (sauf Ready for QA / Merge Request), non assignée ;
  - 🔵 RAF supérieur à 0 sur une tâche finie.
- **Suivi du RAF** (un seul bloc) : RAF DEV / QA avec l'écart, **par jour** (chaque jour ouvré du sprint, Freeze Code et fin de test repérés), **par semaine** ou **par sprint** (RAF début / fin de chaque sprint enregistré), affiché en **tableau** ou en **courbe**. Un clic sur une colonne (ou un point de la courbe) la prend comme référence : les indicateurs, le RAF par personne et la liste des changements en dessous (terminées, rouvertes, nouvelles, statut, RAF, réassignations, échéances) se comparent à ce relevé. Les filtres de la page s'appliquent. Une photo des tâches est enregistrée chaque jour dans `history/snapshots.db` (dernière lecture de la journée) ; l'application relit Jira toutes les heures en arrière-plan pour ne pas rater de jour. L'historique démarre au premier lancement : la comparaison est disponible le lendemain. Un sprint est reconnu à sa date de début : le renommer dans les paramètres ne coupe pas son historique ; changer sa date de début en fait un nouveau sprint.
- **Export Excel** de la vue filtrée.
- **Rafraîchissement** automatique toutes les 2 minutes, ou immédiat avec le bouton « Actualiser ».

Règles de calcul (identiques à la feuille *Charge*) :

- RAF (HJ) = estimation restante (Σ) / 8 ;
- RAF DEV = types *Développement* et *Anomalie de test US* ;
- RAF QA = type *Test/Recette Us*.

## Page « Capacité » (Tempo) : http://localhost:8000/capa

Lue dans Tempo avec le même jeton que Jira (aucune autre connexion). Réglages dans la page Paramètres, section Tempo : équipe Tempo (301 = Equipe BUILD) et tâches où les absences sont saisies (ex. PINTERNE-70).

- **Capacité** = heures dues au planning Tempo (week-ends et jours fériés exclus) × disponibilité dans l'équipe − absences saisies, − part des scrum events (un % pour les TL / PO, un % pour les DEV / QA : `tempo.scrum_events.percent`), × affectation au chantier (`tempo.affectations`, sinon au prorata du RAF), du jour à l'échéance incluse. Le **1er jour du sprint** est consacré au sprint planning : il ne compte dans aucune capacité (prévue ni réelle), mais la saisie du temps y reste attendue. Au-delà de 100 % : surcharge. Rôles : ceux de l'équipe Tempo (`tempo.roles.lead_roles` = TL / PO), avec des exceptions par personne possibles.
- **DEV et QA séparés** : la capacité DEV court jusqu'au Freeze Code et se compare au RAF DEV ; la capacité QA court jusqu'à la fin de test et se compare au RAF QA. Elles ne s'additionnent jamais. Profil d'après le rôle Tempo (`tempo.roles.dev_roles`, `qa_roles`) ; rôle non reconnu : déduit du RAF ; exceptions par personne (`dev_people`, `qa_people`). TL / PO sans RAF : pas de capacité de réalisation.
- **Arrivées et départs en cours de sprint** : `tempo.presences` (ex. `"Mazen JEBALI": {debut: 2026-09-21}`), sinon dates d'appartenance à l'équipe Tempo. Hors de la période : ni capacité, ni heures dues, ni saisie manquante.
- **Congés connus d'avance** (page Paramètres, section Congés) : les **alternants** sont absents les 2 premiers mercredis de chaque mois (tout mercredi du 1er au 14) ; les **congés prévus** couvrent leurs dates (du … au …, inclus). Ces jours-là, ni capacité ni saisie attendue ; une absence saisie dans Tempo le même jour n'est pas comptée deux fois. Ils apparaissent « Alt. » ou « Congé » dans les temps saisis.
- **Deux notions de capacité, les mêmes dans tout l'outil** (Synthèse, Capacité, Rapport, burndown, Daily New FEAT) :
  - **Capacité du sprint** : du 1er jour au jalon, (planning × disponibilité − absences − scrum events) × affectation ;
  - **Capacité restante** : d'aujourd'hui au jalon, jour par jour, (planning × disponibilité − absences − temps déjà imputé ce jour-là − scrum events à réserver) × affectation (8 h dues, 6 h imputées : 2 h). C'est elle qui se compare au RAF (charge, météo, écart). Les jours passés non saisis n'en font pas partie : ils apparaissent dans « Temps non saisis ». Par chantier : capacité restante des personnes affectées × leur part. Chaque capacité est cliquable et montre son calcul jour par jour.
- **Charge par chantier** : capacité DEV et capacité QA des personnes affectées, chacune face au RAF du chantier.
- **Charge par personne** : regroupée en DEV et QA ; le RAF de l'autre profil est signalé « hors profil » sans entrer dans la charge.
- **Temps saisis** : heures saisies par personne et par jour depuis le début du sprint ; les jours passés incomplets sont teintés, avec le total manquant par personne.

## Page « Temps passé » : http://localhost:8000/temps

Sur le sprint en cours, le temps saisi dans Tempo par l'équipe, réparti en tâches du sprint, scrum events, absences et autres sujets : totaux, scrum events par rôle (mesuré face au paramètre de capacité), répartition par personne, et tâches les plus saisies par catégorie.


## Planifié vs consommé : http://localhost:8000/effort

L'effort des tâches, DEV et QA séparés (jamais additionnés) :

- **Estimé** = estimation initiale Jira ; **Consommé** = temps passé ; **Reste** = reste à faire (0 pour une tâche finie) ;
- **À terminaison** = consommé + reste ; **Écart** = à terminaison − estimé, en JH et en %.
- État : **conforme** jusqu'à +5 %, **dérive** jusqu'à +20 %, **forte dérive** au-delà. Une tâche sans estimation initiale compte comme travail non prévu (signalée).

La page montre la synthèse DEV / QA, l'évolution jour par jour (estimé, consommé cumulé, prévu à terminaison, d'après les relevés : un estimé qui monte = tâches ajoutées), le détail dépliable chantier → FEAT → US → tâche, et les plus fortes dérives. Résumé du chantier dans la Synthèse, ligne « Effort » dans le rapport.

## Cadrage du sprint : http://localhost:8000/cadrage

Analyse de début de sprint (estimation, affectation, répartition du reste à faire), et son rapport PowerPoint (bouton **Télécharger le rapport**, ou bouton **Cadrage du sprint** de la Synthèse). Mêmes chiffres à l'écran et dans le rapport, au jour affiché. Un filtre **Chantier** limite l'analyse et le rapport à un chantier : la capacité d'une personne y est sa capacité × sa part d'affectation à ce chantier.

1. **Macro-chiffrage initial vs chiffrage actualisé, par FEAT.** Le macro-chiffrage se saisit dans la fenêtre « Saisir le macro-chiffrage » (une valeur en JH par FEAT, DEV + QA), ou se colle depuis Excel (lignes avec la clé de la FEAT et le nombre). Il est gardé dans le navigateur, pour chaque sprint. Actualisé = consommé + reste à faire des tâches DEV et QA de la FEAT. Les FEAT au-delà du macro sont signalées (rouge au-delà de +20 %).
2. **Charge de test vs charge de développement, par FEAT** : QA ÷ DEV face à l'hypothèse (30 % par défaut, modifiable sur la page). Conforme à ±5 points ; test sous- ou sur-dimensionné au-delà (fort écart au-delà de 15 points).
3. **Charge planifiée vs capacité disponible, par ressource** : reste à faire affecté de son profil (DEV ou QA) face à sa capacité prévue restante jusqu'au jalon (page Capacité). Surcharge au-delà de 100 % (arbitrage), tendu dès 90 %, sous-chargé sous 60 % ou sans charge (rééquilibrage possible). Le reste à faire non affecté est signalé à part.

Le rapport : couverture, synthèse (messages clés des trois analyses et du préalable « estimation et affectation »), une diapositive par analyse avec tableau et graphique, fin. Les bogues n'entrent dans aucune charge.

## Scrum events : http://localhost:8000/scrum

Respect de la part réservée aux cérémonies par les **DEV et QA** (objectif = paramètre de capacité `tempo.scrum_events.percent.team`, 10 %), d'après les temps saisis dans Tempo. Les TL / PO (rôle Tempo ou paramètre) sont exclus du calcul, même s'ils ont du reste à faire.

- **Ratio** = scrum events ÷ temps travaillé (tâches du sprint + scrum events + autres sujets ; absences exclues) : la même base que le paramètre de capacité, et le même chiffre dans la page Temps et la Synthèse. Scrum ÷ (développement + test) reste affiché pour information, sans verdict. Développement = tâches DEV, anomalies de test et bogues ; test = tâches de recette.
- **État** : respecté jusqu'à l'objectif, « à la limite » jusqu'à +2 points, « dépassé » au-delà ; « faible, saisie à vérifier » sous la moitié de l'objectif.
- **Indicateurs** : ratio cumulé (et part du temps travaillé), scrum events en JH et en heures par personne et par jour, développement + test, écart au budget en JH, tendance des 5 derniers jours, jours au-dessus de l'objectif ; points d'attention calculés.
- **Au fil du sprint**, par jour ou par semaine : ratio de la période (barre) et cumulé (ligne) face à l'objectif, Freeze Code et fin de test repérés.
- **Par personne** (ratio calculé à partir de 2 JH travaillés), **par chantier** (scrum events saisis sur la tâche Tempo du chantier, reconnue à son résumé, par exemple « [ETAB_BENEF] … Scrum Event » ; sinon « Transverse ») et **nature des events** (daily, planning, review / démo, rétro, affinage), lue dans le commentaire de la saisie Tempo.

## Suivi des anomalies : http://localhost:8000/anomalies

Bogues (BUG) et anomalies de test US (ANO) du sprint, au jour affiché.

- **Récapitulatif** : nombre (BUG / ANO), ouvertes (bloquant une US, âge moyen), closes (taux et délai moyen de résolution), temps consommé (temps passé Jira, moyenne par anomalie, estimé), reste à faire, **coût de la non-qualité** (temps des anomalies ÷ temps des tâches de développement), **densité** (anomalies de test par US développée), arrivées du dernier relevé.
- **Points d'attention** : anomalies bloquées ou bloquant une US, ouvertes depuis plus de 5 jours, au-delà de +20 % de leur estimation, sans estimation, non assignées, closes sans temps saisi ou avec un reste à faire, réouvertures.
- **Au fil du sprint**, d'après les relevés quotidiens : ouvertes / closes, nouvelles, résolues, réouvertes et temps consommé depuis le relevé précédent.
- Répartition **par chantier** et **par personne**, et **liste** (ouvertes, closes ou toutes) avec US liée, priorité, âge ou délai de correction.

L'âge et le délai viennent des dates de création et de résolution Jira, lues depuis le 12/10/2026 (les relevés plus anciens ne les ont pas).

## Rapport « Daily New FEAT » (PowerPoint)

Bouton **Daily New FEAT** de la Synthèse (ou `GET /api/daily-new-feat.pptx?day=AAAA-MM-JJ`) : le rapport quotidien, sur la charte be-ivs (`app/templates/dnf_template.pptx`), au jour affiché.

- **vue d'ensemble** (tous chantiers) : une ligne par chantier (météo, avancement, RAF DEV / QA avec la variation depuis la veille entre parenthèses, écart CAPA − RAF, dérive d'effort DEV / QA, bogues ouverts, retards et blocages) et une carte de 4 messages clés au plus par chantier.

Puis, par chantier :

- **la diapositive du daily** : météo, CAPA / RAF / écart DEV et QA de la semaine (un seul tableau), burndown du sprint face à la trajectoire idéale, RAF par ressource (seulement les personnes qui ont encore du reste à faire), **effort** DEV / QA (estimé initial, consommé, reste, à terminaison, dérive), 4 points d'attention au plus, les plus graves d'abord (dont une forte dérive d'effort) ;
- **tâches ouvertes** : FEAT (avec sa dérive d'effort) → US → tâches, à la suite sur des pages pleines ; US et tâches terminées comptées, pas listées ;
- **bogues et TNR ouverts** : avec l'US liée (et le sens du lien), RAF et estimation ; les bogues clos sont seulement comptés.

En **annexe**, une diapositive par chantier : tâches terminées / restantes jour par jour (le périmètre qui grossit se voit), état des tâches par type. Graphiques PowerPoint modifiables. L'effort n'est plus en annexe : il est dans les diapositives présentées (mêmes règles que la page Effort : ≤ 5 % conforme, ≤ 20 % dérive, au-delà forte dérive).

Règles : météo identique à la Synthèse (RAF > CAPA : hors capacité ; ≥ 80 % ou retard / blocage : sous tension). Rythme = RAF soldé par jour ouvré sur les 3 derniers intervalles entre relevés (net des tâches ajoutées et des réestimations) ; « 5,2 j pour 3 j ouvrés » = jours de travail nécessaires à ce rythme face aux jours ouvrés restants d'ici le jalon (jour du rapport compris). Les tendances et le Δ viennent des relevés quotidiens : un jour sans relevé n'apparaît pas.

Mêmes chiffres que l'outil ; génération en 5 à 10 s (lecture de la capacité Tempo de chaque jour de la semaine).

## Image d'un jour passé (tous les onglets)

Le sélecteur de date de l'en-tête (« Aujourd'hui ») propose chaque jour du sprint en cours qui a un relevé.
En choisissant un jour, Synthèse, Tâches, Capacité, Temps et le rapport affichent les chiffres de ce jour-là :
reste à faire, échéances et alertes du relevé de ce jour, temps Tempo saisis jusqu'à ce jour (les saisies postérieures sont ignorées).
Le jour suit la navigation entre onglets et l'export Excel ; un bandeau violet le rappelle, avec « Revenir à aujourd'hui ».
L'adresse se partage telle quelle : `http://localhost:8000/recap?jour=2026-10-01`.

Un jour n'est disponible que si l'outil a fait un relevé ce jour-là : laisser l'application tourner (relecture automatique toutes les heures).

## Rapport de synthèse : http://localhost:8000/rapport

Bouton « Rapport de synthèse » de la Synthèse. Une page A4 paysage, à imprimer ou enregistrer en PDF :
vue d'ensemble de tous les chantiers (jamais cumulés), puis une page par chantier avec, pour le développement et la recette :
météo, reste à faire, capacité du sprint, capacité restante, écart, charge / capacité, avancement, dernière échéance, retards, et le burndown ;
enfin le détail par FEAT (avancement, RAF DEV / QA, échéances DEV / QA, retards). Mêmes calculs que la Synthèse, au jour choisi.

## Hébergement sur le réseau interne (VM Linux + Docker)

```bash
cp .env.example .env         # puis renseigner JIRA_TOKEN
docker compose up -d --build
# → http://<ip-de-la-vm>:8000
```

Pour la mise en production, placer un reverse proxy **Nginx** en HTTPS devant l'application, avec un nom interne comme `pmo-reporting.be-ys.local`. Les paramètres sont dans MongoDB : les dates du sprint se changent dans la page Paramètres, sans redémarrer. Autoriser l'adresse IP de sortie de la VM dans Atlas (Network Access).

## Architecture

```
app/
  main.py         API FastAPI + cache + service de la page
  jira_client.py  client REST Jira DC (jeton Bearer, pagination)
  loaders.py      lecture Jira (filtres, liens US, epic, sprint) ou Excel (démo)
  reporting.py    calculs : chantier, RAF DEV/QA, échéances, avancement, alertes, export
  tempo.py        capacité, temps saisis, scrum events, absences (Tempo)
  store.py        stockage : paramètres et historique dans MongoDB (historique en SQLite local si la base est injoignable)
  static/         interface web (HTML/CSS/JS, aucune dépendance Internet)
```

| Point d'API | Rôle |
|---|---|
| `GET /api/reporting-tasks[?refresh=true]` | Données JSON |
| `GET /api/reporting-tasks.xlsx?chantier=…` | Export Excel |
| `GET /api/history?chantier=…` | Indicateurs jour par jour du sprint (mêmes filtres) |
| `GET /api/history/sprints` | RAF au premier et au dernier jour de chaque sprint enregistré |
| `GET /api/history/{AAAA-MM-JJ}` | Photo des tâches d'un jour |
| `GET /api/days` | Jours du sprint courant qui ont un relevé |
| `GET /api/people` | Liste commune des personnes du pilotage, avec leur classement DEV / QA / TL / PO |
| `…?day=AAAA-MM-JJ` | Sur `/api/reporting-tasks`, `/api/tempo`, `/api/history`, l'export Excel : image de ce jour |
| `GET /api/settings` | Paramètres de l'outil, sans secret |
| `PUT /api/settings` | Enregistre les paramètres (en-tête `X-Admin-Code`) |
| `GET /api/settings/history` | Historique des modifications de paramètres |
| `GET /api/check-jira` | Test de connexion Jira |
| `GET /api/health` | Supervision |
| `GET /docs` | Documentation interactive de l'API |

## Suite prévue

- **Phase 2** : Aperçu sprint, Synthèse globale, suivi FEAT/US.
- **Phase 3** : CAPA vs RAF, congés, Tempo.
- **Phase 4** : historique des sprints, conformité process, connexion par utilisateur via Jira. `JiraClient` accepte déjà un jeton par utilisateur.
