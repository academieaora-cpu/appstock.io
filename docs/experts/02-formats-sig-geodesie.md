# Pile SIG navigateur — état au 15 nov. 2026

**[V]** vérifié en session (registre npm, GitHub, EPSG) · **[S]** supposé, non revérifié (budget de recherche épuisé).

## 1. GDAL-WASM
- **gdal3.js** : stable 2.8.1 (févr. 2024) = GDAL 3.8.4 / PROJ 9.3.1 / GEOS 3.12.1, LGPL-2.1+ ; `.wasm` 28,2 Mo + `.data` 11,6 Mo (11,7 Mo gzip). 3.0.0-beta.4 (mai 2026) rebâtie sur cpp.js, wasm32 mono/multi-thread ≈ 31 Mo. API de niveau « applications » (ogr2ogr, gdal_translate, gdalwarp, gdal_rasterize), sans accès entité par entité [V].
- Pilotes présents : Shapefile, GPKG, GeoJSON, KML, GPX, GML, MapInfo, FlatGeobuf, DXF, DGN, CSV, PMTiles, GTiff ; COG et PDF en écriture seule. **Absents : DWG, ECW, JP2, LAS/LAZ, Parquet, PDF en lecture** [V]. LandXML et IFC n'existent pas dans GDAL ; DGN limité à la v7 [S].
- Alternatives : loam abandonné (2022) ; @cpp.js/package-gdal encore en bêta ; geos-wasm figé depuis déc. 2024 (LGPL-3) ; DuckDB-WASM actif (MIT) [V].
- Limites : wasm32 = 4 Go ; memory64 livré dans Chrome 133 et Firefox 134, Safari non confirmé [V] ; fichiers en mémoire virtuelle, pas d'OPFS natif ; multi-thread = en-têtes COOP/COEP [S].
- **Verdict : bon convertisseur de secours chargé à la demande, pas une base « tout lire / tout écrire ».**

## 2. Format → bibliothèque

| Format | Lecture | Écriture |
|---|---|---|
| Shapefile | shpjs 6.2 (sans `.prj`, sinon reprojection WGS84 forcée) | GDAL-WASM |
| GeoJSON, CSV PNEZD, LandXML | natif / parseur maison | maison |
| GeoPackage | sql.js 1.16 ou sqlite-wasm ; @ngageoint/geopackage 4.2.10 (lecture d'après son README) | GDAL-WASM |
| KML/KMZ, GPX | @tmcw/togeojson 7.1.3 | @placemarkio/tokml 0.4 ; GPX maison |
| GML, TAB/MIF, DGN v7 | GDAL-WASM | GDAL-WASM |
| FlatGeobuf | flatgeobuf 4.6.1 | idem |
| GeoParquet | hyparquet 1.33 | hyparquet-writer 0.18 |
| GeoTIFF/COG | geotiff.js 3.0.5 | GDAL-WASM |
| LAS/LAZ/COPC | copc 0.0.9 + laz-perf 0.0.7 | LAS maison |
| IFC | web-ifc 0.0.79 (MPL-2.0) | idem |
| JP2, PDF géoréférencé | OpenJPEG-WASM ; pdf.js [S] | PDF : GDAL-WASM |
| WMS/WMTS/WFS/XYZ, PMTiles | OpenLayers [S] ; pmtiles 4.5 | — |
| ECW, DWG, DGN v8 | serveur (SDK propriétaires) [S] | — |

À éviter : `shapefile` 0.6.6 (2017), @mapbox/togeojson et @mapbox/shp-write (2023), loam [V].

## 3. Projections
- **proj4js 2.23.0** (nov. 2026, MIT) : chaînes PROJ, WKT, PROJJSON ; grilles NTv2 `.gsb` et GeoTIFF du CDN PROJ via geotiff.js ; pivot WGS84 ; aucune grille verticale documentée [V] → géoïde non géré [S].
- **proj-wasm 0.1.0** (oct. 2026, MIT) : PROJ complet, proj.db 10,6 Mo + wasm 3,7 Mo ; grilles téléchargées depuis cdn.proj.org, **aucune grille locale** ; mono-thread ; « nouveau, ruptures possibles », un seul contributeur [V].
- Précision [S] : projections identiques à PROJ au sous-millimètre ; l'erreur vient du changement de datum. NTF→RGF93 à 3 paramètres : 1 à 5 m ; avec la grille gr3df97a (`ntf_r93.gsb`) : décimétrique. proj4js assimile RGF93 à WGS84 (écart réel ≈ 0,9 m en 2026) ; seul PROJ gère les transformations datées.
- France : 2154 (RGF93 v1 / Lambert-93), 9793 (v2), 9794 (v2b), 10499 (v2b + NGF-IGN69), transformations 9876/9877 avec `fr_ign_RAF20.tif` [V]. CC42–CC50 = 3942–3950, NTF 4275, Lambert II étendu 27572, NGF-IGN69 5720, EGM2008 3855 [S].
- Afrique : UTM WGS84 28N–33N = 32628–32633 ; Abidjan 1987 = 4143 (UTM 30N = 2041) ; Locodjo 1965 = 4142 ; Adindan = 4201 (UTM 20135–20138) ; Hanoi 1972 = 4147 [V]. Yoff 4310, Conakry 1905 4315, Nord Sahara 1959 4307, Manoca 1962 4193 [S, à contrôler sur epsg.org]. Datums Clarke 1880 : précision métrique inhérente [S].
- Altimétrie : faisable côté client, via PROJ-WASM ou interpolation bilinéaire maison de RAF20/EGM2008 lus par geotiff.js [S].

## 4. Détection du CRS sans .prj [S]
1. Lire les métadonnées internes (objet GEODATA du DWG, code Map 3D/Civil 3D).
2. Filtrer par plages : Lambert-93 X 0,1–1,25 M, Y 6,0–7,2 M ; CC : le chiffre des millions de Y donne la zone (CC49 → Y ≈ 8,2 M) ; Lambert II étendu Y 1,6–2,7 M ; zone UTM indéterminable sans le pays.
3. Classer les candidats : reprojeter l'emprise, tester l'inclusion dans la zone d'usage EPSG (emprises exposées par proj.db [V]), pondérer par pays.
4. Valider sur fond ortho/OSM ; pour les coordonnées locales, calage sur 2 points (Helmert 2D) et contrôle d'unité.

Outils existants : projfinder.com, epsg.io.

## 5. Gros volumes
- Plafonds : 4 Go en wasm32 [V] ; chaîne JS ≈ 512 Mo sous V8, donc `JSON.parse` impossible au-delà [S].
- Ordres de grandeur [S] : objets GeoJSON jusqu'à 200–500 k entités ; au-delà, tableaux typés + WebGL (quelques millions) ; COPC indispensable au-delà de ~30 M points.
- Index : flatbush 4.7 (statique), rbush 4.0.1 (dynamique, édition) ; geojson-vt 5.0.4 pour l'affichage [V].
- Lecture partielle par requêtes de plage : COG, COPC, PMTiles, FlatGeobuf, GeoParquet [V] ; idem en local avec `File.slice()` [S].

## 6. Recommandation
**MVP** : parseurs légers en chargement immédiat + proj4js avec table EPSG embarquée (définitions et emprises extraites de proj.db), grilles `ntf_r93.gsb` et RAF20 auto-hébergées + flatbush/rbush + gdal3.js 2.8.1 en worker, chargé à la demande (TAB/MIF, GML, DGN, exports SHP/GPKG/COG).

**Cible** : build GDAL-WASM maison (GDAL récent, OpenJPEG, Parquet, OPFS) ; PROJ-WASM comme moteur de référence ; micro-service réservé à DWG, ECW, DGN v8.

**Risques** : gdal3.js stable figé sur GDAL 3.8.4 ; obligations LGPL ; proj-wasm jeune, sans hors-ligne ; Safari sans memory64 ; aucune voie libre côté client pour ECW/DWG ; COOP/COEP incompatibles avec certains flux tiers.

## Sources
- https://github.com/bugra9/gdal3.js
- https://github.com/willcohen/clj-proj
- https://github.com/proj4js/proj4js
- https://registry.npmjs.org/ (versions, dates, licences, tailles des paquets cités)
- https://cnig.gouv.fr/IMG/pdf/ign_2026-03-26_geopos_refgeodesique_sig_v2.pdf
- https://epsg.io/9794 · https://epsg.io/9876 · https://epsg.io/4143 · https://spatialreference.org/ref/epsg/10499
- https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html
- https://bugs.webkit.org/show_bug.cgi?id=300538

Hôtes bloqués en session : api.github.com, cdn.jsdelivr.net.
