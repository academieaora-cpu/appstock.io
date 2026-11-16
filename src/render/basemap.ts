/**
 * Fond de carte tuilé (tuiles Web Mercator) affiché dans le système du projet,
 * quel qu'il soit : chaque tuile est recalée par ses coins, ce qui est exact à
 * l'échelle d'une tuile pour les projections conformes (UTM, Lambert).
 */
import { transform } from '../core/crs'
import type { View } from './painter'

export interface TileSource {
  id: string
  label: string
  url: string
  maxZoom: number
  attribution: string
}

export const TILE_SOURCES: TileSource[] = [
  { id: 'osm', label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '© les contributeurs d’OpenStreetMap' },
  {
    id: 'satellite',
    label: 'Imagerie satellite (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    attribution: 'Imagerie : Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'ign-ortho',
    label: 'Orthophotos IGN (France)',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    maxZoom: 19,
    attribution: '© IGN – Géoplateforme',
  },
  {
    id: 'ign-plan',
    label: 'Plan IGN (France)',
    url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    maxZoom: 18,
    attribution: '© IGN – Géoplateforme',
  },
]

const HALF = 20037508.342789244
const MERC = 'EPSG:3857'

interface Tile {
  img: HTMLImageElement
  state: 'loading' | 'ok' | 'failed'
  failedAt: number
  used: number
}

const cache = new Map<string, Tile>()
let clock = 0

function getTile(source: TileSource, z: number, x: number, y: number, onLoad: () => void): Tile {
  const key = `${source.id}/${z}/${x}/${y}`
  let tile = cache.get(key)
  if (tile && tile.state === 'failed' && Date.now() - tile.failedAt > 20000) {
    cache.delete(key)
    tile = undefined
  }
  if (!tile) {
    const img = new Image()
    const created: Tile = { img, state: 'loading', failedAt: 0, used: 0 }
    tile = created
    img.onload = () => {
      created.state = 'ok'
      onLoad()
    }
    img.onerror = () => {
      created.state = 'failed'
      created.failedAt = Date.now()
    }
    img.src = source.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    cache.set(key, tile)
    if (cache.size > 400) {
      // On retire les tuiles les moins récemment utilisées.
      const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 100)
      for (const [k] of old) cache.delete(k)
    }
  }
  tile.used = ++clock
  return tile
}

/** Dessine le fond de carte. Renvoie false si le système du projet ne le permet pas. */
export function drawBasemap(ctx: CanvasRenderingContext2D, view: View, width: number, height: number, crs: string, source: TileSource, onLoad: () => void): boolean {
  let toMerc: (x: number, y: number) => [number, number]
  let fromMerc: (x: number, y: number) => [number, number]
  try {
    toMerc = (x, y) => transform(crs, MERC, x, y)
    fromMerc = (x, y) => transform(MERC, crs, x, y)
    toMerc(view.cx, view.cy)
  } catch {
    return false
  }
  const world = (px: number, py: number): [number, number] => [view.cx + (px - view.ox) / view.scale, view.cy - (py - view.oy) / view.scale]
  // Emprise de l'écran en Mercator, par échantillonnage d'une grille de points.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const w = world((width * i) / 4, (height * j) / 4)
      const m = toMerc(w[0], w[1])
      if (!Number.isFinite(m[0]) || !Number.isFinite(m[1])) continue
      if (m[0] < minX) minX = m[0]
      if (m[0] > maxX) maxX = m[0]
      if (m[1] < minY) minY = m[1]
      if (m[1] > maxY) maxY = m[1]
    }
  }
  if (!(minX < maxX) || !(minY < maxY)) return false
  minY = Math.max(minY, -HALF)
  maxY = Math.min(maxY, HALF)
  // Niveau de zoom : une tuile de 256 px couvre environ 256 à 512 px d'écran.
  const mercPerPx = Math.max(maxX - minX, 1e-9) / Math.max(width, 1)
  let z = Math.round(Math.log2((2 * HALF) / 256 / mercPerPx) - 0.35)
  z = Math.max(0, Math.min(source.maxZoom, z))
  let n = 2 ** z
  const range = () => {
    const size = (2 * HALF) / n
    return {
      size,
      x0: Math.floor((minX + HALF) / size),
      x1: Math.floor((maxX + HALF) / size),
      y0: Math.max(0, Math.floor((HALF - maxY) / size)),
      y1: Math.min(n - 1, Math.floor((HALF - minY) / size)),
    }
  }
  let r = range()
  while ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 96 && z > 0) {
    z--
    n = 2 ** z
    r = range()
  }
  const out = (mx: number, my: number): [number, number] => {
    const p = fromMerc(mx, my)
    return [view.ox + (p[0] - view.cx) * view.scale, view.oy - (p[1] - view.cy) * view.scale]
  }
  ctx.save()
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      const wrapped = ((tx % n) + n) % n
      const tile = getTile(source, z, wrapped, ty, onLoad)
      if (tile.state !== 'ok') continue
      const mx0 = tx * r.size - HALF
      const my1 = HALF - ty * r.size
      const tl = out(mx0, my1)
      const tr = out(mx0 + r.size, my1)
      const bl = out(mx0, my1 - r.size)
      if (!Number.isFinite(tl[0] + tl[1] + tr[0] + tr[1] + bl[0] + bl[1])) continue
      ctx.setTransform((tr[0] - tl[0]) / 256, (tr[1] - tl[1]) / 256, (bl[0] - tl[0]) / 256, (bl[1] - tl[1]) / 256, tl[0], tl[1])
      ctx.drawImage(tile.img, 0, 0, 256.6, 256.6)
    }
  }
  ctx.restore()
  return true
}
