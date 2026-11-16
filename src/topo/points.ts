/**
 * Import de fichiers de points topographiques (TXT, CSV, XYZ, ASC…) :
 * reconnaissance du séparateur et de l'ordre des colonnes, puis contrôle qualité.
 *
 * Principe : rien n'est corrigé ni supprimé en silence. Les ambiguïtés et les
 * anomalies sont rapportées ; c'est le géomètre qui décide.
 */
import { detectCrs, regionHint } from '../core/crs'

export interface SurveyPoint {
  id: string
  x: number
  y: number
  z: number | null
  code: string
  /** Numéro de ligne dans le fichier source. */
  line: number
}

export interface ColumnMap {
  id: number
  x: number
  y: number
  z: number
  code: number
}

export interface PointsFile {
  points: SurveyPoint[]
  /** Lignes découpées en cellules (pour l'aperçu et le ré-import avec d'autres colonnes). */
  rows: string[][]
  rowLines: number[]
  delimiter: string
  hasHeader: boolean
  header: string[]
  columns: ColumnMap
  columnCount: number
  /** Vrai si l'ordre des colonnes a dû être deviné sans en-tête explicite. */
  guessed: boolean
  /** Questions à confirmer par l'utilisateur. */
  questions: string[]
  rejected: { line: number; reason: string; text: string }[]
}

const DELIMS: [string, string][] = [
  [';', 'point-virgule'],
  ['\t', 'tabulation'],
  [',', 'virgule'],
  ['|', 'barre verticale'],
  [' ', 'espaces'],
]

function splitLine(line: string, delim: string): string[] {
  if (delim === ' ') return line.trim().split(/\s+/)
  return line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
}

/** Convertit une cellule en nombre (accepte la virgule décimale). NaN si ce n'est pas un nombre. */
export function parseNumber(cell: string): number {
  let s = cell.trim()
  if (!s) return NaN
  if (/^[-+]?\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, '')
  if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? parseFloat(s) : NaN
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9°]/g, '')

function headerRole(cell: string): keyof ColumnMap | null {
  const h = norm(cell)
  if (!h) return null
  if (/^(n°|no|num|numero|nopoint|point|pt|pts|mat|matricule|id|ident|identifiant|nom|name|s|sommet|borne)$/.test(h)) return 'id'
  if (/^(x|e|est|east|easting|abscisse|xm|em)$/.test(h)) return 'x'
  if (/^(y|n|nord|north|northing|ordonnee|ym|nm)$/.test(h)) return 'y'
  if (/^(z|alt|altitude|altitudes|h|elev|elevation|cote|zm|hauteur)$/.test(h)) return 'z'
  if (/^(code|codes|desc|description|designation|nature|type|obs|observation|remarque|libelle|objet)$/.test(h)) return 'code'
  return null
}

/** Devine l'ordre Est/Nord en comparant les deux hypothèses à la région de travail. */
function guessEastNorth(a: number[], b: number[]): { swap: boolean; sure: boolean } {
  const mid = (v: number[]) => {
    const s = [...v].sort((p, q) => p - q)
    return s[s.length >> 1]
  }
  const ma = mid(a)
  const mb = mid(b)
  const hint = regionHint()
  const best = (x: number, y: number): number => {
    const c = detectCrs([x, y, x, y], hint)
    return c.length ? (hint ? c[0].distanceKm : 0) : Infinity
  }
  const d1 = best(ma, mb) // première colonne = Est
  const d2 = best(mb, ma) // première colonne = Nord
  if (d1 === Infinity && d2 === Infinity) return { swap: false, sure: false }
  if (d2 === Infinity) return { swap: false, sure: true }
  if (d1 === Infinity) return { swap: true, sure: true }
  if (!hint) return { swap: false, sure: false }
  const swap = d2 < d1
  const near = Math.min(d1, d2)
  const far = Math.max(d1, d2)
  return { swap, sure: near < 400 && far > 1500 }
}

export function parsePointsText(text: string, forced?: Partial<ColumnMap> & { delimiter?: string; hasHeader?: boolean }): PointsFile {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/)
  const lines: { n: number; s: string }[] = []
  raw.forEach((s, i) => {
    const t = s.trim()
    if (t && !t.startsWith('#') && !t.startsWith('//') && !t.startsWith('!')) lines.push({ n: i + 1, s })
  })

  // Séparateur : celui qui donne le nombre de colonnes le plus régulier (≥ 2).
  let delimiter = forced?.delimiter ?? ' '
  if (!forced?.delimiter) {
    let bestScore = -1
    const sample = lines.slice(0, 200)
    for (const [d] of DELIMS) {
      const counts = new Map<number, number>()
      for (const l of sample) {
        const n = splitLine(l.s, d).length
        counts.set(n, (counts.get(n) ?? 0) + 1)
      }
      let mode = 0
      let freq = 0
      for (const [n, f] of counts) if (f > freq || (f === freq && n > mode)) [mode, freq] = [n, f]
      if (mode < 2) continue
      // Une virgule peut être un séparateur décimal : on l'écarte si un autre séparateur convient.
      const score = (freq / Math.max(1, sample.length)) * 10 + Math.min(mode, 6) - (d === ',' ? 0.5 : 0) - (d === ' ' ? 0.25 : 0)
      if (score > bestScore) {
        bestScore = score
        delimiter = d
      }
    }
  }
  const rows = lines.map((l) => splitLine(l.s, delimiter))
  const rowLines = lines.map((l) => l.n)
  const columnCount = rows.reduce((m, r) => Math.max(m, r.length), 0)

  // En-tête : première ligne sans aucune coordonnée numérique plausible.
  const numericIn = (r: string[]) => r.filter((c) => !Number.isNaN(parseNumber(c))).length
  let hasHeader = forced?.hasHeader ?? (rows.length > 1 && numericIn(rows[0]) < Math.min(2, numericIn(rows[1])))
  if (rows.length && forced?.hasHeader === undefined && rows[0].some((c) => headerRole(c) === 'x' || headerRole(c) === 'y')) hasHeader = true
  const header = hasHeader ? rows[0] : []
  const body = hasHeader ? rows.slice(1) : rows
  const bodyLines = hasHeader ? rowLines.slice(1) : rowLines

  const columns: ColumnMap = { id: -1, x: -1, y: -1, z: -1, code: -1 }
  const questions: string[] = []
  let guessed = false

  if (hasHeader) {
    header.forEach((cell, i) => {
      const role = headerRole(cell)
      if (role && columns[role] < 0) columns[role] = i
    })
  }
  if (columns.x < 0 || columns.y < 0) {
    guessed = true
    // Statistiques par colonne
    const stats = Array.from({ length: columnCount }, (_, c) => {
      const values: number[] = []
      let text = 0
      let decimals = 0
      for (const r of body) {
        const cell = r[c] ?? ''
        const v = parseNumber(cell)
        if (Number.isNaN(v)) {
          if (cell) text++
        } else {
          values.push(v)
          if (/[.,]\d/.test(cell)) decimals++
        }
      }
      const sorted = [...values].sort((p, q) => p - q)
      return {
        c,
        numeric: values.length / Math.max(1, body.length),
        text: text / Math.max(1, body.length),
        median: sorted.length ? Math.abs(sorted[sorted.length >> 1]) : 0,
        decimals: decimals / Math.max(1, values.length),
        values,
      }
    })
    const numeric = stats.filter((s) => s.numeric > 0.9)
    const texts = stats.filter((s) => s.text > 0.3)
    // Identifiant : première colonne si elle est textuelle ou faite d'entiers.
    let rest = numeric
    if (columns.id < 0 && stats.length && (stats[0].text > 0.3 || (stats[0].numeric > 0.9 && stats[0].decimals < 0.05 && numeric.length >= 3))) {
      columns.id = 0
      rest = numeric.filter((s) => s.c !== 0)
    }
    if (rest.length >= 2) {
      // Les deux premières colonnes numériques sont les coordonnées planes, la suivante l'altitude.
      const [a, b, c] = rest
      const g = guessEastNorth(a.values, b.values)
      columns.x = g.swap ? b.c : a.c
      columns.y = g.swap ? a.c : b.c
      if (!g.sure) {
        questions.push(
          `Ordre des coordonnées à confirmer : la colonne ${columns.x + 1} est lue comme X (Est) et la colonne ${columns.y + 1} comme Y (Nord).`,
        )
      }
      if (c && columns.z < 0) columns.z = c.c
    }
    if (columns.code < 0) {
      const t = texts.filter((s) => s.c !== columns.id)
      if (t.length) columns.code = t[t.length - 1].c
    }
  }
  if (forced) {
    for (const k of ['id', 'x', 'y', 'z', 'code'] as const) {
      const v = forced[k]
      if (v !== undefined) columns[k] = v
    }
  }

  const points: SurveyPoint[] = []
  const rejected: PointsFile['rejected'] = []
  if (columns.x < 0 || columns.y < 0) {
    questions.push('Impossible de reconnaître les colonnes X et Y : indiquez-les manuellement.')
  } else {
    body.forEach((r, i) => {
      const x = parseNumber(r[columns.x] ?? '')
      const y = parseNumber(r[columns.y] ?? '')
      if (Number.isNaN(x) || Number.isNaN(y)) {
        rejected.push({ line: bodyLines[i], reason: 'coordonnée X ou Y absente ou non numérique', text: r.join(' ') })
        return
      }
      const zRaw = columns.z >= 0 ? parseNumber(r[columns.z] ?? '') : NaN
      points.push({
        id: columns.id >= 0 ? (r[columns.id] ?? '').trim() : String(points.length + 1),
        x,
        y,
        z: Number.isNaN(zRaw) ? null : zRaw,
        code: columns.code >= 0 ? (r[columns.code] ?? '').trim() : '',
        line: bodyLines[i],
      })
    })
  }
  return { points, rows, rowLines, delimiter, hasHeader, header, columns, columnCount, guessed, questions, rejected }
}

export function delimiterName(d: string): string {
  return DELIMS.find(([c]) => c === d)?.[1] ?? d
}

// ---------------------------------------------------------------------------
// Contrôle qualité
// ---------------------------------------------------------------------------

export interface Anomaly {
  level: 'erreur' | 'alerte' | 'info'
  message: string
  /** Identifiants des points concernés. */
  ids: string[]
}

function median(v: number[]): number {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface QualityReport {
  anomalies: Anomaly[]
  count: number
  withZ: number
  extent: [number, number, number, number]
  zRange: [number, number] | null
}

export function checkPoints(file: PointsFile): QualityReport {
  const pts = file.points
  const anomalies: Anomaly[] = []
  for (const r of file.rejected.slice(0, 50)) {
    anomalies.push({ level: 'erreur', message: `Ligne ${r.line} non importée (${r.reason}) : « ${r.text.slice(0, 60)} »`, ids: [] })
  }
  if (file.rejected.length > 50) anomalies.push({ level: 'erreur', message: `… et ${file.rejected.length - 50} autres lignes non importées.`, ids: [] })

  // Identifiants
  const byId = new Map<string, number>()
  const missingId: string[] = []
  for (const p of pts) {
    if (!p.id) missingId.push('ligne ' + p.line)
    else byId.set(p.id, (byId.get(p.id) ?? 0) + 1)
  }
  const dupIds = [...byId].filter(([, n]) => n > 1).map(([id]) => id)
  if (dupIds.length) anomalies.push({ level: 'alerte', message: `${dupIds.length} identifiant(s) de point répété(s) : ${dupIds.slice(0, 8).join(', ')}${dupIds.length > 8 ? '…' : ''}`, ids: dupIds })
  if (missingId.length) anomalies.push({ level: 'alerte', message: `${missingId.length} point(s) sans identifiant (${missingId.slice(0, 5).join(', ')}…)`, ids: [] })

  // Doublons de position (même X, Y au millimètre)
  const seen = new Map<string, string>()
  const dupPos: string[] = []
  for (const p of pts) {
    const key = Math.round(p.x * 1000) + ':' + Math.round(p.y * 1000)
    const other = seen.get(key)
    if (other !== undefined) dupPos.push(`${other} = ${p.id}`)
    else seen.set(key, p.id)
  }
  if (dupPos.length) anomalies.push({ level: 'alerte', message: `${dupPos.length} point(s) en double à la même position : ${dupPos.slice(0, 5).join(' ; ')}${dupPos.length > 5 ? '…' : ''}`, ids: [] })

  // Coordonnées nulles ou aberrantes
  const zero = pts.filter((p) => p.x === 0 || p.y === 0)
  if (zero.length) anomalies.push({ level: 'erreur', message: `${zero.length} point(s) avec une coordonnée nulle : ${zero.slice(0, 8).map((p) => p.id).join(', ')}`, ids: zero.map((p) => p.id) })
  const mx = median(pts.map((p) => p.x))
  const my = median(pts.map((p) => p.y))
  const dist = pts.map((p) => Math.hypot(p.x - mx, p.y - my))
  const md = median(dist)
  const mad = median(dist.map((d) => Math.abs(d - md))) || md || 1
  const far = pts.filter((_, i) => dist[i] > md + 8 * mad && dist[i] > 5 * md)
  if (far.length && pts.length >= 6) {
    anomalies.push({ level: 'alerte', message: `${far.length} point(s) très éloigné(s) du reste du levé (erreur de saisie possible) : ${far.slice(0, 8).map((p) => p.id).join(', ')}`, ids: far.map((p) => p.id) })
  }

  // Altimétrie
  const withZ = pts.filter((p) => p.z !== null)
  let zRange: [number, number] | null = null
  if (withZ.length) {
    const zs = withZ.map((p) => p.z as number)
    zRange = [Math.min(...zs), Math.max(...zs)]
    if (withZ.length < pts.length) anomalies.push({ level: 'info', message: `${pts.length - withZ.length} point(s) sans altitude : ils sont exclus du modèle de terrain.`, ids: pts.filter((p) => p.z === null).map((p) => p.id) })
    const neg = withZ.filter((p) => (p.z as number) < 0)
    if (neg.length) anomalies.push({ level: 'alerte', message: `${neg.length} altitude(s) négative(s) : ${neg.slice(0, 8).map((p) => p.id).join(', ')}`, ids: neg.map((p) => p.id) })
    const zero0 = withZ.filter((p) => p.z === 0)
    if (zero0.length && zero0.length < withZ.length) anomalies.push({ level: 'alerte', message: `${zero0.length} altitude(s) égale(s) à 0 alors que les autres sont renseignées : ${zero0.slice(0, 8).map((p) => p.id).join(', ')}`, ids: zero0.map((p) => p.id) })
    const mz = median(zs)
    const madZ = median(zs.map((z) => Math.abs(z - mz))) || 1
    const odd = withZ.filter((p) => Math.abs((p.z as number) - mz) > Math.max(10 * madZ, 30) && p.z !== 0)
    if (odd.length) anomalies.push({ level: 'alerte', message: `${odd.length} altitude(s) très différente(s) des autres (médiane ${mz.toFixed(2)} m) : ${odd.slice(0, 8).map((p) => `${p.id} (${p.z})`).join(', ')}`, ids: odd.map((p) => p.id) })
  } else if (pts.length) {
    anomalies.push({ level: 'info', message: 'Aucune altitude dans le fichier : plan planimétrique seulement (pas de courbes de niveau).', ids: [] })
  }

  const noCode = pts.filter((p) => !p.code)
  if (noCode.length && noCode.length < pts.length) anomalies.push({ level: 'info', message: `${noCode.length} point(s) sans code ni description.`, ids: noCode.map((p) => p.id) })

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return { anomalies, count: pts.length, withZ: withZ.length, extent: pts.length ? [minX, minY, maxX, maxY] : [0, 0, 0, 0], zRange }
}
