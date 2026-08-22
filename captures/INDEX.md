# Relevés de transparence IA — 22 août 2026

> **AVERTISSEMENT — AUCUN RELEVÉ EXPLOITABLE N'A PU ÊTRE PRODUIT.**
> Les trois pages cibles n'ont pas pu être chargées : la politique de sortie
> réseau de l'environnement d'exécution refuse la connexion vers ces hôtes.
> Les fichiers JSON présents dans ce dossier sont les **constats d'échec**
> horodatés produits par l'outil — ils ne décrivent en rien le comportement
> des sites concernés.

## Tableau des relevés

| Cible | Éditeur détecté | Widget ouvert | Fichier JSON | Capture page | Capture widget |
|---|---|---|---|---|---|
| https://yourkaya.pl/ | *(aucun — page non chargée)* | non | `captures/yourkaya-pl_2026-08-22T01-20-14.json` | *(non produite)* | *(non produite)* |
| https://www.procosmet.com/en | *(aucun — page non chargée)* | non | `captures/www-procosmet-com-en_2026-08-22T01-20-21.json` | *(non produite)* | *(non produite)* |
| https://reedsy.com/ | *(aucun — page non chargée)* | non | `captures/reedsy-com_2026-08-22T01-20-26.json` | *(non produite)* | *(non produite)* |

Les captures PNG ne figurent pas dans ce dossier parce que la navigation
échoue avant l'étape de capture : le script lève l'erreur sur `page.goto()`,
donc aucune image n'est écrite. C'est le comportement normal de l'outil.

## Premier message affiché, mot pour mot

- **yourkaya.pl** : *non relevé — page non chargée*
- **procosmet.com** : *non relevé — page non chargée*
- **reedsy.com** : *non relevé — page non chargée*

**Aucun texte n'est cité ici, parce qu'aucun texte n'a été lu.**

## Anomalies rencontrées

1. **Blocage réseau à la source (les trois cibles).** Le proxy de sortie de
   l'environnement répond `403` à la requête `CONNECT` pour `yourkaya.pl:443`,
   `www.procosmet.com:443` et `reedsy.com:443`. Chromium remonte
   `net::ERR_TUNNEL_CONNECTION_FAILED`. Vérifié aussi hors navigateur, avec
   `curl` : même refus, `CONNECT tunnel failed, response 403`.
   Il s'agit d'une **restriction de la politique de sortie de l'environnement
   d'exécution**, pas d'une protection anti-bot des sites visés, et pas d'un
   défaut du script. Aucun contournement n'a été tenté.

2. **Aucune conclusion sur les sites.** `editeur_detecte: []` et
   `widget_ouvert: false` dans les trois JSON sont la conséquence mécanique du
   point 1. Ces valeurs **ne doivent pas** être lues comme une information sur
   la présence, l'absence ou le comportement d'un chatbot sur ces sites.

3. **Fichier de synthèse partiel.** `_synthese_2026-08-22.json` ne contient que
   la dernière cible exécutée : le script réécrit ce fichier à chaque
   invocation, et les trois relevés ont été lancés en trois commandes séparées,
   conformément à la consigne (une locale par cible). Les trois relevés
   individuels sont complets.

## Conditions d'exécution

- Outil : `capture-chatbot.mjs` (racine du dépôt), exécuté **sans aucune
  modification**.
- Node.js v22.22.2 — Playwright **1.56.1** — Chromium **141.0.7390.37**
  (build 1194 pré-installé dans l'environnement).
- Commandes lancées, telles quelles :
  ```
  node capture-chatbot.mjs https://yourkaya.pl/          --lang pl-PL --wait 12000
  node capture-chatbot.mjs https://www.procosmet.com/en  --lang it-IT --wait 12000
  node capture-chatbot.mjs https://reedsy.com/           --lang en-GB --wait 12000
  ```
- L'outil a été vérifié fonctionnel : lancé sur un hôte autorisé, Chromium
  démarre, navigue et écrit son relevé JSON normalement.

## Pour refaire les relevés

Sur une machine dont l'accès Internet n'est pas filtré :

```bash
npm install playwright@1.56.1
npx playwright install chromium
node capture-chatbot.mjs https://yourkaya.pl/          --lang pl-PL --wait 12000
node capture-chatbot.mjs https://www.procosmet.com/en  --lang it-IT --wait 12000
node capture-chatbot.mjs https://reedsy.com/           --lang en-GB --wait 12000
```

*Relevé automatisé. Aucune qualification juridique. Diagnostic technique et
documentaire — ne constitue pas un avis juridique.*
