/**
 * Liste d'affichage : les entités d'un jeu de données développées en primitives
 * simples (polylignes, surfaces, points, textes), dans le système de coordonnées
 * du projet. La même liste sert à l'écran, à la sélection, à l'accrochage et à
 * l'impression PDF : ce qui est vu est ce qui est imprimé.
 */
import Flatbush from 'flatbush'
import { walkDataset, type Projector, type Style } from '../core/geom'
import type { Color, Dataset, Extent } from '../core/types'

export interface TextPrim {
  x: number
  y: number
  h: number
  rot: number
  text: string
  ha: number
  va: number
  color: Color
  layer: number
  ent: number
}

export interface FillPrim {
  rings: number[][]
  color: Color
  alpha: number
  layer: number
  ent: number
  bbox: Extent
}

export interface DisplayList {
  datasetId: string
  layerNames: string[]
  /** Sommets de toutes les polylignes : x,y,x,y… */
  coords: Float64Array
  /** Index du premier sommet de chaque polyligne (+ une sentinelle finale). */
  polyStart: Uint32Array
  polyClosed: Uint8Array
  polyColor: Int32Array
  /** Épaisseur en mm. */
  polyLw: Float32Array
  polyLayer: Uint16Array
  polyEnt: Uint32Array
  /** Emprise de chaque polyligne : minX,minY,maxX,maxY. */
  polyBox: Float64Array
  /** Altitude constante de la polyligne (NaN si inconnue ou variable). */
  polyZ: Float64Array
  fills: FillPrim[]
  /** Points : x,y */
  points: Float64Array
  pointZ: Float64Array
  pointColor: Int32Array
  pointLayer: Uint16Array
  pointEnt: Uint32Array
  texts: TextPrim[]
  extent: Extent
  /** Index spatial des polylignes. */
  polyIndex: Flatbush | null
  pointIndex: Flatbush | null
  /** Polylignes regroupées par style, pour tracer par lots. */
  batches: { color: Color; lw: number; ids: Uint32Array }[]
  counts: { polylines: number; vertices: number; fills: number; points: number; texts: number }
}

class Grow {
  buf: Float64Array
  n = 0
  constructor(cap = 1024) {
    this.buf = new Float64Array(cap)
  }
  reserve(extra: number) {
    if (this.n + extra > this.buf.length) {
      const next = new Float64Array(Math.max(this.buf.length * 2, this.n + extra))
      next.set(this.buf.subarray(0, this.n))
      this.buf = next
    }
  }
  done(): Float64Array {
    return this.buf.slice(0, this.n)
  }
}

/** Construit la liste d'affichage d'un jeu, reprojetée par `project` (ou telle quelle). */
export function buildDisplayList(ds: Dataset, project: Projector | null): DisplayList {
  const layerNames: string[] = []
  const layerIds = new Map<string, number>()
  const layerId = (name: string): number => {
    let id = layerIds.get(name)
    if (id === undefined) {
      id = layerNames.length
      layerNames.push(name)
      layerIds.set(name, id)
    }
    return id
  }
  for (const name of ds.layers.keys()) layerId(name)

  const coords = new Grow(1 << 14)
  const starts: number[] = []
  const closedArr: number[] = []
  const colors: number[] = []
  const lws: number[] = []
  const layers: number[] = []
  const ents: number[] = []
  const boxes: number[] = []
  const zsConst: number[] = []
  const fills: FillPrim[] = []
  const pts: number[] = []
  const ptZ: number[] = []
  const ptColor: number[] = []
  const ptLayer: number[] = []
  const ptEnt: number[] = []
  const texts: TextPrim[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let current = 0

  walkDataset(ds, project, {
    begin(index) {
      current = index
    },
    polyline(p, closed, zs, style: Style) {
      const n = p.length
      if (n < 4) return
      let bx0 = Infinity
      let by0 = Infinity
      let bx1 = -Infinity
      let by1 = -Infinity
      coords.reserve(n)
      const buf = coords.buf
      let k = coords.n
      for (let i = 0; i < n; i += 2) {
        const x = p[i]
        const y = p[i + 1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        buf[k++] = x
        buf[k++] = y
        if (x < bx0) bx0 = x
        if (x > bx1) bx1 = x
        if (y < by0) by0 = y
        if (y > by1) by1 = y
      }
      starts.push(coords.n >> 1)
      coords.n = k
      closedArr.push(closed ? 1 : 0)
      colors.push(style.color)
      lws.push(style.lw)
      layers.push(layerId(style.layer))
      ents.push(current)
      boxes.push(bx0, by0, bx1, by1)
      zsConst.push(typeof zs === 'number' ? zs : NaN)
      if (bx0 < minX) minX = bx0
      if (bx1 > maxX) maxX = bx1
      if (by0 < minY) minY = by0
      if (by1 > maxY) maxY = by1
    },
    fill(rings, alpha, style) {
      let bx0 = Infinity
      let by0 = Infinity
      let bx1 = -Infinity
      let by1 = -Infinity
      for (const r of rings) {
        for (let i = 0; i < r.length; i += 2) {
          if (r[i] < bx0) bx0 = r[i]
          if (r[i] > bx1) bx1 = r[i]
          if (r[i + 1] < by0) by0 = r[i + 1]
          if (r[i + 1] > by1) by1 = r[i + 1]
        }
      }
      if (!Number.isFinite(bx0 + by0 + bx1 + by1)) return
      fills.push({ rings, color: style.color, alpha, layer: layerId(style.layer), ent: current, bbox: [bx0, by0, bx1, by1] })
      if (bx0 < minX) minX = bx0
      if (bx1 > maxX) maxX = bx1
      if (by0 < minY) minY = by0
      if (by1 > maxY) maxY = by1
    },
    point(x, y, z, style) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      pts.push(x, y)
      ptZ.push(z ?? NaN)
      ptColor.push(style.color)
      ptLayer.push(layerId(style.layer))
      ptEnt.push(current)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    },
    text(x, y, h, rot, text, ha, va, style) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      texts.push({ x, y, h, rot, text, ha, va, color: style.color, layer: layerId(style.layer), ent: current })
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    },
  })

  const count = starts.length
  starts.push(coords.n >> 1)
  const polyBox = Float64Array.from(boxes)
  let polyIndex: Flatbush | null = null
  if (count > 0) {
    polyIndex = new Flatbush(count)
    for (let i = 0; i < count; i++) polyIndex.add(polyBox[i * 4], polyBox[i * 4 + 1], polyBox[i * 4 + 2], polyBox[i * 4 + 3])
    polyIndex.finish()
  }
  let pointIndex: Flatbush | null = null
  const np = pts.length >> 1
  if (np > 0) {
    pointIndex = new Flatbush(np)
    for (let i = 0; i < np; i++) pointIndex.add(pts[i * 2], pts[i * 2 + 1], pts[i * 2], pts[i * 2 + 1])
    pointIndex.finish()
  }

  // Lots par style : un seul tracé par couple couleur/épaisseur.
  const groups = new Map<string, number[]>()
  for (let i = 0; i < count; i++) {
    const key = colors[i] + '|' + lws[i]
    let g = groups.get(key)
    if (!g) groups.set(key, (g = []))
    g.push(i)
  }
  const batches = [...groups.values()].map((ids) => ({ color: colors[ids[0]], lw: lws[ids[0]], ids: Uint32Array.from(ids) }))

  return {
    datasetId: ds.id,
    layerNames,
    coords: coords.done(),
    polyStart: Uint32Array.from(starts),
    polyClosed: Uint8Array.from(closedArr),
    polyColor: Int32Array.from(colors),
    polyLw: Float32Array.from(lws),
    polyLayer: Uint16Array.from(layers),
    polyEnt: Uint32Array.from(ents),
    polyBox,
    polyZ: Float64Array.from(zsConst),
    fills,
    points: Float64Array.from(pts),
    pointZ: Float64Array.from(ptZ),
    pointColor: Int32Array.from(ptColor),
    pointLayer: Uint16Array.from(ptLayer),
    pointEnt: Uint32Array.from(ptEnt),
    texts,
    extent: minX <= maxX ? [minX, minY, maxX, maxY] : [0, 0, 0, 0],
    polyIndex,
    pointIndex,
    batches,
    counts: { polylines: count, vertices: coords.n >> 1, fills: fills.length, points: np, texts: texts.length },
  }
}

/** Visibilité des calques d'une liste d'affichage, d'après le jeu de données. */
export function layerVisibility(dl: DisplayList, ds: Dataset): Uint8Array {
  const vis = new Uint8Array(dl.layerNames.length)
  for (let i = 0; i < vis.length; i++) vis[i] = ds.layers.get(dl.layerNames[i])?.visible === false ? 0 : 1
  return vis
}
