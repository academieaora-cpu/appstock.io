# Architecture plateforme web CAO + SIG — état au 15/11/2026

Légende : **[V]** vérifié en source cette session ; **[R]** recommandation de conception ; **[NV]** connaissance non revérifiée. Recherche seule : aucun fichier ni dépôt modifié.

## 1. Avis sur les décisions du prototype

- **TypeScript + Vite** : à garder [R].
- **LibreDWG-WASM en worker isolé → DXF → parseur maison** : défendable (un seul chemin de lecture, frontière nette avec le code GPL). Quatre réserves :
  - LibreDWG est GPL-3 [V]. L'isolation en worker est une pratique revendiquée par realdwg-web [V], pas une garantie juridique. Prendre un avis juridique et servir le worker comme module séparé à sources publiées [R].
  - Le DXF texte intermédiaire risque de doubler le pic mémoire. À mesurer sur un DWG de 200 Mo [R].
  - La lecture couvre toutes les versions DWG, mais certains objets R2010+ échouent [V]. Prévoir une conversion serveur de secours [R].
  - L'écriture DWG est limitée à R2000 (R2004 selon le README) et désactivée dans le build par défaut de libredwg-web [V]. Exporter en R2000 avec un build dédié, ou côté serveur [R].
- **CRS d'origine par jeu + reprojection à la volée** : bon choix, trois pièges.
  - Une reprojection non affine détruit les primitives CAO (un arc n'est plus un arc). Garder la géométrie exacte dans le CRS natif, ne reprojeter que les sommets tessellés, éditer dans le CRS du jeu [R].
  - proj4js fait Helmert + grilles NTv2/GeoTIFF avec pivot WGS84 [V], mais pas les pipelines PROJ entre référentiels quelconques [V]. Afficher la précision attendue, embarquer les grilles hors-ligne, proposer PROJ-WASM en V1 [R].
  - Les DWG arrivent souvent sans CRS : prévoir affectation + calage Helmert sur points [R].
- **WebGL2 sur-mesure** : OK. Coordonnées relatives à une origine locale calculée en float64 (float32 ≈ 0,5 m de résolution sur des ordonnées UTM) [NV]. Textes, types de ligne et hachures seront le vrai coût.
- **Tout en local** : à garder ; serveur strictement optionnel.

## 2. Modèle de données

Approches existantes :
- Le modèle « feature » OGC ignore arcs, blocs et styles ; le modèle DXF ignore schéma attributaire et CRS.
- Speckle sépare propriétés, géométrie d'affichage (`displayValue`) et instances/définitions ; sa version 2026.9 passe à des objets plats + propriétés en colonnes [V].
- GeoArrow (geoarrow-js 0.2, pensé pour l'interop WASM) [V] convient aux couches SIG, pas aux courbes CAO.
- IFC est hors sujet (BIM) ; l'ECS est une organisation mémoire, pas un modèle d'échange.

Modèle proposé [R] :

```
Projet  { crs, unités, jeux[] }
Jeu     { source{fichier OPFS, format, hash}, crs|null, calage?, schéma{champs typés},
          calques[], blocs[], typesLigne[], stylesTexte[] }
Calque  { nom, type: cao|entités|raster|nuage, style, visible/verrouillé }
Entité  { id stable, calque, genre, géom exacte, style?, attrs?, natif? }
genre   = point | chemin(segments ligne/arc/bulge/spline) | cercle | ellipse | texte
        | hachure(contours) | insertion(bloc, matrice, attributs) | cote | (multi)polygone
natif   = charge opaque conservée telle quelle (codes DXF, XDATA, handles, champs inconnus)
```

Le sans-perte repose sur trois règles : fichier source conservé intact ; entité non modifiée ré-émise depuis `natif` ; entité modifiée régénérée. Toute conversion dégradante (arc→polyligne, bloc éclaté vers SHP) produit un rapport de pertes. Stockage en colonnes (tableaux typés par calque) ; les tampons de rendu sont un cache dérivé.

## 3. Exécution

```
Thread principal  : UI, saisie, ligne de commande, appels WebGL2 uniquement
   ▲ Transferable (tampons sommets/index/ids)
Worker document   : magasin d'entités, transactions, index spatial, accrochage, journal → OPFS
Workers import/export : parseurs en flux, tessellation, reprojection, GDAL-WASM à la demande
Worker GPL isolé  : LibreDWG
Service worker    : appli + moteurs WASM hors-ligne
OPFS              : sources, projet, caches paginés
```

- **Zéro-copie** : Transferable par défaut. SharedArrayBuffer exige COOP+COEP, et `credentialless` manque dans Safari [V], ce qui contraint les fonds de carte tiers. Ne pas en dépendre [R].
- **Mémoire** : wasm32 plafonne à 4 Go. Memory64 existe dans Chrome 133 et Firefox 134, limité à 16 Go, 10 à plus de 100 % plus lent ; Safari ne l'a qu'en 27.3 bêta [V]. Sur iPhone : environ 1,5 Go par processus, parfois 300 Mo fiables [V]. Concevoir hors-mémoire (pagination OPFS, niveaux de détail), sans Memory64 [R].
- **OPFS** : accès synchrone réservé aux workers, disponible partout depuis 2023 [V]. Safari purge le stockage d'un site après 7 jours d'usage sans interaction ; l'appli installée a son propre compteur [V]. D'où PWA installée + `persist()` + export de sauvegarde [R].
- **Référence** : GeoLibre bascule en tuilage dans un worker au-delà de 50 000 entités et lit COG/PMTiles/FlatGeobuf par requêtes Range [V].

## 4. Local-first et synchronisation

- Figma : dernier-écrivain-gagne par propriété, serveur ordonnanceur, « pas un CRDT » ; tldraw sync : serveur autoritaire, une salle par Durable Object [V].
- Automerge 3 divise la mémoire par plus de 10, Loro a des instantanés superficiels, Yjs 14 est en cours [V]. Rien de démontré sur des millions d'entités géométriques.

Recommandé [R] : journal d'opérations + serveur ordonnanceur, dernier-écrivain-gagne par (entité, propriété), géométrie atomique. Hors-ligne : file locale rejouée à la reconnexion, conflits géométriques signalés. Versions : instantanés adressés par contenu + journal. Avant le temps réel, synchro asynchrone « pousser/tirer une version ».

## 5. Moteur d'édition [R]

- Toute mutation est une transaction produisant opérations + inverses : la même structure sert à annuler/rétablir, à la synchro et à l'historique.
- Accrochage : index spatial dans le worker, requête en rayon-pixel, modes extrémité/milieu/centre/intersection/perpendiculaire, calcul dans le CRS projet.
- Commandes : machines à états asynchrones consommant des jetons (point, nombre, option) ; ligne de commande et tactile alimentent les mêmes commandes.
- Plugins : bac à sable (worker/iframe) + API transactionnelle, en V1.

## 6. Serveur minimal [R]

- Un service API (TypeScript), PostgreSQL, relais WebSocket.
- Stockage objet compatible S3 avec URL pré-signées. MinIO communautaire est archivé depuis 2026 ; alternatives Garage ou SeaweedFS [V].
- Conteneur de conversion à la demande (GDAL + convertisseur DWG).
- Tuiles statiques PMTiles/COG par Range, sans serveur de tuiles. Felt fait ainsi : pipeline GDAL/Tippecanoe → PMTiles sur CDN [V].
- OIDC ou lien magique ; partage par jeton signé à portée et expiration ; chiffrement côté client des paquets projet (foncier).

## 7. Langages [R]

- **TypeScript** : UI, modèle, commandes, rendu, parseurs texte (DXF, GeoJSON, KML), synchro.
- **C/C++ existant via Emscripten**, jamais réécrit : LibreDWG, et GDAL/PROJ/GEOS (gdal3.js 2.8 [V]) pour la longue traîne, en chargement paresseux. Contre-exemple : LibreCAD complet en WASM pèse 18 Mo compressés [V], trop lourd pour le terrain.
- **Rust→WASM** : seulement sur points chauds mesurés (tessellation, booléens, LAZ), pas avant V1.

## 8. Feuille de route

1. **Prototype** : import DXF/DWG/GeoJSON/SHP, superposition, rendu. À dérisquer tout de suite : banc 200 Mo sur PC modeste, Android et iPhone ; corpus d'aller-retour automatisé ; avis GPL.
2. **MVP** : worker document, OPFS, PWA hors-ligne, dessin/accrochage/attributs/calques, annuler/rétablir, export DXF/GeoJSON/SHP/GPKG/KML, calage, rapport de pertes.
3. **V1** : GDAL-WASM, GeoTIFF/LAS avec niveaux de détail, export DWG, serveur optionnel (comptes, partage, synchro par versions), plugins.
4. **Cible** : co-édition temps réel, historique/branches, WebGPU, noyau Rust, mode terrain GNSS.

**Risques majeurs** : mémoire mobile ; fidélité et licence DWG ; précision géodésique ; purge du stockage ; dérive « tous formats » (prioriser, déléguer à GDAL) ; rendu textes/hachures.

**Non vérifié** (quota de recherche atteint) : détail Onshape (microversions, extrait seul), COPC/LAZ, licence ODA, état des serveurs de synchro Yjs.

## Sources

- Memory64 : https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html
- Safari 27.3 bêta / 27 : https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes · https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes
- Mémoire iOS : https://bugs.webkit.org/show_bug.cgi?id=269777
- OPFS : https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle
- Stockage Safari : https://webkit.org/blog/14403/updates-to-storage-policy/ · https://openpwa.net/reference/storage/safari-seven-day-cap/
- COEP : https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy · https://andrewlock.net/understanding-security-headers-part-3-cross-origin-embedder-policy/
- Figma : https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/ · https://www.figma.com/blog/figma-rendering-powered-by-webgpu/
- tldraw : https://tldraw.dev/docs/sync
- CRDT : https://automerge.org/blog/automerge-3/ · https://loro.dev/blog/v1.0 · https://github.com/yjs/y-simple-attribution-server
- DWG : https://github.com/LibreDWG/libredwg · https://github.com/mlightcad/libredwg-web · https://mlightcad.github.io/realdwg-web/
- LibreCAD WASM : https://osarch.org/2026/07/06/librecad-webassembly-browser-port/
- GeoLibre : https://geolibre.app/tutorials/source-code-deep-dive-en/
- Speckle : https://docs.speckle.systems/developers/object-model/overview · https://docs.speckle.systems/developers/data-schema/object-schema
- GeoArrow : https://geoarrow.org/geoarrow-js/
- Projections : https://proj4js.org/ · https://proj.org/en/stable/usage/transformation.html · https://github.com/3liz/proj4rs
- Felt : https://felt.com/blog/upload-anything
- MinIO : https://auroraiq.cloud/en/blog/minio-archived-object-storage-alternatives
- Onshape : https://www.onshape.com/en/blog/under-the-hood-how-collaboration-works
