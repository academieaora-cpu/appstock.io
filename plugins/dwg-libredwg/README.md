# Décodeur DWG (LibreDWG en WebAssembly)

Ce dossier contient un composant **séparé de l'application** : un Web Worker qui convertit
un fichier DWG en DXF, entièrement dans le navigateur.

- `worker.js` — le worker (GPL-3.0-or-later).
- `libredwg-web.js`, `libredwg-web.wasm` — LibreDWG compilé en WebAssembly, copiés depuis le
  paquet npm [`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web) (GPL-3.0)
  par `scripts/install-dwg-plugin.mjs`.

Sources correspondantes : https://github.com/LibreDWG/libredwg et
https://github.com/mlightcad/libredwg-web.

## Pourquoi un composant séparé ?

LibreDWG est sous licence GPL. Pour ne pas mélanger ce code avec le reste de l'application :

1. le worker est un fichier distinct, jamais inclus dans le bundle de l'application ;
2. il ne communique que par messages : octets DWG en entrée, octets DXF en sortie
   (format d'échange public) ;
3. aucune mémoire n'est partagée (pas de `SharedArrayBuffer`) ;
4. il est optionnel et remplaçable : l'application fonctionne sans lui (DXF, SHP, GeoJSON…),
   et un autre convertisseur DWG → DXF (service serveur, SDK commercial) peut prendre sa place
   en respectant le même protocole de messages.

Cette séparation est une précaution d'architecture, pas un avis juridique : avant toute
commercialisation en code fermé, faites valider le montage par un juriste.
