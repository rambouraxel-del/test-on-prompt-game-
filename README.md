# Les Premiers Foyers

Jeu de gestion de colonie en **pixel art 2D**, jouable dans le navigateur, sans serveur ni compte.
Construisez des maisons et des exploitations, tracez les routes, affectez les métiers, nourrissez
et abreuvez les foyers, et accompagnez plusieurs générations d'habitants jusqu'à la prospérité.

## Installation et lancement

Prérequis : **Node.js 18+** (testé avec Node 22).

```bash
npm install        # installe les dépendances
npm run dev        # lance le jeu en développement → http://localhost:5173
npm run build      # vérifie les types puis construit la version de production dans dist/
npm run preview    # sert la version construite → http://localhost:4173
npm test           # tests automatisés (Vitest)
npm run simulate   # simulation accélérée de plusieurs décennies (équilibrage)
npm run e2e        # test navigateur de bout en bout (nécessite « npm run preview » lancé et Chromium)
```

Le dossier `dist/` est un site statique : il peut être ouvert depuis n'importe quel hébergement
statique. Tous les graphismes sont générés localement par le code, aucune ressource distante n'est chargée.

## Commandes

| Action | Commande |
| --- | --- |
| Sélectionner, construire, tracer une route | Clic gauche (maintenir et glisser pour les routes) |
| Déplacer la caméra | Clic droit ou molette maintenus, **Z Q S D** (W A S D en QWERTY) ou flèches |
| Zoomer | Molette (centrée sur le pointeur) |
| Pivoter le bâtiment à placer | **R** |
| Annuler / fermer / menu pause | **Échap** |
| Pause / reprise | **Espace** |
| Vitesse ×1, ×2, ×4 | **1**, **2**, **3** (ou boutons en haut) |
| Recentrer sur l'hôtel de ville | **C** ou bouton « Recentrer » |
| Population et emplois | **P** ou clic sur la population |
| Écran tactile | un doigt : déplacer · pincer : zoomer · toucher : action |

## Règles du jeu

- **Carte** : 96 × 96 cases, découpée en parcelles de 16 × 16. Quatre parcelles centrales sont
  possédées au départ ; les autres sont voilées. L'outil **Parcelles** permet d'acheter une parcelle
  adjacente (coût affiché avant confirmation, croissant à chaque achat).
- **Routes** : un bâtiment est *relié* si une route touchant son pourtour rejoint l'hôtel de ville.
  Exploitations, services et greniers ne fonctionnent que reliés. Une maison non reliée reste
  habitable mais perd l'accès aux services (−10 de bonheur). Les habitants peuvent marcher hors des
  routes (plus lentement), mais jamais sur l'eau, les bâtiments, les arbres ou les rochers.
- **Production** : chaque exploitation produit selon le **personnel affecté** (boutons + et −).
  Les bûcherons et tailleurs prélèvent réellement le stock des arbres et gisements **accessibles**
  de leur rayon ; les arbres repoussent (2 ans + 1,5 an de croissance), les gisements se
  reconstituent plus lentement (convention de jeu). Un stock plein bloque la production (grenier).
- **Consommation** : nourriture et eau pour chaque habitant (enfants : moitié), bois de chauffage
  en hiver. Une pénurie fait baisser bonheur et santé ; si elle dure, des habitants meurent.
- **Saisons** (une année ≈ 1 minute à ×1) : printemps favorable, été assoiffé, automne généreux,
  hiver rigoureux (récoltes réduites, chauffage).
- **Foyers** : les couples se forment automatiquement (pas de liens parent/enfant ni frère/sœur).
  Une naissance exige une **place libre** dans la maison (réservée pendant la grossesse de 9 mois),
  un bonheur du couple ≥ 55, une santé ≥ 50 et des réserves de nourriture et d'eau.
  Les enfants deviennent adultes à 18 ans, les adultes prennent leur retraite à 65 ans.
- **Bonheur** : base + nourriture + eau + logement + autel + jardins + santé − pénalités
  (sans-abri, surpeuplement, maison non reliée, froid). La fiche d'un habitant détaille chaque terme.
- **Services** : autels (rayon et capacité limités, un seul autel compte par maison), écoles
  (enseignants, élèves de 6 à 17 ans, jusqu'à +30 % de productivité adulte), dispensaires
  (soignants, meilleure santé, sans compenser la faim ni la soif), jardins (bonus plafonné).
- **Progression** : fermes et écoles à 16 habitants, dispensaires et niveau 2 à 24, niveau 3 à 40.
- **Événements** : récolte exceptionnelle, sécheresse, maladie passagère, arrivée de voyageurs
  (jamais avant l'an 4, durée affichée).
- **Victoire** : 60 habitants et bonheur moyen ≥ 70 % maintenus deux années sans pénurie ;
  la partie peut ensuite continuer en mode libre. **Défaite** si la population tombe à zéro.

## Sauvegardes

Sauvegarde automatique régulière (réglable), sauvegarde manuelle (avec confirmation avant
écrasement), chargement, export/import JSON. Le format est versionné et entièrement validé à
l'import ; une sauvegarde corrompue produit un message clair. Tout l'état logique est enregistré
(carte, graine et état du générateur aléatoire, habitants, familles, logements, métiers,
bâtiments, niveaux, stocks naturels, réserves, territoire, calendrier, événements, progression).
Les parties chargées démarrent en pause. Quand l'onglet est masqué, la simulation est suspendue.

## Architecture

```
src/
  config/     balance.ts (coûts, rendements, consommations, seuils, durées) · buildings.ts
  sim/        simulation pure, sans DOM : monde, logique, agents, chemin (A*), carte, sauvegarde,
              alertes, générateur aléatoire à graine, boucle à pas fixe (runner), joueur automatique (bot)
  render/     sprites pixel art générés par code et mis en cache, rendu Canvas 2D, minicarte
  ui/         interface HTML/CSS : barre du haut, construction, panneaux, fenêtres, stockage
tests/        tests Vitest ciblés
scripts/      simulate.ts (décennies accélérées) · e2e.ts (Playwright/Chromium)
```

- **Pas de temps fixe** de 50 ms (logique économique toutes les 250 ms), indépendant du nombre
  d'images par seconde ; rattrapage plafonné.
- **Aléatoire à graine** (mulberry32) : même graine ⇒ même carte, mêmes colons et même partie.
- La simulation n'utilise pas le DOM : elle est testée et simulée en Node.

## Arbitrages de conception

- **Logistique abstraite** : stocks globaux, sans transport d'objets ; en revanche personnel,
  connexion routière et disponibilité réelle des arbres et gisements conditionnent la production.
- **Déplacements visuels** : les habitants font réellement leurs trajets (A* à 8 directions,
  routes préférées, calculs échelonnés) mais ces trajets n'influencent pas l'économie.
- **Postes à remplacement automatique** : le joueur fixe le nombre de postes ; si un travailleur
  part à la retraite ou meurt, un adulte disponible le remplace automatiquement.
- **Déménagements** : un jeune adulte vivant chez ses parents, ou un couple à l'étroit, s'installe
  spontanément dans une maison libre, afin que construire des maisons débloque réellement les naissances.
- **Construction instantanée**, démolition remboursée à 50 %, hôtel de ville indestructible.

## Limites connues

- Pas de son ni de musique.
- Une seule sauvegarde manuelle (plus la sauvegarde automatique et l'export illimité en fichiers).
- Les gestes tactiles sont pris en charge mais l'expérience est pensée d'abord pour la souris.
