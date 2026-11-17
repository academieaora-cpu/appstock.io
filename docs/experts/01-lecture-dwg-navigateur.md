# DWG dans le navigateur : état au 15/11/2026

Légende : **[V]** vérifié sur source, **[S]** supposé ou non testé. Aucun fichier ni dépôt modifié.

## 1. Comparatif

| Brique | Licence | Lecture DWG | Écriture DWG | Navigateur | Activité |
|---|---|---|---|---|---|
| LibreDWG 0.14 | GPL-3.0+ | Toutes versions ; certains objets R2010+ ignorés [V] | Sauf R2007 ; R2010-2018 : erreurs CRC [V] | Via portage | Release 27/06/2026, commit 13/11/2026 [V] |
| @mlightcad/libredwg-web 0.9.0 | GPL-3.0 | R14 à 2018 (vos tests) | Non, DWG vers DXF seulement | WASM 7,8 Mo ; lot worker ~13 Mo [V] | Actif |
| mlightcad cad-viewer / realdwg-web 1.7.8 | MIT, sauf convertisseur DWG | Via convertisseur GPL en Web Worker, ou parseur propriétaire [V] | Non ; « Save to DXF » [V] | 100 % client | 02/11/2026, 1,3k étoiles, projet personnel [V] |
| @mlightcad/dwg-converter (propriétaire) | 3 000 $ perpétuel, puis 1 500 $/an pour les mises à jour [V] | « Broader coverage », ~437 Ko, pas d'OOM [V, déclaratif] | Non | Oui | Sans sources ni SLA [V] |
| ACadSharp 3.8.35 (.NET) | MIT | AC1014 à AC1032 [V] | AC1014 à AC1032 [V] | Non démontré [S] | NuGet 28/10/2026 [V] |
| acadrust 0.4.x (Rust) | MPL-2.0 | R13 à R2018 [V, README] | R13 à R2018 [V, README] | Non démontré [S] | Jeune |
| libdxfrw | GPL-2.0+ | R14 à 2015, « rudimentaire » [sources secondaires] | Non | Portage mlightcad déprécié [V] | À écarter |
| ODA Drawings SDK | Commercial 3 000 $ + 2 250 $/an ; Sustaining 7 500 $ + 4 500 $/an, Open Cloud inclus [V] | Référence | Référence | Open Cloud (serveur + client) | Industriel |
| APS Model Derivative | 0,1 jeton Flex par job simple, 0,5 par job complexe [V] | Oui, cloud Autodesk | Non | Viewer | Industriel |
| MxCAD | Commercial, ~2 800 $/an [S, source tierce] | Oui, C++ en WASM [V] | Non vérifié | Oui | Éditeur chinois |

Couverture mlightcad [V, feuille de route du README] :
- **Cochés** : lignes, polylignes, arcs, cercles, ellipses, splines, TEXT/MTEXT, HATCH, cotes, blocs, XDATA et dictionnaires d'extension, proxies, espace papier, viewports.
- **Non cochés** : entités custom, LOD, rendu tuilé des très gros dessins, intégration carte (OpenLayers).
- **3DSOLID/ACIS** : partiel (filaire ou boîte englobante).
- Le README admet pour la voie LibreDWG : couverture « limited », démarrage lent, mémoire élevée, OOM possible sur très gros fichiers.

## 2. Écriture DWG

- Aucune brique navigateur n'écrit du DWG [V pour mlightcad et libredwg-web].
- LibreDWG en écriture : seuls R2000/R2004 sont crédibles [S, non testé].
- Stratégie réaliste : DXF produit côté client (MIT), DWG produit côté serveur. D'abord un microservice ACadSharp (MIT), puis ODA Drawings SDK quand le revenu le permet. Le SaaS exige le niveau Sustaining [source secondaire].
- Pour ne rien perdre : rejouer côté serveur le « change set » de cad-viewer [V, fonction existante] sur le DWG d'origine, plutôt que réécrire tout le fichier depuis un modèle partiel [S, à prototyper].

## 3. Filet de sécurité serveur

- **ODA File Converter** : pour les non-membres, usage non commercial uniquement [V] ; usage « service bureau » interdit [source secondaire]. Inutilisable en SaaS commercial sans adhésion.
- **LibreDWG dwg2dxf natif** : pas de plafond mémoire WASM. La GPL ne s'appliquerait pas sans distribution [S, à valider juridiquement].
- **APS** : prix du jeton non confirmé (3 $ en 2021) ; le classement du DWG en « simple » est une inférence [S] ; quota gratuit mensuel limité [V] ; les fichiers partent chez Autodesk.

## 4. Pièges

- **R2007 (AC1021)** : LibreDWG ne l'écrit pas [V]. Ne jamais le cibler en sortie.
- **Proxies Civil 3D / Covadis** : aucune brique ouverte ne décode les objets AEC ; au mieux le graphique proxy enregistré [S]. ODA vend « Civil for DWG SDK » à 10 000 $ [V].
- **SHX** : mlightcad charge les polices depuis jsDelivr par défaut, auto-hébergement documenté [V] ; police métier absente = substitution [S].
- **Codepages** : LibreDWG convertit ~30 codepages en UTF-8 [V] ; tester les accents ANSI_1252.
- **Grandes coordonnées** (Lambert 93, CC) : recentrage sur une origine locale à vérifier dans le rendu WebGL [S].
- **Mémoire** : aucun benchmark public 50-200 Mo trouvé ; test de charge obligatoire [S].
- **GPL** : l'isolation par Web Worker est la thèse de mlightcad, qui précise « not legal advice » [V].
- **ODA** : la fin d'abonnement fait perdre le droit de distribuer [V].

## 5. Recommandation

**MVP lecture** : `@mlightcad/cad-simple-viewer` + `data-model` (MIT), DWG via `libredwg-converter` en Web Worker (publier les sources du worker), avec repli automatique sur un `dwg2dxf` natif côté serveur en cas d'échec, d'OOM ou de gros fichier. En parallèle, demander l'essai du parseur propriétaire (réservé aux sociétés) et le mesurer sur de vrais fichiers topo. L'acheter si le gain est confirmé ou si la GPL bloque.

**Cible lecture + écriture** : édition sur `data-model`, export DXF client, service serveur DXF/change set vers DWG. ACadSharp d'abord, ODA Sustaining ensuite, extension Civil seulement si la demande le justifie.

**Plan B** : APS Model Derivative pour visualiser les fichiers illisibles ; MxCAD si mlightcad s'arrête ; fork possible, le cœur étant MIT.

**Risques principaux** : mainteneur unique chez mlightcad ; GPL ; mémoire sur gros fichiers ; pertes au round-trip ; qualité réelle des DWG écrits par ACadSharp non testée.

## Non vérifié

Crate Rust `dwg`, ODA Web SDK (taille WASM), prix du jeton Flex, compilation WASM d'ACadSharp et d'acadrust, couverture individuelle de LEADER, IMAGE, 3DFACE et ATTRIB.

## Sources

- https://github.com/mlightcad/cad-viewer
- https://github.com/mlightcad/cad-viewer/blob/main/PROPRIETARY-PARSER.md
- https://github.com/mlightcad/realdwg-web
- https://github.com/mlightcad/libredwg-web
- https://github.com/LibreDWG/libredwg
- https://github.com/DomCR/ACadSharp
- https://www.nuget.org/packages/ACadSharp
- https://docs.rs/crate/acadrust/0.4.1
- https://docs.rs/crate/acadrust/0.3.3/source/Cargo.toml
- https://www.opendesign.com/pricing.md
- https://www.opendesign.com/node/3218
- https://opendesign.com/join
- https://www.opendesign.com/agreements/2025/en/ODA%20Community%20User%20Agreement%2009-2025.pdf
- https://aps.autodesk.com/pricing
- https://aps.autodesk.com/node/3776
- https://wiki.osarch.org/libdxfrw/
- https://www.sourceforge.net/software/product/MxCAD
