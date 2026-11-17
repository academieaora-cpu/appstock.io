**Plateforme web topographie/géomatique : analyse métier.** Recherche seule, aucun fichier écrit. **V** = vérifié par source ; **E** = jugement d'expert.

**Constat** : le DWG est le pivot du métier, mais points, MNT et système de coordonnées (SCR) y sont implicites et propres à chaque éditeur [E]. Sogelink vend déjà un cloud compagnon (Sogelink Connect : consultation mobile, annotations) lié à son écosystème [V]. Il faut donc se différencier par le calcul et l'édition dans le navigateur, la neutralité de format, le hors-ligne et le prix [E].

## 1. Ruptures par étape

| Étape | Logiciels / formats | Rupture |
|---|---|---|
| Levé | Leica GSI, Trimble JXL, RW5, SDR, CSV | Un format par constructeur ; ordre des colonnes (PNEZD/PENZD) et codes ambigus [E] |
| Calcul | Covadis, TBC, Infinity, TopoCal | Observations brutes perdues dès l'export en coordonnées ; recalcul impossible [E] |
| Dessin, codification | Covadis, Civil 3D, Mensura | Points Covadis = bloc TCPOINT, attributs MAT/ALT/COD [V] ; objets Civil 3D = proxy hors Civil 3D [V] |
| MNT, profils, cubatures | idem, Global Mapper | MNT Covadis = Faces 3D ou « objet MNT » propriétaire [V] ; LandXML, seul pont, perd styles et profils [E] |
| DAO vers SIG | QGIS, ArcGIS, Global Mapper | DWG sans SCR déclaré [E] ; attributs de blocs non lus par QGIS (ticket #56992, titre seul consulté) |
| Livrables réglementaires | PCRS, StaR-DT (GML) | Passage du DWG au GML structuré : forte ressaisie [E] |
| Diffusion client | PDF, DWG | Client sans AutoCAD ni visionneuse géoréférencée [E] |

Les trois plus douloureuses [E] : SCR absent du DWG, points/MNT propriétaires, DWG vers GML réglementaire.

## 2. Qui fait quoi
- **Covadis** : applicatif AutoCAD, inutilisable sans lui [V]. Carnets, calculs, codification, foncier (documents d'arpentage, RFU, copropriété), MNT, profils, VRD, réseaux, exports IFC/LandXML/SHP/PCRS [V]. Abonnement seul depuis le 30/06/2024, prix sur devis [V]. Usage de XDATA/dictionnaires : probable, non vérifié [E].
- **Global Mapper** : 300+ formats en lecture/écriture, raster, altimétrie, nuages de points, moteur géodésique GeoCalc [V]. Ni calcul topométrique, ni foncier, ni habillage de plan français [E].
- **Mensura** : moteur graphique autonome, sans AutoCAD, orienté VRD/terrassement/BIM [V].
- **Civil 3D** : objets dynamiques, mais « Export to AutoCAD » leur fait perdre leur intelligence [V].

## 3. MVP : 15 fonctions, priorité décroissante [E]
1. Ouvrir DWG/DXF sans AutoCAD : pivot de tous les échanges.
2. Reconnaître les points topo (TCPOINT, COGO, CSV) dans un modèle unique matricule/X/Y/Z/code.
3. Gérer les SCR et reprojeter (Lambert 93, CC, UTM, locaux) : première source d'erreurs.
4. Importer SHP, GeoJSON, KML, GPKG, LandXML avec attributs.
5. Exporter DWG/DXF/SHP/GeoJSON/CSV : supprime l'aller-retour Covadis–Global Mapper.
6. Importer les carnets (GSI, JXL, RW5, SDR) et le PNEZD paramétrable.
7. Calques, accrochage, mesures de distance, surface, gisement.
8. Dessiner et éditer points, polylignes 2D/3D, blocs, textes.
9. Codification : lignes et symboles générés depuis les codes terrain.
10. MNT (triangulation, lignes de rupture) et courbes de niveau.
11. Profils en long et en travers.
12. Cubatures déblai/remblai entre deux surfaces.
13. Fonds de plan : orthophoto, cadastre, WMS/WMTS.
14. Calage Helmert d'un plan local.
15. Mise en page, cartouche, PDF à l'échelle : le livrable final reste un plan signé.

## 4. Aller au-delà, priorisé [E]
1. Géoréférencement automatique d'un DWG sans SCR (emprise, cadastre, points connus).
2. Conversion universelle avec rapport explicite des pertes.
3. Contrôle qualité automatique : doublons, Z aberrants, polygones non fermés, charte de calques, conformité PCRS/classe A.
4. Lien de partage client (visualiser, mesurer, commenter) sans compte.
5. Synchronisation terrain–bureau sur mobile, hors-ligne compris.
6. Historique des versions et comparaison de plans.
7. IA : codification assistée, vectorisation de PDF/scans, génération du GML réglementaire.
8. Conservation des observations brutes pour recalcul et traçabilité.

## 5. Contraintes de terrain
- **Connectivité** : fin 2021, 39 % de la population d'Afrique centrale et 16 % en Afrique de l'Ouest hors couverture haut débit mobile [V, donnée ancienne]. D'où application installable hors-ligne, synchronisation différée, calcul côté client [E].
- **Piratage** : logiciels sans licence en 2015 : Algérie 83 %, Cameroun 82 %, Côte d'Ivoire 80 %, Sénégal 75 % [V, source secondaire]. D'où prix local, paiement mobile, offre gratuite [E].
- **Autres** [E] : coordonnées en double précision sans simplification silencieuse ; systèmes locaux à paramètres personnalisés ; fichiers lourds en flux ; données foncières chiffrées avec traitement local possible ; PC modestes et smartphones.

## 6. Livrables prioritaires
- **France** : PCRS v2.0, obligatoire dans les réponses DT-DICT depuis le 01/01/2026 là où il existe [V] ; StaR-DT en GML [V] ; récolement classe A (≤ 40 cm rigide, ≤ 50 cm flexible ; échéances 2020/2026/2032) [V] ; DWG selon charte, PDF [E].
- **Afrique francophone** : dossier technique signé par un géomètre agréé (Sénégal : NICAD obligatoire ; Cameroun : géomètre ONGEC) [V, extraits]. Tableau de coordonnées des bornes, rattachement au réseau géodésique national, PDF + DWG + CSV [E].

**Non vérifié** : prix Covadis, formats de carnets lus par Covadis, exigences cadastrales détaillées par pays.

## Sources
- https://www.sogelink.com/fr-fr/solutions/covadis/
- https://www.sogelink.com/fr-fr/solutions/mensura/
- https://www.topographie.net/logiciels/fiche.php?id=Covadis
- https://www.hexabim.com/solutions/covadis
- https://georezo.net/forum/viewtopic.php?id=125673
- https://docs.sogelink.fr/geomedia-docs/autopiste/18.0/01_Aide_AP/06_PTypes/APTp12_Calcul_de_l_axe_du_projet.htm
- https://www.bluemarblegeo.com/global-mapper/
- https://forums.autodesk.com/t5/autocad-forum/cant-see-objects-in-autocad-due-to-proxy-but-its-ok-in-civil-3d/td-p/12231271
- https://help.autodesk.com/cloudhelp/2026/ENU/Civil3D-ObjectEnabler/files/GUID-D18FA6FA-5D11-4CBB-A495-C4DCB36E7348.htm
- https://github.com/qgis/QGIS/issues/56992
- https://docs.pcrs.beta.gouv.fr/contexte/reglementation
- https://cnig.gouv.fr/ressources-pcrs-dt-dict-a11745.html
- https://github.com/cnigfr/StaR-DT
- https://www.geodatadays.fr/_medias/afigeo/files/GDD_2025/2_GDD25_CRAIG_StarDT.pdf
- https://www.gsma.com/mobilefordevelopment/blog/new-insights-on-mobile-internet-connectivity-in-sub-saharan-africa/
- https://www.slideshare.net/slideshow/global-results-bsa-software-study/62609124
- https://landwise-production.s3.amazonaws.com/2022/03/Senegal_Decree-cadastral-identification_2012_French.pdf
- https://osy-immo.com/blog/dossier-technique
