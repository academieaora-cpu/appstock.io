/**
 * Exports : DXF (calques, blocs, attributs conservés), GeoJSON, KML et CSV de points.
 *
 * Quand le système de coordonnées cible est celui du jeu de données, le DXF garde
 * les entités natives (arcs, blocs, textes). Quand il faut reprojeter, les courbes
 * sont discrétisées et les blocs éclatés : c'est signalé dans le compte rendu.
 */
import { DxfWriter, LWPolylineFlags, PolylineFlags, TextHorizontalAlignment, TextVerticalAlignment, Units, point2d, point3d } from '@tarikjabiri/dxf'
import { projector } from '../core/crs'
import { colorToAci, walkDataset, type Projector, type Style } from '../core/geom'
import type { Item } from '../core/project'
import type { Dataset, EText, Entity, Props } from '../core/types'

export interface ExportResult {
  name: string
  mime: string
  data: string | Uint8Array
  /** Ce qui a été simplifié ou perdu : rien n'est dégradé en silence. */
  notes: string[]
}

const RAD = 180 / Math.PI

type Target = Pick<DxfWriter, 'addLine' | 'addLWPolyline' | 'addPolyline3D' | 'addPoint' | 'addCircle' | 'addArc' | 'addText' | 'addInsert' | 'addEllipse' | 'addAttrib' | 'addAttdef'>

function safeName(name: string): string {
  return name.replace(/[<>/\\":;?*|=`,]/g, '_').slice(0, 250) || 'calque'
}

function textOptions(e: EText, layerName: string, colorNumber: number | undefined) {
  const aligned = e.ha !== 0 || e.va !== 0
  return {
    layerName,
    colorNumber,
    rotation: e.rot * RAD,
    horizontalAlignment: [TextHorizontalAlignment.Left, TextHorizontalAlignment.Center, TextHorizontalAlignment.Right][e.ha],
    verticalAlignment: [TextVerticalAlignment.BaseLine, TextVerticalAlignment.Bottom, TextVerticalAlignment.Middle, TextVerticalAlignment.Top][e.va],
    ...(aligned ? { secondAlignmentPoint: point3d(e.x, e.y, e.z ?? 0) } : {}),
  }
}

function xdata(entity: { addXData(name: string): { string(s: string): void } }, props: Props | undefined): void {
  if (!props) return
  const keys = Object.keys(props)
  if (!keys.length) return
  const x = entity.addXData('APPSTOCK')
  // La bibliothèque d'écriture tronque le dernier caractère des chaînes étendues : on ajoute un espace de garde.
  for (const k of keys) x.string(`${k}=${props[k] ?? ''}`.slice(0, 240) + ' ')
}

/** Écrit une entité native (sans reprojection). Renvoie false si elle a dû être simplifiée. */
function writeNative(t: Target, e: Entity, layerName: (n: string) => string, tol: number, inBlock: boolean): boolean {
  const colorNumber = e.color === -1 ? undefined : colorToAci(e.color)
  const o = { layerName: inBlock && e.layer === '0' ? '0' : layerName(e.layer), colorNumber }
  switch (e.t) {
    case 'point':
      xdata(t.addPoint(e.x, e.y, e.z ?? 0, o), e.props)
      return true
    case 'line':
      xdata(t.addLine(point3d(e.x1, e.y1, e.z1 ?? 0), point3d(e.x2, e.y2, e.z2 ?? 0), o), e.props)
      return true
    case 'pline': {
      const n = e.pts.length >> 1
      if (e.zs) {
        const v = []
        for (let i = 0; i < n; i++) v.push({ point: point3d(e.pts[i * 2], e.pts[i * 2 + 1], e.zs[i]) })
        xdata(t.addPolyline3D(v, { ...o, flags: PolylineFlags.Polyline3D | (e.closed ? PolylineFlags.Closed : 0) }), e.props)
      } else {
        const v = []
        for (let i = 0; i < n; i++) v.push({ point: point2d(e.pts[i * 2], e.pts[i * 2 + 1]), ...(e.bulges && e.bulges[i] ? { bulge: e.bulges[i] } : {}) })
        xdata(t.addLWPolyline(v, { ...o, flags: e.closed ? LWPolylineFlags.Closed : LWPolylineFlags.None, ...(e.elev ? { elevation: e.elev } : {}) }), e.props)
      }
      return true
    }
    case 'circle':
      xdata(t.addCircle(point3d(e.cx, e.cy, e.z ?? 0), e.r, o), e.props)
      return true
    case 'arc':
      xdata(t.addArc(point3d(e.cx, e.cy, e.z ?? 0), e.r, e.a0 * RAD, e.a1 * RAD, o), e.props)
      return true
    case 'ellipse':
      xdata(t.addEllipse(point3d(e.cx, e.cy, 0), point3d(e.mx, e.my, 0), e.ratio, e.a0, e.a1, o), e.props)
      return true
    case 'text': {
      const lines = e.text.split('\n')
      lines.forEach((s, i) => {
        if (!s) return
        // Les lignes suivantes d'un texte multiligne sont décalées sous la première.
        const dy = i * e.h * 1.6
        const x = e.x + Math.sin(e.rot) * dy
        const y = e.y - Math.cos(e.rot) * dy
        t.addText(point3d(x, y, e.z ?? 0), e.h, s, textOptions({ ...e, x, y }, o.layerName, colorNumber))
      })
      return true
    }
    case 'polygon':
      for (let r = 0; r < e.rings.length; r++) {
        const ring = e.rings[r]
        const zs = e.zs?.[r]
        const n = ring.length >> 1
        if (zs) {
          const v = []
          for (let i = 0; i < n; i++) v.push({ point: point3d(ring[i * 2], ring[i * 2 + 1], zs[i]) })
          xdata(t.addPolyline3D(v, { ...o, flags: PolylineFlags.Polyline3D | PolylineFlags.Closed }), e.props)
        } else {
          const v = []
          for (let i = 0; i < n; i++) v.push({ point: point2d(ring[i * 2], ring[i * 2 + 1]) })
          xdata(t.addLWPolyline(v, { ...o, flags: LWPolylineFlags.Closed }), e.props)
        }
      }
      return !e.filled
    case 'spline': {
      // Écrite comme polyligne fine : forme identique à la tolérance d'affichage.
      const pts: number[] = []
      walkDataset({ entities: [e], layers: new Map(), blocks: new Map(), xform: null, kind: 'cad' } as unknown as Dataset, null, {
        begin() {},
        polyline(p) {
          pts.push(...p)
        },
        fill() {},
        point() {},
        text() {},
      }, { tol })
      const v = []
      for (let i = 0; i < pts.length; i += 2) v.push({ point: point2d(pts[i], pts[i + 1]) })
      if (v.length >= 2) t.addLWPolyline(v, { ...o, flags: LWPolylineFlags.None })
      return false
    }
    case 'insert': {
      const ins = t.addInsert(safeName(e.block), point3d(e.x, e.y, e.z ?? 0), {
        ...o,
        scaleFactor: { x: e.mirror ? -e.sx : e.sx, y: e.sy, z: 1 },
        rotationAngle: e.rot * RAD,
        ...(e.cols && e.rows ? { columnCount: e.cols, rowCount: e.rows, columnSpacing: e.dx ?? 0, rowSpacing: e.dy ?? 0 } : {}),
      })
      xdata(ins, e.props)
      if (e.attribs) {
        for (const a of e.attribs) {
          // Attribut étiqueté : écrit comme attribut du bloc, reconnu par AutoCAD et Covadis.
          if (a.tag) t.addAttrib(point3d(a.x, a.y, a.z ?? 0), a.h, a.tag, a.text, ins, textOptions(a, layerName(a.layer), a.color === -1 ? undefined : colorToAci(a.color)))
          else writeNative(t, a, layerName, tol, inBlock)
        }
      }
      return true
    }
  }
}

/**
 * Remet au format DXF deux écarts de la bibliothèque d'écriture sur les attributs de bloc :
 * elle termine chaque attribut par un SEQEND (un seul est attendu, après le dernier attribut
 * d'une insertion) et écrit l'alignement vertical des ATTRIB/ATTDEF sous le code 73 au lieu de 74.
 * Sans cette correction, AutoCAD et Covadis peuvent ne lire que le premier attribut.
 */
export function fixAttributeSequences(dxf: string): string {
  const lines = dxf.split('\n')
  const out: string[] = []
  // Début de chaque enregistrement (couple code 0 / type).
  const starts: number[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) if (lines[i].trim() === '0') starts.push(i)
  starts.push(lines.length - (lines.length % 2))
  for (let k = 0; k + 1 < starts.length; k++) {
    const from = starts[k]
    const to = starts[k + 1]
    const type = lines[from + 1].trim()
    const next = k + 2 < starts.length ? lines[starts[k + 1] + 1].trim() : ''
    if (type === 'SEQEND' && next === 'ATTRIB') continue
    if (type === 'ATTRIB' || type === 'ATTDEF') {
      for (let i = from; i < to; i += 2) {
        out.push(lines[i].trim() === '73' ? lines[i].replace('73', '74') : lines[i], lines[i + 1])
      }
    } else {
      for (let i = from; i < to; i++) out.push(lines[i])
    }
  }
  for (let i = starts[starts.length - 1]; i < lines.length; i++) out.push(lines[i])
  return out.join('\n')
}

/** Export DXF d'un ou plusieurs jeux, dans le système `target` (null : coordonnées telles quelles). */
export function exportDxf(items: Item[], target: string | null, name: string): ExportResult {
  const dxf = new DxfWriter()
  dxf.setUnits(Units.Meters)
  const notes: string[] = []
  const layers = new Set<string>(['0'])
  const multi = items.length > 1
  let simplified = 0
  let exploded = 0

  for (const item of items) {
    const ds = item.ds
    const prefix = multi ? safeName(ds.name.replace(/\.[^.]+$/, '')) + '_' : ''
    const layerName = (n: string): string => {
      if (n === '0') return '0'
      const full = safeName(prefix + n)
      if (!layers.has(full)) {
        layers.add(full)
        const layer = ds.layers.get(n)
        dxf.addLayer(full, layer ? colorToAci(layer.color) : 7, 'Continuous')
      }
      return full
    }
    for (const n of ds.layers.keys()) layerName(n)
    const proj: Projector | null = ds.crs && target && ds.crs !== target ? projector(ds.crs, target) : null
    const tol = 0.001
    if (!proj && !ds.xform) {
      for (const b of ds.blocks.values()) {
        if (/^\*/.test(b.name) && !/^\*[DUTX]/i.test(b.name)) continue
        const blk = dxf.addBlock(safeName(b.name))
        blk.basePoint = point3d(b.bx, b.by, 0)
        for (const e of b.entities) if (!writeNative(blk as unknown as Target, e, layerName, tol, true)) simplified++
        for (const d of b.attdefs ?? []) {
          if (d.tag) (blk as unknown as Target).addAttdef(point3d(d.x, d.y, 0), d.h, d.tag, d.text, textOptions(d, layerName(d.layer), d.color === -1 ? undefined : colorToAci(d.color)))
        }
      }
      for (const e of ds.entities) if (!writeNative(dxf as unknown as Target, e, layerName, tol, false)) simplified++
    } else {
      // Reprojection : géométrie développée et discrétisée.
      let props: Props | undefined
      walkDataset(ds, proj, {
        begin(_i, e) {
          props = e.props
          if (e.t === 'insert') exploded++
        },
        polyline(p, closed, zs, s: Style) {
          const o = { layerName: layerName(s.layer), colorNumber: undefined as number | undefined }
          if (Array.isArray(zs)) {
            const v = []
            for (let i = 0; i < p.length; i += 2) v.push({ point: point3d(p[i], p[i + 1], zs[i >> 1] ?? 0) })
            xdata(dxf.addPolyline3D(v, { ...o, flags: PolylineFlags.Polyline3D | (closed ? PolylineFlags.Closed : 0) }), props)
          } else {
            const v = []
            for (let i = 0; i < p.length; i += 2) v.push({ point: point2d(p[i], p[i + 1]) })
            xdata(dxf.addLWPolyline(v, { ...o, flags: closed ? LWPolylineFlags.Closed : LWPolylineFlags.None, ...(typeof zs === 'number' && zs ? { elevation: zs } : {}) }), props)
          }
        },
        fill() {},
        point(x, y, z, s) {
          xdata(dxf.addPoint(x, y, z ?? 0, { layerName: layerName(s.layer) }), props)
        },
        text(x, y, h, rot, text, ha, va, s) {
          const e = { t: 'text', layer: s.layer, color: -1, x, y, h, rot, text, ha, va } as EText
          writeNative(dxf as unknown as Target, e, layerName, tol, false)
        },
      })
    }
  }
  if (simplified) notes.push(`${simplified} entité(s) simplifiée(s) : splines écrites en polylignes, surfaces pleines écrites en contours.`)
  if (exploded) notes.push(`${exploded} bloc(s) éclaté(s) et courbes discrétisées, car le fichier a été reprojeté.`)
  return { name: name + '.dxf', mime: 'application/dxf', data: fixAttributeSequences(dxf.stringify()), notes }
}

// ---------------------------------------------------------------------------
// GeoJSON / KML / CSV
// ---------------------------------------------------------------------------

interface Geo {
  type: 'Point' | 'LineString' | 'Polygon'
  coordinates: unknown
  props: Props
}

function collect(items: Item[], target: string | null): { features: Geo[]; texts: number } {
  const features: Geo[] = []
  let texts = 0
  for (const item of items) {
    const ds = item.ds
    const proj = ds.crs && target && ds.crs !== target ? projector(ds.crs, target) : null
    let props: Props = {}
    let fills = false
    walkDataset(ds, proj, {
      begin(_i, e: Entity) {
        props = { ...(e.props ?? {}), calque: e.layer }
        fills = e.t === 'polygon' && e.filled
      },
      polyline(p, closed, zs) {
        if (fills) return // déjà émis comme polygone
        const coords: number[][] = []
        for (let i = 0; i < p.length; i += 2) {
          const z = Array.isArray(zs) ? zs[i >> 1] : typeof zs === 'number' ? zs : undefined
          coords.push(z !== undefined && z !== 0 ? [p[i], p[i + 1], z] : [p[i], p[i + 1]])
        }
        if (closed && coords.length >= 3) {
          coords.push(coords[0])
          features.push({ type: 'Polygon', coordinates: [coords], props })
        } else features.push({ type: 'LineString', coordinates: coords, props })
      },
      fill(rings) {
        const coords = rings.map((r) => {
          const c: number[][] = []
          for (let i = 0; i < r.length; i += 2) c.push([r[i], r[i + 1]])
          c.push(c[0])
          return c
        })
        features.push({ type: 'Polygon', coordinates: coords, props })
      },
      point(x, y, z) {
        features.push({ type: 'Point', coordinates: z !== null && z !== 0 ? [x, y, z] : [x, y], props })
      },
      text(x, y, _h, _r, text) {
        texts++
        features.push({ type: 'Point', coordinates: [x, y], props: { ...props, texte: text } })
      },
    })
  }
  return { features, texts }
}

export function exportGeoJSON(items: Item[], name: string): ExportResult {
  const { features, texts } = collect(items, 'EPSG:4326')
  const round = (v: unknown): unknown => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v)
  const fc = {
    type: 'FeatureCollection',
    features: features.map((f) => ({ type: 'Feature', properties: f.props, geometry: { type: f.type, coordinates: round(f.coordinates) } })),
  }
  const notes = ['Coordonnées converties en longitude/latitude WGS 84 (norme GeoJSON).', 'Arcs et courbes discrétisés ; blocs éclatés en géométries simples.']
  if (texts) notes.push(`${texts} texte(s) exporté(s) comme points portant l'attribut « texte ».`)
  return { name: name + '.geojson', mime: 'application/geo+json', data: JSON.stringify(fc), notes }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function exportKml(items: Item[], name: string): ExportResult {
  const { features } = collect(items, 'EPSG:4326')
  const c = (p: number[]) => p.map((v) => Math.round(v * 1e8) / 1e8).join(',')
  const body = features
    .map((f) => {
      const data = Object.entries(f.props)
        .map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(String(v ?? ''))}</value></Data>`)
        .join('')
      let geom = ''
      if (f.type === 'Point') geom = `<Point><coordinates>${c(f.coordinates as number[])}</coordinates></Point>`
      else if (f.type === 'LineString') geom = `<LineString><coordinates>${(f.coordinates as number[][]).map(c).join(' ')}</coordinates></LineString>`
      else {
        const rings = f.coordinates as number[][][]
        geom =
          '<Polygon>' +
          rings.map((r, i) => `<${i ? 'inner' : 'outer'}BoundaryIs><LinearRing><coordinates>${r.map(c).join(' ')}</coordinates></LinearRing></${i ? 'inner' : 'outer'}BoundaryIs>`).join('') +
          '</Polygon>'
      }
      const label = f.props.texte ?? f.props.MAT ?? f.props.calque ?? ''
      return `<Placemark><name>${esc(String(label))}</name><ExtendedData>${data}</ExtendedData>${geom}</Placemark>`
    })
    .join('\n')
  const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>\n${body}\n</Document></kml>\n`
  return { name: name + '.kml', mime: 'application/vnd.google-earth.kml+xml', data: kml, notes: ['Coordonnées converties en longitude/latitude WGS 84.', 'Arcs et courbes discrétisés ; blocs éclatés.'] }
}

/** Tableau des points (blocs de points topo, points SIG) : matricule;X;Y;Z;code. */
export function exportPointsCsv(items: Item[], target: string | null, name: string): ExportResult {
  const lines = ['Point;X;Y;Z;Code']
  let n = 0
  for (const item of items) {
    const ds = item.ds
    const proj = ds.crs && target && ds.crs !== target ? projector(ds.crs, target) : null
    for (const e of ds.entities) {
      if (e.t !== 'point' && e.t !== 'insert') continue
      if (e.t === 'insert' && !e.props) continue
      const p = proj ? proj(e.x, e.y) : [e.x, e.y]
      const props = e.props ?? {}
      const id = props.MAT ?? props.MATRICULE ?? props.id ?? props.name ?? ++n
      const z = e.z ?? props.ALT ?? props.z ?? ''
      const code = props.COD ?? props.CODE ?? props.code ?? ''
      lines.push([id, p[0].toFixed(3), p[1].toFixed(3), typeof z === 'number' ? z.toFixed(3) : z, code].join(';'))
    }
  }
  return { name: name + '_points.csv', mime: 'text/csv', data: lines.join('\n') + '\n', notes: [`${lines.length - 1} point(s) exporté(s).`] }
}

export function download(result: { name: string; mime: string; data: string | Uint8Array | Blob }): void {
  const blob = result.data instanceof Blob ? result.data : new Blob([result.data as BlobPart], { type: result.mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // Nom de fichier sûr sur tous les systèmes.
  a.download = result.name.replace(/[\\/:*?"<>|\u2013\u2014]+/g, '-').replace(/\s+/g, '_')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

