# AppStock Géo

Plateforme web pour la topographie et la géomatique : ouvrir des plans DWG et DXF, les superposer à des données SIG, générer un plan à partir d'un fichier de points et l'imprimer en PDF à l'échelle — le tout dans le navigateur, sans installation. « AppStock Géo » est un nom de travail.

**Prototype.** L'analyse complète, les limites et la feuille de route sont dans [`docs/SYNTHESE.md`](docs/SYNTHESE.md).

## Ce que fait le prototype

- **Ouvrir** : DWG (R14 à 2018), DXF, Shapefile, GeoJSON, KML/KMZ, GPX, fichiers de points TXT/CSV/XYZ.
- **Superposer** : chaque fichier garde son système de coordonnées ; tout est reprojeté à la volée dans celui du projet. Le système d'un DWG qui n'en déclare pas est proposé automatiquement (UTM, Lambert…), à confirmer.
- **Consulter** : calques, sélection d'un objet (dimensions, attributs), mesures de distance et de surface avec accrochage, fond de carte.
- **Générer un plan** (assistant) : reconnaissance des colonnes, contrôle des données, dictionnaire de codes terrain, points en blocs `TCPOINT` comme dans Covadis, lignes par codes, parcelle bornée (côtés, superficie, tableau de coordonnées), modèle de terrain et courbes de niveau.
- **Imprimer** : PDF vectoriel à l'échelle, A4 à A0, modèle de plan cadastral camerounais ou cartouche générique, plusieurs formats d'un coup.
- **Exporter** : DXF (calques, blocs, attributs), GeoJSON, KML, CSV.
- **Reprendre plus tard** : sauvegarde automatique sur l'appareil, projets nommés, fichier `.geoprojet`, et enregistrement en ligne facultatif dans un compte.

Les fichiers sont traités sur l'appareil. Rien n'est envoyé, sauf si l'utilisateur choisit d'enregistrer un projet en ligne.

## Lancer

```bash
npm install     # installe aussi le décodeur DWG dans public/plugins/
npm run dev     # application sur http://localhost:5173
npm test        # tests automatiques
npm run build   # site statique dans dist/
```

Node 20 ou plus récent. Le résultat de `npm run build` est un site statique : il se dépose chez n'importe quel hébergeur de fichiers.

## Organisation

| Dossier | Rôle |
|---|---|
| `src/core/` | Modèle de données unifié CAO + SIG, géométrie, systèmes de coordonnées, projet, sauvegarde |
| `src/io/` | Lecture (DXF, DWG, SIG) et exports ; registre des capacités |
| `src/topo/` | Fichiers de points, codes terrain, modèle de terrain, génération du dessin, mise en page |
| `src/render/` | Liste d'affichage, tracé écran et PDF, vue interactive, fond de carte |
| `src/ui/` | Interface : écran principal, assistant, mise en page, projets |
| `src/cloud/` | Enregistrement en ligne facultatif (Supabase) et maintien en vie |
| `plugins/dwg-libredwg/` | Décodeur DWG isolé (LibreDWG en WebAssembly, GPL-3.0) |
| `supabase/migrations/` | Schéma du service en ligne |
| `docs/` | Synthèse et rapports des experts |

## Décodeur DWG et licence

La lecture du DWG repose sur LibreDWG (GPL-3.0), compilé en WebAssembly. Il est tenu à l'écart du reste du code : un worker séparé reçoit un DWG et renvoie un DXF, lu ensuite par le lecteur du projet. Voir [`plugins/dwg-libredwg/README.md`](plugins/dwg-libredwg/README.md) et la section licences de la synthèse. Le dépôt n'a pas encore de licence déclarée : c'est une décision à prendre.

## Service en ligne et maintien en vie

L'enregistrement en ligne utilise un projet Supabase (table `geo_projects`, bucket privé `geo-projects`, un dossier par utilisateur, accès limité au propriétaire). Un projet Supabase gratuit est mis en pause après une semaine sans activité ; deux « bips » l'évitent :

- l'application envoie, au plus une fois toutes les 12 heures, une requête vide (`geo_ping`) ;
- la tâche planifiée [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml) fait de même deux fois par jour, même si personne ne se connecte. Elle ne s'exécute que depuis la branche par défaut du dépôt.

## Limites connues

Pas d'écriture DWG (export en DXF) ; objets propriétaires Covadis et Civil 3D non décodés ; hachures à motif, types de ligne et mise en forme interne des textes simplifiés ; pas encore de profils, de cubatures ni de carnets de terrain. Le détail est dans la synthèse.
