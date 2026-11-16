/**
 * Géométrie : transformations affines, discrétisation des courbes CAO et parcours
 * d'un jeu de données en primitives simples (polylignes, surfaces, points, textes).
 *
 * Un seul parcours (`walkDataset`) alimente à la fois le moteur de rendu, la
 * sélection et tous les exports : ce qui est affiché est ce qui est exporté.
 */
import {
  BYBLOCK,
  BYLAYER,
  FOREGROUND,
  type Affine,
  type Color,
  type Dataset,
  type EInsert,
  type EText,
  type Entity,
  type Extent,
} from './types'

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

/** Compose deux transformations : résultat = m ∘ n (n appliquée en premier). */
export function mul(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function translate(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y]
}

export function rotate(a: number): Affine {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, s, -s, c, 0, 0]
}

export function scale(sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, 0, 0]
}

/** Projection d'un point vers le système cible (ou identité). */
export type Projector = (x: number, y: number) => [number, number]

export interface Style {
  layer: string
  /** Couleur résolue 0xRRGGBB, ou FOREGROUND. */
  color: Color
  /** Épaisseur en mm. */
  lw: number
}

/** Récepteur de primitives. Les coordonnées sont dans le système cible. */
export interface Sink {
  /** Début d'une entité de premier niveau (index dans `dataset.entities`). */
  begin(index: number, entity: Entity): void
  polyline(pts: number[], closed: boolean, zs: number[] | number | null, style: Style): void
  /** Surface pleine (anneaux extérieurs puis trous). `alpha` entre 0 et 1. */
  fill(rings: number[][], alpha: number, style: Style): void
  point(x: number, y: number, z: number | null, style: Style): void
  text(x: number, y: number, h: number, rot: number, text: string, ha: number, va: number, style: Style): void
}

// ---------------------------------------------------------------------------
// Couleurs AutoCAD (ACI)
// ---------------------------------------------------------------------------

const ACI: number[] = (() => {
  const table = new Array<number>(256).fill(0xffffff)
  const base = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0]
  for (let i = 0; i < 10; i++) table[i] = base[i]
  const values = [1, 0.8, 0.6, 0.5, 0.3]
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15
    const v = values[Math.floor(((i - 10) % 10) / 2)]
    const s = i % 2 === 0 ? 1 : 0.5
    const c = v * s
    const hp = hue / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))
    let r = 0
    let g = 0
    let b = 0
    if (hp < 1) [r, g, b] = [c, x, 0]
    else if (hp < 2) [r, g, b] = [x, c, 0]
    else if (hp < 3) [r, g, b] = [0, c, x]
    else if (hp < 4) [r, g, b] = [0, x, c]
    else if (hp < 5) [r, g, b] = [x, 0, c]
    else [r, g, b] = [c, 0, x]
    const m = v - c
    table[i] = (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255)
  }
  const grays = [0x333333, 0x5b5b5b, 0x848484, 0xadadad, 0xd6d6d6, 0xffffff]
  for (let i = 0; i < 6; i++) table[250 + i] = grays[i]
  return table
})()

/** Convertit un index de couleur AutoCAD (0–256) en couleur du modèle. */
export function aciToColor(index: number): Color {
  if (index === 0) return BYBLOCK
  if (index === 256 || index < 0) return BYLAYER
  if (index === 7) return FOREGROUND
  return ACI[index] ?? FOREGROUND
}

/** Index ACI le plus proche d'une couleur RVB (pour l'export DXF). */
export function colorToAci(color: Color): number {
  if (color === BYLAYER) return 256
  if (color === BYBLOCK) return 0
  if (color === FOREGROUND) return 7
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  let best = 7
  let bestD = Infinity
  for (let i = 1; i < 256; i++) {
    const c = ACI[i]
    const d = ((c >> 16) & 255) - r
    const e = ((c >> 8) & 255) - g
    const f = (c & 255) - b
    const dist = d * d + e * e + f * f
    if (dist < bestD) {
      bestD = dist
      best = i
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Discrétisation des courbes
// ---------------------------------------------------------------------------

/** Nombre de segments pour un arc de rayon r et d'angle `sweep`, à la tolérance de corde `tol`. */
export function arcSegments(r: number, sweep: number, tol: number): number {
  const a = Math.abs(sweep)
  if (!(r > 0) || a === 0) return 1
  const step = r > tol ? 2 * Math.acos(1 - Math.min(tol / r, 1)) : Math.PI / 2
  const n = Math.ceil(a / Math.max(step, 1e-4))
  return Math.max(Math.min(n, 1440), Math.ceil(a / (Math.PI / 6)), 1)
}

/** Ajoute à `out` les points d'un arc (sans le point de départ si `skipFirst`). */
export function appendArc(
  out: number[],
  cx: number,
  cy: number,
  r: number,
  a0: number,
  sweep: number,
  tol: number,
  skipFirst: boolean,
): void {
  const n = arcSegments(r, sweep, tol)
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
}

/** Discrétise une polyligne à bulges en liste de points. */
export function tessellateBulges(
  pts: ArrayLike<number>,
  bulges: ArrayLike<number> | undefined,
  closed: boolean,
  tol: number,
): number[] {
  const n = pts.length >> 1
  const out: number[] = []
  if (n === 0) return out
  out.push(pts[0], pts[1])
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n
    const x0 = pts[i * 2]
    const y0 = pts[i * 2 + 1]
    const x1 = pts[j * 2]
    const y1 = pts[j * 2 + 1]
    const b = bulges ? bulges[i] : 0
    if (b && Math.abs(b) > 1e-12) {
      const dx = x1 - x0
      const dy = y1 - y0
      const d = Math.hypot(dx, dy)
      if (d > 0) {
        const k = (1 - b * b) / (4 * b)
        const cx = (x0 + x1) / 2 - dy * k
        const cy = (y0 + y1) / 2 + dx * k
        const r = Math.hypot(x0 - cx, y0 - cy)
        const a0 = Math.atan2(y0 - cy, x0 - cx)
        appendArc(out, cx, cy, r, a0, 4 * Math.atan(b), tol, true)
        // Le dernier point calculé remplace exactement le sommet d'arrivée.
        out[out.length - 2] = x1
        out[out.length - 1] = y1
        continue
      }
    }
    out.push(x1, y1)
  }
  if (closed && out.length >= 4) {
    out.length -= 2 // le point de fermeture est implicite
  }
  return out
}

/** Évalue une B-spline (rationnelle si `weights`) par l'algorithme de De Boor. */
export function tessellateSpline(
  degree: number,
  knots: ArrayLike<number>,
  ctrl: ArrayLike<number>,
  weights: ArrayLike<number> | undefined,
  samples: number,
): number[] {
  const n = ctrl.length >> 1
  const out: number[] = []
  if (n === 0) return out
  const p = Math.max(1, Math.min(degree, n - 1))
  if (knots.length < n + p + 1) {
    for (let i = 0; i < n; i++) out.push(ctrl[i * 2], ctrl[i * 2 + 1])
    return out
  }
  const t0 = knots[p]
  const t1 = knots[n]
  const dx = new Float64Array(p + 1)
  const dy = new Float64Array(p + 1)
  const dw = new Float64Array(p + 1)
  let span = p
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + ((t1 - t0) * s) / samples
    while (span < n - 1 && t >= knots[span + 1]) span++
    for (let j = 0; j <= p; j++) {
      const idx = span - p + j
      const w = weights ? weights[idx] : 1
      dx[j] = ctrl[idx * 2] * w
      dy[j] = ctrl[idx * 2 + 1] * w
      dw[j] = w
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = span - p + j
        const denom = knots[i + p - r + 1] - knots[i]
        const a = denom === 0 ? 0 : (t - knots[i]) / denom
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j]
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j]
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j]
      }
    }
    const w = dw[p] || 1
    out.push(dx[p] / w, dy[p] / w)
  }
  return out
}

/** Courbe de Catmull-Rom passant par des points (pour les splines définies par points de passage). */
export function tessellateFit(fit: ArrayLike<number>, perSpan: number): number[] {
  const n = fit.length >> 1
  const out: number[] = []
  if (n < 3) {
    for (let i = 0; i < n * 2; i++) out.push(fit[i])
    return out
  }
  const P = (i: number, k: number) => fit[Math.max(0, Math.min(n - 1, i)) * 2 + k]
  for (let i = 0; i < n - 1; i++) {
    for (let s = 0; s < perSpan; s++) {
      const t = s / perSpan
      const t2 = t * t
      const t3 = t2 * t
      for (let k = 0; k < 2; k++) {
        const p0 = P(i - 1, k)
        const p1 = P(i, k)
        const p2 = P(i + 1, k)
        const p3 = P(i + 2, k)
        out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
      }
    }
  }
  out.push(fit[(n - 1) * 2], fit[(n - 1) * 2 + 1])
  return out
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** Retire les codes de mise en forme d'un MTEXT et renvoie le texte lisible. */
export function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[ACcFfHhQTWpLlOoKk][^;\\]*;/g, '')
    .replace(/\\S([^;^#/]*)[\^#/]([^;]*);/g, '$1/$2')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\([\\{}])/g, '$1')
    .replace(/[{}]/g, '')
}

/** Décode les séquences spéciales des textes DXF (%%d, \U+XXXX…). */
export function decodeDxfText(s: string): string {
  if (s.indexOf('%%') < 0 && s.indexOf('\\U+') < 0 && s.indexOf('\\M+') < 0) return s
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%')
}

// ---------------------------------------------------------------------------
// Parcours d'un jeu de données
// ---------------------------------------------------------------------------

interface Ctx {
  /** Calque de l'insertion englobante (pour les entités du calque 0). */
  layer: string | null
  /** Couleur de l'insertion englobante (pour BYBLOCK). */
  color: Color
  depth: number
}

export interface WalkOptions {
  /** Tolérance de corde pour la discrétisation des courbes, en unités du jeu. */
  tol?: number
  /** Ne parcourir que ces entités (index). */
  only?: Iterable<number>
}

/** Estime l'emprise brute d'un jeu (points caractéristiques, sans développer les blocs). */
export function rawExtent(ds: Dataset): Extent {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const e of ds.entities) {
    switch (e.t) {
      case 'point':
      case 'text':
      case 'insert':
        add(e.x, e.y)
        break
      case 'line':
        add(e.x1, e.y1)
        add(e.x2, e.y2)
        break
      case 'pline':
        for (let i = 0; i < e.pts.length; i += 2) add(e.pts[i], e.pts[i + 1])
        break
      case 'circle':
      case 'arc':
        add(e.cx - e.r, e.cy - e.r)
        add(e.cx + e.r, e.cy + e.r)
        break
      case 'ellipse': {
        const r = Math.hypot(e.mx, e.my)
        add(e.cx - r, e.cy - r)
        add(e.cx + r, e.cy + r)
        break
      }
      case 'spline': {
        const a = e.ctrl.length ? e.ctrl : (e.fit ?? e.ctrl)
        for (let i = 0; i < a.length; i += 2) add(a[i], a[i + 1])
        break
      }
      case 'polygon':
        for (const ring of e.rings) for (let i = 0; i < ring.length; i += 2) add(ring[i], ring[i + 1])
        break
    }
  }
  if (minX > maxX) return [0, 0, 0, 0]
  return [minX, minY, maxX, maxY]
}

/**
 * Parcourt les entités d'un jeu et émet des primitives simples dans le système cible.
 * Chaîne appliquée à chaque point : coordonnées locales → transformation de bloc →
 * calage du jeu (`xform`) → projection.
 */
export function walkDataset(ds: Dataset, project: Projector | null, sink: Sink, options: WalkOptions = {}): void {
  let tol = options.tol
  if (tol === undefined) {
    const ext = rawExtent(ds)
    const diag = Math.hypot(ext[2] - ext[0], ext[3] - ext[1])
    tol = Math.max(diag * 1e-6, 1e-9)
  }
  const tolerance = tol
  const root: Affine = ds.xform ?? IDENTITY
  const rootIsIdentity = !ds.xform

  const tp = (m: Affine | null, x: number, y: number): [number, number] => {
    if (m) {
      const tx = m[0] * x + m[2] * y + m[4]
      const ty = m[1] * x + m[3] * y + m[5]
      return project ? project(tx, ty) : [tx, ty]
    }
    return project ? project(x, y) : [x, y]
  }

  const tpts = (m: Affine | null, pts: ArrayLike<number>): number[] => {
    const out = new Array<number>(pts.length)
    if (!m && !project) {
      for (let i = 0; i < pts.length; i++) out[i] = pts[i]
      return out
    }
    for (let i = 0; i < pts.length; i += 2) {
      const p = tp(m, pts[i], pts[i + 1])
      out[i] = p[0]
      out[i + 1] = p[1]
    }
    return out
  }

  const resolve = (e: Entity, ctx: Ctx): Style => {
    const layerName = e.layer === '0' && ctx.layer !== null ? ctx.layer : e.layer
    const layer = ds.layers.get(layerName)
    let color = e.color
    if (color === BYBLOCK) color = ctx.depth > 0 ? ctx.color : FOREGROUND
    if (color === BYLAYER) color = layer ? layer.color : FOREGROUND
    if (color === BYLAYER || color === BYBLOCK) color = FOREGROUND
    let lw = e.lw ?? -1
    if (lw < 0) lw = layer ? layer.lineweight : 0
    return { layer: layerName, color, lw }
  }

  const emitText = (e: EText, m: Affine | null, style: Style) => {
    const p = tp(m, e.x, e.y)
    // Le vecteur « haut » du texte donne la hauteur et la rotation après transformation.
    const ux = e.x - Math.sin(e.rot) * e.h
    const uy = e.y + Math.cos(e.rot) * e.h
    const q = tp(m, ux, uy)
    const h = Math.hypot(q[0] - p[0], q[1] - p[1])
    const rot = Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.PI / 2
    if (h > 0 && e.text) sink.text(p[0], p[1], h, rot, e.text, e.ha, e.va, style)
  }

  const insertMatrix = (e: EInsert, parent: Affine | null, bx: number, by: number, col: number, row: number): Affine => {
    let m: Affine = translate(e.x, e.y)
    if (e.mirror) m = mul(scale(-1, 1), m)
    m = mul(m, rotate(e.rot))
    if (col || row) m = mul(m, translate(col * (e.dx ?? 0), row * (e.dy ?? 0)))
    m = mul(m, scale(e.sx, e.sy))
    m = mul(m, translate(-bx, -by))
    return parent ? mul(parent, m) : m
  }

  const emit = (e: Entity, m: Affine | null, ctx: Ctx): void => {
    const style = resolve(e, ctx)
    switch (e.t) {
      case 'point': {
        const p = tp(m, e.x, e.y)
        sink.point(p[0], p[1], e.z ?? null, style)
        break
      }
      case 'line': {
        const a = tp(m, e.x1, e.y1)
        const b = tp(m, e.x2, e.y2)
        const zs = e.z1 !== undefined || e.z2 !== undefined ? [e.z1 ?? 0, e.z2 ?? 0] : null
        sink.polyline([a[0], a[1], b[0], b[1]], false, zs, style)
        break
      }
      case 'pline': {
        const hasBulge = !!e.bulges && e.bulges.some((b) => b !== 0)
        if (hasBulge) {
          const pts = tessellateBulges(e.pts, e.bulges, e.closed, tolerance)
          sink.polyline(tpts(m, pts), e.closed, e.elev ?? null, style)
        } else {
          sink.polyline(tpts(m, e.pts), e.closed, e.zs ? Array.from(e.zs) : (e.elev ?? null), style)
        }
        break
      }
      case 'circle': {
        const pts: number[] = []
        appendArc(pts, e.cx, e.cy, e.r, 0, Math.PI * 2, tolerance, false)
        pts.length -= 2
        sink.polyline(tpts(m, pts), true, e.z ?? null, style)
        break
      }
      case 'arc': {
        let sweep = e.a1 - e.a0
        while (sweep <= 0) sweep += Math.PI * 2
        const pts: number[] = []
        appendArc(pts, e.cx, e.cy, e.r, e.a0, sweep, tolerance, false)
        sink.polyline(tpts(m, pts), false, e.z ?? null, style)
        break
      }
      case 'ellipse': {
        let sweep = e.a1 - e.a0
        while (sweep <= 0) sweep += Math.PI * 2
        const full = Math.abs(sweep - Math.PI * 2) < 1e-9
        const major = Math.hypot(e.mx, e.my)
        const n = arcSegments(major, sweep, tolerance)
        const nx = -e.my * e.ratio
        const ny = e.mx * e.ratio
        const pts: number[] = []
        for (let i = 0; i <= n - (full ? 1 : 0); i++) {
          const t = e.a0 + (sweep * i) / n
          pts.push(e.cx + e.mx * Math.cos(t) + nx * Math.sin(t), e.cy + e.my * Math.cos(t) + ny * Math.sin(t))
        }
        sink.polyline(tpts(m, pts), full, null, style)
        break
      }
      case 'spline': {
        let pts: number[]
        if (e.ctrl.length >= 4) {
          const count = e.ctrl.length >> 1
          pts = tessellateSpline(e.degree, e.knots, e.ctrl, e.weights, Math.min(Math.max(count * 8, 16), 4000))
        } else if (e.fit && e.fit.length >= 4) {
          pts = tessellateFit(e.fit, 12)
        } else break
        sink.polyline(tpts(m, pts), false, null, style)
        break
      }
      case 'text':
        emitText(e, m, style)
        break
      case 'polygon': {
        const rings = e.rings.map((r) => tpts(m, r))
        if (e.filled) {
          const gis = ds.kind === 'gis'
          sink.fill(rings, gis ? 0.28 : e.pattern && e.pattern !== 'SOLID' ? 0.35 : 0.85, style)
        }
        if (!e.filled || ds.kind === 'gis') {
          for (let i = 0; i < rings.length; i++) sink.polyline(rings[i], true, e.zs ? Array.from(e.zs[i]) : null, style)
        }
        break
      }
      case 'insert': {
        const block = ds.blocks.get(e.block)
        if (block && ctx.depth < 12) {
          const sub: Ctx = { layer: style.layer, color: style.color, depth: ctx.depth + 1 }
          const cols = Math.max(1, e.cols ?? 1)
          const rows = Math.max(1, e.rows ?? 1)
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const mi = insertMatrix(e, m, block.bx, block.by, c, r)
              for (const child of block.entities) emit(child, mi, sub)
            }
          }
        } else if (!block) {
          // Bloc introuvable : on matérialise au moins le point d'insertion.
          const p = tp(m, e.x, e.y)
          sink.point(p[0], p[1], e.z ?? null, style)
        }
        if (e.attribs) {
          const am = e.mirror ? (m ? mul(m, scale(-1, 1)) : scale(-1, 1)) : m
          for (const a of e.attribs) emitText(a, am, resolve(a, { layer: style.layer, color: style.color, depth: ctx.depth + 1 }))
        }
        break
      }
    }
  }

  const top: Ctx = { layer: null, color: FOREGROUND, depth: 0 }
  const m0 = rootIsIdentity ? null : root
  if (options.only) {
    for (const i of options.only) {
      const e = ds.entities[i]
      if (!e) continue
      sink.begin(i, e)
      emit(e, m0, top)
    }
  } else {
    for (let i = 0; i < ds.entities.length; i++) {
      const e = ds.entities[i]
      sink.begin(i, e)
      emit(e, m0, top)
    }
  }
}

// ---------------------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------------------

export function polylineLength(pts: ArrayLike<number>, closed: boolean): number {
  let len = 0
  const n = pts.length >> 1
  for (let i = 1; i < n; i++) len += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
  if (closed && n > 1) len += Math.hypot(pts[0] - pts[n * 2 - 2], pts[1] - pts[n * 2 - 1])
  return len
}

/** Aire signée (positive en sens trigonométrique). */
export function ringArea(pts: ArrayLike<number>): number {
  const n = pts.length >> 1
  if (n < 3) return 0
  // Décalage vers le premier sommet : garde la précision avec de grandes coordonnées.
  const ox = pts[0]
  const oy = pts[1]
  let a = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += (pts[i * 2] - ox) * (pts[j * 2 + 1] - oy) - (pts[j * 2] - ox) * (pts[i * 2 + 1] - oy)
  }
  return a / 2
}

export function pointInRing(x: number, y: number, pts: ArrayLike<number>): boolean {
  const n = pts.length >> 1
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]
    const yi = pts[i * 2 + 1]
    const xj = pts[j * 2]
    const yj = pts[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance au carré d'un point à un segment, et paramètre du pied de perpendiculaire. */
export function distToSegment2(px: number, py: number, x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  const qx = x0 + t * dx
  const qy = y0 + t * dy
  return [(px - qx) * (px - qx) + (py - qy) * (py - qy), t]
}

export function colorToCss(color: Color, foreground = '#ffffff'): string {
  if (color < 0) return foreground
  return '#' + color.toString(16).padStart(6, '0')
}
