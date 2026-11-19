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
