/**
 * Plan de situation : extrait de carte centré sur le terrain, à l'échelle choisie, avec le
 * contour du terrain en rouge. Fond OpenStreetMap par défaut (libre, sans clé, attribution
 * obligatoire) ; Google Maps par l'API officielle Maps Static quand une clé est fournie.
 * Si le fond n'est pas joignable (hors ligne, clé refusée), on le dit : rien n'est inventé.
 */

export type SituationProvider = 'osm' | 'google'

export interface SituationRequest {
  lon: number
  lat: number
  /** Contour du terrain en longitude, latitude (facultatif). */
  ring: [number, number][] | null
  widthMm: number
  heightMm: number
  /** Dénominateur de l'échelle du plan de situation. */
  scale: number
  provider: SituationProvider
  googleKey?: string
  googleType?: 'roadmap' | 'hybrid'
}

export interface SituationMap {
  canvas: HTMLCanvasElement
  attribution: string
  scale: number
  provider: SituationProvider
  /** Remarque à afficher (fond de remplacement, par exemple). */
  note?: string
}

const EARTH = 6378137
/** Densité de l'image : 6 pixels par millimètre papier (environ 150 points par pouce). */
export const PX_PER_MM = 6

/** Mètres terrain par pixel d'une tuile Web Mercator au niveau z, à la latitude donnée. */
export function groundResolution(lat: number, z: number): number {
  return (2 * Math.PI * EARTH * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z)
}

/** Position en pixels globaux Web Mercator au niveau z. */
export function mercatorPx(lon: number, lat: number, z: number): [number, number] {
  const n = 256 * 2 ** z
  const phi = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n]
}

/**
 * Niveau de tuiles et facteur d'agrandissement pour obtenir l'échelle demandée : au niveau
 * choisi, un pixel de tuile vaut `factor` pixel de l'image finale.
 */
export function zoomFor(lat: number, scale: number, pxPerMm = PX_PER_MM, maxZoom = 19): { z: number; factor: number } {
  const target = scale / 1000 / pxPerMm
  const ideal = Math.log2(groundResolution(lat, 0) / target)
  const z = Math.max(0, Math.min(maxZoom, Math.ceil(ideal - 1e-9)))
  return { z, factor: groundResolution(lat, z) / target }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image non chargée'))
    img.src = url
  })
}

/** Contour du terrain (ou repère s'il est trop petit à cette échelle), et attribution. */
function overlay(ctx: CanvasRenderingContext2D, req: SituationRequest, toPx: (lon: number, lat: number) => [number, number], attribution: string): void {
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const [cx, cy] = toPx(req.lon, req.lat)
  let size = 0
  if (req.ring && req.ring.length >= 3) {
    const pts = req.ring.map(([lon, lat]) => toPx(lon, lat))
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.closePath()
    ctx.fillStyle = 'rgba(230,0,0,0.35)'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#e00000'
    ctx.stroke()
  }
  if (size < 14) {
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#e00000'
    ctx.beginPath()
    ctx.arc(cx, cy, 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 15, cy)
    ctx.lineTo(cx - 4, cy)
    ctx.moveTo(cx + 4, cy)
    ctx.lineTo(cx + 15, cy)
    ctx.moveTo(cx, cy - 15)
    ctx.lineTo(cx, cy - 4)
    ctx.moveTo(cx, cy + 4)
    ctx.lineTo(cx, cy + 15)
    ctx.stroke()
  }
  ctx.font = '11px Helvetica, Arial, sans-serif'
  const tw = ctx.measureText(attribution).width
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillRect(W - tw - 8, H - 16, tw + 8, 16)
  ctx.fillStyle = '#333'
  ctx.textBaseline = 'middle'
  ctx.fillText(attribution, W - tw - 4, H - 8)
}

async function fromOsm(req: SituationRequest): Promise<SituationMap> {
  const W = Math.round(req.widthMm * PX_PER_MM)
  const H = Math.round(req.heightMm * PX_PER_MM)
  const { z, factor } = zoomFor(req.lat, req.scale)
  const [gx, gy] = mercatorPx(req.lon, req.lat, z)
  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f2efe9'
  ctx.fillRect(0, 0, W, H)
  const halfW = W / 2 / factor
  const halfH = H / 2 / factor
  const n = 2 ** z
  const jobs: Promise<boolean>[] = []
  for (let ty = Math.floor((gy - halfH) / 256); ty <= Math.floor((gy + halfH) / 256); ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor((gx - halfW) / 256); tx <= Math.floor((gx + halfW) / 256); tx++) {
      const x = ((tx % n) + n) % n
      jobs.push(
        loadImage(`https://tile.openstreetmap.org/${z}/${x}/${ty}.png`).then(
          (img) => {
            ctx.drawImage(img, (tx * 256 - gx) * factor + W / 2, (ty * 256 - gy) * factor + H / 2, 256 * factor + 0.5, 256 * factor + 0.5)
            return true
          },
          () => false,
        ),
      )
    }
  }
  const ok = (await Promise.all(jobs)).filter(Boolean).length
  if (!ok) throw new Error('fond OpenStreetMap inaccessible (connexion ?)')
  const toPx = (lon: number, lat: number): [number, number] => {
    const [x, y] = mercatorPx(lon, lat, z)
    return [(x - gx) * factor + W / 2, (y - gy) * factor + H / 2]
  }
  const attribution = '© contributeurs OpenStreetMap'
  overlay(ctx, req, toPx, attribution)
  return { canvas, attribution, scale: req.scale, provider: 'osm', ...(ok < jobs.length ? { note: `${jobs.length - ok} tuile(s) manquante(s)` } : {}) }
}

async function fromGoogle(req: SituationRequest): Promise<SituationMap> {
  if (!req.googleKey) throw new Error('clé Google Maps absente')
  const W = Math.round(req.widthMm * PX_PER_MM)
  const H = Math.round(req.heightMm * PX_PER_MM)
  // Image « scale=2 » : deux pixels par pixel de tuile. Niveau choisi par défaut pour couvrir la zone.
  const target = req.scale / 1000 / PX_PER_MM
  const z = Math.max(0, Math.min(20, Math.floor(Math.log2(groundResolution(req.lat, 0) / 2 / target))))
  const factor = groundResolution(req.lat, z) / 2 / target
  const sw = Math.min(640, Math.ceil(W / factor / 2) + 2)
  const sh = Math.min(640, Math.ceil(H / factor / 2) + 2)
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${req.lat.toFixed(7)},${req.lon.toFixed(7)}&zoom=${z}&size=${sw}x${sh}&scale=2&maptype=${req.googleType ?? 'roadmap'}&key=${encodeURIComponent(req.googleKey)}`
  const img = await loadImage(url)
  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  const dw = img.width * factor
  const dh = img.height * factor
  ctx.drawImage(img, W / 2 - dw / 2, H / 2 - dh / 2, dw, dh)
  // Pixels de l'image Google (scale 2) autour du centre.
  const [gx, gy] = mercatorPx(req.lon, req.lat, z)
  const toPx = (lon: number, lat: number): [number, number] => {
    const [x, y] = mercatorPx(lon, lat, z)
    return [(x - gx) * 2 * factor + W / 2, (y - gy) * 2 * factor + H / 2]
  }
  const attribution = 'Données cartographiques © Google'
  overlay(ctx, req, toPx, attribution)
  return { canvas, attribution, scale: req.scale, provider: 'google' }
}

const cache = new Map<string, Promise<SituationMap>>()

export function situationKey(req: SituationRequest): string {
  const ring = req.ring ? req.ring.map(([a, b]) => a.toFixed(6) + ',' + b.toFixed(6)).join(';') : ''
  return [req.provider, req.googleType ?? '', req.lon.toFixed(6), req.lat.toFixed(6), Math.round(req.widthMm * 10), Math.round(req.heightMm * 10), req.scale, ring, req.googleKey ? 'k' : ''].join('|')
}

/** Plan de situation (mis en cache) ; Google Maps se replie sur OpenStreetMap en cas d'échec. */
export function situationMap(req: SituationRequest): Promise<SituationMap> {
  const key = situationKey(req)
  let p = cache.get(key)
  if (!p) {
    p =
      req.provider === 'google'
        ? fromGoogle(req).catch(async (err: Error) => ({ ...(await fromOsm({ ...req, provider: 'osm' })), note: `Google Maps indisponible (${err.message}) : fond OpenStreetMap utilisé` }))
        : fromOsm(req)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

/** Résultat déjà prêt (sans attendre), pour un tracé synchrone ; lance le calcul sinon. */
const ready = new Map<string, SituationMap | Error>()
const tracked = new Set<string>()
export function situationReady(req: SituationRequest, onReady?: () => void): SituationMap | Error | undefined {
  const key = situationKey(req)
  const r = ready.get(key)
  if (r) return r
  if (!tracked.has(key)) {
    tracked.add(key)
    situationMap(req).then(
      (m) => {
        ready.set(key, m)
        onReady?.()
      },
      (e: Error) => {
        ready.set(key, e)
        onReady?.()
      },
    )
  }
  return undefined
}

/** Oublie les échecs pour retenter (retour de la connexion, nouvelle clé). */
export function retrySituations(): void {
  for (const [k, v] of ready) {
    if (v instanceof Error) {
      ready.delete(k)
      tracked.delete(k)
    }
  }
}
