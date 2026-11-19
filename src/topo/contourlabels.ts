/**
 * Habillage des courbes de niveau : couleur selon l'altitude et cotes posées le long des
 * courbes, le trait étant interrompu sous chaque cote (comme le masquage des logiciels de
 * topographie). Les morceaux gardent les sommets exacts : chaque coupure est interpolée
 * sur un segment de la courbe, donc reste à la cote.
 */

/** Dégradé hypsométrique : vert (bas) → jaune → orange → rouge → brun (haut). */
const RAMP: [number, number, number][] = [
  [26, 150, 65],
  [145, 207, 96],
  [217, 239, 139],
  [254, 224, 139],
  [252, 141, 89],
  [215, 48, 39],
  [127, 59, 8],
]

/** Couleur 0xRRGGBB d'une courbe selon sa cote dans [zmin, zmax]. */
export function elevationColor(z: number, zmin: number, zmax: number): number {
  const t = zmax > zmin ? Math.max(0, Math.min(1, (z - zmin) / (zmax - zmin))) : 0.5
  const f = t * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(f))
  const u = f - i
  const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * u))
  return (c[0] << 16) | (c[1] << 8) | c[2]
}

export interface LabelOptions {
  /** Distance entre deux cotes le long de la courbe (m). */
  spacing: number
  /** Longueur occupée par le texte de la cote (m). */
  textLength: number
  /** Marge de part et d'autre du texte (m). */
  gap: number
}

export interface LabeledContour {
  /** Morceaux de la courbe, interrompus sous les cotes. */
  pieces: number[][]
  /** Position (sur la courbe) et orientation lisible de chaque cote. */
  labels: { x: number; y: number; rot: number }[]
}

function readable(a: number): number {
  let r = a
  while (r > Math.PI / 2 + 1e-9) r -= Math.PI
  while (r <= -Math.PI / 2 + 1e-9) r += Math.PI
  return r
}

/**
 * Place des cotes régulièrement le long d'une courbe, là où elle est assez droite pour que
 * le texte la suive, et coupe le trait sous chaque cote.
 */
export function labelContour(pts: number[], closed: boolean, o: LabelOptions): LabeledContour {
  const ring = closed ? [...pts, pts[0], pts[1]] : pts
  const n = ring.length >> 1
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(ring[i * 2] - ring[i * 2 - 2], ring[i * 2 + 1] - ring[i * 2 - 1]))
  const L = cum[n - 1]
  const half = o.textLength / 2 + o.gap
  if (n < 2 || L < 2 * half + o.gap * 2) return { pieces: [pts], labels: [] }
  const at = (s: number): [number, number] => {
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= s) lo = mid
      else hi = mid
    }
    const seg = cum[hi] - cum[lo] || 1
    const t = (s - cum[lo]) / seg
    return [ring[lo * 2] + (ring[hi * 2] - ring[lo * 2]) * t, ring[lo * 2 + 1] + (ring[hi * 2 + 1] - ring[lo * 2 + 1]) * t]
  }
  const straightEnough = (s0: number, s1: number) => {
    const a = at(s0)
    const b = at(s1)
    return Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.97 * (s1 - s0)
  }
  // Positions candidates : régulières, sinon une seule au milieu.
  const wanted: number[] = []
  for (let s = Math.min(o.spacing / 2, L / 2); s <= L - half; s += o.spacing) if (s >= half) wanted.push(s)
  if (!wanted.length) wanted.push(L / 2)
  const cuts: [number, number][] = []
  const labels: LabeledContour['labels'] = []
  for (const s of wanted) {
    let placed = false
    for (const shift of [0, o.textLength, -o.textLength, 2 * o.textLength, -2 * o.textLength]) {
      const c = s + shift
      const s0 = c - half
      const s1 = c + half
      if (s0 < 0 || s1 > L) continue
      if (cuts.some(([a, b]) => s0 < b + o.gap && s1 > a - o.gap)) continue
      if (!straightEnough(s0, s1)) continue
      const p = at(c)
      const a = at(c - o.textLength / 2)
      const b = at(c + o.textLength / 2)
      labels.push({ x: p[0], y: p[1], rot: readable(Math.atan2(b[1] - a[1], b[0] - a[0])) })
      cuts.push([s0, s1])
      placed = true
      break
    }
    if (!placed) continue
  }
  if (!cuts.length) return { pieces: [pts], labels: [] }
  cuts.sort((p, q) => p[0] - q[0])
  // Morceaux entre les coupures (les sommets d'origine sont conservés).
  const piece = (s0: number, s1: number): number[] => {
    const out: number[] = []
    const a = at(s0)
    out.push(a[0], a[1])
    for (let i = 0; i < n; i++) if (cum[i] > s0 && cum[i] < s1) out.push(ring[i * 2], ring[i * 2 + 1])
    const b = at(s1)
    out.push(b[0], b[1])
    return out
  }
  const pieces: number[][] = []
  if (closed) {
    // Courbe fermée : le morceau qui passe par le point de départ relie la dernière coupure à la première.
    for (let i = 0; i + 1 < cuts.length; i++) pieces.push(piece(cuts[i][1], cuts[i + 1][0]))
    const wrap = [...piece(cuts[cuts.length - 1][1], L), ...piece(0, cuts[0][0]).slice(2)]
    pieces.push(wrap)
  } else {
    let s = 0
    for (const [a, b] of cuts) {
      if (a > s) pieces.push(piece(s, a))
      s = b
    }
    if (s < L) pieces.push(piece(s, L))
  }
  return { pieces: pieces.filter((p) => p.length >= 4), labels }
}
