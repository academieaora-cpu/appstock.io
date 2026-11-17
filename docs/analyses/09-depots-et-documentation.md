# Analyse des dépôts et de la documentation fournis (17 novembre 2026)

Sources demandées : trois dépôts GitHub (Open CASCADE Technology, JellyCAD, Autodesk Machine
Control Framework), sept manuels Covadis et AutoPiste, la documentation AutoCAD 2025 et des cours
AutoCAD. Ce document dit ce que chaque source apporte à la plateforme, ce qui a été intégré dans
cette version, et ce qui reste à faire. Aucun texte des manuels n'est recopié : les fonctions sont
décrites avec nos mots.

## 1. Ce qui a pu être lu

| Source | Accès | Ce qui en a été tiré |
|---|---|---|
| github.com/Open-Cascade-SAS/OCCT | lu (page et métadonnées) | noyau de CAO 3D en C++, LGPL-2.1, très actif |
| github.com/Jelatine/JellyCAD | lu | CAO programmable Qt6 + OCCT 7.9 + Lua 5.4, MIT |
| github.com/Autodesk/AutodeskMachineControlFramework | lu | intergiciel CAO/FAO ↔ machines, BSD-3-Clause d'après le dépôt |
| Covadis v16.4 Projets VRD (geniecivilpdf) | table des matières et procédures | plates-formes, cubatures, assainissement |
| Covadis v16.5 Projets linéaires (geniecivilpdf) | table des matières et procédures | axe en plan, tabulation, profils types |
| Covadis v16.3 Modélisation 3D (scribd) | partiel | MNT, courbes, transformation 2D/3D, profils |
| Manuel AutoPiste Covadis 18 (scribd) | sommaire et procédures | enchaînement complet d'un projet routier |
| Covadis v17.1 Topographie, v17.2 Dessin assisté (pdfcoffee) | **non accessible** (visionneuse sans texte) | rien, par prudence : aucune fonction n'est attribuée à ces manuels |
| Covadis v17.4 Projets VRD (scribd) | **non accessible** | idem |
| Guide de démarrage rapide (support.sogelink.fr) | lu | ne traite que de l'installation réseau (fichier de licence) |
| help.autodesk.com (ACD 2025, page GUID-E56B90DC…) et cours AutoCAD | **non accessibles** depuis l'environnement de développement (pages dynamiques, liens morts) | la correspondance des commandes AutoCAD ci-dessous repose sur le jeu de commandes standard, bien connu et stable |

Pour compléter l'inventaire Topographie et Dessin assisté, il suffit de déposer les PDF v17.1 et
v17.2 dans la conversation : ils seront lus directement.

## 2. Open CASCADE Technology (OCCT)

**Ce que c'est.** Le noyau de modélisation 3D libre de référence : géométrie exacte (B-rep), solides,
booléens, congés, extrusions, maillage, et surtout les échanges STEP, IGES, STL, glTF, BREP. C'est
lui qui fait tourner FreeCAD, KiCad 3D, JellyCAD et de nombreux logiciels industriels.

**Licence.** LGPL-2.1 avec exception. On peut l'utiliser dans un produit fermé à condition qu'il
reste un module séparé, remplaçable par l'utilisateur. C'est exactement le schéma déjà appliqué au
module DWG (LibreDWG en GPL, isolé dans son propre worker).

**Dans le navigateur.** Il existe des compilations WebAssembly maintenues : opencascade.js (environ
9 Mo compressés) et occt-wasm (environ 4,5 Mo compressés, primitives, booléens, volumes, maillage,
STEP en entrée et en sortie). Faisable, mais lourd : à charger seulement quand on en a besoin.

**Ce qu'il apporte à la topographie.** Rien pour le levé 2D, le MNT ou les courbes : nos calculs
propres sont plus légers et déjà exacts. En revanche, il devient utile pour :

- les volumes d'ouvrages (murs, bassins, bâtiments) et les booléens entre solides ;
- les échanges avec la CAO mécanique et le BIM (STEP, IGES) ;
- les métrés de solides et les coupes 3D.

**Décision.** Module « Noyau 3D » chargé à la demande dans un worker isolé, inscrit au registre des
extensions avec le statut « prévu ». Ce n'est pas une priorité tant que le dessin 2D et les projets
VRD ne sont pas complets.

## 3. JellyCAD

**Ce que c'est.** Un logiciel de CAO programmable pour développeurs et roboticiens : on écrit un
script Lua (`box.new`, `cylinder.new`, `fuse`, `cut`, `prism`, `export_step`…) et la pièce est
construite par OCCT. Il exporte aussi des descriptions de robots (URDF, MJCF). Application de bureau
Qt6, licence MIT, sans version web.

**Ce qu'on ne reprend pas.** Le code lui-même : il dépend de Qt et d'un environnement de bureau, et
son métier (pièces mécaniques, robots) n'est pas la topographie.

**Ce qu'on reprend : l'idée que le dessin est un programme.** C'est l'étape « avant d'automatiser »
que vous décriviez : on dessine à la main, puis on rejoue. Intégré dans cette version :

- **Outils › Exécuter un script** : chaque ligne est une saisie de la ligne de commande (nom de
  commande, coordonnées, valeur, option), comme un fichier .scr d'AutoCAD ;
- à l'invite « Choix des objets », **T** (tout) et **D** (dernier objet), pour que les scripts
  puissent enchaîner une commande sur l'objet qu'ils viennent de créer.

Prochaine étape : un atelier de scripts en JavaScript isolé, où chaque commande du logiciel devient
une fonction (`ligne(a, b)`, `polyligne([...])`, `profilEnLong(axe, {pas: 10})`), pour que
l'assistant IA produise des scripts vérifiables plutôt que des dessins opaques.

**Architecture.** JellyCAD sépare géométrie, exécution des scripts, application, services et
interface, et propose une exécution sans interface (CLI). Notre découpage est le même
(`core`, `edit`, `topo`, `ui`) ; l'exécution sans interface existe déjà pour la conversion DWG
(`scripts/dwg2dxf.mjs`) et servira à la génération de plans par lots.

## 4. Autodesk Machine Control Framework

**Ce que c'est.** Un intergiciel qui relie la CAO/FAO aux machines (fabrication additive
notamment) : serveur avec interface web, extensions C++, pilotes de matériel avec simulateurs,
machines d'état versionnées, journal complet de chaque opération rejouable à la milliseconde.

**Pertinence directe.** Faible : aucune fonction topographique.

**Concepts repris pour le hub d'extensions (module 18).**

- *Pilote + simulateur* : chaque appareil de terrain (station totale, récepteur GNSS) aura un pilote
  et un simulateur, pour tester sans matériel. Inscrit au registre : « Pilotes d'instruments »
  (Web Serial, Web Bluetooth), statut « prévu ».
- *Journal rejouable* : notre historique d'annulation enregistre déjà chaque modification ; il pourra
  devenir un journal d'audit (qui a modifié quoi, quand), utile pour un dossier de bornage.
- *Configurations versionnées* : les bibliothèques de codes terrain et de symboles devront être
  versionnées pour qu'un plan ancien se régénère à l'identique.

## 5. Documentation Covadis et AutoPiste : inventaire fonctionnel

Légende : ✓ disponible dans la plateforme · ◐ partiel · ○ à faire.

### Topographie et dessin

| Fonction | État | Commande |
|---|---|---|
| Chargement d'un semis de points, contrôle, codification, dessin automatique | ✓ | SEMIS |
| Point topographique avec matricule et altitude (bloc compatible) | ✓ | PT |
| Rayonnement, distance et gisement, coordonnées | ✓ | RAY, DG, ID |
| Implantation depuis une station (gisement, distance, lecture) | ✓ nouveau | IMP |
| Polygonale, relèvement, intersection, transformation de Helmert | ○ | |
| Carnets de terrain (GSI, JXL, RW5) | ○ | |
| Symboles, numérotation des sommets, tableau des coordonnées, surfaces | ✓ | SY, NS, TC, ES |
| Talus (hachures crête / pied) | ✓ nouveau | TAL |
| Carroyage dans le dessin | ✓ nouveau | CAR |
| Division de parcelle à surface imposée | ✓ nouveau | DIV |
| Cartouche, cadre, mise en page multi-formats | ✓ | NOUVEAUPLAN, MEP |

### Modélisation 3D

| Fonction | État | Commande |
|---|---|---|
| MNT par triangulation des points cotés | ✓ | MNT |
| Courbes de niveau et cotation des maîtresses | ✓ | CN |
| Informations sur le MNT (surfaces plane et réelle, altitudes) | ✓ nouveau | INFOMNT |
| Transformation 2D → 3D par le MNT | ✓ nouveau | 2D3D |
| Lignes de rupture (MNT contraint), périmètre imposé | ○ | |
| Profil entre deux MNT, moyenne de deux polylignes, grille de modification | ○ | |

### Projets VRD (plates-formes, cubatures, réseaux)

| Fonction | État | Commande |
|---|---|---|
| Cubatures terrain / plateforme horizontale, dans un contour | ✓ nouveau | CUB |
| Plates-formes inclinées, talus calculés, entrées en terre | ○ | |
| Recherche d'équilibrage déblai / remblai | ○ (simple à ajouter : recherche de l'altitude) | |
| Listings et métrés | ◐ (tableau des cubatures) | |
| Réseaux d'assainissement : canalisations, nœuds, regards, profils, hydraulique | ○ | |

### Projets linéaires (voirie) et AutoPiste

| Fonction | État | Commande |
|---|---|---|
| Axe en plan : droites et arcs | ◐ (polyligne + raccord) | PL, RA |
| Liaisons clothoïdes | ○ | |
| Tabulation de l'axe | ✓ nouveau | PFT |
| Profil en long du terrain naturel avec guitare | ✓ nouveau | PFL |
| Profils en travers du terrain naturel | ✓ nouveau | PFT |
| Ligne rouge, dévers, profils types, couches de chaussée | ○ | |
| Cubatures par profils, tracé combiné | ○ | |

### Enchaînement type d'un projet de voirie (lu dans les manuels)

1. MNT du terrain naturel ;
2. axe en plan (droites, arcs, liaisons) puis tabulation ;
3. profil en long du terrain, puis ligne rouge du projet ;
4. profils types (couches, matériaux, dévers) affectés par zones ;
5. calcul : emprises, entrées en terre, MNT projet ;
6. dessins (plan, profil en long, profils en travers) et cubatures.

Les étapes 1, 2 (sans clothoïdes) et le terrain naturel des étapes 3 et 6 sont maintenant couverts.

## 6. AutoCAD : correspondance des commandes

| AutoCAD | Plateforme | | AutoCAD | Plateforme |
|---|---|---|---|---|
| LINE | LIGNE (L) | | MOVE / COPY | DEPLACER (D) / COPIER (CO) |
| PLINE | POLYLIGNE (PL) | | ROTATE / SCALE | ROTATION (RO) / ECHELLE (EC) |
| POLYGON / RECTANG | POLYREG / RECTANGLE (REC) | | MIRROR / OFFSET | MIROIR (MI) / DECALER (DC) |
| CIRCLE / ARC | CERCLE (C) / ARC (A) | | EXPLODE | DECOMPOSER (X) |
| POINT / MLINE | POINT (PO) / MULTILIGNE (ML) | | **TRIM** | **AJUSTER (AJ, TR)** nouveau |
| TEXT / HATCH | TEXTE (TE) / HACHURES (H) | | **EXTEND** | **PROLONGER (PRO, EX)** nouveau |
| DIMALIGNED | COTE (COT) | | **FILLET** | **RACCORD (RA)** nouveau |
| ERASE | EFFACER (E) | | **SCRIPT** | **Exécuter un script** nouveau |
| AREA / ID / DIST | AIRE (AI) / ID / DISTGIS (DG) | | UNDO / REDO | ANNULER (U) / RETABLIR |

Encore absents et prévus : CHAMFER (chanfrein), BREAK (coupure), JOIN (joindre), STRETCH (étirer
une zone), ARRAY (réseau), LENGTHEN, cotations linéaire, angulaire et de rayon, MTEXT, LEADER
(ligne de repère), insertion de blocs depuis une bibliothèque, copie des propriétés (MATCHPROP).

## 7. Intégré dans cette version

- Modification : **Ajuster**, **Prolonger**, **Raccord** (deux lignes ou tous les angles d'une
  polyligne). Intersections exactes avec les arcs de polylignes, les arcs et les cercles.
- Topo 2D : **Talus**, **Carroyage**, **Division de parcelle** (parallèle ou pivot).
- Topo Calculs : **Implantation** (tableau sur le plan et carnet CSV).
- Topo 3D : **Transformation 2D → 3D**, **Informations sur le MNT**.
- Nouveau menu et onglet **Projets** : **Profil en long**, **Profils en travers**, **Cubatures**.
- Outils : **Exécuter un script** ; « T » et « D » à l'invite de choix des objets.
- Manuel intégré : trois nouveaux guides (retouche, projets, scripts) ; chaque commande a sa fiche.
- 18 nouveaux tests automatiques (50 au total), dont des contrôles de volumes et de surfaces exacts.

Principe tenu partout : aucun résultat n'est inventé hors des données. Une partie d'axe ou de
contour hors du MNT est signalée et exclue, jamais extrapolée.

## 8. Feuille de route proposée

1. **Court terme (dessin complet)** : chanfrein, coupure, joindre, étirer ; cotations linéaire,
   angulaire, rayon ; équilibrage déblai/remblai ; lignes de rupture dans le MNT.
2. **Terrain** : carnets GSI/JXL, polygonale et compensation, transformation de Helmert ;
   pilotes d'instruments avec simulateurs.
3. **Voirie et VRD** : clothoïdes, ligne rouge, profils types, cubatures par profils ; réseaux
   d'assainissement (canalisations, regards, profils réseau).
4. **3D** : module OCCT à la demande (solides, STEP, IGES) ; nuages de points.
