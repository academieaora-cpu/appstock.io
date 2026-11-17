# IA et web 2026 pour une plateforme CAO + SIG topographe

État au 15/11/2026. Recherche plafonnée par consigne : tout ce qui n'a pas été recoupé est marqué SUPPOSÉ. Aucun fichier créé ni modifié.

## 1. Existant : réel vs marketing (VÉRIFIÉ)
- **Autodesk** : livré dans AutoCAD 2027 = Smart Blocks, import d'annotations PDF, Macro Advisor, et un Assistant surtout d'aide et de questions sur le dessin. L'Assistant « agent-first » et les serveurs MCP (Revit, Fusion) relèvent des annonces AU 2026.
- **Esri** : en GA (juin 2026), seulement Survey123, Business Analyst et traduction ; l'assistant ArcGIS Pro (actions, ArcPy/SQL) était en bêta.
- **QGIS** : plugins communautaires, dont QGIS MCP (≈ 67 000 téléchargements) et QGIS Agent (MCP local, jeton, outils dangereux masqués, confirmation à l'écran).
- **Felt, CARTO** : les plus aboutis côté agent (MCP Felt ≈ 30 outils ; CARTO expose des Workflows déterministes, versionnés, auditables), mais orientés entrepôts de données, pas CAO.
- **Bentley** : OpenSite+ en disponibilité limitée (fin 2025), Copilot décrit comme « couche en évolution ».
- **Trimble TBC, Global Mapper Pro** : ce qui marche est l'IA classique sur poste (classification de nuages, extraction de bordures, regards, poteaux, modèles entraînables).
- Aucun acteur trouvé ne pilote par agent un moteur CAO + SIG dans le navigateur.

## 2. Fonctions IA pour le topographe
Les faisabilités sont mon jugement (SUPPOSÉ).

| Fonction | Valeur métier | Faisabilité | Exécution |
|---|---|---|---|
| Commande en langage naturel | Enchaînements en une phrase, sans menus | Facile | LLM serveur, outils dans le navigateur |
| Géoréférencement auto d'un DWG | Supprime une erreur quotidienne | Moyen | Navigateur ; contrôle sur OSM/orthophoto |
| Nettoyage et contrôle PCRS | Moins de rejets à la livraison | Facile à moyen | Navigateur (règles) |
| Mappage calques ↔ schéma SIG | Heures de ressaisie évitées | Facile à moyen | LLM serveur, validation humaine |
| Codification du semis, dessin auto | Gain direct sur le report | Moyen (codes connus), recherche sinon | Navigateur |
| Vectorisation d'orthophoto (SAM) | Numérisation au clic | Moyen | Navigateur WebGPU ; SAM 3 (texte) sur serveur |
| Vectorisation de plans scannés/PDF | Reprise d'archives | Recherche | Serveur |
| Classification de nuage, MNT | MNT sans logiciel lourd | Moyen (sol), recherche (sémantique) | Navigateur ; serveur GPU |
| Rapports, légendes | Finition | Facile | LLM serveur |

## 3. Où exécuter l'IA
- **Navigateur** : géométrie, reprojection, règles, SAM/SAM 2 interactif (WebGPU), petits modèles via Transformers.js v4 ou WebLLM (≈ 1–2 Go de mémoire GPU pour 1,5 Md de paramètres). Confidentiel et hors-ligne.
- **Serveur** : LLM de pointe pour planifier les appels d'outils, en n'envoyant que des métadonnées (noms de calques, emprises), pas les géométries.
- Gemini Nano (API Prompt de Chrome) n'est pas universel : ne pas en dépendre.
- Les coûts d'API n'ont pas été chiffrés.

## 4. Noyau pilotable par agent
- Chaque opération est une commande typée (schéma JSON), indépendante de l'interface ; interface, ligne de commande et agent appellent le même registre.
- Le journal d'opérations est rejouable (annulation, audit, macros), avec simulation et confirmation avant toute action destructrice.
- L'exposition se fait par serveur MCP ; WebMCP (`document.modelContext`) reste optionnel, en essai d'origine Chrome 149–156 et quasi sans adoption.
- Modèles à suivre : CARTO (workflows auditables), QGIS Agent (sécurité).

## 5. Ruptures web : support réel (VÉRIFIÉ sauf mention)

| API | Android (Chrome) | iOS (Safari) |
|---|---|---|
| WebGPU | Oui (Android 12+, GPU Qualcomm/ARM) | Oui depuis iOS 26 |
| Web Serial | Oui sur Bluetooth RFCOMM depuis Chrome 138 | Non |
| Web Bluetooth (BLE) | Oui | Non |
| WebXR | Partiel | Non |
| File System Access | Non vérifié | Non ; OPFS disponible |

- **GNSS RTK** : réaliste sur Android seulement ; iOS exige une enveloppe native. Direct Sockets est réservé aux Isolated Web Apps, donc NTRIP passe par un relais WebSocket (SUPPOSÉ).
- **Firefox** : WebGPU partiel (Windows, macOS ARM) ; prévoir un repli WebGL2.
- **Formats cloud-natifs** : GeoParquet se lit via DuckDB-WASM (limites : 2 Gio par fichier distant, ≈ 4 Gio de mémoire) ; PMTiles et COPC par requêtes partielles.
- **Collaboration temps réel** : non vérifiée.

## 6. Top 5 à livrer (efforts SUPPOSÉS)
1. **Noyau à commandes typées, journal rejouable, commande en langage naturel, serveur MCP** — 6 à 10 semaines ; prérequis de tout le reste.
2. **« Dépose ton DWG, il se cale seul »** : CRS deviné (Lambert 93, CC42–50, UTM), superposition de contrôle, score de confiance — 3 à 5 semaines ; dépend de PROJ en WASM et d'un fond de référence.
3. **Contrôle avant livraison** : nettoyage, topologie, profil PCRS, rapport — 6 à 10 semaines ; dépend du mappage calques ↔ schéma ; le validateur IGN a un modèle PCRS v2.0 expérimental.
4. **Implantation GNSS RTK en PWA Android** sur le plan superposé — 6 à 8 semaines ; dépend de Web Serial, d'un relais NTRIP et d'OPFS.
5. **Vectorisation au clic (SAM dans le navigateur)** vers un calque CAO — 4 à 6 semaines ; dépend de WebGPU ; une aide, pas un automatisme.

## 7. Non vérifié
Tarifs LLM, produits de codification automatique, classification de nuages dans le navigateur, série USB filaire sur Android, statut actuel de la bêta ArcGIS Pro.

## Sources
- https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/What-are-the-AutoCAD-AI-driven-features.html
- https://develop3d.com/ai/autodesks-most-ambitious-ai-play-yet/
- https://www.esri.com/arcgis-blog/products/arcgis-online/geoai/whats-new-in-ai-assistants-june-2026
- https://www.esri.com/arcgis-blog/products/arcgis-pro/announcements/try-the-arcgis-pro-assistant-3-7-beta-and-get-more-done-in-arcgis-pro
- https://plugins.qgis.org/plugins/tags/llm/
- https://terra-lab.ai/blog/qgis-mcp-alternatives
- https://felt.com/blog/introducing-felt-mcp-server
- https://carto.com/blog/introducing-carto-for-agents-gis-for-the-agentic-enterprise/
- https://aecmag.com/ai/bentley-systems-shapes-its-ai-future/
- https://geospatial.trimble.com/blog/geospatial/en-US/article/ai-based-feature-extraction-in-tbc-adds-value-to-collected-data
- https://www.bluemarblegeo.com/blog/insight-and-learning-engine-leads-expansion-of-analysis-tools-in-global-mapper-pro-v26/
- https://caniuse.com/webgpu
- https://web.dev/blog/webgpu-supported-major-browsers
- https://caniuse.com/web-serial
- https://developer.chrome.com/release-notes/138
- https://caniuse.com/web-bluetooth
- https://caniuse.com/webxr
- https://caniuse.com/native-filesystem-api
- https://developer.chrome.com/docs/iwa/direct-sockets
- https://developer.chrome.com/docs/ai/webmcp
- https://www.spronta.com/blog/state-of-webmcp-july-2026/
- https://github.com/mlc-ai/web-llm
- https://huggingface.co/docs/transformers.js/en/index
- https://lucasgelfond.online/software/webgpu-sam2/
- https://samgeo.gishub.org/
- https://ignf.github.io/validator/validator-core/src/test/resources/config-json/CNIG_PCRS_v2.0/
- https://geolibre.app/tutorials/source-code-deep-dive-en/
- https://copc.io/
