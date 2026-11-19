/**
 * Opérations géométriques sur les entités : transformations (déplacer, copier, rotation,
 * échelle, miroir), décalage, décomposition, poignées. Toutes les fonctions renvoient de
 * nouvelles entités : les originales ne sont jamais modifiées (annuler/rétablir en dépend).
 */
import { mul, ringArea, rotate, scale, translate } from '../core/geom'
import type { Affine, Block, Color, EInsert, EText, Entity } from '../core/types'

export type Pt = [number, number]

export function apply(m: Affine, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

const det = (m: Affine) => m[0] * m[3] - m[1] * m[2]

/** Direction d'un angle après transformation. */
function dirAngle(m: Affine, a: number): number {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return Math.atan2(m[1] * c + m[3] * s, m[0] * c + m[2] * s)
}

/** Angle de texte lisible (jamais la tête en bas). */
export function readableAngle(a: number): number {
  let r = a
  while (r > Math.PI / 2 + 1e-9) r -= Math.PI
  while (r <= -Math.PI / 2 + 1e-9) r += Math.PI
  return r
}

function tPts(m: Affine, pts: ArrayLike<number>): Float64Array {
  const out = new Float64Array(pts.length)
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = m[0] * pts[i] + m[2] * pts[i + 1] + m[4]
    out[i + 1] = m[1] * pts[i] + m[3] * pts[i + 1] + m[5]
  }
  return out
}

export function transformText(e: EText, m: Affine): EText {
  const [x, y] = apply(m, e.x, e.y)
  const s = Math.sqrt(Math.abs(det(m)))
  const rot = det(m) < 0 ? readableAngle(dirAngle(m, e.rot)) : dirAngle(m, e.rot)
  return { ...e, x, y, h: e.h * s, rot, ...(e.width ? { width: e.width * s } : {}) }
}

/** Matrice d'une insertion de bloc, sans le point de base du bloc. */
export function insertMatrix(e: EInsert): Affine {
  let m: Affine = translate(e.x, e.y)
  if (e.mirror) m = mul(scale(-1, 1), m)
  m = mul(m, rotate(e.rot))
  return mul(m, scale(e.sx, e.sy))
}

function transformInsert(e: EInsert, m: Affine): EInsert {
  const M = mul(m, insertMatrix(e))
  const sx = Math.hypot(M[0], M[1])
  const rot = Math.atan2(M[1], M[0])
  const sy = (det(M) < 0 ? -1 : 1) * Math.hypot(M[2], M[3])
  const s = Math.sqrt(Math.abs(det(m)))
  const attribs = e.attribs?.map((a) => transformText(a, e.mirror ? mul(m, scale(-1, 1)) : m))
  const out: EInsert = { ...e, x: M[4], y: M[5], sx, sy, rot, ...(attribs ? { attribs } : {}) }
  delete out.mirror
  if (out.dx) out.dx *= s
  if (out.dy) out.dy *= s
  return out
}

/** Applique une similitude (translation, rotation, échelle uniforme, symétrie) à une entité. */
export function transformEntity(e: Entity, m: Affine): Entity {
  const s = Math.sqrt(Math.abs(det(m)))
  const mirrored = det(m) < 0
  switch (e.t) {
    case 'point': {
      const [x, y] = apply(m, e.x, e.y)
      return { ...e, x, y }
    }
    case 'line': {
      const [x1, y1] = apply(m, e.x1, e.y1)
      const [x2, y2] = apply(m, e.x2, e.y2)
      return { ...e, x1, y1, x2, y2 }
    }
    case 'pline':
      return { ...e, pts: tPts(m, e.pts), ...(e.bulges ? { bulges: mirrored ? e.bulges.map((b) => -b) : e.bulges.slice() } : {}) }
    case 'circle': {
      const [cx, cy] = apply(m, e.cx, e.cy)
      return { ...e, cx, cy, r: e.r * s }
    }
    case 'arc': {
      const [cx, cy] = apply(m, e.cx, e.cy)
      const a0 = dirAngle(m, e.a0)
      const a1 = dirAngle(m, e.a1)
      return { ...e, cx, cy, r: e.r * s, a0: mirrored ? a1 : a0, a1: mirrored ? a0 : a1 }
    }
    case 'ellipse': {
      const [cx, cy] = apply(m, e.cx, e.cy)
      return { ...e, cx, cy, mx: m[0] * e.mx + m[2] * e.my, my: m[1] * e.mx + m[3] * e.my, a0: mirrored ? -e.a1 : e.a0, a1: mirrored ? -e.a0 : e.a1 }
    }
    case 'spline':
      return { ...e, ctrl: tPts(m, e.ctrl), ...(e.fit ? { fit: tPts(m, e.fit) } : {}) }
    case 'text':
      return transformText(e, m)
    case 'polygon':
      return { ...e, rings: e.rings.map((r) => tPts(m, r)) }
    case 'insert':
      return transformInsert(e, m)
  }
}

export function rotationAbout(x: number, y: number, a: number): Affine {
  return mul(translate(x, y), mul(rotate(a), translate(-x, -y)))
}

export function scaleAbout(x: number, y: number, f: number): Affine {
  return mul(translate(x, y), mul(scale(f, f), translate(-x, -y)))
}

/** Symétrie par rapport à la droite (x1,y1)-(x2,y2). */
export function mirrorAbout(x1: number, y1: number, x2: number, y2: number): Affine {
  const a = Math.atan2(y2 - y1, x2 - x1)
  return mul(translate(x1, y1), mul(rotate(a), mul(scale(1, -1), mul(rotate(-a), translate(-x1, -y1)))))
}

// ---------------------------------------------------------------------------
// Décalage (parallèle)
// ---------------------------------------------------------------------------

/** Polyligne parallèle à la distance `d` (positive : à gauche du sens de parcours). */
export function offsetPolyline(pts: ArrayLike<number>, closed: boolean, d: number): number[] {
  const n = pts.length >> 1
  if (n < 2) return []
  const segs: { x: number; y: number; ux: number; uy: number }[] = []
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n
    const dx = pts[j * 2] - pts[i * 2]
    const dy = pts[j * 2 + 1] - pts[i * 2 + 1]
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const ux = dx / len
    const uy = dy / len
    segs.push({ x: pts[i * 2] - uy * d, y: pts[i * 2 + 1] + ux * d, ux, uy })
  }
  if (!segs.length) return []
  const meet = (a: (typeof segs)[number], b: (typeof segs)[number], fx: number, fy: number): Pt => {
    const den = a.ux * b.uy - a.uy * b.ux
    if (Math.abs(den) < 1e-12) return [fx, fy]
    const t = ((b.x - a.x) * b.uy - (b.y - a.y) * b.ux) / den
    const x = a.x + a.ux * t
    const y = a.y + a.uy * t
    // Angle très aigu : on évite les pointes démesurées.
    return Math.hypot(x - fx, y - fy) > 10 * Math.abs(d) ? [fx, fy] : [x, y]
  }
  const out: number[] = []
  const m = segs.length
  if (closed) {
    for (let i = 0; i < m; i++) {
      const prev = segs[(i - 1 + m) % m]
      const p = meet(prev, segs[i], segs[i].x, segs[i].y)
      out.push(p[0], p[1])
    }
  } else {
    out.push(segs[0].x, segs[0].y)
    for (let i = 1; i < m; i++) {
      const p = meet(segs[i - 1], segs[i], segs[i].x, segs[i].y)
      out.push(p[0], p[1])
    }
    const last = segs[m - 1]
    const len = Math.hypot(pts[(n - 1) * 2] - pts[(n - 2) * 2], pts[(n - 1) * 2 + 1] - pts[(n - 2) * 2 + 1])
    out.push(last.x + last.ux * len, last.y + last.uy * len)
  }
  return out
}

/** Côté d'un point par rapport à une polyligne : +1 à gauche, -1 à droite (segment le plus proche). */
export function sideOf(pts: ArrayLike<number>, closed: boolean, x: number, y: number): number {
  const n = pts.length >> 1
  let best = Infinity
  let sign = 1
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n
    const x0 = pts[i * 2]
    const y0 = pts[i * 2 + 1]
    const dx = pts[j * 2] - x0
    const dy = pts[j * 2 + 1] - y0
    const l2 = dx * dx + dy * dy
    if (l2 === 0) continue
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2))
    const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy))
    if (d < best) {
      best = d
      sign = dx * (y - y0) - dy * (x - x0) >= 0 ? 1 : -1
    }
  }
  return sign
}

// ---------------------------------------------------------------------------
// Décomposition
// ---------------------------------------------------------------------------

function arcFromBulge(x0: number, y0: number, x1: number, y1: number, b: number): { cx: number; cy: number; r: number; a0: number; a1: number } {
  const dx = x1 - x0
  const dy = y1 - y0
  const k = (1 - b * b) / (4 * b)
  const cx = (x0 + x1) / 2 - dy * k
  const cy = (y0 + y1) / 2 + dx * k
  const r = Math.hypot(x0 - cx, y0 - cy)
  const s = Math.atan2(y0 - cy, x0 - cx)
  const e = Math.atan2(y1 - cy, x1 - cx)
  return b > 0 ? { cx, cy, r, a0: s, a1: e } : { cx, cy, r, a0: e, a1: s }
}

/** Décompose une entité en entités plus simples. Renvoie null si elle n'est pas décomposable. */
export function explode(e: Entity, blocks: Map<string, Block>): Entity[] | null {
  const base = { layer: e.layer, color: e.color, ...(e.lw !== undefined ? { lw: e.lw } : {}) }
  if (e.t === 'pline') {
    const n = e.pts.length >> 1
    const out: Entity[] = []
    const count = e.closed ? n : n - 1
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n
      const x0 = e.pts[i * 2]
      const y0 = e.pts[i * 2 + 1]
      const x1 = e.pts[j * 2]
      const y1 = e.pts[j * 2 + 1]
      const b = e.bulges?.[i] ?? 0
      if (Math.abs(b) > 1e-12) out.push({ t: 'arc', ...base, ...arcFromBulge(x0, y0, x1, y1, b) })
      else out.push({ t: 'line', ...base, x1: x0, y1: y0, x2: x1, y2: y1, ...(e.zs ? { z1: e.zs[i], z2: e.zs[j] } : {}) })
    }
    return out
  }
  if (e.t === 'polygon') return e.rings.map((r) => ({ t: 'pline', ...base, pts: r.slice(), closed: true }) as Entity)
  if (e.t === 'insert') {
    const block = blocks.get(e.block)
    if (!block) return null
    const m = mul(insertMatrix(e), translate(-block.bx, -block.by))
    const resolve = (c: Entity): Entity => {
      const color: Color = c.color === -2 ? e.color : c.color
      return { ...c, layer: c.layer === '0' ? e.layer : c.layer, color }
    }
    const out = block.entities.map((c) => resolve(transformEntity(c, m)))
    for (const a of e.attribs ?? []) out.push({ ...a })
    return out
  }
  return null
}

// ---------------------------------------------------------------------------
// Poignées
// ---------------------------------------------------------------------------

export function grips(e: Entity): Pt[] {
  switch (e.t) {
    case 'line':
      return [
        [e.x1, e.y1],
        [e.x2, e.y2],
      ]
    case 'pline': {
      const out: Pt[] = []
      for (let i = 0; i < e.pts.length; i += 2) out.push([e.pts[i], e.pts[i + 1]])
      return out
    }
    case 'polygon': {
      const out: Pt[] = []
      const r = e.rings[0]
      for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]])
      return out
    }
    case 'circle':
    case 'arc':
      return [[e.cx, e.cy]]
    case 'ellipse':
      return [[e.cx, e.cy]]
    case 'spline': {
      const src = e.ctrl.length ? e.ctrl : (e.fit ?? e.ctrl)
      const out: Pt[] = []
      for (let i = 0; i < src.length; i += 2) out.push([src[i], src[i + 1]])
      return out
    }
    case 'point':
    case 'text':
      return [[e.x, e.y]]
    case 'insert':
      return e.mirror ? [] : [[e.x, e.y]]
  }
}

/** Entité modifiée après déplacement d'une poignée. */
export function moveGrip(e: Entity, index: number, x: number, y: number): Entity {
  switch (e.t) {
    case 'line':
      return index === 0 ? { ...e, x1: x, y1: y } : { ...e, x2: x, y2: y }
    case 'pline': {
      const pts = e.pts.slice()
      pts[index * 2] = x
      pts[index * 2 + 1] = y
      return { ...e, pts }
    }
    case 'polygon': {
      const rings = e.rings.map((r) => r.slice())
      rings[0][index * 2] = x
      rings[0][index * 2 + 1] = y
      return { ...e, rings }
    }
    case 'spline': {
      if (e.ctrl.length) {
        const ctrl = e.ctrl.slice()
        ctrl[index * 2] = x
        ctrl[index * 2 + 1] = y
        return { ...e, ctrl }
      }
      const fit = (e.fit ?? new Float64Array()).slice()
      fit[index * 2] = x
      fit[index * 2 + 1] = y
      return { ...e, fit }
    }
    default: {
      const g = grips(e)[index]
      return g ? transformEntity(e, translate(x - g[0], y - g[1])) : e
    }
  }
}

// ---------------------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------------------

/** Contour fermé d'une entité (polyligne fermée, surface, cercle), ou null. */
export function closedRing(e: Entity): number[] | null {
  if (e.t === 'pline' && (e.closed || (e.pts.length >= 6 && e.pts[0] === e.pts[e.pts.length - 2] && e.pts[1] === e.pts[e.pts.length - 1]))) return Array.from(e.pts)
  if (e.t === 'polygon') return Array.from(e.rings[0])
  if (e.t === 'circle') {
    const out: number[] = []
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2
      out.push(e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a))
    }
    return out
  }
  return null
}

/** Sommets d'une entité linéaire ou surfacique (pour coter, numéroter, tabuler). */
export function vertices(e: Entity): { pts: number[]; closed: boolean } | null {
  if (e.t === 'pline') return { pts: Array.from(e.pts), closed: e.closed }
  if (e.t === 'polygon') return { pts: Array.from(e.rings[0]), closed: true }
  if (e.t === 'line') return { pts: [e.x1, e.y1, e.x2, e.y2], closed: false }
  return null
}

export function centroid(ring: ArrayLike<number>): Pt {
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
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0
    let sy = 0
    for (let i = 0; i < n; i++) {
      sx += ring[i * 2]
      sy += ring[i * 2 + 1]
    }
    return [sx / n, sy / n]
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)]
}

export function ringAreaAbs(ring: ArrayLike<number>): number {
  return Math.abs(ringArea(ring))
}

/**
 * Directions vers l'intérieur d'un polygone : pour chaque côté (normale unitaire) et pour
 * chaque sommet (bissectrice des normales des deux côtés), selon le sens de parcours.
 */
export function inwardFrames(ring: ArrayLike<number>): { edge: Pt[]; vertex: Pt[] } {
  const n = ring.length >> 1
  const ccw = ringArea(ring) > 0
  const edge: Pt[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = ring[j * 2] - ring[i * 2]
    const dy = ring[j * 2 + 1] - ring[i * 2 + 1]
    const l = Math.hypot(dx, dy) || 1
    // Intérieur à gauche du côté si le polygone tourne dans le sens trigonométrique.
    edge.push(ccw ? [-dy / l, dx / l] : [dy / l, -dx / l])
  }
  const vertex: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = edge[(i - 1 + n) % n]
    const b = edge[i]
    let x = a[0] + b[0]
    let y = a[1] + b[1]
    const l = Math.hypot(x, y)
    if (l < 1e-9) [x, y] = b
    else {
      x /= l
      y /= l
    }
    vertex.push([x, y])
  }
  return { edge, vertex }
}

/** Gisement de A vers B en grades (0 au nord, sens horaire, 400 gr par tour). */
export function gisement(ax: number, ay: number, bx: number, by: number): number {
  let g = (Math.atan2(bx - ax, by - ay) * 200) / Math.PI
  if (g < 0) g += 400
  return g
}

/** Point situé à une distance et un gisement (grades) d'une station. */
export function pointRayonne(x: number, y: number, gisementGr: number, distance: number): Pt {
  const a = (gisementGr * Math.PI) / 200
  return [x + distance * Math.sin(a), y + distance * Math.cos(a)]
}

/** Cercle passant par trois points, ou null s'ils sont alignés. */
export function circleThrough(p1: Pt, p2: Pt, p3: Pt): { cx: number; cy: number; r: number } | null {
  const ox = p1[0]
  const oy = p1[1]
  const bx = p2[0] - ox
  const by = p2[1] - oy
  const cx = p3[0] - ox
  const cy = p3[1] - oy
  const d = 2 * (bx * cy - by * cx)
  if (Math.abs(d) < 1e-12) return null
  const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d
  const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d
  return { cx: ox + ux, cy: oy + uy, r: Math.hypot(ux, uy) }
}
