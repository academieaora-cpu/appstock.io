# Licences et PI — plateforme web DWG/SIG (15/11/2026)

Analyse de risques, pas un avis juridique. **[V]** vérifié à la source dans cette session ; **[M]** non revérifié (recherches plafonnées à trois) ; **[I]** interprétation.

## 1. Tableau

| Brique | Licence | Risque | Mesure |
|---|---|---|---|
| LibreDWG-WASM (navigateur) | GPL-3.0+ | Moyen en worker isolé, élevé dans le bundle | §2 |
| LibreDWG (serveur) | GPL-3.0+ | Faible | Rien à publier en SaaS [V] |
| ODA SDK | Abonnement | Faible | Sustaining exigé pour le web ; droit de distribuer perdu à la résiliation [V] |
| ODA File Converter | Non commercial hors membres | Élevé | Exclure |
| RealDWG | 8 000 $/an, Windows desktop, hébergement serveur interdit [V] | Élevé | Exclure |
| APS | À l'usage, jetons Flex [V] ; tarif unitaire non obtenu | Moyen | Fichiers transmis à Autodesk |
| GEOS | LGPL-2.1 [V] | Moyen | §3 |
| GDAL, PROJ, proj4js, three.js, ezdxf, ACadSharp, OpenLayers, MapLibre, SQLite | MIT, BSD, domaine public [M] | Faible | Reproduire les notices |
| libdxfrw | GPL-2.0+ [M] | Comme LibreDWG | Idem |
| acadrust | MPL-2.0 | Faible | Publier les fichiers MPL modifiés |
| Polices SHX Autodesk | Propriétaires [M] | Élevé | Polices libres auto-hébergées |
| Tuiles OSM | ODbL + politique de tuiles [V] | Moyen | Fournisseur payant ou auto-hébergement |
| Orthophotos IGN | Licence Ouverte 2.0 [V] | Faible | Mention source et millésime |
| Esri World Imagery | CGU Esri [M] | Moyen à élevé | Abonnement ArcGIS |
| Google, Bing | CGU [M] | Élevé | API officielles uniquement |

## 2. LibreDWG-WASM en Web Worker

**Distribution : oui [V].** La FAQ GPL oppose le programme exécuté sur le serveur (aucune obligation) au programme « distributed to the user when they visit the web site » : ses sources sont alors dues à l'utilisateur. Il faut donc publier les sources correspondantes du worker (LibreDWG, glue, scripts de build), la licence et les notices.

**Œuvre dérivée : non tranché.** [V] Pour la FSF, le critère combine mécanisme et sémantique :
- même exécutable ou espace d'adressage partagé : un seul programme ;
- pipes et sockets : programmes « normally » séparés, sauf échange de « complex internal data structures » ;
- mémoire partagée : équivaut à une liaison dynamique.

La FSF précise que les juges trancheront.

[I] Un worker qui dialogue par postMessage ressemble à un socket. L'argument est sérieux mais fragile : aucune jurisprudence ; le modèle DWG complet renvoyé en JSON peut passer pour un échange « intime » ; une application conçue autour de ce worker ressemble peu à un agrégat.

[V] mlightcad applique ce schéma et vend en parallèle un convertisseur DWG propriétaire présenté comme « No GPL propagation issue ». Son README signale que LibreDWG pose des « GPL licensing considerations for commercial closed-source products » : l'isolation n'y est pas présentée comme une garantie.

Si cette voie est retenue :
- worker dans un fichier et un dépôt GPL séparés, jamais inliné par le bundler ;
- sortie dans un format neutre documenté (DXF, GeoJSON) ;
- pas de SharedArrayBuffer ;
- convertisseur optionnel et remplaçable ;
- validation par un avocat.

**Serveur seul :** GPL ≠ AGPL, rien à publier [V]. On perd le traitement local, et une livraison on-premise redevient une distribution [I].

## 3. GEOS lié statiquement

[V] FSF : lier statiquement une bibliothèque LGPL impose de fournir l'application en format objet, pour permettre le relink.

[I] En WASM, la liaison est presque toujours statique. La solution est un .wasm ne contenant que du code ouvert (GDAL, GEOS, PROJ, SQLite, glue publié), appelé par le JavaScript propriétaire, avec recette de build publiée. Les CGU ne doivent pas interdire la rétro-ingénierie de cette partie [M, LGPL-2.1 §6]. Ne jamais compiler de code propriétaire dans ce même .wasm.

## 4. Marque DWG

[V] Autodesk autorise « works with DWG files » et « compatible with the DWG file format », avec la mention que DWG est le format natif d'AutoCAD et une marque d'Autodesk, Inc. Sont interdits : DWG dans un nom de produit, de service ou de société, un logo, un nom de domaine ou un dépôt de marque.

[V] Aux États-Unis, *Autodesk v. Lee* (E.D. Va., 30/10/2014) a jugé DWG descriptif et refusé l'enregistrement. ODA (avril 2010) et SolidWorks (janvier 2010, source Wikipédia) ont néanmoins transigé en abandonnant leurs marques en DWG.

Ne jamais écrire le filigrane TrustedDWG (litige ODA 2006-2007, source Wikipédia). Le statut de la marque dans l'UE n'a pas été vérifié.

## 5. Fonds de carte

- **OSM :** attribution obligatoire [V]. tile.openstreetmap.org est sans garantie de service et inadapté à un SaaS commercial à fort trafic [M].
- **IGN :** BD ORTHO sous Licence Ouverte 2.0 [V], réutilisation commerciale permise ; flux Géoplateforme sans clé (source secondaire).
- **Esri :** clé et abonnement requis [M].
- **Google, Bing :** accès aux tuiles hors API interdit, comme la numérisation sur l'imagerie, ce qui est bloquant pour un outil de dessin [M].

## 6. RGPD [I]

- **Traitement 100 % local :** l'éditeur ne traite pas le contenu des fichiers ; il reste responsable des comptes, journaux et télémétrie.
- **Fuite indirecte :** les polices du viewer mlightcad sont chargées par défaut depuis un CDN [V] ; les auto-héberger.
- **Stockage serveur de plans fonciers** (propriétaires, parcelles) : statut de sous-traitant, contrat article 28, sécurité, durées de conservation, hébergement UE ; SecNumCloud si clients publics.

## 7. Recommandation

- **Prototype open source :** tout en GPL-3.0-or-later, LibreDWG-WASM dans le navigateur. Aucune ambiguïté.
- **Produit fermé :** pas de LibreDWG dans le navigateur. DXF et SIG côté client avec des briques permissives. Pour le DWG : ODA Sustaining (7 500 $ puis 4 500 $/an), ou ACadSharp/acadrust si une fidélité moindre suffit, ou LibreDWG côté serveur.
- **Open core :** cœur MIT/Apache sans dépendance GPL, avec une interface de convertisseurs. Plug-in LibreDWG GPL dans un dépôt distinct pour l'édition communautaire ; convertisseur ODA ou permissif dans l'édition payante.

**Payer ODA** si le code est fermé et qu'il faut, dans le navigateur, une écriture DWG fiable ou les objets Civil 3D (extension à 10 000 $ [V]). **L'éviter** si le produit est open source, si le DXF suffit ou si la conversion serveur est acceptable.

## Sources

- https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation
- https://www.gnu.org/licenses/gpl-faq.en.html#UnreleasedMods
- https://github.com/LibreDWG/libredwg
- https://github.com/mlightcad/realdwg-web
- https://github.com/mlightcad/cad-viewer
- https://www.opendesign.com/oda-membership
- https://www.opendesign.com/pricing/individual
- https://www.opendesign.com/faq/question/what-are-oda-viewer-and-oda-file-converter
- https://www.techsoft3d.com/oem/realdwg/
- https://aps.autodesk.com/blog/aps-business-model-evolution
- https://www.autodesk.com/company/legal-notices-trademarks/trademarks/guidelines-for-use
- https://investors.autodesk.com/news-releases/news-release-details/autodesk-and-open-design-alliance-reach-agreement-autodesk-dwg
- https://www.vitallaw.com/news/trademark-e-d-va-autocad-s-descriptive-dwg-mark-could-not-be-registered-for-cad-software/ipm01f1f586427c001000a51dd8d385ad169405
- https://en.wikipedia.org/wiki/.dwg
- https://github.com/libgeos/geos/blob/main/COPYING
- https://operations.osmfoundation.org/policies/tiles/
- https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ
- https://www.data.gouv.fr/datasets/bd-ortho-r
