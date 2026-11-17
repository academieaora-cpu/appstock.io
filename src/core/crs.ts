/**
 * Systèmes de coordonnées : catalogue, reprojection (proj4js) et détection
 * automatique du système d'un fichier qui n'en déclare pas (cas habituel d'un DWG).
 */
import proj4 from 'proj4'
import type { Projector } from './geom'
import type { Extent } from './types'

export interface CrsDef {
  code: string
  name: string
  proj4: string
  /** Zone d'usage en longitude/latitude : ouest, sud, est, nord. */
  bbox: [number, number, number, number]
  /** Pays ou régions couverts (recherche et affichage). */
  area: string
  geographic?: boolean
}

const UTM_AREAS: Record<string, string> = {
  '28N': 'Sénégal, Mauritanie, Gambie, Guinée-Bissau, Guinée ouest',
  '29N': 'Guinée, Mali ouest, Côte d’Ivoire ouest, Maroc ouest',
  '30N': 'Côte d’Ivoire, Burkina Faso, Mali, Ghana, Maroc, Algérie ouest',
  '31N': 'Bénin, Togo, Niger ouest, Burkina Faso est, Algérie, France',
  '32N': 'Cameroun (Yaoundé, Douala), Gabon nord, Niger, Tunisie, Nigeria',
  '33N': 'Cameroun est, Tchad, Centrafrique, Congo nord',
  '34N': 'Tchad est, Centrafrique, RD Congo nord',
  '35N': 'RD Congo nord-est, Soudan du Sud',
  '36N': 'Ouganda, Éthiopie ouest',
  '37N': 'Éthiopie, Kenya nord',
  '38N': 'Djibouti, Éthiopie est',
  '20N': 'Guadeloupe, Martinique',
  '22N': 'Guyane',
  '32S': 'Gabon, Congo ouest',
  '33S': 'Congo, RD Congo ouest, Angola',
  '34S': 'RD Congo centre',
  '35S': 'RD Congo est, Burundi, Rwanda',
  '36S': 'Burundi, Rwanda, Tanzanie',
  '38S': 'Madagascar ouest, Comores, Mayotte',
  '39S': 'Madagascar est',
  '40S': 'La Réunion, Maurice',
}

function buildCatalog(): CrsDef[] {
  const list: CrsDef[] = [
    { code: 'EPSG:4326', name: 'WGS 84 (longitude, latitude)', proj4: '+proj=longlat +datum=WGS84 +no_defs', bbox: [-180, -90, 180, 90], area: 'Monde', geographic: true },
    {
      code: 'EPSG:3857',
      name: 'WGS 84 / Pseudo-Mercator (web)',
      proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
      bbox: [-180, -85.06, 180, 85.06],
      area: 'Monde (fonds de carte web)',
    },
    {
      code: 'EPSG:2154',
      name: 'RGF93 / Lambert-93',
      proj4: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
      bbox: [-9.86, 41.15, 10.38, 51.56],
      area: 'France métropolitaine',
    },
  ]
  for (let n = 42; n <= 50; n++) {
    list.push({
      code: 'EPSG:' + (3900 + n),
      name: `RGF93 / CC${n} (conique conforme zone ${n - 41})`,
      proj4: `+proj=lcc +lat_0=${n} +lon_0=3 +lat_1=${n - 0.75} +lat_2=${n + 0.75} +x_0=1700000 +y_0=${(n - 41) * 1000000 + 200000} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`,
      bbox: [-9.86, n - 1, 10.38, n + 1],
      area: 'France métropolitaine, bande de latitude ' + n + '°',
    })
  }
  list.push({
    code: 'EPSG:27572',
    name: 'NTF (Paris) / Lambert zone II étendu',
    proj4: '+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs',
    bbox: [-4.87, 42.33, 8.23, 51.14],
    area: 'France métropolitaine (ancien système, précision métrique sans grille)',
  })
  const utm = (zone: number, south: boolean) => {
    const key = zone + (south ? 'S' : 'N')
    const lon0 = zone * 6 - 183
    list.push({
      code: 'EPSG:' + ((south ? 32700 : 32600) + zone),
      name: `WGS 84 / UTM zone ${zone} ${south ? 'Sud' : 'Nord'}`,
      proj4: `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
      bbox: [lon0 - 3, south ? -80 : 0, lon0 + 3, south ? 0 : 84],
      area: UTM_AREAS[key] ?? `fuseau ${lon0 - 3}° à ${lon0 + 3}°`,
    })
  }
  for (let z = 1; z <= 60; z++) {
    utm(z, false)
    utm(z, true)
  }
  list.push(
    {
      code: 'EPSG:2041',
      name: 'Abidjan 1987 / UTM zone 30 Nord',
      proj4: '+proj=utm +zone=30 +ellps=clrk80ign +towgs84=-124.76,53,466.79,0,0,0,0 +units=m +no_defs',
      bbox: [-6, 4.92, -2.48, 10.46],
      area: 'Côte d’Ivoire (est de 6° O)',
    },
    {
      code: 'EPSG:2040',
      name: 'Abidjan 1987 / UTM zone 29 Nord',
      proj4: '+proj=utm +zone=29 +ellps=clrk80ign +towgs84=-124.76,53,466.79,0,0,0,0 +units=m +no_defs',
      bbox: [-8.61, 4.29, -6, 10.74],
      area: 'Côte d’Ivoire (ouest de 6° O)',
    },
    {
      code: 'EPSG:26191',
      name: 'Merchich / Nord Maroc',
      proj4: '+proj=lcc +lat_1=33.3 +lat_0=33.3 +lon_0=-5.4 +k_0=0.999625769 +x_0=500000 +y_0=300000 +a=6378249.2 +b=6356515 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs',
      bbox: [-9.85, 31.49, -1.01, 35.97],
      area: 'Maroc nord',
    },
    {
      code: 'EPSG:26192',
      name: 'Merchich / Sud Maroc',
      proj4: '+proj=lcc +lat_1=29.7 +lat_0=29.7 +lon_0=-5.4 +k_0=0.999615596 +x_0=500000 +y_0=300000 +a=6378249.2 +b=6356515 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs',
      bbox: [-13.24, 27.66, -3.5, 31.51],
      area: 'Maroc sud',
    },
    {
      code: 'EPSG:22332',
      name: 'Carthage / UTM zone 32 Nord',
      proj4: '+proj=utm +zone=32 +a=6378249.2 +b=6356515 +towgs84=-263,6,431,0,0,0,0 +units=m +no_defs',
      bbox: [7.49, 30.23, 11.59, 37.4],
      area: 'Tunisie',
    },
    {
      code: 'EPSG:30731',
      name: 'Nord Sahara 1959 / UTM zone 31 Nord',
      proj4: '+proj=utm +zone=31 +ellps=clrk80 +towgs84=-186,-93,310,0,0,0,0 +units=m +no_defs',
      bbox: [0, 18.97, 6, 38.8],
      area: 'Algérie centre',
    },
  )
  return list
}

export const CATALOG: CrsDef[] = buildCatalog()
const BY_CODE = new Map<string, CrsDef>()
for (const d of CATALOG) {
  BY_CODE.set(d.code, d)
  proj4.defs(d.code, d.proj4)
}

export function getCrs(code: string): CrsDef | undefined {
  return BY_CODE.get(code)
}

/** Enregistre un système décrit par une chaîne proj4 ou un WKT (.prj). Renvoie son code. */
export function registerCustomCrs(definition: string, name?: string): string {
  const def = definition.trim()
  // Un .prj correspondant à un système du catalogue est ramené à ce système.
  const known = matchWkt(def)
  if (known) return known
  for (const d of CATALOG) if (d.proj4 === def) return d.code
  const code = 'PERSO:' + (name || hash(def))
  if (!BY_CODE.has(code)) {
    proj4.defs(code, def)
    const parsed = proj4.defs(code) as unknown as { projName?: string; title?: string } | undefined
    if (!parsed) throw new Error('Définition de système de coordonnées illisible')
    const geographic = parsed.projName === 'longlat'
    const entry: CrsDef = { code, name: name || parsed.title || 'Système personnalisé', proj4: def, bbox: [-180, -90, 180, 90], area: 'défini par le fichier', geographic }
    BY_CODE.set(code, entry)
    CATALOG.push(entry)
  }
  return code
}

/** Définition d'un système personnalisé (issu d'un .prj), pour pouvoir le réenregistrer à la réouverture d'un projet. */
export function customCrsDefinition(code: string | null): string | null {
  if (!code || !code.startsWith('PERSO:')) return null
  return BY_CODE.get(code)?.proj4 ?? null
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Reconnaît les systèmes courants dans un WKT (.prj) pour leur donner leur code EPSG. */
function matchWkt(wkt: string): string | null {
  const auth = /AUTHORITY\["EPSG","(\d+)"\]\s*\]\s*$/.exec(wkt) ?? /ID\["EPSG",(\d+)\]\s*\]\s*$/.exec(wkt)
  if (auth && BY_CODE.has('EPSG:' + auth[1])) return 'EPSG:' + auth[1]
  const u = wkt.toUpperCase()
  if (!u.startsWith('PROJCS') && !u.startsWith('GEOGCS') && !u.startsWith('PROJCRS') && !u.startsWith('GEOGCRS')) return null
  if (u.startsWith('GEOGCS') && /WGS[_ ]?(19)?84/.test(u)) return 'EPSG:4326'
  if (/LAMBERT[_ -]?93/.test(u)) return 'EPSG:2154'
  const cc = /CC(4[2-9]|50)/.exec(u)
  if (cc && u.includes('RGF')) return 'EPSG:' + (3900 + parseInt(cc[1]))
  const utm = /WGS[_ ]?(19)?84[_ /]+UTM[_ ]ZONE[_ ](\d{1,2})([NS])/.exec(u)
  if (utm) return 'EPSG:' + ((utm[3] === 'S' ? 32700 : 32600) + parseInt(utm[2]))
  return null
}

type Converter = { forward(p: number[]): number[] }
const converters = new Map<string, Converter>()
function converter(from: string, to: string): Converter {
  const key = from + '>' + to
  let c = converters.get(key)
  if (!c) {
    c = proj4(from, to) as unknown as Converter
    converters.set(key, c)
  }
  return c
}

/** Fonction de projection d'un système vers un autre (null si identiques). */
export function projector(from: string | null, to: string | null): Projector | null {
  if (!from || !to || from === to) return null
  const c = converter(from, to)
  return (x, y) => c.forward([x, y]) as [number, number]
}

export function transform(from: string, to: string, x: number, y: number): [number, number] {
  if (from === to) return [x, y]
  return converter(from, to).forward([x, y]) as [number, number]
}

export function toLonLat(crs: string | null, x: number, y: number): [number, number] | null {
  if (!crs) return null
  try {
    const p = transform(crs, 'EPSG:4326', x, y)
    return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null
  } catch {
    return null
  }
}

/** Fuseau UTM WGS 84 adapté à une position géographique. */
export function utmFor(lon: number, lat: number): string {
  const zone = Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1))
  return 'EPSG:' + ((lat < 0 ? 32700 : 32600) + zone)
}

// ---------------------------------------------------------------------------
// Détection automatique
// ---------------------------------------------------------------------------

/** Position approximative de l'utilisateur d'après le fuseau horaire du navigateur (aucune donnée envoyée). */
const TZ_HINTS: Record<string, [number, number]> = {
  'Africa/Douala': [11.5, 4.5],
  'Africa/Lagos': [8, 9],
  'Africa/Libreville': [10.5, -0.5],
  'Africa/Malabo': [9.5, 2],
  'Africa/Ndjamena': [16, 12],
  'Africa/Bangui': [19.5, 5.5],
  'Africa/Brazzaville': [15.5, -2],
  'Africa/Kinshasa': [17, -4],
  'Africa/Lubumbashi': [26, -8],
  'Africa/Dakar': [-15.5, 14.5],
  'Africa/Abidjan': [-5.5, 7.5],
  'Africa/Bamako': [-6, 14],
  'Africa/Ouagadougou': [-1.5, 12.5],
  'Africa/Niamey': [5, 14.5],
  'Africa/Porto-Novo': [2.3, 8],
  'Africa/Lome': [1.2, 8],
  'Africa/Conakry': [-11.5, 10.5],
  'Africa/Nouakchott': [-13, 19],
  'Africa/Casablanca': [-7, 32.5],
  'Africa/Algiers': [3, 34],
  'Africa/Tunis': [9.8, 35.5],
  'Africa/Bujumbura': [29.9, -3.4],
  'Africa/Kigali': [30, -2],
  'Africa/Djibouti': [42.8, 11.6],
  'Indian/Antananarivo': [47, -19],
  'Indian/Comoro': [43.5, -11.8],
  'Indian/Reunion': [55.5, -21.1],
  'Indian/Mayotte': [45.2, -12.8],
  'Europe/Paris': [2.5, 46.6],
  'Europe/Brussels': [4.5, 50.6],
  'Europe/Zurich': [8, 46.8],
  'Europe/Luxembourg': [6.1, 49.7],
  'America/Martinique': [-61, 14.6],
  'America/Guadeloupe': [-61.5, 16.2],
  'America/Cayenne': [-53, 4],
}

export function regionHint(): [number, number] | null {
  try {
    const stored = localStorage.getItem('appstock.region')
    if (stored) {
      const p = JSON.parse(stored) as [number, number]
      if (Array.isArray(p) && p.length === 2) return p
    }
  } catch {
    /* stockage indisponible */
  }
  try {
    return TZ_HINTS[Intl.DateTimeFormat().resolvedOptions().timeZone] ?? null
  } catch {
    return null
  }
}

export interface CrsCandidate {
  def: CrsDef
  /** Position du centre de l'emprise si ce système est le bon. */
  lon: number
  lat: number
  /** Distance en km à la région de travail supposée (Infinity si inconnue). */
  distanceKm: number
  score: number
}

function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Propose les systèmes de coordonnées compatibles avec une emprise brute.
 * Méthode : pour chaque système du catalogue, on suppose que les coordonnées y sont
 * exprimées, on calcule la position géographique correspondante et on vérifie qu'elle
 * tombe dans la zone d'usage du système. Les candidats sont classés par proximité avec
 * la région de travail (`hint`), ce qui lève l'ambiguïté entre fuseaux UTM.
 */
export function detectCrs(extent: Extent, hint: [number, number] | null = regionHint()): CrsCandidate[] {
  const [minX, minY, maxX, maxY] = extent
  if (!Number.isFinite(minX + minY + maxX + maxY)) return []
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const out: CrsCandidate[] = []
  const looksGeographic = minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90
  for (const def of CATALOG) {
    if (def.code.startsWith('PERSO:')) continue
    if (def.geographic) {
      if (!looksGeographic) continue
      const d = hint ? haversineKm(cx, cy, hint[0], hint[1]) : Infinity
      out.push({ def, lon: cx, lat: cy, distanceKm: d, score: 1000 - Math.min(d, 900) / 10 })
      continue
    }
    if (looksGeographic || def.code === 'EPSG:3857') continue
    let p: [number, number]
    try {
      p = transform(def.code, 'EPSG:4326', cx, cy)
    } catch {
      continue
    }
    const [lon, lat] = p
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const [w, s, e, n] = def.bbox
    const margin = 0.3
    if (lon < w - margin || lon > e + margin || lat < s - margin || lat > n + margin) continue
    const d = hint ? haversineKm(lon, lat, hint[0], hint[1]) : Infinity
    let score = 100
    // Un système national ou local est plus probable qu'un fuseau mondial quand les deux conviennent.
    if (!/UTM zone/.test(def.name)) score += 20
    if (def.code === 'EPSG:27572') score -= 30
    if (hint) score += 400 - Math.min(d, 4000) / 10
    out.push({ def, lon, lat, distanceKm: d, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, 12)
}

/** Recherche dans le catalogue (code, nom, pays). */
export function searchCrs(query: string): CrsDef[] {
  const q = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
  if (!q) return []
  const words = q.split(/\s+/)
  return CATALOG.filter((d) => {
    const hay = (d.code + ' ' + d.name + ' ' + d.area)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    return words.every((w) => hay.includes(w))
  }).slice(0, 30)
}

/** Libellé court d'un système : « UTM 32 Nord », « Lambert-93 »… */
export function crsLabel(code: string | null): string {
  if (!code) return 'Coordonnées locales'
  const def = BY_CODE.get(code)
  return def ? def.name : code
}
