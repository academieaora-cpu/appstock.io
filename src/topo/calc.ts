/**
 * Calculs topographiques et de projet : talus, carroyage, implantation, division de
 * parcelle, cubatures et profil en long. Fonctions pures et déterministes : aucune valeur
 * n'est inventée hors des données (zones hors MNT signalées, jamais extrapolées).
 */
import { elevationAt, type Tin } from './tin'

type Pt = [number, number]

// ---------------------------------------------------------------------------
// Outils de polygones
// ---------------------------------------------------------------------------

/** Aire signée (positive si sens trigonométrique). */
export function signedArea(ring: ArrayLike<number>): number {
  const n = ring.length >> 1
  if (n < 3) return 0
  const ox = ring[0]
  const oy = ring[1]
  let a = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += (ring[i * 2] - ox) * (ring[j * 2 + 1] - oy) - (ring[j * 2] - ox) * (ring[i * 2 + 1] - oy)
  }
  return a / 2
}

/**
 * Découpe par un demi-plan a·x + b·y + c ≥ 0 (Sutherland–Hodgman). Exact pour l'aire même
 * sur un polygone concave : les morceaux séparés sont reliés par des ponts d'aire nulle.
 */
export function clipHalfPlane(ring: ArrayLike<number>, a: number, b: number, c: number): number[] {
  const n = ring.length >> 1
  const out: number[] = []
  if (n < 3) return out
  const f = (i: number) => a * ring[i * 2] + b * ring[i * 2 + 1] + c
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const fi = f(i)
    const fj = f(j)
    if (fi >= 0) out.push(ring[i * 2], ring[i * 2 + 1])
    if ((fi >= 0) !== (fj >= 0)) {
      const t = fi / (fi - fj)
      out.push(ring[i * 2] + (ring[j * 2] - ring[i * 2]) * t, ring[i * 2 + 1] + (ring[j * 2 + 1] - ring[i * 2 + 1]) * t)
    }
  }
  return dedupe(out)
}

function dedupe(r: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < r.length; i += 2) {
    const n = out.length
    if (n && Math.abs(out[n - 2] - r[i]) < 1e-9 && Math.abs(out[n - 1] - r[i + 1]) < 1e-9) continue
    out.push(r[i], r[i + 1])
  }
  if (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-9 && Math.abs(out[1] - out[out.length - 1]) < 1e-9) out.length -= 2
  return out
}

function centroidOf(ring: ArrayLike<number>): Pt | null {
  const n = ring.length >> 1
  const ox = ring[0]
  const oy = ring[1]
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x0 = ring[i * 2] - ox
    const y0 = ring[i * 2 + 1] - oy
    const x1 = ring[j * 2] - ox
    const y1 = ring[j * 2 + 1] - oy
    const k = x0 * y1 - x1 * y0
    a += k
    cx += (x0 + x1) * k
    cy += (y0 + y1) * k
  }
  if (Math.abs(a) < 1e-12) return null
  return [ox + cx / (3 * a), oy + cy / (3 * a)]
}

// ---------------------------------------------------------------------------
// Talus
// ---------------------------------------------------------------------------

function closestOnPolyline(pts: ArrayLike<number>, x: number, y: number): Pt {
  let best = Infinity
  let out: Pt = [pts[0], pts[1]]
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i]
    const y0 = pts[i + 1]
    const dx = pts[i + 2] - x0
    const dy = pts[i + 3] - y0
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0
    const px = x0 + dx * t
    const py = y0 + dy * t
    const d = (px - x) ** 2 + (py - y) ** 2
    if (d < best) {
      best = d
      out = [px, py]
    }
  }
  return out
}

function rayToPolyline(o: Pt, d: Pt, pts: ArrayLike<number>): number | null {
  let best: number | null = null
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ex = pts[i + 2] - pts[i]
    const ey = pts[i + 3] - pts[i + 1]
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-14) continue
    const s = ((pts[i] - o[0]) * ey - (pts[i + 1] - o[1]) * ex) / den
    const u = ((pts[i] - o[0]) * d[1] - (pts[i + 1] - o[1]) * d[0]) / den
    if (s > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || s < best)) best = s
  }
  return best
}

/**
 * Hachures de talus : traits perpendiculaires à la crête (haut), alternativement longs
 * (jusqu'au pied) et courts (fraction `short`), tous les `spacing` mètres.
 */
export function talusHachures(top: ArrayLike<number>, bottom: ArrayLike<number>, spacing: number, short = 0.5): number[][] {
  const out: number[][] = []
  if (!(spacing > 0) || top.length < 4 || bottom.length < 4) return out
  let carry = spacing / 2
  let k = 0
  for (let i = 0; i + 3 < top.length; i += 2) {
    const x0 = top[i]
    const y0 = top[i + 1]
    const dx = top[i + 2] - x0
    const dy = top[i + 3] - y0
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const ux = dx / len
    const uy = dy / len
    for (let s = carry; s <= len + 1e-9; s += spacing) {
      const p: Pt = [x0 + ux * s, y0 + uy * s]
      const q = closestOnPolyline(bottom, p[0], p[1])
      // Normale orientée vers le pied du talus.
      let n: Pt = [-uy, ux]
      if ((q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1] < 0) n = [uy, -ux]
      const hit = rayToPolyline(p, n, bottom)
      const target: Pt = hit !== null && hit < 4 * Math.hypot(q[0] - p[0], q[1] - p[1]) + 1e-9 ? [p[0] + n[0] * hit, p[1] + n[1] * hit] : q
      const f = k % 2 === 0 ? 1 : short
      out.push([p[0], p[1], p[0] + (target[0] - p[0]) * f, p[1] + (target[1] - p[1]) * f])
      k++
    }
    carry = ((carry - len) % spacing + spacing) % spacing
    if (carry < 1e-9) carry = spacing
  }
  return out
}

// ---------------------------------------------------------------------------
// Carroyage
// ---------------------------------------------------------------------------

const NICE = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000]

/** Pas de carroyage : au plus 10 cm sur le papier, avec au moins deux lignes dans la zone. */
export function gridStep(width: number, height: number, scale: number): number {
  const paperMax = 0.1 * scale
  const span = Math.min(width, height)
  let best = NICE[0]
  for (const s of NICE) if (s <= paperMax && span / s >= 2) best = s
  return best
}

/** Valeurs multiples du pas comprises dans [min, max]. */
export function gridValues(min: number, max: number, step: number): number[] {
  const out: number[] = []
  if (!(step > 0) || max - min > step * 2000) return out
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)))
  return out
}

// ---------------------------------------------------------------------------
// Implantation
// ---------------------------------------------------------------------------

export function gisementGr(ax: number, ay: number, bx: number, by: number): number {
  let g = (Math.atan2(bx - ax, by - ay) * 200) / Math.PI
  if (g < 0) g += 400
  return g
}

export interface StakeRow {
  name: string
  x: number
  y: number
  /** Gisement station → point (grades). */
  gisement: number
  distance: number
  /** Lecture horizontale à afficher, la référence étant visée à 0 gr. */
  hz: number | null
}

export function stakeout(station: Pt, reference: Pt | null, points: { name: string; x: number; y: number }[]): StakeRow[] {
  const g0 = reference ? gisementGr(station[0], station[1], reference[0], reference[1]) : null
  return points.map((p) => {
    const g = gisementGr(station[0], station[1], p.x, p.y)
    return { name: p.name, x: p.x, y: p.y, gisement: g, distance: Math.hypot(p.x - station[0], p.y - station[1]), hz: g0 === null ? null : (g - g0 + 400) % 400 }
  })
}

// ---------------------------------------------------------------------------
// Division de parcelle
// ---------------------------------------------------------------------------

export interface Division {
  /** Partie détachée (surface demandée) et reste. */
  part: number[]
  rest: number[]
  partArea: number
  restArea: number
  /** Segments de la ligne de division à l'intérieur de la parcelle. */
  cut: number[][]
}

function chordsInside(ring: ArrayLike<number>, p: Pt, d: Pt): number[][] {
  const n = ring.length >> 1
  const ts: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ex = ring[j * 2] - ring[i * 2]
    const ey = ring[j * 2 + 1] - ring[i * 2 + 1]
    const den = d[0] * ey - d[1] * ex
    if (Math.abs(den) < 1e-14) continue
    const s = ((ring[i * 2] - p[0]) * ey - (ring[i * 2 + 1] - p[1]) * ex) / den
    const u = ((ring[i * 2] - p[0]) * d[1] - (ring[i * 2 + 1] - p[1]) * d[0]) / den
    if (u >= 0 && u < 1) ts.push(s)
  }
  ts.sort((a, b) => a - b)
  const out: number[][] = []
  for (let i = 0; i + 1 < ts.length; i += 2) out.push([p[0] + d[0] * ts[i], p[1] + d[1] * ts[i], p[0] + d[0] * ts[i + 1], p[1] + d[1] * ts[i + 1]])
  return out
}

function finish(ring: number[], a: number, b: number, c: number, p: Pt, d: Pt): Division {
  const part = clipHalfPlane(ring, a, b, c)
  const rest = clipHalfPlane(ring, -a, -b, -c)
  return { part, rest, partArea: Math.abs(signedArea(part)), restArea: Math.abs(signedArea(rest)), cut: chordsInside(ring, p, d) }
}

/**
 * Division par une ligne parallèle à la direction (A, B) : la bande détachée part du côté
 * de la parcelle le plus proche de la droite AB.
 */
export function divideParallel(ringIn: ArrayLike<number>, A: Pt, B: Pt, target: number): Division | string {
  const ring = Array.from(ringIn)
  const total = Math.abs(signedArea(ring))
  if (!(target > 0) || target >= total) return `La surface demandée doit être comprise entre 0 et ${total.toFixed(2)} m².`
  const len = Math.hypot(B[0] - A[0], B[1] - A[1])
  if (len === 0) return 'Direction nulle.'
  const d: Pt = [(B[0] - A[0]) / len, (B[1] - A[1]) / len]
  const nx = -d[1]
  const ny = d[0]
  let pmin = Infinity
  let pmax = -Infinity
  for (let i = 0; i < ring.length; i += 2) {
    const v = nx * ring[i] + ny * ring[i + 1]
    pmin = Math.min(pmin, v)
    pmax = Math.max(pmax, v)
  }
  const s0 = nx * A[0] + ny * A[1]
  // Bande du côté « min » : points où n·p ≤ c, soit (-n)·p + c ≥ 0.
  const fromMin = Math.abs(s0 - pmin) <= Math.abs(s0 - pmax)
  const areaAt = (c: number) => Math.abs(signedArea(fromMin ? clipHalfPlane(ring, -nx, -ny, c) : clipHalfPlane(ring, nx, ny, -c)))
  let lo = pmin
  let hi = pmax
  for (let it = 0; it < 200 && hi - lo > 1e-10; it++) {
    const mid = (lo + hi) / 2
    const a = areaAt(mid)
    if (fromMin ? a < target : a > target) lo = mid
    else hi = mid
  }
  const c = (lo + hi) / 2
  const p: Pt = [nx * c, ny * c]
  return fromMin ? finish(ring, -nx, -ny, c, p, d) : finish(ring, nx, ny, -c, p, d)
}

/**
 * Division par une ligne pivotant autour d'un point fixe F (souvent une borne) : la partie
 * détachée est à gauche de la ligne orientée ; on retient la solution la plus proche de la
 * direction indiquée par `towards`.
 */
export function dividePivot(ringIn: ArrayLike<number>, F: Pt, towards: Pt, target: number): Division | string {
  const ring = Array.from(ringIn)
  const total = Math.abs(signedArea(ring))
  if (!(target > 0) || target >= total) return `La surface demandée doit être comprise entre 0 et ${total.toFixed(2)} m².`
  const leftArea = (phi: number) => {
    const d: Pt = [Math.cos(phi), Math.sin(phi)]
    // À gauche de la ligne orientée : d × (p - F) ≥ 0.
    return Math.abs(signedArea(clipHalfPlane(ring, -d[1], d[0], d[1] * F[0] - d[0] * F[1])))
  }
  const phi0 = Math.atan2(towards[1] - F[1], towards[0] - F[0])
  const N = 720
  const g = (k: number) => leftArea(phi0 + (k / N) * Math.PI * 2) - target
  let bracket: [number, number] | null = null
  let bestDist = Infinity
  let prev = g(0)
  for (let k = 1; k <= N; k++) {
    const cur = g(k)
    if ((prev <= 0 && cur >= 0) || (prev >= 0 && cur <= 0)) {
      const dist = Math.min(k - 1, N - k + 1)
      if (dist < bestDist) {
        bestDist = dist
        bracket = [k - 1, k]
      }
    }
    prev = cur
  }
  if (!bracket) return 'Aucune ligne passant par ce point ne détache cette surface.'
  let lo = phi0 + (bracket[0] / N) * Math.PI * 2
  let hi = phi0 + (bracket[1] / N) * Math.PI * 2
  const glo = leftArea(lo) - target
  for (let it = 0; it < 200 && hi - lo > 1e-13; it++) {
    const mid = (lo + hi) / 2
    const gm = leftArea(mid) - target
    if ((gm <= 0) === (glo <= 0)) lo = mid
    else hi = mid
  }
  const phi = (lo + hi) / 2
  const d: Pt = [Math.cos(phi), Math.sin(phi)]
  return finish(ring, -d[1], d[0], d[1] * F[0] - d[0] * F[1], F, d)
}

// ---------------------------------------------------------------------------
// Cubatures
// ---------------------------------------------------------------------------

export interface Cubature {
  /** Surface traitée (couverte par le MNT et intérieure au contour). */
  area: number
  /** Volume de déblai : terrain au-dessus de la plateforme. */
  cut: number
  /** Volume de remblai : terrain au-dessous de la plateforme. */
  fill: number
  /** Surface du contour non couverte par le MNT (non calculée). */
  uncovered: number
}

/**
 * Volumes exacts entre le MNT (facettes planes) et une plateforme horizontale, dans un
 * contour facultatif. Chaque triangle est découpé par le contour puis par la ligne où le
 * terrain coupe la plateforme : volume = aire × hauteur au centre de gravité.
 */
export function cutFill(tin: Tin, platform: number, boundary?: ArrayLike<number>): Cubature {
  const { xs, ys, zs, triangles } = tin
  const ox = xs.length ? xs[0] : 0
  const oy = ys.length ? ys[0] : 0
  let bnd: number[] | null = null
  if (boundary && boundary.length >= 6) {
    bnd = []
    for (let i = 0; i < boundary.length; i += 2) bnd.push(boundary[i] - ox, boundary[i + 1] - oy)
  }
  let area = 0
  let cut = 0
  let fill = 0
  for (let t = 0; t < triangles.length; t += 3) {
    let a = triangles[t]
    let b = triangles[t + 1]
    const c = triangles[t + 2]
    let ax = xs[a] - ox
    let ay = ys[a] - oy
    let bx = xs[b] - ox
    let by = ys[b] - oy
    const cx = xs[c] - ox
    const cy = ys[c] - oy
    let cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(cross) < 1e-12) continue
    if (cross < 0) {
      ;[a, b] = [b, a]
      ;[ax, ay, bx, by] = [bx, by, ax, ay]
      cross = -cross
    }
    // Plan du triangle : z = px·x + py·y + pc (coordonnées locales).
    const za = zs[a]
    const zb = zs[b]
    const zc = zs[c]
    const px = ((zb - za) * (cy - ay) - (zc - za) * (by - ay)) / cross
    const py = ((zc - za) * (bx - ax) - (zb - za) * (cx - ax)) / cross
    const pc = za - px * ax - py * ay
    let poly: number[] = [ax, ay, bx, by, cx, cy]
    if (bnd) {
      // Contour (concave possible) découpé par le triangle convexe, arête par arête.
      poly = bnd
      const tri = [ax, ay, bx, by, cx, cy]
      for (let e = 0; e < 3 && poly.length >= 6; e++) {
        const x0 = tri[e * 2]
        const y0 = tri[e * 2 + 1]
        const x1 = tri[((e + 1) % 3) * 2]
        const y1 = tri[((e + 1) % 3) * 2 + 1]
        poly = clipHalfPlane(poly, -(y1 - y0), x1 - x0, (y1 - y0) * x0 - (x1 - x0) * y0)
      }
      if (poly.length < 6) continue
    }
    const pa = Math.abs(signedArea(poly))
    if (pa < 1e-12) continue
    area += pa
    const vol = (piece: number[], sign: number) => {
      if (piece.length < 6) return 0
      const ar = Math.abs(signedArea(piece))
      if (ar < 1e-12) return 0
      const g = centroidOf(piece)
      if (!g) return 0
      return ar * sign * (px * g[0] + py * g[1] + pc - platform)
    }
    if (Math.abs(px) < 1e-15 && Math.abs(py) < 1e-15) {
      const h = pc - platform
      if (h > 0) cut += pa * h
      else fill -= pa * h
      continue
    }
    cut += vol(clipHalfPlane(poly, px, py, pc - platform), 1)
    fill += vol(clipHalfPlane(poly, -px, -py, platform - pc), -1)
  }
  const uncovered = bnd ? Math.max(0, Math.abs(signedArea(bnd)) - area) : 0
  return { area, cut, fill, uncovered: uncovered < 1e-6 ? 0 : uncovered }
}

// ---------------------------------------------------------------------------
// Profil en long
// ---------------------------------------------------------------------------

export interface ProfilePoint {
  /** Abscisse curviligne depuis l'origine de l'axe. */
  d: number
  x: number
  y: number
  /** Altitude du terrain naturel (null hors MNT). */
  z: number | null
  /** Sommet de l'axe ou point d'échantillonnage régulier (présenté dans la guitare). */
  kind: 'sommet' | 'mnt' | 'pas'
}

/**
 * Profil du terrain le long d'un axe : altitudes aux sommets de l'axe, à chaque arête du MNT
 * franchie (cassures exactes du terrain) et aux pas réguliers demandés.
 */
export function longProfile(tin: Tin, axis: ArrayLike<number>, step = 0): ProfilePoint[] {
  const { xs, ys, triangles } = tin
  const edges = new Set<number>()
  const n = xs.length
  const E: [number, number][] = []
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e]
      const b = triangles[t + ((e + 1) % 3)]
      const key = a < b ? a * n + b : b * n + a
      if (edges.has(key)) continue
      edges.add(key)
      E.push([a, b])
    }
  }
  const pts: ProfilePoint[] = []
  let cum = 0
  const m = axis.length >> 1
  for (let i = 0; i < m; i++) {
    const x0 = axis[i * 2]
    const y0 = axis[i * 2 + 1]
    pts.push({ d: cum, x: x0, y: y0, z: null, kind: 'sommet' })
    if (i === m - 1) break
    const x1 = axis[i * 2 + 2]
    const y1 = axis[i * 2 + 3]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const ts: { t: number; kind: ProfilePoint['kind'] }[] = []
    for (const [a, b] of E) {
      const ex = xs[b] - xs[a]
      const ey = ys[b] - ys[a]
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-14) continue
      const t = ((xs[a] - x0) * ey - (ys[a] - y0) * ex) / den
      const u = ((xs[a] - x0) * dy - (ys[a] - y0) * dx) / den
      if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) ts.push({ t, kind: 'mnt' })
    }
    if (step > 0) {
      for (let s = Math.ceil((cum + 1e-9) / step) * step; s < cum + len - 1e-9; s += step) ts.push({ t: (s - cum) / len, kind: 'pas' })
    }
    ts.sort((p, q) => p.t - q.t)
    for (const { t, kind } of ts) pts.push({ d: cum + t * len, x: x0 + dx * t, y: y0 + dy * t, z: null, kind })
    cum += len
  }
  // Fusion des points confondus (un pas régulier qui tombe sur une arête, par exemple).
  const out: ProfilePoint[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.d - p.d) < 1e-6) {
      if (p.kind === 'sommet' || (p.kind === 'pas' && last.kind === 'mnt')) last.kind = p.kind
      continue
    }
    out.push(p)
  }
  for (const p of out) p.z = elevationAt(tin, p.x, p.y)
  return out
}

// ---------------------------------------------------------------------------
// Profils en travers et transformation 2D → 3D
// ---------------------------------------------------------------------------

export interface Station {
  /** Abscisse curviligne sur l'axe. */
  s: number
  x: number
  y: number
  /** Normale unitaire, à gauche du sens de parcours. */
  nx: number
  ny: number
}

/** Tabulation d'un axe : stations au pas donné, aux sommets et aux deux extrémités. */
export function tabulate(axis: ArrayLike<number>, step: number, vertices = true): Station[] {
  const out: Station[] = []
  const m = axis.length >> 1
  let cum = 0
  const push = (s: number, x: number, y: number, ux: number, uy: number) => {
    if (out.length && Math.abs(out[out.length - 1].s - s) < 1e-6) return
    out.push({ s, x, y, nx: -uy, ny: ux })
  }
  for (let i = 0; i + 1 < m; i++) {
    const x0 = axis[i * 2]
    const y0 = axis[i * 2 + 1]
    const dx = axis[i * 2 + 2] - x0
    const dy = axis[i * 2 + 3] - y0
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const ux = dx / len
    const uy = dy / len
    if (i === 0 || vertices) push(cum, x0, y0, ux, uy)
    if (step > 0) for (let s = Math.ceil((cum + 1e-9) / step) * step; s < cum + len - 1e-9; s += step) push(s, x0 + ux * (s - cum), y0 + uy * (s - cum), ux, uy)
    cum += len
    if (i + 2 === m) push(cum, x0 + dx, y0 + dy, ux, uy)
  }
  return out
}

/**
 * Transformation 2D → 3D : altitude de chaque sommet lue sur le MNT, avec en option les
 * points de cassure du terrain. Renvoie null si un sommet est hors du MNT (rien n'est inventé).
 */
export function drape(tin: Tin, pts: ArrayLike<number>, breaks: boolean): { pts: number[]; zs: number[] } | null {
  if (breaks) {
    const prof = longProfile(tin, pts, 0)
    if (prof.some((p) => p.z === null)) return null
    return { pts: prof.flatMap((p) => [p.x, p.y]), zs: prof.map((p) => p.z!) }
  }
  const zs: number[] = []
  for (let i = 0; i < pts.length; i += 2) {
    const z = elevationAt(tin, pts[i], pts[i + 1])
    if (z === null) return null
    zs.push(z)
  }
  return { pts: Array.from(pts), zs }
}
