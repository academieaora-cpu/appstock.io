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
      code: 'EPSG:2215',
      name: 'Manoca 1962 / UTM zone 32 Nord',
      proj4: '+proj=utm +zone=32 +ellps=clrk80ign +towgs84=-70.9,-151.8,-41.4,0,0,0,0 +units=m +no_defs',
      bbox: [8.32, 2.16, 10.4, 4.99],
      area: 'Cameroun, zone côtière (ancien système ; passage au WGS 84 par translation, précision métrique)',
    },
    {
      code: 'EPSG:3119',
      name: 'Douala 1948 / AEF ouest',
      proj4: '+proj=tmerc +lat_0=0 +lon_0=10.5 +k=0.999 +x_0=1000000 +y_0=1000000 +ellps=intl +towgs84=-206.1,-174.7,-87.7,0,0,0,0 +units=m +no_defs',
      bbox: [8.32, 2.16, 10.4, 4.99],
      area: 'Cameroun, zone côtière (ancien système remplacé par Manoca 1962 ; précision métrique)',
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

export interface WorkRegion {
  id: string
  name: string
  /** Ouest, sud, est, nord. */
  bbox: [number, number, number, number]
  center: [number, number]
}

/** Pays de travail : la détection retient le système qui place les coordonnées dans ce pays. */
export const WORK_REGIONS: WorkRegion[] = [
  { id: 'CM', name: 'Cameroun', bbox: [8.4, 1.6, 16.2, 13.1], center: [11.5, 4.5] },
  { id: 'GA', name: 'Gabon', bbox: [8.6, -4.0, 14.6, 2.4], center: [11.6, -0.6] },
  { id: 'CG', name: 'Congo', bbox: [11.0, -5.1, 18.7, 3.8], center: [15.3, -1.0] },
  { id: 'GQ', name: 'Guinée équatoriale', bbox: [5.6, -1.5, 11.4, 3.8], center: [10.3, 1.6] },
  { id: 'TD', name: 'Tchad', bbox: [13.4, 7.4, 24.0, 23.5], center: [18.7, 15.4] },
  { id: 'CF', name: 'Centrafrique', bbox: [14.4, 2.2, 27.5, 11.0], center: [20.9, 6.6] },
  { id: 'NG', name: 'Nigeria', bbox: [2.6, 4.2, 14.7, 13.9], center: [8.7, 9.1] },
  { id: 'CD', name: 'RD Congo', bbox: [12.2, -13.5, 31.4, 5.4], center: [23.6, -2.9] },
  { id: 'CI', name: 'Côte d’Ivoire', bbox: [-8.6, 4.3, -2.5, 10.8], center: [-5.5, 7.5] },
  { id: 'SN', name: 'Sénégal', bbox: [-17.6, 12.3, -11.3, 16.7], center: [-14.5, 14.5] },
  { id: 'ML', name: 'Mali', bbox: [-12.3, 10.1, 4.3, 25.0], center: [-4.0, 17.6] },
  { id: 'BF', name: 'Burkina Faso', bbox: [-5.6, 9.4, 2.4, 15.1], center: [-1.6, 12.3] },
  { id: 'NE', name: 'Niger', bbox: [0.1, 11.6, 16.0, 23.6], center: [8.1, 17.6] },
  { id: 'BJ', name: 'Bénin', bbox: [0.7, 6.2, 3.9, 12.4], center: [2.3, 9.3] },
  { id: 'TG', name: 'Togo', bbox: [-0.2, 6.1, 1.9, 11.2], center: [0.8, 8.6] },
  { id: 'GN', name: 'Guinée', bbox: [-15.1, 7.2, -7.6, 12.7], center: [-11.0, 10.4] },
  { id: 'MA', name: 'Maroc', bbox: [-13.2, 27.6, -1.0, 35.9], center: [-6.8, 31.8] },
  { id: 'DZ', name: 'Algérie', bbox: [-8.7, 19.0, 12.0, 37.1], center: [2.6, 28.0] },
  { id: 'TN', name: 'Tunisie', bbox: [7.5, 30.2, 11.6, 37.6], center: [9.5, 34.0] },
  { id: 'MG', name: 'Madagascar', bbox: [43.2, -25.6, 50.5, -11.9], center: [46.9, -18.8] },
  { id: 'FR', name: 'France', bbox: [-5.2, 41.3, 9.6, 51.1], center: [2.5, 46.6] },
]

const TZ_REGION: Record<string, string> = {
  'Africa/Douala': 'CM', 'Africa/Libreville': 'GA', 'Africa/Brazzaville': 'CG', 'Africa/Malabo': 'GQ', 'Africa/Ndjamena': 'TD', 'Africa/Bangui': 'CF',
  'Africa/Lagos': 'NG', 'Africa/Kinshasa': 'CD', 'Africa/Lubumbashi': 'CD', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Bamako': 'ML',
  'Africa/Ouagadougou': 'BF', 'Africa/Niamey': 'NE', 'Africa/Porto-Novo': 'BJ', 'Africa/Lome': 'TG', 'Africa/Conakry': 'GN', 'Africa/Casablanca': 'MA',
  'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Indian/Antananarivo': 'MG', 'Europe/Paris': 'FR',
}

/**
 * Pays de travail : choix enregistré par l'utilisateur ; sinon déduit du fuseau horaire
 * seulement s'il désigne sans ambiguïté un pays ; sinon le Cameroun (marché de la plateforme).
 */
export function workRegion(): WorkRegion {
  try {
    const id = localStorage.getItem('appstock.workRegion')
    const r = WORK_REGIONS.find((x) => x.id === id)
    if (r) return r
  } catch {
    /* stockage indisponible */
  }
  try {
    const id = TZ_REGION[Intl.DateTimeFormat().resolvedOptions().timeZone]
    const r = WORK_REGIONS.find((x) => x.id === id)
    if (r) return r
  } catch {
    /* fuseau inconnu */
  }
  return WORK_REGIONS[0]
}

export function setWorkRegion(id: string): void {
  try {
    localStorage.setItem('appstock.workRegion', id)
  } catch {
    /* stockage indisponible */
  }
}

/** Villes de référence (longitude, latitude) : pour dire en clair où tombent des coordonnées. */
const PLACES: [string, number, number][] = [
  ['Yaoundé', 11.502, 3.848], ['Douala', 9.768, 4.051], ['Garoua', 13.398, 9.302], ['Bamenda', 10.146, 5.96], ['Maroua', 14.316, 10.591],
  ['Bafoussam', 10.418, 5.478], ['Ngaoundéré', 13.585, 7.327], ['Bertoua', 13.685, 4.578], ['Loum', 9.735, 4.718], ['Kumba', 9.433, 4.636],
  ['Edéa', 10.133, 3.8], ['Kribi', 9.91, 2.94], ['Nkongsamba', 9.94, 4.954], ['Mbouda', 10.255, 5.626], ['Dschang', 10.053, 5.444],
  ['Foumban', 10.901, 5.727], ['Foumbot', 10.633, 5.508], ['Ebolowa', 11.154, 2.915], ['Sangmélima', 11.983, 2.933], ['Mbalmayo', 11.501, 3.517],
  ['Bafia', 11.233, 4.75], ['Obala', 11.533, 4.167], ['Limbé', 9.214, 4.024], ['Buea', 9.241, 4.155], ['Tiko', 9.36, 4.075], ['Bafang', 10.183, 5.157],
  ['Bangangté', 10.517, 5.15], ['Kousséri', 15.031, 12.077], ['Mokolo', 13.802, 10.74], ['Kaélé', 14.45, 10.1], ['Guider', 13.95, 9.933],
  ['Meiganga', 14.3, 6.517], ['Tibati', 12.633, 6.467], ['Batouri', 14.364, 4.43], ['Abong-Mbang', 13.183, 3.983], ['Yokadouma', 15.05, 3.517],
  ['Akonolinga', 12.25, 3.767], ['Nanga-Eboko', 12.367, 4.683], ['Mfou', 11.633, 3.717], ['Soa', 11.594, 3.976], ['Ambam', 11.283, 2.383],
  ['Campo', 9.817, 2.367], ['Mamfé', 9.3, 5.767], ['Kumbo', 10.683, 6.2], ['Wum', 10.067, 6.383], ['Nkambé', 10.667, 6.583], ['Yagoua', 15.233, 10.333],
  ['Mora', 14.133, 11.05], ['Tcholliré', 14.167, 8.4], ['Banyo', 11.817, 6.75], ['Lolodorf', 10.733, 3.233], ['Éséka', 10.767, 3.65],
  ['Monatélé', 11.2, 4.267], ['Ntui', 11.633, 4.45], ['Yabassi', 9.967, 4.45], ['Manjo', 9.817, 4.833], ['Mbanga', 9.567, 4.5],
  ['Libreville', 9.454, 0.39], ['Malabo', 8.783, 3.75], ['Bata', 9.767, 1.867], ['N’Djamena', 15.044, 12.134], ['Bangui', 18.555, 4.394],
  ['Brazzaville', 15.283, -4.267], ['Kinshasa', 15.313, -4.322], ['Lagos', 3.379, 6.524], ['Abuja', 7.491, 9.072], ['Calabar', 8.327, 4.958],
  ['Abidjan', -4.008, 5.36], ['Dakar', -17.447, 14.693], ['Paris', 2.352, 48.857], ['Rabat', -6.85, 34.02], ['Alger', 3.059, 36.754], ['Tunis', 10.182, 36.806],
]

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** « près d'Ebolowa (2 km) », ou la position en degrés si aucune ville de référence n'est proche. */
export function describePlace(lon: number, lat: number): string {
  let best: [string, number] | null = null
  for (const [name, x, y] of PLACES) {
    const d = haversine(lon, lat, x, y)
    if (!best || d < best[1]) best = [name, d]
  }
  const deg = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'O'}`
  if (best && best[1] <= 80) {
    const name = best[0]
    const prep = /^[AEÉÈIOU]/.test(name) ? 'd’' : 'de '
    return `près ${prep}${name} (${best[1] < 1 ? 'moins de 1' : best[1].toFixed(0)} km) · ${deg}`
  }
  return deg
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
export function detectCrs(extent: Extent, where: WorkRegion | [number, number] | null = workRegion()): CrsCandidate[] {
  const [minX, minY, maxX, maxY] = extent
  if (!Number.isFinite(minX + minY + maxX + maxY)) return []
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  // Pays de travail : celui donné, ou celui qui contient le point indiqué.
  const region: WorkRegion | null = Array.isArray(where)
    ? (WORK_REGIONS.find((r) => where[0] >= r.bbox[0] && where[0] <= r.bbox[2] && where[1] >= r.bbox[1] && where[1] <= r.bbox[3]) ?? null)
    : where
  const center: [number, number] | null = Array.isArray(where) ? where : (region?.center ?? null)
  const inRegion = (lon: number, lat: number) => !!region && lon >= region.bbox[0] - 0.3 && lon <= region.bbox[2] + 0.3 && lat >= region.bbox[1] - 0.3 && lat <= region.bbox[3] + 0.3
  const out: CrsCandidate[] = []
  const looksGeographic = minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90
  for (const def of CATALOG) {
    if (def.code.startsWith('PERSO:')) continue
    if (def.geographic) {
      if (!looksGeographic) continue
      const d = center ? haversineKm(cx, cy, center[0], center[1]) : Infinity
      out.push({ def, lon: cx, lat: cy, distanceKm: d, score: 3000 - Math.min(d, 900) / 10 })
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
    const d = center ? haversineKm(lon, lat, center[0], center[1]) : Infinity
    const inside = inRegion(lon, lat)
    let score = 100
    // Décisif : les coordonnées doivent tomber dans le pays de travail.
    if (inside) score += 1000
    // Système national ou local, à égalité de position : seulement dans le pays de travail.
    if (inside && !/UTM zone/.test(def.name)) score += 20
    // Anciens systèmes à translation approchée : proposés, jamais choisis d'office.
    if (def.code === 'EPSG:27572' || def.code === 'EPSG:2215' || def.code === 'EPSG:3119') score -= 30
    if (center) score += 400 - Math.min(d, 4000) / 10
    out.push({ def, lon, lat, distanceKm: d, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, 12)
}

/** Les coordonnées tombent-elles dans le pays de travail avec ce candidat ? */
export function candidateInRegion(c: CrsCandidate, region: WorkRegion = workRegion()): boolean {
  return c.lon >= region.bbox[0] - 0.3 && c.lon <= region.bbox[2] + 0.3 && c.lat >= region.bbox[1] - 0.3 && c.lat <= region.bbox[3] + 0.3
}

/** Recherche dans le catalogue (code, nom, pays). */
export function searchCrs(query: string): CrsDef[] {
  const fold = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const q = fold(query).trim()
  if (!q) return []
  const words = q.split(/\s+/)
  const scored: { d: CrsDef; score: number }[] = []
  for (const d of CATALOG) {
    const name = fold(d.name)
    const area = fold(d.area)
    const code = fold(d.code)
    let score = 0
    let ok = true
    for (const w of words) {
      if (/^\d+$/.test(w)) {
        // Un nombre désigne une zone ou un code entier : « 32 » ne doit pas trouver EPSG:32601.
        const re = new RegExp('(^|[^\\d])' + w + '([^\\d]|$)')
        if (re.test(name)) score += 3
        else if (code === 'epsg:' + w) score += 5
        else if (re.test(area)) score += 1
        else ok = false
      } else if (name.includes(w)) score += 2
      else if (code.includes(w) || area.includes(w)) score += 1
      else ok = false
      if (!ok) break
    }
    if (ok) scored.push({ d, score })
  }
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, 30)
    .map((x) => x.d)
}

/** Libellé court d'un système : « UTM 32 Nord », « Lambert-93 »… */
export function crsLabel(code: string | null): string {
  if (!code) return 'Coordonnées locales'
  const def = BY_CODE.get(code)
  return def ? def.name : code
}
