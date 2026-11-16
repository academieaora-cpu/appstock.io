/**
 * Formats SIG : GeoJSON, Shapefile, KML/KMZ, GPX → jeu de données du modèle unifié.
 * Les coordonnées restent dans le système d'origine du fichier ; la table
 * attributaire est conservée telle quelle.
 */
import { gpx, kml } from '@tmcw/togeojson'
import { unzipSync } from 'fflate'
import { combine, parseDbf, parseShp } from 'shpjs'
import { registerCustomCrs } from '../core/crs'
import { ensureLayer, newDataset, type Dataset, type Props } from '../core/types'

type Position = number[]
interface Geometry {
  type: string
  coordinates?: unknown
  geometries?: Geometry[]
}
interface Feature {
  type: 'Feature'
  geometry: Geometry | null
  properties: Record<string, unknown> | null
}
interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
  crs?: { properties?: { name?: string } }
}

const PALETTE = [0x1f78b4, 0xe31a1c, 0x33a02c, 0xff7f00, 0x6a3d9a, 0xb15928, 0x00a6a6, 0xd6338a]
let paletteIndex = 0

function cleanProps(p: Record<string, unknown> | null): Props | undefined {
  if (!p) return undefined
  const out: Props = {}
  let any = false
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue
    out[k] = v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v)
    any = true
  }
  return any ? out : undefined
}

function flat(coords: Position[]): { pts: Float64Array; zs?: Float64Array } {
  const pts = new Float64Array(coords.length * 2)
  let hasZ = false
  for (let i = 0; i < coords.length; i++) {
    pts[i * 2] = coords[i][0]
    pts[i * 2 + 1] = coords[i][1]
    if (coords[i].length > 2 && coords[i][2]) hasZ = true
  }
  if (!hasZ) return { pts }
  return { pts, zs: Float64Array.from(coords, (c) => c[2] ?? 0) }
}

/** Anneau sans le point de fermeture répété. */
function ring(coords: Position[]): { pts: Float64Array; zs?: Float64Array } {
  const n = coords.length
  const closed = n > 1 && coords[0][0] === coords[n - 1][0] && coords[0][1] === coords[n - 1][1]
  return flat(closed ? coords.slice(0, n - 1) : coords)
}

export function fromGeoJSON(data: unknown, name: string, format: string, crs: string | null): Dataset {
  const ds = newDataset(name, format, 'gis')
  const color = PALETTE[paletteIndex++ % PALETTE.length]
  const layer = ensureLayer(ds, name, color).name
  ds.layers.get(layer)!.lineweight = 0.35
  let root = data as { type?: string; features?: Feature[]; crs?: FeatureCollection['crs'] }
  if (Array.isArray(data)) root = { type: 'FeatureCollection', features: (data as FeatureCollection[]).flatMap((c) => c.features ?? []) }
  const features: Feature[] =
    root.type === 'FeatureCollection' ? (root.features ?? []) : root.type === 'Feature' ? [root as unknown as Feature] : [{ type: 'Feature', geometry: root as Geometry, properties: null }]
  // Ancienne convention : système de coordonnées nommé dans le fichier.
  const named = root.crs?.properties?.name
  const m = named ? /EPSG:{1,2}(\d+)/i.exec(named) : null
  ds.crs = m ? 'EPSG:' + m[1] : named && /CRS84/i.test(named) ? 'EPSG:4326' : crs
  ds.crsSource = ds.crs ? 'file' : 'none'
  const fields = new Set<string>()
  let fid = 0
  const add = (g: Geometry | null, props: Props | undefined, id: number): void => {
    if (!g) return
    const b = { layer, color: -1, props, fid: id }
    switch (g.type) {
      case 'Point': {
        const c = g.coordinates as Position
        ds.entities.push({ t: 'point', ...b, x: c[0], y: c[1], ...(c.length > 2 && c[2] ? { z: c[2] } : {}) })
        break
      }
      case 'MultiPoint':
        for (const c of g.coordinates as Position[]) ds.entities.push({ t: 'point', ...b, x: c[0], y: c[1], ...(c.length > 2 && c[2] ? { z: c[2] } : {}) })
        break
      case 'LineString': {
        const f = flat(g.coordinates as Position[])
        if (f.pts.length >= 4) ds.entities.push({ t: 'pline', ...b, pts: f.pts, ...(f.zs ? { zs: f.zs } : {}), closed: false })
        break
      }
      case 'MultiLineString':
        for (const l of g.coordinates as Position[][]) {
          const f = flat(l)
          if (f.pts.length >= 4) ds.entities.push({ t: 'pline', ...b, pts: f.pts, ...(f.zs ? { zs: f.zs } : {}), closed: false })
        }
        break
      case 'Polygon': {
        const rings = (g.coordinates as Position[][]).map(ring).filter((r) => r.pts.length >= 6)
        if (rings.length) ds.entities.push({ t: 'polygon', ...b, rings: rings.map((r) => r.pts), filled: true })
        break
      }
      case 'MultiPolygon':
        for (const poly of g.coordinates as Position[][][]) {
          const rings = poly.map(ring).filter((r) => r.pts.length >= 6)
          if (rings.length) ds.entities.push({ t: 'polygon', ...b, rings: rings.map((r) => r.pts), filled: true })
        }
        break
      case 'GeometryCollection':
        for (const sub of g.geometries ?? []) add(sub, props, id)
        break
      default:
        ds.unsupported[g.type] = (ds.unsupported[g.type] ?? 0) + 1
    }
  }
  for (const f of features) {
    const props = cleanProps(f.properties)
    if (props) for (const k of Object.keys(props)) fields.add(k)
    add(f.geometry, props, fid++)
  }
  ds.fields = [...fields]
  ds.meta.entites = features.length
  return ds
}

export function parseGeoJSON(text: string, name: string): Dataset {
  return fromGeoJSON(JSON.parse(text), name, 'GeoJSON', 'EPSG:4326')
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier XML illisible')
  return doc
}

export function parseKml(text: string, name: string): Dataset {
  return fromGeoJSON(kml(parseXml(text)), name, 'KML', 'EPSG:4326')
}

export function parseGpx(text: string, name: string): Dataset {
  return fromGeoJSON(gpx(parseXml(text)), name, 'GPX', 'EPSG:4326')
}

export function parseKmz(bytes: Uint8Array, name: string): Dataset {
  const files = unzipSync(bytes)
  const entry = Object.keys(files).find((f) => f.toLowerCase().endsWith('.kml'))
  if (!entry) throw new Error('Archive KMZ sans fichier KML')
  const ds = parseKml(new TextDecoder().decode(files[entry]), name)
  ds.format = 'KMZ'
  return ds
}

export interface ShapeParts {
  shp: Uint8Array
  dbf?: Uint8Array
  prj?: string
  cpg?: string
}

/** Shapefile : géométries lues sans reprojection, système repris du .prj. */
export function parseShapefile(parts: ShapeParts, name: string): Dataset {
  const geometries = parseShp(parts.shp)
  const attributes = parts.dbf ? parseDbf(parts.dbf, parts.cpg) : undefined
  const collection = combine([geometries, attributes]) as unknown
  let crs: string | null = null
  let note = ''
  if (parts.prj) {
    try {
      crs = registerCustomCrs(parts.prj)
    } catch {
      note = 'fichier .prj illisible'
    }
  }
  const ds = fromGeoJSON(collection, name, 'Shapefile', crs)
  if (note) ds.meta.remarque = note
  if (!parts.prj) ds.meta.remarque = 'pas de fichier .prj : système à définir'
  return ds
}

/** Archive .zip contenant un ou plusieurs shapefiles. */
export function parseShapeZip(bytes: Uint8Array, name: string): Dataset[] {
  const files = unzipSync(bytes)
  const byBase = new Map<string, Record<string, Uint8Array>>()
  for (const [path, content] of Object.entries(files)) {
    const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(path)
    if (!m || path.includes('__MACOSX')) continue
    const base = m[1]
    let entry = byBase.get(base)
    if (!entry) byBase.set(base, (entry = {}))
    entry[m[2].toLowerCase()] = content
  }
  const out: Dataset[] = []
  const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(b) : undefined)
  for (const [base, e] of byBase) {
    if (!e.shp) continue
    out.push(parseShapefile({ shp: e.shp, dbf: e.dbf, prj: text(e.prj), cpg: text(e.cpg) }, base.split('/').pop() || name))
  }
  if (!out.length) throw new Error('Aucun shapefile (.shp) dans cette archive')
  return out
}
