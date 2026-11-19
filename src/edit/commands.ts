/**
 * Commandes de dessin, de cotation, de modification et de topographie.
 * Chaque commande porte sa propre fiche de mode d'emploi (`steps`) : le manuel intégré
 * est généré à partir de ce registre, il ne peut donc pas diverger du logiciel.
 */
import { toLonLat } from '../core/crs'
import { polylineLength, translate } from '../core/geom'
import type { Item } from '../core/project'
import { BYBLOCK, FOREGROUND, type Block, type Color, type EText, type Entity } from '../core/types'
import { symbolBlock, tcpointBlock } from '../topo/generate'
import { formatArea } from '../topo/sheet'
import { buildTin, checkContours, contours, intervalDecimals, type TerrainPoint, type Tin } from '../topo/tin'
import { Cancelled, fmt, parseNumber, type CommandDef, type Editor, type Ghost, type Keyword } from './editor'
import {
  centroid,
  circleThrough,
  closedRing,
  explode,
  gisement,
  mirrorAbout,
  offsetPolyline,
  pointRayonne,
  readableAngle,
  ringAreaAbs,
  rotationAbout,
  scaleAbout,
  sideOf,
  transformEntity,
  vertices,
  type Pt,
} from './ops'
import { selectionGeometry, toProjectFn, type Selection } from './query'
import { canProvidePoints, pointsFromSelection } from './selpoints'

const BYLAYER: Color = -1
const cur = (ed: Editor) => ({ layer: ed.currentLayer, color: BYLAYER })

function groupBy(sel: Selection[]): Map<Item, number[]> {
  const m = new Map<Item, number[]>()
  for (const s of sel) {
    const a = m.get(s.item)
    if (a) a.push(s.entity)
    else m.set(s.item, [s.entity])
  }
  return m
}

/** Aperçu d'une sélection transformée. */
function transformedGhost(sel: Selection[], m: (cur: Pt) => [number, number, number, number, number, number]): (c: Pt) => Ghost {
  const g = selectionGeometry(sel)
  const lines = g.lines.slice(0, 3000)
  return (c) => {
    const t = m(c)
    return {
      lines: lines.map((l) => {
        const out = new Array<number>(l.length)
        for (let i = 0; i < l.length; i += 2) {
          out[i] = t[0] * l[i] + t[2] * l[i + 1] + t[4]
          out[i + 1] = t[1] * l[i] + t[3] * l[i + 1] + t[5]
        }
        return out
      }),
      closed: g.closed.slice(0, 3000),
    }
  }
}

export function circlePts(cx: number, cy: number, r: number, n = 72, a0 = 0, sweep = Math.PI * 2): number[] {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return out
}

/** Collecte des points successifs (polyligne, polygone, multiligne). */
async function collect(ed: Editor, opts: { closedPreview: boolean; previewLines?: (pts: number[], closed: boolean) => number[][] }): Promise<{ pts: number[]; closed: boolean } | null> {
  const first = await ed.getPoint('Spécifiez le point de départ')
  const pts: number[] = [first[0], first[1]]
  for (;;) {
    const n = pts.length / 2
    const kws: Keyword[] = n >= 2 ? [['C', 'Clore'], ['U', 'annUler']] : [['U', 'annUler']]
    const r = await ed.point('Spécifiez le point suivant (Entrée pour terminer)', {
      base: [pts[pts.length - 2], pts[pts.length - 1]],
      keywords: kws,
      preview: (c) => {
        const all = [...pts, c[0], c[1]]
        const closed = opts.closedPreview && all.length >= 6
        const extra: Ghost['texts'] = []
        if (closed) extra.push({ x: c[0], y: c[1], text: `S = ${ringAreaAbs(all).toFixed(2)} m²` })
        else extra.push({ x: c[0], y: c[1], text: `${Math.hypot(c[0] - pts[pts.length - 2], c[1] - pts[pts.length - 1]).toFixed(3)} m` })
        const lines = opts.previewLines ? opts.previewLines(all, closed) : [all]
        return { lines, closed: lines.map(() => closed), texts: extra }
      },
    })
    if (r === null) return n >= 2 ? { pts, closed: false } : null
    if (r === 'U') {
      pts.length -= 2
      if (!pts.length) throw new Cancelled()
      continue
    }
    if (r === 'C') return n >= 2 ? { pts, closed: true } : null
    if (Array.isArray(r)) pts.push(r[0], r[1])
  }
}

// ---------------------------------------------------------------------------
// Cotations
// ---------------------------------------------------------------------------

let uid = 0
const newId = () => Date.now().toString(36) + (uid++).toString(36)

/** Cote alignée : bloc (lignes d'attache, ligne de cote, traits obliques, texte). */
export function dimension(p1: Pt, p2: Pt, pos: Pt, k: number): { block: Block; insert: Entity; length: number } | null {
  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  const length = Math.hypot(dx, dy)
  if (length === 0) return null
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const off = (pos[0] - p1[0]) * nx + (pos[1] - p1[1]) * ny
  const sg = off >= 0 ? 1 : -1
  const a1: Pt = [p1[0] + nx * off, p1[1] + ny * off]
  const a2: Pt = [p2[0] + nx * off, p2[1] + ny * off]
  const b = { layer: '0', color: BYBLOCK }
  const gap = 0.8 * k * sg
  const ext = 1.5 * k * sg
  const tick = 1.3 * k
  const tx = ((ux + nx) / Math.SQRT2) * tick
  const ty = ((uy + ny) / Math.SQRT2) * tick
  const entities: Entity[] = [
    { t: 'line', ...b, x1: p1[0] + nx * gap, y1: p1[1] + ny * gap, x2: a1[0] + nx * ext, y2: a1[1] + ny * ext },
    { t: 'line', ...b, x1: p2[0] + nx * gap, y1: p2[1] + ny * gap, x2: a2[0] + nx * ext, y2: a2[1] + ny * ext },
    { t: 'line', ...b, x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1] },
    { t: 'line', ...b, x1: a1[0] - tx, y1: a1[1] - ty, x2: a1[0] + tx, y2: a1[1] + ty },
    { t: 'line', ...b, x1: a2[0] - tx, y1: a2[1] - ty, x2: a2[0] + tx, y2: a2[1] + ty },
    {
      t: 'text',
      ...b,
      x: (a1[0] + a2[0]) / 2 + nx * 0.8 * k * sg,
      y: (a1[1] + a2[1]) / 2 + ny * 0.8 * k * sg,
      h: 2.5 * k,
      rot: readableAngle(Math.atan2(uy, ux)),
      text: length.toFixed(2),
      ha: 1,
      va: sg > 0 === (Math.cos(Math.atan2(uy, ux)) >= 0) ? 1 : 3,
    },
  ]
  const name = 'COTE_' + newId()
  return { block: { name, bx: 0, by: 0, entities }, insert: { t: 'insert', layer: 'COTATIONS', color: BYLAYER, block: name, x: 0, y: 0, sx: 1, sy: 1, rot: 0, props: { COTE: Number(length.toFixed(3)) } }, length }
}

/** Longueurs des côtés écrites le long d'une polyligne, à l'extérieur. */
function sideLabels(pts: number[], closed: boolean, k: number): EText[] {
  const n = pts.length / 2
  const c = closed ? centroid(pts) : null
  const out: EText[] = []
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n
    const x0 = pts[i * 2]
    const y0 = pts[i * 2 + 1]
    const x1 = pts[j * 2]
    const y1 = pts[j * 2 + 1]
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (len === 0) continue
    let nx = -(y1 - y0) / len
    let ny = (x1 - x0) / len
    const mx = (x0 + x1) / 2
    const my = (y0 + y1) / 2
    if (c && (mx + nx - c[0]) ** 2 + (my + ny - c[1]) ** 2 < (mx - c[0]) ** 2 + (my - c[1]) ** 2) {
      nx = -nx
      ny = -ny
    }
    out.push({ t: 'text', layer: 'COTATIONS', color: BYLAYER, x: mx + nx * 1.8 * k, y: my + ny * 1.8 * k, h: 2 * k, rot: readableAngle(Math.atan2(y1 - y0, x1 - x0)), text: len.toFixed(2), ha: 1, va: 2 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Points topographiques
// ---------------------------------------------------------------------------

const TOPO_LAYERS: [string, Color][] = [
  ['TOPOJIS', FOREGROUND],
  ['TopoMat', FOREGROUND],
  ['TopoAlt', 0x009a00],
]

let nextMat = '1'
function incrementMat(m: string): string {
  const r = /^(.*?)(\d+)$/.exec(m)
  if (!r) return m + '1'
  const n = String(parseInt(r[2]) + 1).padStart(r[2].length, '0')
  return r[1] + n
}

export function tcpoint(ed: Editor, x: number, y: number, mat: string, z: number | null): Entity {
  const s = ed.docScale / 500
  const attribs: EText[] = [{ t: 'text', layer: 'TopoMat', color: BYLAYER, x: x + 0.25 * s, y: y + 0.25 * s, h: 0.75 * s, rot: 0, text: mat, ha: 0, va: 0, tag: 'MAT' }]
  if (z !== null) attribs.push({ t: 'text', layer: 'TopoAlt', color: BYLAYER, x: x + 0.25 * s, y: y - 0.25 * s, h: 0.75 * s, rot: 0, text: z.toFixed(3), ha: 0, va: 3, tag: 'ALT' })
  return { t: 'insert', layer: 'TOPOJIS', color: BYLAYER, block: 'TCPOINT', x, y, ...(z !== null ? { z } : {}), sx: s, sy: s, rot: 0, props: { MAT: mat, ...(z !== null ? { ALT: z } : {}) }, attribs }
}

function addTcpoints(ed: Editor, label: string, ents: Entity[]): void {
  ed.add(label, ents, { blocks: [tcpointBlock()], layers: TOPO_LAYERS })
}

/**
 * Données de terrain du dessin : points cotés (points, points topographiques) et lignes de
 * rupture (polylignes et lignes 3D visibles : talus, fossés, bords de route levés en 3D).
 */
export function terrainFromDrawing(ed: Editor): { points: TerrainPoint[]; breaklines: TerrainPoint[][] } {
  const points: TerrainPoint[] = []
  const breaklines: TerrainPoint[][] = []
  for (const item of ed.project.items) {
    if (!item.ds.visible) continue
    const toP = toProjectFn(ed.project, item)
    for (const e of item.ds.entities) {
      if (item.ds.layers.get(e.layer)?.visible === false || e.layer === 'MNT') continue
      if (e.t === 'point' && e.z !== undefined) {
        const p = toP(e.x, e.y)
        points.push({ x: p[0], y: p[1], z: e.z })
      } else if (e.t === 'insert') {
        const raw = e.z ?? (e.props?.ALT !== undefined ? parseNumber(String(e.props.ALT)) : null)
        if (raw !== null && raw !== undefined && Number.isFinite(raw) && !e.mirror) {
          const p = toP(e.x, e.y)
          points.push({ x: p[0], y: p[1], z: raw, id: e.props?.MAT !== undefined ? String(e.props.MAT) : undefined })
        }
      } else if (e.t === 'pline' && e.zs) {
        const line: TerrainPoint[] = []
        for (let i = 0; i < e.pts.length / 2; i++) {
          const p = toP(e.pts[i * 2], e.pts[i * 2 + 1])
          line.push({ x: p[0], y: p[1], z: e.zs[i] })
        }
        if (e.closed && line.length >= 3) line.push(line[0])
        breaklines.push(line)
      } else if (e.t === 'line' && e.z1 !== undefined && e.z2 !== undefined) {
        const a = toP(e.x1, e.y1)
        const b = toP(e.x2, e.y2)
        breaklines.push([{ x: a[0], y: a[1], z: e.z1 }, { x: b[0], y: b[1], z: e.z2 }])
      }
    }
  }
  return { points, breaklines }
}

/** MNT du dessin (lignes de rupture comprises), ou erreur explicite. */
export function drawingTin(ed: Editor): Tin {
  const t = terrainFromDrawing(ed)
  const tin = buildTin(t.points, { breaklines: t.breaklines })
  if (!tin) throw new Error(`Il faut au moins trois points cotés visibles (trouvés : ${t.points.length}).`)
  for (const c of tin.conflicts) ed.message('⚠ ' + c)
  return tin
}

// ---------------------------------------------------------------------------
// Registre
// ---------------------------------------------------------------------------

const yesNo: Keyword[] = [
  ['O', 'Oui'],
  ['N', 'Non'],
]

export const GEOMETRY_COMMANDS: CommandDef[] = [
  // --- Dessin ---------------------------------------------------------------
  {
    id: 'LIGNE',
    label: 'Ligne',
    aliases: ['L', 'LINE'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'line',
    tip: 'Trace des segments de droite indépendants, l’un après l’autre.',
    steps: ['Cliquez le premier point (ou tapez ses coordonnées X,Y).', 'Cliquez les points suivants : chaque clic ajoute un segment.', 'Tapez C pour fermer sur le premier point, U pour annuler le dernier segment.', 'Entrée ou clic droit pour terminer.'],
    async run(ed) {
      const pts: Pt[] = [await ed.getPoint('Spécifiez le premier point')]
      for (;;) {
        const last = pts[pts.length - 1]
        const kws: Keyword[] = pts.length >= 3 ? [['C', 'Clore'], ['U', 'annUler']] : pts.length >= 2 ? [['U', 'annUler']] : []
        const r = await ed.point('Spécifiez le point suivant', { base: last, keywords: kws })
        if (r === null) return
        if (r === 'U') {
          if (pts.length > 1) {
            ed.history.undo()
            pts.pop()
          }
          continue
        }
        const to: Pt | null = r === 'C' ? pts[0] : Array.isArray(r) ? r : null
        if (!to) continue
        ed.add('Ligne', [{ t: 'line', ...cur(ed), x1: last[0], y1: last[1], x2: to[0], y2: to[1] }])
        if (r === 'C') return
        pts.push(to)
      }
    },
  },
  {
    id: 'POLYLIGNE',
    label: 'Polyligne',
    aliases: ['PL', 'PLINE'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'pline',
    tip: 'Trace une ligne brisée continue, qui forme un seul objet (limite, clôture, bord de route…).',
    steps: ['Cliquez le point de départ.', 'Cliquez les sommets suivants. La longueur du segment s’affiche près du curseur.', 'C pour fermer la polyligne, U pour retirer le dernier sommet.', 'Entrée ou clic droit pour terminer.'],
    async run(ed) {
      const r = await collect(ed, { closedPreview: false })
      if (r) ed.add('Polyligne', [{ t: 'pline', ...cur(ed), pts: Float64Array.from(r.pts), closed: r.closed }])
    },
  },
  {
    id: 'POLYGONE',
    label: 'Polygone (surface fermée)',
    aliases: ['POL', 'PARCELLE'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'polygon',
    tip: 'Trace une surface fermée (parcelle, bâtiment) et affiche sa superficie et son périmètre.',
    steps: ['Cliquez le premier sommet.', 'Cliquez les sommets suivants : la surface s’affiche en direct près du curseur.', 'Entrée ou clic droit : le polygone est fermé automatiquement.', 'La superficie et le périmètre s’affichent dans la ligne de commande.'],
    async run(ed) {
      const r = await collect(ed, { closedPreview: true })
      if (!r || r.pts.length < 6) {
        ed.message('Il faut au moins trois sommets.')
        return
      }
      ed.add('Polygone', [{ t: 'pline', ...cur(ed), pts: Float64Array.from(r.pts), closed: true }])
      ed.message(`Surface = ${ringAreaAbs(r.pts).toFixed(2)} m² (${formatArea(ringAreaAbs(r.pts))}) · Périmètre = ${polylineLength(r.pts, true).toFixed(2)} m`)
    },
  },
  {
    id: 'RECTANGLE',
    label: 'Rectangle',
    aliases: ['REC', 'RECTANG'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'rect',
    tip: 'Trace un rectangle à partir de deux coins opposés.',
    steps: ['Cliquez le premier coin.', 'Cliquez le coin opposé, ou tapez @largeur,hauteur (par exemple @12,8).'],
    async run(ed) {
      const a = await ed.getPoint('Spécifiez le premier coin')
      const rect = (b: Pt) => [a[0], a[1], b[0], a[1], b[0], b[1], a[0], b[1]]
      const b = await ed.getPoint('Spécifiez le coin opposé', { base: a, preview: (c) => ({ lines: [rect(c)], closed: [true] }) })
      ed.add('Rectangle', [{ t: 'pline', ...cur(ed), pts: Float64Array.from(rect(b)), closed: true }])
    },
  },
  {
    id: 'POLYREG',
    label: 'Polygone régulier',
    aliases: ['POLYGON', 'PR'],
    menu: 'Dessin',
    icon: 'hexagon',
    tip: 'Trace un polygone à côtés égaux inscrit dans un cercle.',
    steps: ['Tapez le nombre de côtés.', 'Cliquez le centre.', 'Cliquez un sommet ou tapez le rayon.'],
    async run(ed) {
      const n = Math.round(await ed.number('Nombre de côtés', 6, { positive: true }))
      if (n < 3) throw new Error('Il faut au moins trois côtés.')
      const c = await ed.getPoint('Spécifiez le centre')
      const shape = (p: Pt | number) => {
        const r = typeof p === 'number' ? p : Math.hypot(p[0] - c[0], p[1] - c[1])
        const a0 = typeof p === 'number' ? Math.PI / 2 : Math.atan2(p[1] - c[1], p[0] - c[0])
        const out: number[] = []
        for (let i = 0; i < n; i++) out.push(c[0] + r * Math.cos(a0 + (i * 2 * Math.PI) / n), c[1] + r * Math.sin(a0 + (i * 2 * Math.PI) / n))
        return out
      }
      const r = await ed.point('Spécifiez un sommet ou le rayon', { base: c, acceptNumber: true, preview: (p) => ({ lines: [shape(p)], closed: [true] }) })
      if (r === null || typeof r === 'string') return
      ed.add('Polygone régulier', [{ t: 'pline', ...cur(ed), pts: Float64Array.from(shape(r)), closed: true }])
    },
  },
  {
    id: 'CERCLE',
    label: 'Cercle',
    aliases: ['C', 'CIRCLE'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'circle',
    tip: 'Trace un cercle par son centre et son rayon.',
    steps: ['Cliquez le centre.', 'Cliquez un point du cercle ou tapez le rayon.'],
    async run(ed) {
      const c = await ed.getPoint('Spécifiez le centre')
      const r = await ed.point('Spécifiez le rayon', { base: c, acceptNumber: true, preview: (p) => ({ lines: [circlePts(c[0], c[1], Math.hypot(p[0] - c[0], p[1] - c[1]))], texts: [{ x: p[0], y: p[1], text: `R = ${Math.hypot(p[0] - c[0], p[1] - c[1]).toFixed(3)}` }] }) })
      if (r === null || typeof r === 'string') return
      const radius = typeof r === 'number' ? r : Math.hypot(r[0] - c[0], r[1] - c[1])
      if (radius > 0) ed.add('Cercle', [{ t: 'circle', ...cur(ed), cx: c[0], cy: c[1], r: radius }])
    },
  },
  {
    id: 'ARC',
    label: 'Arc (3 points)',
    aliases: ['A'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'arc',
    tip: 'Trace un arc de cercle passant par trois points.',
    steps: ['Cliquez le point de départ.', 'Cliquez un point de passage.', 'Cliquez le point d’arrivée.'],
    async run(ed) {
      const p1 = await ed.getPoint('Spécifiez le point de départ')
      const p2 = await ed.getPoint('Spécifiez le deuxième point', { base: p1 })
      const arcOf = (p3: Pt) => {
        const c = circleThrough(p1, p2, p3)
        if (!c) return null
        const ccw = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]) > 0
        const s = Math.atan2(p1[1] - c.cy, p1[0] - c.cx)
        const e = Math.atan2(p3[1] - c.cy, p3[0] - c.cx)
        return { ...c, a0: ccw ? s : e, a1: ccw ? e : s }
      }
      const p3 = await ed.getPoint('Spécifiez le point d’arrivée', {
        base: p2,
        preview: (p) => {
          const a = arcOf(p)
          if (!a) return { lines: [[p1[0], p1[1], p[0], p[1]]] }
          let sweep = a.a1 - a.a0
          while (sweep <= 0) sweep += Math.PI * 2
          return { lines: [circlePts(a.cx, a.cy, a.r, 64, a.a0, sweep)] }
        },
      })
      const a = arcOf(p3)
      if (!a) throw new Error('Les trois points sont alignés.')
      ed.add('Arc', [{ t: 'arc', ...cur(ed), cx: a.cx, cy: a.cy, r: a.r, a0: a.a0, a1: a.a1 }])
    },
  },
  {
    id: 'POINT',
    label: 'Point',
    aliases: ['PO'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'point',
    tip: 'Place des points simples (sans matricule). Pour un point topographique, utilisez « Point topo ».',
    steps: ['Cliquez chaque position, ou tapez X,Y.', 'Entrée pour terminer.'],
    async run(ed) {
      for (;;) {
        const r = await ed.point('Spécifiez un point (Entrée pour terminer)')
        if (!Array.isArray(r)) return
        ed.add('Point', [{ t: 'point', ...cur(ed), x: r[0], y: r[1] }])
      }
    },
  },
  {
    id: 'MULTILIGNE',
    label: 'Multiligne (double trait)',
    aliases: ['ML', 'MLIGNE'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'mline',
    tip: 'Trace deux traits parallèles à largeur constante (mur, route, caniveau).',
    steps: ['Tapez la largeur entre les deux traits (par exemple 0.20 pour un mur, 7 pour une voie).', 'Cliquez l’axe point par point.', 'C pour fermer, Entrée pour terminer.'],
    async run(ed) {
      const w = await ed.number('Largeur', lastWidth, { positive: true })
      lastWidth = w
      const both = (pts: number[], closed: boolean) => [offsetPolyline(pts, closed, w / 2), offsetPolyline(pts, closed, -w / 2)]
      const r = await collect(ed, { closedPreview: false, previewLines: (pts) => both(pts, false) })
      if (!r) return
      ed.add(
        'Multiligne',
        both(r.pts, r.closed).map((p) => ({ t: 'pline', ...cur(ed), pts: Float64Array.from(p), closed: r.closed }) as Entity),
      )
    },
  },
  {
    id: 'TEXTE',
    label: 'Texte',
    aliases: ['TE', 'T', 'TEXT'],
    menu: 'Dessin',
    ribbon: ['Début', 'Annotation'],
    icon: 'text',
    tip: 'Écrit un texte sur le plan. La hauteur proposée correspond à 2,5 mm sur le papier à l’échelle du plan.',
    steps: ['Cliquez le point d’insertion (bas gauche du texte).', 'Validez ou tapez la hauteur (en mètres sur le terrain).', 'Validez ou tapez la rotation en degrés.', 'Tapez le texte puis Entrée.'],
    async run(ed) {
      const p = await ed.getPoint('Spécifiez le point d’insertion')
      const h = await ed.number('Hauteur', Number((2.5 * ed.k).toFixed(3)), { positive: true })
      const rot = await ed.number('Rotation (degrés)', 0)
      const text = await ed.text('Texte')
      ed.add('Texte', [{ t: 'text', ...cur(ed), x: p[0], y: p[1], h, rot: (rot * Math.PI) / 180, text, ha: 0, va: 0 }])
    },
  },
  {
    id: 'HACHURES',
    label: 'Hachures (remplissage)',
    aliases: ['H', 'HACH'],
    menu: 'Dessin',
    ribbon: ['Début', 'Dessin'],
    icon: 'hatch',
    tip: 'Remplit l’intérieur de contours fermés (polygones, polylignes fermées, cercles).',
    steps: ['Sélectionnez un ou plusieurs contours fermés.', 'Entrée : les surfaces sont remplies sur le calque courant.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les contours fermés', { filter: (s) => !!closedRing(ed.entity(s)) })
      const ents: Entity[] = []
      for (const s of sel) {
        const ring = closedRing(ed.entity(s))
        if (ring) ents.push({ t: 'polygon', ...cur(ed), rings: [Float64Array.from(ring)], filled: true, pattern: 'ANSI31' })
      }
      ed.add('Hachures', ents)
    },
  },
  // --- Cotation --------------------------------------------------------------
  {
    id: 'COTE',
    label: 'Cote alignée',
    aliases: ['COT', 'DAL', 'COTALIGNEE'],
    menu: 'Cotation',
    ribbon: ['Début', 'Annotation'],
    icon: 'dim',
    tip: 'Cote la distance entre deux points, parallèlement au segment.',
    steps: ['Cliquez le premier point (accrochage aux extrémités conseillé).', 'Cliquez le second point.', 'Déplacez la souris pour placer la ligne de cote, puis cliquez.'],
    async run(ed) {
      const p1 = await ed.getPoint('Origine de la première ligne d’attache')
      const p2 = await ed.getPoint('Origine de la seconde ligne d’attache', { base: p1 })
      const pos = await ed.getPoint('Position de la ligne de cote', {
        noSnap: true,
        preview: (c) => {
          const d = dimension(p1, p2, c, ed.k)
          if (!d) return null
          const lines = d.block.entities.filter((e) => e.t === 'line').map((e) => (e.t === 'line' ? [e.x1, e.y1, e.x2, e.y2] : []))
          return { lines, texts: [{ x: c[0], y: c[1], text: d.length.toFixed(2) + ' m' }] }
        },
      })
      const d = dimension(p1, p2, pos, ed.k)
      if (d) ed.add('Cote', [d.insert], { blocks: [d.block], layers: [['COTATIONS', FOREGROUND]] })
    },
  },
  {
    id: 'COTPOLY',
    label: 'Coter les côtés d’une polyligne',
    aliases: ['CPL', 'COTESCOTES'],
    menu: 'Cotation',
    ribbon: ['Topographie', 'Habillage'],
    icon: 'dimpoly',
    tip: 'Écrit la longueur de chaque côté d’une parcelle ou d’une polyligne, à l’extérieur.',
    steps: ['Cliquez la polyligne ou le polygone.', 'Les longueurs (au centimètre) sont écrites au milieu de chaque côté, sur le calque COTATIONS.'],
    async run(ed) {
      const [s] = await ed.select('Sélectionnez la polyligne à coter', { single: true, filter: (x) => !!vertices(ed.entity(x)) })
      const v = vertices(ed.entity(s))
      if (!v) return
      ed.add('Cotation des côtés', sideLabels(v.pts, v.closed, ed.k), { layers: [['COTATIONS', FOREGROUND]] })
    },
  },
  // --- Modification ------------------------------------------------------------
  {
    id: 'EFFACER',
    label: 'Effacer',
    aliases: ['E', 'EF', 'ERASE', 'SUPPR'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'erase',
    tip: 'Supprime les objets sélectionnés (touche Suppr).',
    steps: ['Sélectionnez les objets (clic, ou fenêtre en glissant).', 'Entrée.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à effacer')
      const changes = new Map([...groupBy(sel)].map(([item, ids]) => [item, { remove: new Set(ids) }]))
      ed.modify('Effacer', changes)
      ed.message(`${sel.length} objet(s) effacé(s).`)
    },
  },
  {
    id: 'DEPLACER',
    label: 'Déplacer',
    aliases: ['D', 'DEP', 'MOVE'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'move',
    tip: 'Déplace des objets d’un point de base vers un point de destination.',
    steps: ['Sélectionnez les objets puis Entrée.', 'Cliquez le point de base.', 'Cliquez le point de destination, ou tapez @dx,dy.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à déplacer')
      const b = await ed.getPoint('Spécifiez le point de base')
      const to = await ed.getPoint('Spécifiez le point de destination', { base: b, preview: transformedGhost(sel, (c) => translate(c[0] - b[0], c[1] - b[1])) })
      transformSel(ed, 'Déplacer', sel, translate(to[0] - b[0], to[1] - b[1]), false)
    },
  },
  {
    id: 'COPIER',
    label: 'Copier',
    aliases: ['CO', 'CP', 'COPY'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'copy',
    tip: 'Copie des objets, autant de fois que voulu.',
    steps: ['Sélectionnez les objets puis Entrée.', 'Cliquez le point de base.', 'Cliquez chaque destination ; Entrée pour terminer.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à copier')
      const b = await ed.getPoint('Spécifiez le point de base')
      for (;;) {
        const r = await ed.point('Spécifiez le point de destination (Entrée pour terminer)', { base: b, preview: transformedGhost(sel, (c) => translate(c[0] - b[0], c[1] - b[1])) })
        if (!Array.isArray(r)) return
        transformSel(ed, 'Copier', sel, translate(r[0] - b[0], r[1] - b[1]), true)
      }
    },
  },
  {
    id: 'ROTATION',
    label: 'Rotation',
    aliases: ['RO', 'ROTATE'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'rotate',
    tip: 'Fait pivoter des objets autour d’un point.',
    steps: ['Sélectionnez les objets puis Entrée.', 'Cliquez le centre de rotation.', 'Tapez l’angle en degrés (sens trigonométrique) ou cliquez une direction.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à faire pivoter')
      const b = await ed.getPoint('Spécifiez le point de base')
      const r = await ed.point('Spécifiez l’angle de rotation (degrés)', { base: b, acceptNumber: true, preview: transformedGhost(sel, (c) => rotationAbout(b[0], b[1], Math.atan2(c[1] - b[1], c[0] - b[0]))) })
      if (r === null || typeof r === 'string') return
      const a = typeof r === 'number' ? (r * Math.PI) / 180 : Math.atan2(r[1] - b[1], r[0] - b[0])
      transformSel(ed, 'Rotation', sel, rotationAbout(b[0], b[1], a), false)
    },
  },
  {
    id: 'ECHELLE',
    label: 'Échelle',
    aliases: ['EC', 'SCALE'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'scale',
    tip: 'Agrandit ou réduit des objets autour d’un point.',
    steps: ['Sélectionnez les objets puis Entrée.', 'Cliquez le point de base (il ne bouge pas).', 'Tapez le facteur (2 = double, 0.5 = moitié).'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à mettre à l’échelle')
      const b = await ed.getPoint('Spécifiez le point de base')
      const f = await ed.number('Facteur d’échelle', 1, { positive: true })
      transformSel(ed, 'Échelle', sel, scaleAbout(b[0], b[1], f), false)
    },
  },
  {
    id: 'MIROIR',
    label: 'Miroir',
    aliases: ['MI', 'MIRROR'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'mirror',
    tip: 'Crée le symétrique d’objets par rapport à un axe.',
    steps: ['Sélectionnez les objets puis Entrée.', 'Cliquez deux points de l’axe de symétrie.', 'Choisissez de garder ou non les objets d’origine.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à copier en miroir')
      const a = await ed.getPoint('Premier point de l’axe')
      const b = await ed.getPoint('Second point de l’axe', { base: a, preview: transformedGhost(sel, (c) => mirrorAbout(a[0], a[1], c[0], c[1])) })
      const erase = await ed.choice('Effacer les objets sources ?', yesNo, 'N')
      transformSel(ed, 'Miroir', sel, mirrorAbout(a[0], a[1], b[0], b[1]), erase === 'N')
    },
  },
  {
    id: 'DECALER',
    label: 'Décaler (parallèle)',
    aliases: ['DC', 'DECAL', 'OFFSET'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'offset',
    tip: 'Crée une copie parallèle d’une ligne, d’une polyligne, d’un cercle ou d’un arc à une distance donnée.',
    steps: ['Tapez la distance de décalage.', 'Cliquez l’objet à décaler.', 'Cliquez du côté où placer la copie.', 'Recommencez ou Entrée pour terminer.'],
    async run(ed) {
      const d = await ed.number('Distance de décalage', lastOffset, { positive: true })
      lastOffset = d
      for (;;) {
        const [s] = await ed.select('Sélectionnez l’objet à décaler (Entrée pour terminer)', { single: true, filter: (x) => ['line', 'pline', 'polygon', 'circle', 'arc'].includes(ed.entity(x).t) })
        const e = ed.entity(s)
        const make = (c: Pt): Entity | null => {
          if (e.t === 'circle' || e.t === 'arc') {
            const out = Math.hypot(c[0] - e.cx, c[1] - e.cy) > e.r
            const r = e.r + (out ? d : -d)
            return r > 0 ? { ...e, r } : null
          }
          const v = vertices(e)
          if (!v) return null
          const side = sideOf(v.pts, v.closed, c[0], c[1])
          const pts = offsetPolyline(v.pts, v.closed, side * d)
          if (e.t === 'line') return { ...e, x1: pts[0], y1: pts[1], x2: pts[2], y2: pts[3] }
          if (e.t === 'polygon') return { ...e, rings: [Float64Array.from(pts)] }
          if (e.t !== 'pline') return null
          return { ...e, pts: Float64Array.from(pts), bulges: undefined }
        }
        const side = await ed.getPoint('Cliquez du côté du décalage', {
          noSnap: true,
          preview: (c) => {
            const m = make(c)
            if (!m) return null
            if (m.t === 'circle') return { lines: [circlePts(m.cx, m.cy, m.r)] }
            const v = vertices(m)
            return v ? { lines: [v.pts], closed: [v.closed] } : null
          },
        })
        const m = make(side)
        if (m) ed.modify('Décaler', new Map([[s.item, { add: [m] }]]))
      }
    },
  },
  {
    id: 'DECOMPOSER',
    label: 'Décomposer',
    aliases: ['X', 'DECOMP', 'EXPLODE'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'explode',
    tip: 'Décompose un bloc, une cote ou une polyligne en objets élémentaires (lignes, arcs, textes).',
    steps: ['Sélectionnez les objets puis Entrée.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez les objets à décomposer')
      const changes = new Map<Item, { remove: Set<number>; add: Entity[] }>()
      let n = 0
      for (const s of sel) {
        const parts = explode(ed.entity(s), s.item.ds.blocks)
        if (!parts) continue
        let c = changes.get(s.item)
        if (!c) changes.set(s.item, (c = { remove: new Set(), add: [] }))
        c.remove.add(s.entity)
        c.add.push(...parts)
        n++
      }
      ed.modify('Décomposer', changes)
      ed.message(n ? `${n} objet(s) décomposé(s).` : 'Aucun objet décomposable (blocs, cotes, polylignes, surfaces).')
    },
  },
  // --- Calculs topographiques ------------------------------------------------------
  {
    id: 'DISTGIS',
    label: 'Distance et gisement',
    aliases: ['DG', 'DIST', 'GISEMENT'],
    menu: 'Topo Calculs',
    ribbon: ['Topographie', 'Calculs'],
    icon: 'bearing',
    tip: 'Calcule la distance horizontale, le gisement (en grades) et les écarts ΔX, ΔY entre deux points.',
    steps: ['Cliquez la station (accrochage aux points conseillé).', 'Cliquez le point visé.', 'Le résultat s’affiche dans la ligne de commande et dans une notification.'],
    async run(ed) {
      const a = await ed.getPoint('Spécifiez la station')
      const b = await ed.getPoint('Spécifiez le point visé', { base: a, preview: (c) => ({ lines: [[a[0], a[1], c[0], c[1]]], texts: [{ x: c[0], y: c[1], text: `${Math.hypot(c[0] - a[0], c[1] - a[1]).toFixed(3)} m · ${gisement(a[0], a[1], c[0], c[1]).toFixed(4)} gr` }] }) })
      const d = Math.hypot(b[0] - a[0], b[1] - a[1])
      const g = gisement(a[0], a[1], b[0], b[1])
      const msg = `Distance horizontale = ${d.toFixed(3)} m · Gisement = ${g.toFixed(4)} gr (${((g * 9) / 10).toFixed(4)}°) · ΔX = ${(b[0] - a[0]).toFixed(3)} · ΔY = ${(b[1] - a[1]).toFixed(3)}`
      ed.message(msg)
      ed.actions.notify?.(msg)
    },
  },
  {
    id: 'ID',
    label: 'Coordonnées d’un point',
    aliases: ['COORD', 'IDPOINT'],
    menu: 'Topo Calculs',
    ribbon: ['Topographie', 'Calculs'],
    icon: 'id',
    tip: 'Affiche les coordonnées X, Y d’un point (et sa position géographique si le système est connu).',
    steps: ['Cliquez le point (accrochage conseillé).'],
    async run(ed) {
      const p = await ed.getPoint('Spécifiez le point')
      const ll = toLonLat(ed.project.crs, p[0], p[1])
      const msg = `X = ${p[0].toFixed(3)} · Y = ${p[1].toFixed(3)}${ll ? ` · ${ll[1].toFixed(7)}° ${ll[1] >= 0 ? 'N' : 'S'}, ${ll[0].toFixed(7)}° ${ll[0] >= 0 ? 'E' : 'O'}` : ''}`
      ed.message(msg)
      ed.actions.notify?.(msg)
    },
  },
  {
    id: 'AIRE',
    label: 'Surface et périmètre',
    aliases: ['AI', 'AREA', 'SURFACE'],
    menu: 'Topo Calculs',
    ribbon: ['Topographie', 'Calculs'],
    icon: 'area',
    tip: 'Mesure une surface en cliquant ses sommets, ou celle d’un objet fermé, et peut l’inscrire sur le plan.',
    steps: ['Cliquez les sommets un à un (la surface s’affiche en direct), ou tapez O puis cliquez un objet fermé.', 'Entrée pour calculer.', 'Répondez Oui pour écrire « S = … m² » sur le plan, puis placez l’étiquette.'],
    async run(ed) {
      const first = await ed.point('Spécifiez le premier sommet', { keywords: [['O', 'Objet']] })
      let ring: number[] | null = null
      if (first === 'O') {
        const [s] = await ed.select('Sélectionnez l’objet fermé', { single: true, editable: false, filter: (x) => !!closedRing(ed.entity(x)) })
        ring = closedRing(ed.entity(s))
        if (ring && !isSameCrs(ed, s.item)) {
          const toP = toProjectFn(ed.project, s.item)
          const out: number[] = []
          for (let i = 0; i < ring.length; i += 2) out.push(...toP(ring[i], ring[i + 1]))
          ring = out
        }
      } else if (Array.isArray(first)) {
        const pts: number[] = [first[0], first[1]]
        for (;;) {
          const r = await ed.point('Spécifiez le sommet suivant (Entrée pour calculer)', {
            base: [pts[pts.length - 2], pts[pts.length - 1]],
            preview: (c) => {
              const all = [...pts, c[0], c[1]]
              return { lines: [all], closed: [all.length >= 6], texts: [{ x: c[0], y: c[1], text: `S = ${ringAreaAbs(all).toFixed(2)} m²` }] }
            },
          })
          if (!Array.isArray(r)) break
          pts.push(r[0], r[1])
        }
        ring = pts
      } else return
      if (!ring || ring.length < 6) {
        ed.message('Il faut au moins trois sommets.')
        return
      }
      const area = ringAreaAbs(ring)
      const msg = `Surface = ${area.toFixed(2)} m² (${formatArea(area)}) · Périmètre = ${polylineLength(ring, true).toFixed(2)} m`
      ed.message(msg)
      ed.actions.notify?.(msg)
      if ((await ed.choice('Inscrire la surface sur le plan ?', yesNo, 'N')) !== 'O') return
      const c = centroid(ring)
      const r = await ed.point('Position de l’étiquette (Entrée = centre de la surface)', { noSnap: true })
      const at = Array.isArray(r) ? r : c
      ed.add('Étiquette de surface', [{ t: 'text', layer: 'SURFACES', color: BYLAYER, x: at[0], y: at[1], h: 3.5 * ed.k, rot: 0, text: `S = ${formatArea(area)}`, ha: 1, va: 2 }], { layers: [['SURFACES', FOREGROUND]] })
    },
  },
  {
    id: 'RAYONNEMENT',
    label: 'Points rayonnés',
    aliases: ['RAY', 'RAYON'],
    menu: 'Topo Calculs',
    ribbon: ['Topographie', 'Calculs'],
    icon: 'radiate',
    tip: 'Calcule et place des points à partir d’une station, d’un gisement (grades) et d’une distance horizontale.',
    steps: ['Cliquez la station (ou tapez ses coordonnées).', 'Tapez le gisement en grades, puis la distance horizontale en mètres.', 'Validez ou modifiez le matricule proposé.', 'Recommencez pour chaque point ; Entrée sur le gisement pour terminer.'],
    async run(ed) {
      const st = await ed.getPoint('Spécifiez la station')
      const pts: Entity[] = []
      for (;;) {
        const gs = await ed.optionalText('Gisement en grades (Entrée pour terminer)')
        if (!gs) break
        const g = parseNumber(gs)
        if (g === null) {
          ed.message('Gisement non compris : tapez un nombre en grades, par exemple 153.2540.')
          continue
        }
        const d = await ed.number('Distance horizontale (m)', undefined, { positive: true })
        const mat = await ed.optionalText('Matricule', nextMat)
        nextMat = incrementMat(mat)
        const p = pointRayonne(st[0], st[1], g, d)
        const e = tcpoint(ed, p[0], p[1], mat, null)
        pts.push(e)
        addTcpoints(ed, 'Point rayonné', [e])
        ed.message(`Point ${mat} : X = ${p[0].toFixed(3)} · Y = ${p[1].toFixed(3)}`)
      }
      if (pts.length) ed.message(`${pts.length} point(s) rayonné(s) placé(s).`)
    },
  },
  // --- Topo 2D --------------------------------------------------------------------------
  {
    id: 'POINTTOPO',
    label: 'Point topographique',
    aliases: ['PT', 'PTOPO'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Points'],
    icon: 'tcpoint',
    tip: 'Insère un point topographique (bloc TCPOINT avec matricule et altitude), compatible Covadis.',
    steps: ['Cliquez la position ou tapez X,Y.', 'Validez ou modifiez le matricule proposé (il s’incrémente tout seul).', 'Tapez l’altitude, ou Entrée s’il n’y en a pas.', 'Recommencez ; Entrée sur la position pour terminer.'],
    async run(ed) {
      for (;;) {
        const r = await ed.point('Position du point (Entrée pour terminer)')
        if (!Array.isArray(r)) return
        const mat = await ed.optionalText('Matricule', nextMat)
        nextMat = incrementMat(mat)
        const zs = await ed.optionalText('Altitude (Entrée = aucune)')
        const z = zs ? parseNumber(zs) : null
        addTcpoints(ed, 'Point topographique', [tcpoint(ed, r[0], r[1], mat, z)])
      }
    },
  },
  {
    id: 'NUMSOMMETS',
    label: 'Numéroter les sommets',
    aliases: ['NS', 'BORNES'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Habillage'],
    icon: 'number',
    tip: 'Numérote les sommets d’une parcelle (B.1, B.2…) et peut y placer un symbole de borne.',
    steps: ['Cliquez la parcelle (polygone ou polyligne).', 'Validez ou modifiez le préfixe (B.) et le premier numéro.', 'Choisissez d’insérer ou non un symbole de borne sur chaque sommet.'],
    async run(ed) {
      const [s] = await ed.select('Sélectionnez la parcelle', { single: true, filter: (x) => !!vertices(ed.entity(x)) })
      const v = vertices(ed.entity(s))
      if (!v) return
      const prefix = await ed.optionalText('Préfixe', 'B.')
      const start = Math.round(await ed.number('Premier numéro', 1))
      const sym = await ed.choice('Insérer un symbole de borne sur chaque sommet ?', yesNo, 'O')
      const n = v.pts.length / 2
      const c = centroid(v.pts)
      const k = ed.k
      const ents: Entity[] = []
      for (let i = 0; i < n; i++) {
        const x = v.pts[i * 2]
        const y = v.pts[i * 2 + 1]
        const dx = x - c[0]
        const dy = y - c[1]
        const d = Math.hypot(dx, dy) || 1
        ents.push({ t: 'text', layer: 'SOMMETS', color: BYLAYER, x: x + (dx / d) * 3 * k, y: y + (dy / d) * 3 * k, h: 2.2 * k, rot: 0, text: prefix + (start + i), ha: 1, va: 2 })
        if (sym === 'O') ents.push({ t: 'insert', layer: 'BORNES', color: BYLAYER, block: 'SYM_BORNE', x, y, sx: k, sy: k, rot: 0, props: { BORNE: prefix + (start + i) } })
      }
      ed.add('Numérotation des sommets', ents, { blocks: sym === 'O' ? [symbolBlock('borne')] : [], layers: [['SOMMETS', 0xff0000], ['BORNES', 0xff0000]] })
    },
  },
  {
    id: 'TABCOORD',
    label: 'Tableau des coordonnées',
    aliases: ['TC', 'TABLEAU'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Habillage'],
    icon: 'table',
    tip: 'Dessine le tableau des coordonnées (Borne, X, Y) des objets désignés : parcelle, bornes, points topographiques.',
    steps: ['Désignez la parcelle, ou les bornes et points un à un (ou par fenêtre), puis Entrée. Une sélection faite avant la commande est reprise.', 'Validez le préfixe et le premier numéro des sommets sans nom (les points topo gardent leur matricule).', 'Cliquez l’emplacement du coin supérieur gauche du tableau.'],
    async run(ed) {
      const sel = await ed.select('Sélectionnez la parcelle ou les points', { editable: false, filter: (x) => canProvidePoints(ed.entity(x)) })
      const unnamed = sel.some((x) => ed.entity(x).t !== 'insert')
      const prefix = unnamed ? await ed.optionalText('Préfixe des sommets sans nom', 'B.') : 'B.'
      const start = unnamed ? Math.round(await ed.number('Premier numéro', 1)) : 1
      const { rows } = pointsFromSelection(ed.project, sel, prefix, start)
      if (!rows.length) throw new Error('Aucun point dans la sélection.')
      const k = ed.k
      const n = rows.length
      const widths = [14 * k, 26 * k, 26 * k]
      const W = widths[0] + widths[1] + widths[2]
      const rowH = 5 * k
      const H = rowH * (n + 2)
      const at = await ed.getPoint('Coin supérieur gauche du tableau', { noSnap: true, preview: (c) => ({ lines: [[c[0], c[1], c[0] + W, c[1], c[0] + W, c[1] - H, c[0], c[1] - H]], closed: [true] }) })
      const [x0, y0] = at
      const b = { layer: 'TABLEAUX', color: BYLAYER }
      const ents: Entity[] = [{ t: 'pline', ...b, pts: Float64Array.from([x0, y0, x0 + W, y0, x0 + W, y0 - H, x0, y0 - H]), closed: true }]
      for (let r = 1; r < n + 2; r++) ents.push({ t: 'line', ...b, x1: x0, y1: y0 - r * rowH, x2: x0 + W, y2: y0 - r * rowH })
      ents.push({ t: 'line', ...b, x1: x0 + widths[0], y1: y0 - rowH, x2: x0 + widths[0], y2: y0 - H }, { t: 'line', ...b, x1: x0 + widths[0] + widths[1], y1: y0 - rowH, x2: x0 + widths[0] + widths[1], y2: y0 - H })
      const txt = (x: number, y: number, s2: string, ha: 0 | 1 | 2) => ents.push({ t: 'text', ...b, x, y, h: 2 * k, rot: 0, text: s2, ha, va: 2 })
      txt(x0 + W / 2, y0 - rowH / 2, 'Tableau des coordonnées', 1)
      txt(x0 + widths[0] / 2, y0 - rowH * 1.5, 'Borne', 1)
      txt(x0 + widths[0] + widths[1] / 2, y0 - rowH * 1.5, 'X', 1)
      txt(x0 + W - widths[2] / 2, y0 - rowH * 1.5, 'Y', 1)
      rows.forEach((p, i) => {
        const y = y0 - rowH * (i + 2.5)
        txt(x0 + widths[0] / 2, y, p.label, 1)
        txt(x0 + widths[0] + widths[1] - 1.2 * k, y, p.x.toFixed(3), 2)
        txt(x0 + W - 1.2 * k, y, p.y.toFixed(3), 2)
      })
      ed.add('Tableau des coordonnées', ents, { layers: [['TABLEAUX', FOREGROUND]] })
      ed.message(`Tableau de ${n} point(s) dessiné.`)
    },
  },
  {
    id: 'ETIQSURF',
    label: 'Étiquette de surface',
    aliases: ['ES', 'SUP'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Habillage'],
    icon: 'areatag',
    tip: 'Écrit la superficie d’une parcelle (« S = 940 m² » ou en ha a ca) au centre ou à l’endroit choisi.',
    steps: ['Cliquez la parcelle (objet fermé).', 'Cliquez la position de l’étiquette, ou Entrée pour la placer au centre.'],
    async run(ed) {
      const [s] = await ed.select('Sélectionnez la parcelle', { single: true, filter: (x) => !!closedRing(ed.entity(x)) })
      const ring = closedRing(ed.entity(s))
      if (!ring) return
      const area = ringAreaAbs(ring)
      const r = await ed.point('Position de l’étiquette (Entrée = centre)', { noSnap: true })
      const at = Array.isArray(r) ? r : centroid(ring)
      ed.add('Étiquette de surface', [{ t: 'text', layer: 'SURFACES', color: BYLAYER, x: at[0], y: at[1], h: 3.5 * ed.k, rot: 0, text: `S = ${formatArea(area)}`, ha: 1, va: 2 }], { layers: [['SURFACES', FOREGROUND]] })
      ed.message(`Surface = ${area.toFixed(2)} m²`)
    },
  },
  {
    id: 'SYMBOLE',
    label: 'Symbole (arbre, poteau, regard, borne)',
    aliases: ['SY', 'SYM'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Points'],
    icon: 'tree',
    tip: 'Insère des symboles topographiques à l’échelle du plan.',
    steps: ['Choisissez le symbole (A arbre, P poteau, R regard, B borne, C croix).', 'Cliquez chaque position ; Entrée pour terminer.'],
    async run(ed) {
      const kind = await ed.choice('Symbole', [['A', 'Arbre'], ['P', 'Poteau'], ['R', 'Regard'], ['B', 'Borne'], ['C', 'Croix']], 'A')
      const names: Record<string, 'arbre' | 'poteau' | 'regard' | 'borne' | 'croix'> = { A: 'arbre', P: 'poteau', R: 'regard', B: 'borne', C: 'croix' }
      const name = names[kind] ?? 'croix'
      const symbol = name === 'regard' ? 'carre' : name
      const layer = { arbre: 'VEGETATION', poteau: 'RESEAUX', regard: 'RESEAUX', borne: 'BORNES', croix: ed.currentLayer }[name]
      const color = { arbre: 0x00a000, poteau: 0xff00ff, regard: 0x0000ff, borne: 0xff0000, croix: FOREGROUND }[name]
      for (;;) {
        const r = await ed.point('Position (Entrée pour terminer)')
        if (!Array.isArray(r)) return
        ed.add('Symbole', [{ t: 'insert', layer, color: BYLAYER, block: 'SYM_' + symbol.toUpperCase(), x: r[0], y: r[1], sx: ed.k, sy: ed.k, rot: 0 }], { blocks: [symbolBlock(symbol)], layers: [[layer, color]] })
      }
    },
  },
  // --- Topo 3D ---------------------------------------------------------------------------
  {
    id: 'MNT',
    label: 'Modèle numérique de terrain',
    aliases: ['TIN', 'TRIANGULATION'],
    menu: 'Topo 3D',
    ribbon: ['Topographie', 'Terrain'],
    icon: 'tin',
    tip: 'Triangule tous les points cotés visibles (points topo, polylignes 3D) et dessine le MNT.',
    steps: ['Affichez les fichiers et calques qui contiennent les points cotés.', 'Lancez la commande : la triangulation est dessinée sur le calque MNT.', 'Les grands triangles de bordure, hors levé, sont écartés.'],
    async run(ed) {
      const tin = drawingTin(ed)
      const ents: Entity[] = []
      const { xs, ys, zs, triangles } = tin
      for (let t = 0; t < triangles.length; t += 3) {
        const a = triangles[t]
        const b = triangles[t + 1]
        const c = triangles[t + 2]
        ents.push({ t: 'polygon', layer: 'MNT', color: BYLAYER, rings: [Float64Array.from([xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]])], zs: [Float64Array.from([zs[a], zs[b], zs[c]])], filled: false })
      }
      ed.add('MNT', ents, { layers: [['MNT', 0x9a9a9a]] })
      ed.message(`MNT : ${triangles.length / 3} triangles sur ${xs.length} sommets, ${tin.constrained} segment(s) de rupture imposé(s)${tin.discarded ? `, ${tin.discarded} triangle(s) de bordure écarté(s)` : ''}.`)
    },
  },
  {
    id: 'COURBES',
    label: 'Courbes de niveau',
    aliases: ['CN', 'CONTOURS'],
    menu: 'Topo 3D',
    ribbon: ['Topographie', 'Terrain'],
    icon: 'contours',
    tip: 'Calcule les courbes de niveau exactes du MNT (points cotés et lignes de rupture 3D visibles), avec courbes maîtresses cotées et contrôle automatique.',
    steps: ['Tapez l’équidistance (par exemple 0.5 ou 1).', 'Tapez la fréquence des courbes maîtresses (5 = une sur cinq).', 'Les courbes sont dessinées sur les calques COURBES et COURBES_MAITRESSES.'],
    async run(ed) {
      const tin = drawingTin(ed)
      const interval = await ed.number('Équidistance (m)', 1, { positive: true })
      const major = Math.max(1, Math.round(await ed.number('Une courbe maîtresse toutes les', 5, { positive: true })))
      const k = ed.k
      const ents: Entity[] = []
      const list = contours(tin, interval)
      const decimals = intervalDecimals(interval)
      for (const c of list) {
        const isMajor = Math.round(c.z / interval) % major === 0
        const p = c.pts
        ents.push({ t: 'pline', layer: isMajor ? 'COURBES_MAITRESSES' : 'COURBES', color: BYLAYER, pts: Float64Array.from(p), closed: c.closed, elev: c.z, props: { ALTITUDE: c.z } })
        const n = p.length / 2
        if (isMajor && n >= 4) {
          const i = (n >> 1) * 2
          ents.push({ t: 'text', layer: 'COURBES_MAITRESSES', color: BYLAYER, x: p[i], y: p[i + 1], h: 1.4 * k, rot: readableAngle(Math.atan2(p[i + 1] - p[i - 1], p[i] - p[i - 2])), text: c.z.toFixed(decimals), ha: 1, va: 2 })
        }
      }
      ed.add('Courbes de niveau', ents, { layers: [['COURBES', 0xff9f00], ['COURBES_MAITRESSES', 0xff0000]] })
      const check = checkContours(tin, list)
      ed.message(`${ents.filter((e) => e.t === 'pline').length} courbe(s) tracée(s), équidistance ${fmt(interval)} m, ${tin.constrained} segment(s) de rupture. Contrôle : ${check.vertices} sommets, écart maximal au MNT ${check.maxError.toExponential(1)} m, ${check.crossings} croisement.`)
    },
  },
  // --- Édition -----------------------------------------------------------------------------
  {
    id: 'ANNULER',
    label: 'Annuler',
    aliases: ['U', 'UNDO'],
    menu: 'Édition',
    ribbon: ['Début', 'Modification'],
    icon: 'undo',
    tip: 'Annule la dernière modification (Ctrl+Z).',
    steps: ['Cliquez Annuler ou appuyez sur Ctrl+Z ; recommencez pour remonter plus loin.'],
    run(ed) {
      ed.history.undo()
    },
  },
  {
    id: 'RETABLIR',
    label: 'Rétablir',
    aliases: ['REDO'],
    menu: 'Édition',
    ribbon: ['Début', 'Modification'],
    icon: 'redo',
    tip: 'Rétablit la dernière modification annulée (Ctrl+Y).',
    steps: ['Cliquez Rétablir ou appuyez sur Ctrl+Y.'],
    run(ed) {
      ed.history.redo()
    },
  },
  {
    id: 'TOUTSEL',
    label: 'Tout sélectionner',
    aliases: ['TS', 'SELALL'],
    menu: 'Édition',
    tip: 'Sélectionne tous les objets visibles du fichier actif (Ctrl+A).',
    steps: ['Lancez la commande ou appuyez sur Ctrl+A.'],
    run(ed) {
      const item = ed.target()
      const sel: Selection[] = []
      item.ds.entities.forEach((e, i) => {
        if (item.ds.layers.get(e.layer)?.visible !== false) sel.push({ item, entity: i })
      })
      ed.setSelection(sel)
      ed.message(`${sel.length} objet(s) sélectionné(s).`)
    },
  },
]

let lastWidth = 0.2
let lastOffset = 1

function isSameCrs(ed: Editor, item: Item): boolean {
  return !item.ds.xform && item.ds.crs === ed.project.crs
}

/** Transforme (ou copie) des objets sélectionnés. */
function transformSel(ed: Editor, label: string, sel: Selection[], m: [number, number, number, number, number, number], copy: boolean): void {
  const changes = new Map<Item, { replace?: Map<number, Entity>; add?: Entity[] }>()
  for (const [item, ids] of groupBy(sel)) {
    const moved = ids.map((i) => transformEntity(item.ds.entities[i], m))
    changes.set(item, copy ? { add: moved } : { replace: new Map(ids.map((i, k) => [i, moved[k]])) })
  }
  ed.modify(label, changes)
}
