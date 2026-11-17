# Plateforme web universelle CAO · SIG · Topographie — synthèse

*État au 16 novembre 2026. Ce document résume l'analyse, ce que le prototype prouve, ses limites et la suite proposée. Les rapports détaillés des experts sont dans [`docs/experts/`](experts/).*

## 1. Réponse à la question : est-ce possible ?

**Oui.** Le prototype de ce dépôt ouvre de vrais fichiers DWG dans le navigateur, sans serveur et sans installation, les superpose à des données SIG dans un système de coordonnées commun, génère un plan topographique à partir d'un fichier de points et l'imprime en PDF à l'échelle, du A4 au A0.

Ce qui a été vérifié, et comment :

| Capacité | Vérification | Résultat |
|---|---|---|
| Lecture DWG dans le navigateur | 13 fichiers d'essai publics (R14, 2000, 2004, 2007, 2010, 2013, 2018) + vos 2 plans réels (AutoCAD 2013) | Tous lus ; vos plans s'ouvrent en moins d'une seconde |
| Fidélité de lecture | Affichage de vos 2 plans comparé à vos PDF | En-tête, cadre, bornes, côtés, tableau, courbes, plans de situation présents ; limites au § 3 |
| Système de coordonnées | Détection sur vos fichiers, région « Cameroun » | UTM 32 Nord proposé « à confirmer », position calculée à Yaoundé (3,861° N, 11,554° E) |
| Superposition CAO + SIG | Plan en UTM 32 N + GeoJSON en longitude/latitude | Recalage exact à l'écran ; aller-retour de projection au millimètre |
| Génération de plan | Levé d'exemple de 150 points | Bornes, parcelle (superficie, côtés), bâtiments, voirie, courbes de niveau, légende, tableau |
| PDF à l'échelle | A4 portrait et A3 paysage au 1/500 | PDF vectoriel, textes sélectionnables |
| Export DXF | Relecture du DXF produit, et contrôle par un second lecteur indépendant (LibreDWG) | Mêmes entités, calques, blocs, attributs ; emprise identique au millimètre |
| Tests automatiques | `npm test` | 16 tests passent |

Non vérifié à ce jour : ouverture du DXF exporté dans AutoCAD et Covadis eux-mêmes (aucun des deux n'est disponible dans l'environnement de développement) ; comportement sur de très gros fichiers (plus de 50 Mo) ; téléphones.

## 2. La « synthèse de langages » qui rend cela possible

Aucun langage unique ne lit le DWG dans un navigateur. La solution est un assemblage :

```
Fichier DWG ──► Décodeur LibreDWG (langage C, compilé en WebAssembly)
                 exécuté dans un worker isolé ──► DXF (format d'échange public)
                                                    │
Fichier DXF ────────────────────────────────────────┤
                                                    ▼
                          Lecteur DXF du projet (TypeScript)
                                                    │
SHP, GeoJSON, KML, GPX ──► lecteurs SIG ────────────┤
Fichier de points ──► analyse, codes, MNT ──────────┤
                                                    ▼
                 Modèle unifié : jeux de données → calques → entités
                 (chaque jeu garde son système de coordonnées d'origine)
                                                    │
                       reprojection à la volée (proj4js)
                                                    ▼
                     Liste d'affichage unique (polylignes, surfaces,
                     points, textes) dans le système du projet
                          │                │                 │
                          ▼                ▼                 ▼
                    Écran (Canvas)   PDF vectoriel     Exports DXF, GeoJSON,
                    sélection,       à l'échelle       KML, CSV
                    mesures          A4 → A0
```

- **WebAssembly** fait tourner dans le navigateur du code C existant et éprouvé (LibreDWG aujourd'hui, GDAL demain) à vitesse proche du natif.
- **TypeScript** porte tout le reste : modèle de données, géométrie, lecteurs texte, interface.
- **Une seule liste d'affichage** alimente l'écran, le PDF et les exports : ce qui est vu est ce qui est imprimé et exporté.
- **Tout est local** : les fichiers ne quittent pas l'appareil. C'est un avantage de confidentialité (données foncières), de coût (pas de serveur de calcul) et d'usage (connexion faible).

## 3. Limites actuelles, sans détour

| Sujet | État | Conséquence |
|---|---|---|
| Écriture DWG | Absente. Aucune bibliothèque fiable n'écrit le DWG dans un navigateur | Export en DXF, à enregistrer en DWG depuis AutoCAD ; service de conversion prévu |
| Objets Covadis et Civil 3D (« proxy ») | Non décodés (1 objet dans chacun de vos plans), signalés dans l'interface | Les entités AutoCAD standard (blocs de points, polylignes, textes) sont lues ; les objets propriétaires non |
| Masques (WIPEOUT) | Non rendus (73 dans le plan de Mimboman), signalés | Des traits normalement masqués sous un texte restent visibles |
| Mise en forme interne des textes multilignes | Gras, italique et changements de hauteur ignorés | Certains titres apparaissent plus petits que dans AutoCAD |
| Hachures à motif | Rendues comme une teinte translucide | L'aspect diffère, la surface est juste |
| Types de ligne (tiretés) | Tracés en continu | Aspect seulement |
| Polices SHX | Remplacées par une police sans empattement | Largeur des textes approchée |
| Présentations (espace papier) | Ignorées : seul l'espace objet est lu | Les plans mis en page dans l'espace objet (vos deux fichiers) sont complets |
| Très gros fichiers | Moteur d'affichage Canvas 2D | Fluide sur des plans de quelques Mo ; moteur WebGL prévu pour les centaines de milliers d'entités |
| Précision géodésique | proj4js, sans grilles ; le R.G.N.C est assimilé à WGS 84 | Suffisant pour afficher et superposer ; à affiner avant d'annoncer une précision centimétrique entre référentiels |
| Plan de situation | Non généré | À dessiner ou à importer ; génération depuis OpenStreetMap prévue |
| Profils en long et en travers, cubatures, projets VRD | Absents | Phase suivante |
| Carnets de terrain (GSI, JXL), LandXML, GeoPackage, MapInfo | Absents | Prévus (voir l'écran « Extensions ») |
| Instructions en langage naturel | Mots-clés, pas un modèle de langage | Comprend échelle, format, orientation, courbes, parcellaire, numéros, altitudes, tableau, légende ; affiche ce qu'il a compris |
| Impression d'un DWG contenant des objets isolés loin du plan | Le cadrage « tout le dessin » les inclut | Cadrer la vue à l'écran puis choisir « Vue affichée à l'écran » |

## 4. Ce que disent les experts

Sept rapports ont été produits (le huitième, sur le moteur de rendu, a été interrompu par une limite d'utilisation et n'est pas disponible).

**Lecture DWG** ([rapport](experts/01-lecture-dwg-navigateur.md)). LibreDWG en WebAssembly est la seule voie libre côté navigateur. Aucune brique n'écrit le DWG dans le navigateur. Pour l'écriture : DXF côté client, puis conversion par un service (ACadSharp, licence MIT, ou ODA Drawings SDK, environ 7 500 $ puis 4 500 $ par an pour un usage web). Les objets Civil 3D et Covadis ne sont décodés par aucune brique libre.

**Formats SIG et géodésie** ([rapport](experts/02-formats-sig-geodesie.md)). Parseurs légers pour les formats courants, GDAL en WebAssembly chargé à la demande pour le reste (GeoPackage, MapInfo, GML). proj4js projette au sous-millimètre ; l'erreur vient des changements de référentiel sans grille. La détection du système d'un DWG par plages de coordonnées et zone d'usage est la bonne méthode ; le fuseau UTM ne se devine pas sans connaître le pays.

**Métier** ([rapport](experts/04-metier-topographie.md)). Les trois ruptures les plus coûteuses : DWG sans système de coordonnées, points et MNT propriétaires, passage du DWG aux livrables réglementaires. Les 15 fonctions prioritaires sont reprises dans la feuille de route ci-dessous.

**Architecture** ([rapport](experts/05-architecture-logicielle.md)). Garder TypeScript, le worker isolé et le traitement local. Conserver la géométrie exacte dans le système natif de chaque fichier. Prévoir un worker « document », le stockage local des projets (OPFS), une application installable hors-ligne, puis une synchronisation par versions avant toute co-édition temps réel.

**Marché** ([rapport](experts/06-concurrence-marche.md)). Aucun acteur ne réunit DWG natif, carte géoréférencée, traitement local et prix accessible. La CAO web ignore les systèmes de coordonnées ; le SIG web traite le DWG comme un import dégradé. Positionnement proposé : « le plan topo DWG et la carte SIG dans le même onglet, géoréférencés, sans téléverser un seul fichier, en français ».

**Licences** ([rapport](experts/07-licences-juridique.md)). LibreDWG est sous GPL-3. Le distribuer au navigateur est une distribution : ses sources doivent être accessibles. L'isoler dans un worker séparé qui n'échange que du DXF est l'architecture la plus prudente, mais ce n'est pas une garantie juridique. « Compatible avec le format DWG » peut se dire ; DWG ne doit figurer ni dans un nom de produit ni dans un nom de domaine.

**IA et innovation** ([rapport](experts/08-ia-et-innovation.md)). Aucun acteur ne pilote par agent un moteur CAO + SIG dans le navigateur. Bon découpage : le modèle de langage interprète la demande et choisit les opérations ; les calculs (surfaces, triangulation, courbes) restent des algorithmes déterministes. Fonctions à forte valeur : géoréférencement automatique, contrôle avant livraison, implantation GNSS depuis un téléphone Android.

## 5. Conformité au cahier des charges « assistant de production de plans »

| Section | État | Détail |
|---|---|---|
| 2. Import et analyse (TXT, CSV, XYZ, ASC) | Fait | Séparateur, en-tête, ordre des colonnes ; question posée si l'ordre X/Y est ambigu ; colonnes modifiables |
| 3. Contrôle qualité | Fait en grande partie | Doublons d'identifiant et de position, coordonnées nulles, points éloignés, altitudes manquantes, négatives, nulles ou aberrantes. Reste : répartition spatiale, polygones ouverts |
| 4. Reconnaissance des codes | Fait | Dictionnaire modifiable et mémorisé, synonymes, suffixes (BAT1), fautes de frappe signalées « à confirmer » ; jamais de liaison par simple proximité |
| 5. Questionnaire contextuel | Partiel | Seules les questions utiles sont posées (colonnes, système) ; les renseignements du plan sont mémorisés. Pas encore de dialogue conduit par une IA |
| 6. Types de plans | Partiel | Topographique, topographique et altimétrique, parcellaire. Reste : plan de situation, VRD |
| 7. Génération du dessin | Fait | Calques nommés, couleurs, épaisseurs, symboles en blocs, coordonnées intactes |
| 8. Mise en page | Fait | A4 à A0, portrait/paysage, échelles normalisées, modèle cadastral camerounais et cartouche générique, croisillons, nord, légende, tableau, échelle graphique |
| 9. Production en un clic et par instruction | Partiel | Bouton « Analyser et générer mon plan » ; phrase en français interprétée par mots-clés |
| 10. Plusieurs plans | Partiel | Plusieurs formats PDF d'un coup ; régénération avec d'autres options. Pas encore plusieurs plans distincts dans un même projet |
| 11. Formats de sortie | Partiel | DXF, PDF, CSV, GeoJSON, KML. Reste : DWG (service), LandXML, TXT réorganisé |
| 12. Contrôle final | Partiel | Compte rendu de génération et note d'ajustement à la feuille. Reste : chevauchement des textes, liste de contrôle complète |
| 13. Interface | Fait pour l'essentiel | Dépôt de fichier, aperçu, anomalies, codes, instruction, paramètres, aperçu du plan, téléchargements. Reste : modifications par instruction après génération |
| 14. Architecture | Fait | L'interprétation est séparée des calculs, qui sont déterministes et testés |
| 15. Règle fondamentale | Respectée | Rien n'est inventé ni corrigé en silence ; les limites construites sont signalées « à valider par le géomètre » |
| 18. Catalogue d'extensions | Amorcé | Registre des capacités (intégrées et prévues) qui pilote réellement l'import. Pas d'installation automatique de modules externes |

## 6. Architecture cible et feuille de route

**Phase 1 — prototype (ce dépôt).** Lecture DWG, DXF, SIG ; superposition ; génération de plan ; PDF ; exports.

**Phase 2 — produit utilisable au quotidien.**
1. Dessin et édition : points, polylignes, textes, déplacement, suppression, annuler/rétablir, accrochages complets (milieu, intersection, perpendiculaire).
2. Projets enregistrés sur l'appareil, application installable et utilisable hors-ligne.
3. Calage d'un plan local sur deux points connus (Helmert).
4. Plan de situation généré depuis OpenStreetMap ; placement des textes sans chevauchement.
5. Fidélité DWG : masques, hachures à motif, types de ligne, mise en forme des textes multilignes, présentations.
6. Modèles de plan par pays et par cabinet (en-têtes, mentions, logos).

**Phase 3 — fonctions Covadis.**
1. Profils en long et en travers, cubatures entre deux surfaces, lignes de rupture dans le MNT.
2. Codification complète (codes de début et de fin de ligne, symboles orientés).
3. Carnets de terrain (Leica GSI, Trimble JXL), LandXML.
4. GDAL en WebAssembly pour GeoPackage, MapInfo, GML ; orthophotos de drone et nuages de points.
5. Service de conversion DXF → DWG.
6. Moteur d'affichage WebGL pour les très gros dessins.

**Phase 4 — au-delà.**
1. Assistant piloté par un modèle de langage sur le registre des commandes (les calculs restent déterministes).
2. Contrôle automatique avant livraison ; géoréférencement assisté sur fond de carte.
3. Partage par lien, historique des versions, travail à plusieurs.
4. Implantation GNSS depuis un téléphone Android.

## 7. Décisions qui vous reviennent

1. **Licence du produit.** Ouvert (GPL) : LibreDWG s'utilise sans réserve. Fermé : faire valider le montage « worker séparé » par un juriste, ou financer un décodeur commercial. Tant que ce n'est pas tranché, le dépôt n'a pas de licence déclarée.
2. **Priorité métier.** Plans cadastraux camerounais (modèles officiels, mentions du MINDCAF et de l'ordre des géomètres) ou outil généraliste francophone d'abord.
3. **Assistant IA.** Brancher un modèle de langage suppose une clé d'API et un coût par usage ; à décider avec le modèle économique.
4. **Nom.** « AppStock Géo » est un nom de travail. Le mot DWG ne doit pas figurer dans le nom du produit ni dans le nom de domaine.
5. **Hébergement.** Le prototype est un site statique : n'importe quel hébergeur de fichiers suffit.
