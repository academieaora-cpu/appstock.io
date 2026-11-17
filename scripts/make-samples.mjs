// Génère les fichiers d'exemple (données fictives) dans public/samples/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples')
mkdirSync(out, { recursive: true })

// Générateur pseudo-aléatoire déterministe : les exemples sont identiques à chaque exécution.
let seed = 20261116
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

// Site fictif, coordonnées UTM 32 Nord (région de Yaoundé).
const X0 = 783640
const Y0 = 427200
const ground = (x, y) => 748 + (x - X0) * 0.045 - (y - Y0) * 0.07 + 1.6 * Math.sin((x - X0) / 14) * Math.cos((y - Y0) / 17)
const rows = []
let n = 0
const add = (id, x, y, code, z = ground(x, y)) => rows.push([id ?? String(++n), x.toFixed(3), y.toFixed(3), z.toFixed(2), code])

// Parcelle : six bornes
const bornes = [
  [-12.4, 26.8],
  [10.9, 30.1],
  [17.2, -3.5],
  [13.6, -24.9],
  [-9.8, -22.2],
  [-16.3, 2.4],
]
bornes.forEach(([dx, dy], i) => add('B.' + (i + 1), X0 + dx, Y0 + dy, 'BORN'))

// Deux bâtiments (codes à suffixe : BAT1, BAT2)
const rect = (cx, cy, w, h, a, code) => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  for (const [u, v] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) add(null, X0 + cx + u * c - v * s, Y0 + cy + u * s + v * c, code)
}
rect(-1.5, 12, 11, 8, 0.12, 'BAT1')
rect(3, -11, 8, 6.5, 0.12, 'BAT2')

// Route : deux bords et l'axe
for (let i = 0; i <= 8; i++) {
  const t = -34 + i * 9
  const y = -33 - 0.25 * t + 2.5 * Math.sin(t / 22)
  add(null, X0 + t, Y0 + y, 'ROUTE1')
}
for (let i = 0; i <= 8; i++) {
  const t = -34 + i * 9
  const y = -39 - 0.25 * t + 2.5 * Math.sin(t / 22)
  add(null, X0 + t, Y0 + y, 'ROUTE2')
}
for (let i = 0; i <= 8; i++) {
  const t = -34 + i * 9
  const y = -36 - 0.25 * t + 2.5 * Math.sin(t / 22)
  add(null, X0 + t, Y0 + y, 'AXE')
}
// Clôture le long du côté ouest
for (let i = 0; i <= 5; i++) add(null, X0 - 18.5 + i * 0.9, Y0 + 28 - i * 10.4, 'CL')

// Végétation et réseaux
for (const [dx, dy] of [[-6, 3], [7.5, 6.5], [-4, -14], [12, 14], [-22, -8]]) add(null, X0 + dx, Y0 + dy, 'ARB')
add(null, X0 + 19.5, Y0 - 29, 'POT')
add(null, X0 - 20, Y0 - 31.5, 'POT')
add(null, X0 + 2, Y0 - 30.5, 'REG')

// Semis de points de terrain naturel
for (let i = 0; i < 95; i++) add(null, X0 - 34 + rnd() * 68, Y0 - 44 + rnd() * 84, 'TN')

writeFileSync(join(out, 'leve_demo_utm32n.csv'), 'Point;X;Y;Z;Code\n' + rows.map((r) => r.join(';')).join('\n') + '\n')

// Même levé au format « numéro nord est altitude désignation », séparé par des espaces, sans en-tête.
writeFileSync(join(out, 'leve_demo_pnezd.txt'), rows.map((r) => [r[0], r[2], r[1], r[3], r[4]].join(' ')).join('\n') + '\n')

console.log(`exemples écrits dans ${out} (${rows.length} points)`)
