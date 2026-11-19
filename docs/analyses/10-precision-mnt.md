# Précision du MNT et des courbes de niveau (19 novembre 2026)

## Ce qui était faux, et pourquoi

| Défaut | Effet mesuré | Correction |
|---|---|---|
| Lissage des courbes activé par défaut (Chaikin, deux passes) | sur un terrain d'essai, les courbes lissées passaient jusqu'à **18,5 cm** (en altitude) à côté du MNT | lissage désactivé par défaut ; s'il est demandé, la courbe passe **exactement** par les sommets calculés et l'écart restant est chiffré dans le rapport |
| Aucune ligne de rupture dans la triangulation | à la traversée d'un fossé, d'un talus ou d'un bord de route, les triangles relient les deux berges : sur l'essai du fossé, le MNT donnait **10 m au lieu de 8 m** au fond | triangulation de Delaunay **contrainte** : chaque segment de rupture devient un côté de triangle |
| Deux altitudes au même endroit : la première gardée sans le dire | une courbe pouvait dépendre de l'ordre du fichier | conflit signalé dans le rapport |
| Cotes calculées par `k × équidistance` en binaire | des cotes comme 745,6000000000001 | cotes calculées en décimal exact (745,6) |
| Points hors sol (sommet de poteau, toit) dans le MNT | courbes déformées autour de ces points | colonne « MNT » par code dans l'assistant |

## La méthode, et sa correspondance avec les logiciels de référence

| Étape | Plateforme | Covadis (MNT objet) | Civil 3D (surface TIN) | Metashape |
|---|---|---|---|---|
| Triangulation | Delaunay, prédicats exacts de Shewchuk | Delaunay | Delaunay | maillage du nuage dense |
| Lignes de rupture | contraintes strictes, conflits signalés | lignes de rupture | breaklines standard | — |
| Interpolation | linéaire sur chaque facette | linéaire sur facettes | linéaire sur facettes (TIN) | MNT raster interpolé |
| Bords | côté maximal (automatique ou choisi), contour facultatif | périmètre | longueur maximale de triangle, contours | masque |
| Courbes | intersection exacte facette / plan horizontal | idem | idem (lissage optionnel) | courbes sur raster |
| Contrôle | **chaque sommet de courbe revérifié** contre le MNT, recherche de croisements, rapport chiffré | — | — | — |

Sur un même jeu de points et de ruptures, une triangulation de Delaunay et une
interpolation linéaire donnent les mêmes courbes, au même sommet près, quel que soit le
logiciel. La seule ambiguïté possible est celle des quatre points cocycliques (une grille
parfaitement régulière) : deux diagonales sont alors également « de Delaunay ». Il suffit
d'imposer une ligne de rupture pour lever l'ambiguïté.

## Ce qui est garanti, et ce qui ne peut pas l'être

- **Garanti** : par rapport au modèle (les points et les ruptures validés), chaque sommet
  de courbe est à sa cote à la précision du calcul en double précision : 10⁻¹¹ m environ
  sur des coordonnées UTM. Le rapport le prouve à chaque génération.
- **Garanti** : aucune courbe n'en croise une autre ; aucune n'est tracée hors du levé.
- **Impossible pour tout logiciel** : connaître le terrain entre deux points mesurés.
  L'écart entre le modèle et le terrain réel dépend de la densité des points et des
  ruptures levées, pas de l'algorithme. Sur l'essai sinusoïdal (400 points sur un hectare,
  relief de ±5 m), le modèle s'écarte du terrain vrai de 1,3 m au pire, avec n'importe
  quel logiciel de type TIN. La réponse est sur le terrain : densifier les points, lever
  les ruptures en 3D.

## Tests automatiques

`tests/precision.test.ts` : plan incliné en coordonnées UTM (écart < 10⁻⁹ m), cotes
décimales exactes, terrain courbe (contrôle indépendant, aucun croisement), sommets
exactement à la cote d'une courbe, fossé avec et sans ligne de rupture, conflits signalés,
lissage passant par les sommets exacts.

## Comparaison avec Covadis 17 sur le levé de Mimboman (19 novembre 2026)

Fichier fourni : courbes de niveau Covadis 17 (équidistance 0,50 m) et 322 points
topographiques (bloc TCPOINT). La plateforme a construit son MNT sur les mêmes points,
sans autre donnée.

| Mesure | Résultat |
|---|---|
| Sommets des courbes Covadis exactement sur une courbe de la plateforme | médiane de l'écart **0,0 cm** |
| 90 % des sommets Covadis | à moins de **7,7 cm** d'une courbe de la plateforme |
| 95 % des sommets Covadis | à moins de **13,2 cm** |
| Écart d'altitude des courbes Covadis par rapport au MNT des points | médiane 0,0 cm, 90 % 5,1 cm, **max 42 cm** |
| Écart d'altitude des courbes de la plateforme par rapport au même MNT | **10⁻⁹ m** (limite du calcul) |
| Croisements entre courbes de la plateforme | **0** |

Lecture : Covadis 17 et la plateforme partent du même MNT (triangulation des points).
Covadis densifie puis lisse ses courbes (segments de 0,65 m en moyenne) : à certains
endroits, ses courbes ne sont plus à leur cote sur le MNT (jusqu'à 42 cm). Les courbes
de la plateforme restent exactement à leur cote. Ajouter les murs ou les polylignes du
dessin au MNT dégrade la concordance : Covadis n'a utilisé que les points.

Réglages retenus d'après cette comparaison : emprise sur toute l'enveloppe des points
(comme Covadis), courbes non interrompues par défaut (option : interrompre sur les faces
de murs au-delà de 300 %), cotes le long des courbes, couleurs en dégradé selon la cote.

## Positionnement géographique

- Formules de projection contrôlées contre une implémentation indépendante des séries de
  Krüger d'ordre 6 (référence des logiciels géodésiques) : écart **0,000000 mm** à
  Ebolowa, Foumbot, Yaoundé, Douala, Garoua et en bord de fuseau ; aller-retour sans perte.
- Défaut trouvé et corrigé : la détection du système de coordonnées d'un fichier qui
  n'en déclare pas dépendait du fuseau horaire de l'appareil. Sur un appareil réglé
  autrement qu'« Afrique/Douala », des coordonnées d'Ebolowa pouvaient être rattachées à
  l'UTM 31 (670 km plus à l'ouest), à un système marocain ou à un fuseau du Pacifique.
  Désormais, un réglage « Pays de travail » (Cameroun par défaut) impose que le système
  proposé place les points dans ce pays, et chaque proposition affiche la ville la plus
  proche (« près d'Ebolowa, 2 km ») avant validation.
- Systèmes camerounais historiques ajoutés (paramètres EPSG) : Manoca 1962 / UTM 32 Nord
  (EPSG:2215) et Douala 1948 / AEF ouest (EPSG:3119). Leur passage au WGS 84 est une
  translation à trois paramètres, de précision métrique : ils sont proposés, jamais
  choisis d'office.
