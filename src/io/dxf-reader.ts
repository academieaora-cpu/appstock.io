/**
 * Lecteur DXF (ASCII), écrit pour ce projet, sans dépendance.
 *
 * C'est le point d'entrée unique de la CAO : les fichiers DXF y arrivent directement,
 * les fichiers DWG y arrivent après conversion DWG → DXF par le décodeur isolé
 * (`plugins/dwg-libredwg`). Les entités non interprétées sont comptées et signalées,
 * jamais ignorées en silence.
 */
import { aciToColor, cleanMText, decodeDxfText, pointInRing, ringArea, tessellateBulges, tessellateFit, tessellateSpline, appendArc } from '../core/geom'
import {
  BYLAYER,
  ensureLayer,
  newDataset,
  type Block,
  type Color,
  type Dataset,
  type EInsert,
  type EPolygon,
  type EPolyline,
  type EText,
  type Entity,
  type Props,
} from '../core/types'

const DEG = Math.PI / 180

const CODEPAGES: Record<string, string> = {
  ANSI_874: 'windows-874',
  ANSI_932: 'shift_jis',
  ANSI_936: 'gbk',
  ANSI_949: 'euc-kr',
  ANSI_950: 'big5',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
}

const UNITS: Record<number, string> = {
  0: 'sans unité',
  1: 'pouces',
  2: 'pieds',
  4: 'millimètres',
  5: 'centimètres',
  6: 'mètres',
  7: 'kilomètres',
}

export const DWG_VERSIONS: Record<string, string> = {
  AC1009: 'R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: '2000',
  AC1018: '2004',
  AC1021: '2007',
  AC1024: '2010',
  AC1027: '2013',
  AC1032: '2018',
}

/** Choisit l'encodage : UTF-8 si le fichier est de l'UTF-8 valide, sinon la page de code déclarée. */
function detectEncoding(bytes: Uint8Array): string {
  let high = false
  let valid = true
  const n = bytes.length
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b < 0x80) continue
    high = true
    let need = 0
    if (b >= 0xc2 && b <= 0xdf) need = 1
    else if (b >= 0xe0 && b <= 0xef) need = 2
    else if (b >= 0xf0 && b <= 0xf4) need = 3
    else {
      valid = false
      break
    }
    if (i + need >= n) {
      valid = false
      break
    }
    for (let k = 1; k <= need; k++) {
      if ((bytes[i + k] & 0xc0) !== 0x80) {
        valid = false
        break
      }
    }
    if (!valid) break
    i += need
  }
  if (!high || valid) return 'utf-8'
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(n, 65536)))
  const m = /\$DWGCODEPAGE\s+3\s+(\S+)/.exec(head)
  return (m && CODEPAGES[m[1].toUpperCase()]) || 'windows-1252'
}

/** Enregistrement DXF : un type (code 0) et ses couples code/valeur. */
class Rec {
  type = ''
  codes: number[] = []
  vals: string[] = []
  n = 0
  reset(type: string) {
    this.type = type
    this.n = 0
  }
  push(code: number, val: string) {
    this.codes[this.n] = code
    this.vals[this.n] = val
    this.n++
  }
  /** Première valeur d'un code, en nombre. */
  num(code: number, def = 0): number {
    for (let i = 0; i < this.n; i++) if (this.codes[i] === code) return parseFloat(this.vals[i]) || 0
    return def
  }
  has(code: number): boolean {
    for (let i = 0; i < this.n; i++) if (this.codes[i] === code) return true
    return false
  }
  str(code: number, def = ''): string {
    for (let i = 0; i < this.n; i++) if (this.codes[i] === code) return this.vals[i]
    return def
  }
}

interface Common {
  layer: string
  color: Color
  lw: number
  handle?: string
  /** Extrusion négative : le repère de l'entité est symétrique en X. */
  mirror: boolean
  paper: boolean
  invisible: boolean
  props?: Props
}

function common(r: Rec): Common {
  let layer = '0'
  let color: Color = BYLAYER
  let lw = -1
  let handle: string | undefined
  let nz = 1
  let paper = false
  let invisible = false
  let props: Props | undefined
  let inXdata = false
  for (let i = 0; i < r.n; i++) {
    const c = r.codes[i]
    if (c >= 1000) {
      // XDATA : on récupère les paires « clé=valeur » écrites par notre propre export.
      if (c === 1001) inXdata = r.vals[i] === 'APPSTOCK'
      else if (c === 1000 && inXdata) {
        const s = r.vals[i]
        const k = s.indexOf('=')
        if (k > 0) (props ??= {})[s.slice(0, k)] = s.slice(k + 1).trimEnd()
      }
      continue
    }
    switch (c) {
      case 8:
        layer = r.vals[i]
        break
      case 62:
        color = aciToColor(parseInt(r.vals[i]) || 0)
        break
      case 420:
        color = (parseInt(r.vals[i]) || 0) & 0xffffff
        break
      case 370: {
        const v = parseInt(r.vals[i])
        lw = v >= 0 ? v / 100 : -1
        break
      }
      case 5:
        handle = r.vals[i]
        break
      case 230:
        nz = parseFloat(r.vals[i])
        break
      case 67:
        paper = r.vals[i].trim() === '1'
        break
      case 60:
        invisible = r.vals[i].trim() === '1'
        break
    }
  }
  return { layer, color, lw, handle, mirror: nz < 0, paper, invisible, props }
}

function base(c: Common) {
  const b: { layer: string; color: Color; lw?: number; handle?: string; props?: Props } = { layer: c.layer, color: c.color }
  if (c.lw >= 0) b.lw = c.lw
  if (c.handle) b.handle = c.handle
  if (c.props) b.props = c.props
  return b
}

function parseText(r: Rec, c: Common, attrib: boolean): EText | null {
  let x = 0
  let y = 0
  let z = 0
  let ax = 0
  let ay = 0
  let hasAlign = false
  let h = 1
  let rot = 0
  let text = ''
  let h72 = 0
  let v7x = 0
  for (let i = 0; i < r.n; i++) {
    const v = r.vals[i]
    switch (r.codes[i]) {
      case 10:
        x = parseFloat(v)
        break
      case 20:
        y = parseFloat(v)
        break
      case 30:
        z = parseFloat(v)
        break
      case 11:
        ax = parseFloat(v)
        hasAlign = true
        break
      case 21:
        ay = parseFloat(v)
        break
      case 40:
        h = parseFloat(v)
        break
      case 50:
        rot = parseFloat(v) * DEG
        break
      case 1:
        text = v
        break
      case 72:
        h72 = parseInt(v) || 0
        break
      case 73:
        if (!attrib) v7x = parseInt(v) || 0
        break
      case 74:
        if (attrib) v7x = parseInt(v) || 0
        break
    }
  }
  if (!text) return null
  let ha: 0 | 1 | 2 = 0
  let va: 0 | 1 | 2 | 3 = (v7x >= 0 && v7x <= 3 ? v7x : 0) as 0 | 1 | 2 | 3
  if (h72 === 1) ha = 1
  else if (h72 === 2) ha = 2
  else if (h72 === 4) {
    ha = 1
    va = 2
  }
  // Avec un alignement autre que gauche/ligne de base, l'ancrage est le second point.
  if ((ha !== 0 || va !== 0) && hasAlign && (ax !== 0 || ay !== 0)) {
    x = ax
    y = ay
  }
  if (c.mirror) x = -x
  const e: EText = { t: 'text', ...base(c), x, y, h: h || 1, rot, text: decodeDxfText(text), ha, va }
  if (z) e.z = z
  return e
}

function parseMText(r: Rec, c: Common): EText | null {
  let x = 0
  let y = 0
  let h = 1
  let rot = 0
  let attach = 1
  let text = ''
  let dx = 0
  let dy = 0
  let hasDir = false
  let width = 0
  for (let i = 0; i < r.n; i++) {
    const code = r.codes[i]
    if (code === 101) break // objet imbriqué : les codes suivants ne décrivent plus le texte
    const v = r.vals[i]
    switch (code) {
      case 10:
        x = parseFloat(v)
        break
      case 20:
        y = parseFloat(v)
        break
      case 40:
        h = parseFloat(v)
        break
      case 41:
        width = parseFloat(v)
        break
      case 50:
        rot = parseFloat(v) * DEG
        break
      case 11:
        dx = parseFloat(v)
        hasDir = true
        break
      case 21:
        dy = parseFloat(v)
        break
      case 71:
        attach = parseInt(v) || 1
        break
      case 3:
      case 1:
        text += v
        break
    }
  }
  if (!text) return null
  if (hasDir && (dx !== 0 || dy !== 0)) rot = Math.atan2(dy, dx)
  const ha = ((attach - 1) % 3) as 0 | 1 | 2
  const va = (attach <= 3 ? 3 : attach <= 6 ? 2 : 1) as 1 | 2 | 3
  return {
    t: 'text',
    ...base(c),
    x: c.mirror ? -x : x,
    y,
    h: h || 1,
    rot,
    text: cleanMText(decodeDxfText(text)),
    ha,
    va,
    multi: true,
    ...(width > 0 ? { width } : {}),
  }
}

function parseLwPolyline(r: Rec, c: Common): EPolyline | null {
  const xs: number[] = []
  const bulges: number[] = []
  let flags = 0
  let elev: number | undefined
  let anyBulge = false
  for (let i = 0; i < r.n; i++) {
    const v = r.vals[i]
    switch (r.codes[i]) {
      case 10:
        xs.push(parseFloat(v), 0)
        bulges.push(0)
        break
      case 20:
        if (xs.length) xs[xs.length - 1] = parseFloat(v)
        break
      case 42:
        if (bulges.length) {
          const b = parseFloat(v)
          bulges[bulges.length - 1] = b
          if (b !== 0) anyBulge = true
        }
        break
      case 70:
        flags = parseInt(v) || 0
        break
      case 38:
        elev = parseFloat(v)
        break
    }
  }
  if (xs.length < 2) return null
  if (c.mirror) {
    for (let i = 0; i < xs.length; i += 2) xs[i] = -xs[i]
    for (let i = 0; i < bulges.length; i++) bulges[i] = -bulges[i]
  }
  const e: EPolyline = { t: 'pline', ...base(c), pts: Float64Array.from(xs), closed: (flags & 1) === 1 }
  if (anyBulge) e.bulges = Float64Array.from(bulges)
  if (elev) e.elev = elev
  return e
}

function parseSpline(r: Rec, c: Common): Entity | null {
  const knots: number[] = []
  const ctrl: number[] = []
  const fit: number[] = []
  const weights: number[] = []
  let degree = 3
  let flags = 0
  for (let i = 0; i < r.n; i++) {
    const code = r.codes[i]
    const v = r.vals[i]
    if (code === 100 && v === 'AcDbHelix') break
    switch (code) {
      case 70:
        flags = parseInt(v) || 0
        break
      case 71:
        degree = parseInt(v) || 3
        break
      case 40:
        knots.push(parseFloat(v))
        break
      case 41:
        weights.push(parseFloat(v))
        break
      case 10:
        ctrl.push(parseFloat(v), 0)
        break
      case 20:
        if (ctrl.length) ctrl[ctrl.length - 1] = parseFloat(v)
        break
      case 11:
        fit.push(parseFloat(v), 0)
        break
      case 21:
        if (fit.length) fit[fit.length - 1] = parseFloat(v)
        break
    }
  }
  if (ctrl.length < 4 && fit.length < 4) return null
  if (c.mirror) {
    for (let i = 0; i < ctrl.length; i += 2) ctrl[i] = -ctrl[i]
    for (let i = 0; i < fit.length; i += 2) fit[i] = -fit[i]
  }
  return {
    t: 'spline',
    ...base(c),
    degree,
    knots: Float64Array.from(knots),
    ctrl: Float64Array.from(ctrl),
    weights: weights.length === ctrl.length / 2 && weights.some((w) => w !== 1) ? Float64Array.from(weights) : undefined,
    fit: fit.length ? Float64Array.from(fit) : undefined,
    closed: (flags & 1) === 1,
  }
}

/** Contours d'une hachure, discrétisés. */
function hatchRings(r: Rec, tol: number): number[][] {
  const rings: number[][] = []
  let i = 0
  const n = r.n
  const find = (code: number): number => {
    while (i < n && r.codes[i] !== code) i++
    return i < n ? i++ : -1
  }
  const nextNum = (code: number): number => {
    const k = find(code)
    return k < 0 ? 0 : parseFloat(r.vals[k]) || 0
  }
  const pathCount = nextNum(91)
  for (let p = 0; p < pathCount && i < n; p++) {
    const flags = nextNum(92)
    if (i >= n) break
    const ring: number[] = []
    if (flags & 2) {
      nextNum(72)
      const closed = nextNum(73) !== 0
      const count = nextNum(93)
      const pts: number[] = []
      const bulges: number[] = []
      let any = false
      for (let v = 0; v < count && i < n; v++) {
        const x = nextNum(10)
        const y = nextNum(20)
        pts.push(x, y)
        if (i < n && r.codes[i] === 42) {
          const b = parseFloat(r.vals[i++]) || 0
          bulges.push(b)
          if (b) any = true
        } else bulges.push(0)
      }
      ring.push(...(any ? tessellateBulges(pts, bulges, closed, tol) : pts))
    } else {
      const edges = nextNum(93)
      for (let e = 0; e < edges && i < n; e++) {
        const type = nextNum(72)
        if (type === 1) {
          const x0 = nextNum(10)
          const y0 = nextNum(20)
          const x1 = nextNum(11)
          const y1 = nextNum(21)
          ring.push(x0, y0, x1, y1)
        } else if (type === 2 || type === 3) {
          const cx = nextNum(10)
          const cy = nextNum(20)
          let mx = 0
          let my = 0
          let radius = 0
          let ratio = 1
          if (type === 2) radius = nextNum(40)
          else {
            mx = nextNum(11)
            my = nextNum(21)
            ratio = nextNum(40)
          }
          const s = nextNum(50) * DEG
          const en = nextNum(51) * DEG
          const ccw = nextNum(73) !== 0
          const a0 = ccw ? s : -s
          const a1 = ccw ? en : -en
          let sweep = ccw ? a1 - a0 : -(a0 - a1)
          if (ccw) {
            while (sweep <= 1e-12) sweep += Math.PI * 2
          } else {
            while (sweep >= -1e-12) sweep -= Math.PI * 2
          }
          if (type === 2) appendArc(ring, cx, cy, radius, a0, sweep, tol, false)
          else {
            const major = Math.hypot(mx, my)
            const steps = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 36)))
            const nx = -my * ratio
            const ny = mx * ratio
            for (let k = 0; k <= steps && major > 0; k++) {
              const t = a0 + (sweep * k) / steps
              ring.push(cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t))
            }
          }
        } else if (type === 4) {
          const degree = nextNum(94)
          nextNum(73)
          nextNum(74)
          const nk = nextNum(95)
          const nc = nextNum(96)
          const knots: number[] = []
          for (let k = 0; k < nk; k++) knots.push(nextNum(40))
          const ctrl: number[] = []
          const weights: number[] = []
          for (let k = 0; k < nc; k++) {
            ctrl.push(nextNum(10), nextNum(20))
            if (i < n && r.codes[i] === 42) weights.push(parseFloat(r.vals[i++]) || 1)
          }
          let fitCount = 0
          if (i < n && r.codes[i] === 97) fitCount = parseFloat(r.vals[i++]) || 0
          const fit: number[] = []
          for (let k = 0; k < fitCount; k++) fit.push(nextNum(11), nextNum(21))
          if (ctrl.length >= 4) {
            ring.push(...tessellateSpline(degree, knots, ctrl, weights.length === nc ? weights : undefined, Math.max(16, nc * 8)))
          } else if (fit.length >= 4) ring.push(...tessellateFit(fit, 12))
        } else break
      }
    }
    // Objets sources du contour : on les saute.
    if (i < n && r.codes[i] === 97) {
      const refs = parseFloat(r.vals[i++]) || 0
      for (let k = 0; k < refs && i < n && r.codes[i] === 330; k++) i++
    }
    if (ring.length >= 6) rings.push(ring)
  }
  return rings
}

/** Regroupe des anneaux en polygones (extérieur + trous) selon leur emboîtement. */
export function nestRings(rings: number[][]): number[][][] {
  if (rings.length <= 1) return rings.length ? [rings] : []
  const order = rings.map((r, i) => ({ r, i, a: Math.abs(ringArea(r)) })).sort((p, q) => q.a - p.a)
  const depth = new Array<number>(order.length).fill(0)
  const parent = new Array<number>(order.length).fill(-1)
  for (let i = 0; i < order.length; i++) {
    const x = order[i].r[0]
    const y = order[i].r[1]
    for (let j = i - 1; j >= 0; j--) {
      if (pointInRing(x, y, order[j].r)) {
        depth[i] = depth[j] + 1
        parent[i] = j
        break
      }
    }
  }
  const groups = new Map<number, number[][]>()
  for (let i = 0; i < order.length; i++) {
    if (depth[i] % 2 === 0) groups.set(i, [order[i].r])
    else groups.get(parent[i])?.push(order[i].r)
  }
  return [...groups.values()]
}

export interface ParseOptions {
  name: string
  format?: string
}

export function parseDxf(bytes: Uint8Array, options: ParseOptions): Dataset {
  if (bytes.length > 22 && new TextDecoder('latin1').decode(bytes.subarray(0, 22)).startsWith('AutoCAD Binary DXF')) {
    throw new Error('DXF binaire non pris en charge : enregistrez le fichier en DXF ASCII ou en DWG.')
  }
  const ds = newDataset(options.name, options.format ?? 'DXF', 'cad')
  const decoder = new TextDecoder(detectEncoding(bytes))

  const rec = new Rec()
  let section = ''
  let headerVar = ''
  let expectSectionName = false
  let tableType = ''
  let block: Block | null = null
  let skipBlock = false
  let pendingPoly: { c: Common; flags: number; elev: number; pts: number[]; zs: number[]; bulges: number[]; faces: number[][]; target: Entity[] | null } | null =
    null
  let pendingInsert: EInsert | null = null
  let tol = 0.001
  let extMin: [number, number] | null = null
  let extMax: [number, number] | null = null
  let count = 0

  const unsupported = (type: string) => {
    ds.unsupported[type] = (ds.unsupported[type] ?? 0) + 1
  }

  const target = (c: Common): Entity[] | null => {
    if (block) return skipBlock ? null : block.entities
    if (c.paper || c.invisible) return null
    return ds.entities
  }

  const finishEntity = (r: Rec) => {
    const type = r.type
    // Séquences POLYLINE … VERTEX … SEQEND et INSERT … ATTRIB … SEQEND
    if (type === 'VERTEX') {
      if (!pendingPoly) return
      const flags = r.num(70)
      if (flags & 128 && !(flags & 64)) {
        // Enregistrement de face d'un maillage
        const face: number[] = []
        for (const code of [71, 72, 73, 74]) {
          const idx = Math.abs(r.num(code))
          if (idx) face.push(idx - 1)
        }
        if (face.length >= 3) pendingPoly.faces.push(face)
      } else {
        pendingPoly.pts.push(r.num(10), r.num(20))
        pendingPoly.zs.push(r.num(30))
        pendingPoly.bulges.push(r.num(42))
      }
      return
    }
    if (type === 'SEQEND') {
      if (pendingPoly) {
        const p = pendingPoly
        pendingPoly = null
        if (!p.target || p.pts.length < 2) return
        const is3d = (p.flags & 8) !== 0
        if (p.flags & 64) {
          for (const face of p.faces) {
            const ring: number[] = []
            const zs: number[] = []
            for (const idx of face) {
              if (idx * 2 + 1 < p.pts.length) {
                ring.push(p.pts[idx * 2], p.pts[idx * 2 + 1])
                zs.push(p.zs[idx])
              }
            }
            if (ring.length >= 6) {
              p.target.push({ t: 'polygon', ...base(p.c), rings: [Float64Array.from(ring)], zs: [Float64Array.from(zs)], filled: false })
              count++
            }
          }
          return
        }
        if (p.c.mirror) {
          for (let i = 0; i < p.pts.length; i += 2) p.pts[i] = -p.pts[i]
          for (let i = 0; i < p.bulges.length; i++) p.bulges[i] = -p.bulges[i]
        }
        const e: EPolyline = { t: 'pline', ...base(p.c), pts: Float64Array.from(p.pts), closed: (p.flags & 1) === 1 }
        if (is3d || p.zs.some((z) => z !== 0)) e.zs = Float64Array.from(p.zs)
        if (!is3d && p.bulges.some((b) => b !== 0)) e.bulges = Float64Array.from(p.bulges)
        if (!is3d && p.elev) e.elev = p.elev
        p.target.push(e)
        count++
      }
      pendingInsert = null
      return
    }
    if (type === 'ATTRIB') {
      if (pendingInsert) {
        const c = common(r)
        const invisible = (r.num(70) & 1) === 1
        const a = parseText(r, c, true)
        const tag = r.str(2)
        if (a) {
          if (tag) (pendingInsert.props ??= {})[tag] = a.text
          if (!invisible) (pendingInsert.attribs ??= []).push(a)
        }
      }
      return
    }
    // Toute autre entité ferme une séquence en cours
    pendingPoly = null
    pendingInsert = null

    const c = common(r)
    const out = target(c)
    const push = (e: Entity | null) => {
      if (e && out) {
        out.push(e)
        count++
      }
    }
    switch (type) {
      case 'LINE':
        push({
          t: 'line',
          ...base(c),
          x1: r.num(10),
          y1: r.num(20),
          x2: r.num(11),
          y2: r.num(21),
          ...(r.num(30) || r.num(31) ? { z1: r.num(30), z2: r.num(31) } : {}),
        })
        break
      case 'POINT': {
        const z = r.num(30)
        push({ t: 'point', ...base(c), x: r.num(10), y: r.num(20), ...(z ? { z } : {}) })
        break
      }
      case 'CIRCLE': {
        const x = r.num(10)
        const z = r.num(30)
        push({ t: 'circle', ...base(c), cx: c.mirror ? -x : x, cy: r.num(20), r: r.num(40), ...(z ? { z } : {}) })
        break
      }
      case 'ARC': {
        const x = r.num(10)
        let a0 = r.num(50) * DEG
        let a1 = r.num(51) * DEG
        if (c.mirror) [a0, a1] = [Math.PI - a1, Math.PI - a0]
        push({ t: 'arc', ...base(c), cx: c.mirror ? -x : x, cy: r.num(20), r: r.num(40), a0, a1 })
        break
      }
      case 'ELLIPSE': {
        let a0 = r.num(41)
        let a1 = r.has(42) ? r.num(42) : Math.PI * 2
        if (c.mirror) [a0, a1] = [-a1, -a0]
        push({ t: 'ellipse', ...base(c), cx: r.num(10), cy: r.num(20), mx: r.num(11), my: r.num(21), ratio: r.num(40, 1), a0, a1 })
        break
      }
      case 'LWPOLYLINE':
        push(parseLwPolyline(r, c))
        break
      case 'POLYLINE':
        pendingPoly = { c, flags: r.num(70), elev: r.num(30), pts: [], zs: [], bulges: [], faces: [], target: out }
        break
      case 'SPLINE':
      case 'HELIX':
        push(parseSpline(r, c))
        break
      case 'TEXT':
        push(parseText(r, c, false))
        break
      case 'MTEXT':
        push(parseMText(r, c))
        break
      case 'ATTDEF':
        // Définition d'attribut : affichée uniquement hors bloc (dans un bloc, ce sont les ATTRIB des insertions qui s'affichent).
        if (!block) {
          const tag = r.str(2)
          const t = parseText(r, c, true) ?? (tag ? parseText(Object.assign(r, {}), c, true) : null)
          push(t)
        }
        break
      case 'INSERT': {
        const e: EInsert = {
          t: 'insert',
          ...base(c),
          block: r.str(2),
          x: r.num(10),
          y: r.num(20),
          sx: r.num(41, 1) || 1,
          sy: r.num(42, 1) || 1,
          rot: r.num(50) * DEG,
        }
        const z = r.num(30)
        if (z) e.z = z
        if (c.mirror) e.mirror = true
        const cols = r.num(70, 1)
        const rows = r.num(71, 1)
        if (cols > 1 || rows > 1) {
          e.cols = cols
          e.rows = rows
          e.dx = r.num(44)
          e.dy = r.num(45)
        }
        push(e)
        if (r.num(66) === 1 && out) pendingInsert = e
        break
      }
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION': {
        const name = r.str(2)
        if (name) push({ t: 'insert', ...base(c), block: name, x: 0, y: 0, sx: 1, sy: 1, rot: 0 })
        else unsupported(type)
        break
      }
      case 'ACAD_TABLE': {
        const name = r.str(2)
        if (name) push({ t: 'insert', ...base(c), block: name, x: r.num(10), y: r.num(20), sx: 1, sy: 1, rot: 0 })
        else unsupported(type)
        break
      }
      case 'HATCH': {
        const rings = hatchRings(r, tol)
        if (!rings.length) {
          unsupported('HATCH (contour illisible)')
          break
        }
        if (c.mirror) for (const ring of rings) for (let i = 0; i < ring.length; i += 2) ring[i] = -ring[i]
        const pattern = r.str(2) || 'SOLID'
        for (const group of nestRings(rings)) {
          const e: EPolygon = { t: 'polygon', ...base(c), rings: group.map((g) => Float64Array.from(g)), filled: true, pattern }
          push(e)
        }
        break
      }
      case 'SOLID':
      case 'TRACE': {
        const ring = [r.num(10), r.num(20), r.num(11), r.num(21)]
        if (r.has(13)) ring.push(r.num(13), r.num(23))
        ring.push(r.num(12), r.num(22))
        if (c.mirror) for (let i = 0; i < ring.length; i += 2) ring[i] = -ring[i]
        push({ t: 'polygon', ...base(c), rings: [Float64Array.from(ring)], filled: true, pattern: 'SOLID' })
        break
      }
      case '3DFACE': {
        const ring: number[] = []
        const zs: number[] = []
        for (let k = 0; k < 4; k++) {
          if (!r.has(10 + k)) continue
          const x = r.num(10 + k)
          const y = r.num(20 + k)
          const z = r.num(30 + k)
          const m = ring.length
          if (m >= 2 && ring[m - 2] === x && ring[m - 1] === y && zs[zs.length - 1] === z) continue
          ring.push(x, y)
          zs.push(z)
        }
        if (ring.length >= 6) push({ t: 'polygon', ...base(c), rings: [Float64Array.from(ring)], zs: [Float64Array.from(zs)], filled: false })
        break
      }
      case 'LEADER': {
        const pts: number[] = []
        for (let i = 0; i < r.n; i++) {
          if (r.codes[i] === 10) pts.push(parseFloat(r.vals[i]), 0)
          else if (r.codes[i] === 20 && pts.length) pts[pts.length - 1] = parseFloat(r.vals[i])
        }
        if (pts.length >= 4) push({ t: 'pline', ...base(c), pts: Float64Array.from(pts), closed: false })
        break
      }
      case 'MLINE': {
        const pts: number[] = []
        for (let i = 0; i < r.n; i++) {
          if (r.codes[i] === 11) pts.push(parseFloat(r.vals[i]), 0)
          else if (r.codes[i] === 21 && pts.length) pts[pts.length - 1] = parseFloat(r.vals[i])
        }
        if (pts.length >= 4) push({ t: 'pline', ...base(c), pts: Float64Array.from(pts), closed: (r.num(71) & 2) === 2 })
        else unsupported(type)
        break
      }
      case 'IMAGE': {
        // Image raster référencée : on trace son cadre, le fichier image n'est pas dans le dessin.
        const x = r.num(10)
        const y = r.num(20)
        const ux = r.num(11)
        const uy = r.num(21)
        const vx = r.num(12)
        const vy = r.num(22)
        const w = r.num(13)
        const h = r.num(23)
        push({
          t: 'pline',
          ...base(c),
          pts: Float64Array.from([x, y, x + ux * w, y + uy * w, x + ux * w + vx * h, y + uy * w + vy * h, x + vx * h, y + vy * h]),
          closed: true,
        })
        unsupported('IMAGE (cadre seul)')
        break
      }
      case 'VIEWPORT':
      case 'XLINE':
      case 'RAY':
        break // sans objet en espace objet
      default:
        unsupported(type)
    }
  }

  const finish = () => {
    if (!rec.type) return
    const type = rec.type
    if (section === 'TABLES') {
      if (type === 'TABLE') tableType = rec.str(2)
      else if (type === 'ENDTAB') tableType = ''
      else if (type === 'LAYER' && tableType === 'LAYER') {
        const name = rec.str(2)
        if (name) {
          const aci = rec.num(62, 7)
          const flags = rec.num(70)
          const layer = ensureLayer(ds, name)
          layer.color = rec.has(420) ? rec.num(420) & 0xffffff : aciToColor(Math.abs(aci))
          if (layer.color === BYLAYER) layer.color = aciToColor(7)
          layer.visible = aci >= 0 && (flags & 1) === 0
          const lw = rec.num(370, -3)
          layer.lineweight = lw > 0 ? lw / 100 : 0
          const lt = rec.str(6)
          if (lt) layer.ltype = lt
        }
      }
    } else if (section === 'BLOCKS') {
      if (type === 'BLOCK') {
        const name = rec.str(2)
        skipBlock = /^\*(MODEL|PAPER)_SPACE/i.test(name)
        block = { name, bx: rec.num(10), by: rec.num(20), entities: [] }
        if (!skipBlock) ds.blocks.set(name, block)
      } else if (type === 'ENDBLK') {
        pendingPoly = null
        pendingInsert = null
        block = null
      } else if (block) finishEntity(rec)
    } else if (section === 'ENTITIES') {
      finishEntity(rec)
    }
    rec.type = ''
  }

  // --- Lecture par blocs de texte : pas de chaîne géante en mémoire -----------
  const CHUNK = 1 << 23
  let carry = ''
  let pendingCode: number | null = null

  const handleGroup = (code: number, value: string) => {
    if (code === 0) {
      finish()
      if (value === 'SECTION') expectSectionName = true
      else if (value === 'ENDSEC') {
        if (section === 'HEADER') {
          if (extMin && extMax) {
            const diag = Math.hypot(extMax[0] - extMin[0], extMax[1] - extMin[1])
            if (diag > 0 && diag < 1e12) tol = Math.max(diag * 1e-6, 1e-9)
          }
        }
        section = ''
        block = null
      } else if (value === 'EOF') section = 'EOF'
      else rec.reset(value)
      return
    }
    if (expectSectionName) {
      if (code === 2) {
        section = value
        expectSectionName = false
      }
      return
    }
    if (section === 'HEADER') {
      if (code === 9) headerVar = value
      else if (headerVar === '$ACADVER' && code === 1) ds.meta.version = DWG_VERSIONS[value] ?? value
      else if (headerVar === '$INSUNITS' && code === 70) ds.meta.unites = UNITS[parseInt(value)] ?? 'autre (' + value.trim() + ')'
      else if (headerVar === '$EXTMIN' && (code === 10 || code === 20)) {
        extMin ??= [0, 0]
        extMin[code === 10 ? 0 : 1] = parseFloat(value)
      } else if (headerVar === '$EXTMAX' && (code === 10 || code === 20)) {
        extMax ??= [0, 0]
        extMax[code === 10 ? 0 : 1] = parseFloat(value)
      }
      return
    }
    if (rec.type) rec.push(code, value)
  }

  const feed = (text: string, last: boolean) => {
    const s = carry ? carry + text : text
    let pos = 0
    const len = s.length
    for (;;) {
      const nl = s.indexOf('\n', pos)
      if (nl < 0) {
        if (last && pos < len) {
          const line = s.slice(pos)
          if (pendingCode === null) pendingCode = parseInt(line)
          else {
            handleGroup(pendingCode, line.trim())
            pendingCode = null
          }
          pos = len
        }
        break
      }
      let end = nl
      if (end > pos && s.charCodeAt(end - 1) === 13) end--
      if (pendingCode === null) {
        pendingCode = parseInt(s.slice(pos, end))
        if (Number.isNaN(pendingCode)) pendingCode = null
      } else {
        handleGroup(pendingCode, s.slice(pos, end))
        pendingCode = null
        if (section === 'EOF') return
      }
      pos = nl + 1
    }
    carry = pos < len ? s.slice(pos) : ''
  }

  for (let off = 0; off < bytes.length && section !== 'EOF'; off += CHUNK) {
    const end = Math.min(off + CHUNK, bytes.length)
    feed(decoder.decode(bytes.subarray(off, end), { stream: end < bytes.length }), end >= bytes.length)
  }
  finish()

  // Calques cités par des entités mais absents de la table
  const seen = (list: Entity[]) => {
    for (const e of list) if (!ds.layers.has(e.layer)) ensureLayer(ds, e.layer)
  }
  seen(ds.entities)
  for (const b of ds.blocks.values()) seen(b.entities)
  if (!ds.layers.has('0')) ensureLayer(ds, '0')
  ds.meta.entites = count
  return ds
}
