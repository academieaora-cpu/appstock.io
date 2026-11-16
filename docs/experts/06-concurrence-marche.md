# Plateforme web CAO + SIG : analyse concurrentielle (état au 15/11/2026)

**Conclusion :** aucun acteur ne réunit DWG natif, carte géoréférencée, traitement local et prix accessible ; le créneau est ouvert, mais deux projets récents (mlightcad, GeoLibre) en occupent chacun une moitié.

Légende : **V** = vérifié sur source ce jour ; **S** = supposé ou non vérifié. Recherche écourtée : une partie de la liste demandée n'a pas été contrôlée (voir fin).

## 1. Tableau concurrentiel

| Produit | DWG | SIG | Édition | Local | Prix | Limite principale |
|---|---|---|---|---|---|---|
| AutoCAD Web | natif | non | 2D | non (cloud ; hors-ligne mobile) | dès 9 $/mois (V) | ni fond de carte ni reprojection documentés (S) |
| mlightcad | lecture | non | basique | oui | MIT ; parseur DWG propriétaire 3 000 $ + 1 500 $/an (V) | DWG libre = LibreDWG GPL-3 ; pas de carte |
| MxCAD / ODA | complet | non | oui | non | ~2 800 $/an ; 7 500 $ + 4 500 $/an (autre expert) | SDK, pas un produit métier |
| Felt | import DWG/DXF | oui | oui | non | 199 $/mois pour 3 sièges ; offre gratuite sans import (V) | emplacement « deviné » sans SCR ; objets Civil 3D ignorés (V) |
| Atlas.co | DXF (DWG : S) | oui | oui | non | 23 à 72 $/utilisateur/mois (V) | pas orienté plan topo |
| ArcGIS Online | via Pro (S) | oui | oui | non | 125 à 400 $/an selon profil ; Creator non affiché (V) | écosystème lourd |
| GeoLibre | non | oui | oui | oui (PWA) | gratuit, MIT (V) | aucune CAO ; jeune |
| QGIS / qgis-js | import bureau | oui | non | rendu WASM seul (V) | gratuit | pas de version navigateur officielle (V) |
| Global Mapper | oui | oui | oui | bureau | 599 / 1 199 / 2 199 $/an (V) | pas de version web mentionnée (V) |
| Covadis + Sogelink Connect | natif | partiel | bureau | bureau | non publié ; catalogue revendeur 3 815 € HT (V, non daté) + AutoCAD | exige AutoCAD ; Connect = visionneuse cloud (V) |
| MyGeodata | conversion | conversion | non | non | 5 Mo/mois gratuits ; 7 à 39 $/mois (V) | ni visualisation ni édition |
| Pix4Dcloud / DroneDeploy / Cesium ion | non | 3D | non | non | 1 290 à 4 490 $/an ; 4 188 $/an ; 149 à 524 $/mois (V) | niche drone/3D |

Aperçus partiels (V) : Speckle affiche un DWG téléversé dans sa visionneuse web ; Equator (109 $/mois) exporte DWG/DXF/SHP, données nord-américaines.

## 2. Trou de marché

- **CAO web** (AutoCAD Web, mlightcad, MxCAD) : pas de SCR, de fond de carte ni de formats SIG.
- **SIG web** (Felt, Atlas, ArcGIS Online, GeoLibre) : le DWG est un import dégradé. Felt le documente lui-même (V). Aucun export DWG constaté (S).
- **Douleur attestée** : questions récurrentes sur le géoréférencement DWG/DXF dans QGIS (GIS StackExchange, GeoRezo, ticket QGIS #55096) (V).
- **Local** : seuls mlightcad et GeoLibre évitent le téléversement, chacun d'un seul côté du pont (V).
- **Prix** : la chaîne classique coûte AutoCAD 2 095 $/an plus Covadis ; Felt 199 $/mois. Inaccessible pour un cabinet africain (S).
- **Français natif et terrain hors-ligne** pour topographes : aucun acteur identifié (S).

## 3. Briques et concurrents potentiels

- **Briques** : mlightcad (MIT, V) ; LibreDWG (GPL-3, V : contaminant pour un produit fermé) ; GDAL, PROJ/proj4js, MapLibre, OpenLayers, DuckDB-WASM, Potree/COPC, mapshaper (licences permissives de mémoire, S).
- **Concurrents rapides** : GeoLibre s'il ajoute le DWG, mlightcad s'il ajoute la carte, Felt (importe déjà le DWG), Autodesk, Sogelink Connect.

## 4. Marché et prix

- **France** : 1 878 géomètres-experts et 10 000 salariés en cabinet (V). Covadis revendique 20 000 utilisateurs annuels dans plus de 10 pays (V), meilleur repère du cœur de cible. Élargi au BTP, aux collectivités et aux géomaticiens : 30 000 à 50 000 (S).
- **Afrique francophone** : aucun chiffre consolidé trouvé. La FGF fédère 27 à 30 organisations (V). Ordre de grandeur : quelques milliers de géomètres inscrits, dizaines de milliers de techniciens (S).
- **Licences** :
  - AutoCAD : 2 095 $/an ou 260 $/mois (V) ; AutoCAD LT ~460 €/an (V, cité par un concurrent).
  - Global Mapper : 599 à 2 199 $/an, abonnement depuis septembre 2026 (V).
  - Covadis : ~3 815 € HT la première licence (catalogue non daté), désormais abonnement sur devis.
  - Mensura : prix public non trouvé.

## 5. Recommandation

**Positionnement :** « Le plan topo DWG et la carte SIG dans le même onglet, géoréférencés, sans téléverser un seul fichier, en français, au prix d'un forfait mobile. »

**Avantages défendables**
1. Pont CAO↔SIG aller-retour (calques, blocs, attributs, SCR francophones : Lambert-93, CC, UTM africains).
2. Traitement 100 % local : confidentialité, faible débit, hors-ligne, coût serveur quasi nul donc prix bas tenable.
3. Français natif et distribution africaine (paiement mobile, tarif régional, formation).

**Modèle (S, à tester)** : freemium (visualiser, superposer, mesurer en local) ; Pro par siège à 15-25 €/mois en Europe et 5-8 €/mois en Afrique ; packs cabinet ; crédits pour traitements lourds (nuages de points, conversions par lot).

**Risques**
1. Fidélité DWG : LibreDWG est sous GPL et sa couverture est incertaine (S) ; un parseur fiable coûte 3 000 à 7 500 $ et plus.
2. Riposte d'un acteur financé (Felt, Autodesk, Sogelink) ou d'un projet libre (GeoLibre).
3. Faible consentement à payer : des « activations à vie » de Covadis 2027 se vendent sur des groupes Facebook BTP (V) ; inertie AutoCAD/Covadis en France.

## Non contrôlés (S)

DWG FastView, ShareCAD, Bricsys 24/7, nanoCAD, Onshape, CADmapper, GstarCAD 365, CAD Pockets web, CARTO, kepler.gl, geojson.io, Placemark, Mergin Maps, GIS Cloud, Géoportail, TopoCal, Carlson, Trimble Connect, Leica, Propeller, Civil 3D/ACC, iTwin, CloudConvert, AnyConv.

## Sources

- https://www.autodesk.com/products/autocad-web/overview
- https://www.autodesk.com/solutions/autocad-subscription-faq
- https://github.com/mlightcad/cad-viewer
- https://github.com/mlightcad/cad-viewer/blob/main/PROPRIETARY-PARSER.md
- https://felt.com/pricing
- https://help.felt.com/upload-anything/files/supported-file-types
- https://atlas.co/pricing/
- https://www.esri.com/en-us/arcgis/products/arcgis-online/buy
- https://github.com/opengeos/GeoLibre/blob/main/docs/comparison.md
- https://conference.qgis.org/schedule/
- https://www.bluemarblegeo.com/purchase/
- https://www.sogelink.com/fr-fr/solutions/covadis/
- https://www.calameo.com/books/003634627be94a9f4c55d
- https://zwcad.fr/
- https://mygeodata.cloud/pricing
- https://cesium.com/platform/cesium-ion/pricing/
- https://www.birdi.io/blog-post/propeller-vs-dronedeploy-vs-pix4d-vs-birdi
- https://speckle.systems/integrations/autocad/
- https://equatorstudios.com/equator-pricing-plan-update/
- https://www.geometre-expert.fr/nous-connaitre/chiffres-cles/
- http://gltn.net/partners/federation-des-geometres-francophones-fgf
- https://gis.stackexchange.com/questions/371203/georeferencing-imported-dwg-layer-using-qgis
- https://georezo.net/forum/viewtopic.php?id=98217
- https://github.com/qgis/QGIS/issues/55096
- https://www.facebook.com/groups/1575901416019925/posts/4528255224117848/
