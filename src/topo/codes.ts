/**
 * Dictionnaire de codes terrain, modifiable par l'utilisateur.
 *
 * Les codes varient d'un géomètre à l'autre : le dictionnaire par défaut n'est
 * qu'un point de départ. La reconnaissance tolère casse, accents, suffixes
 * numériques (BAT1, BAT2…) et fautes de frappe, mais signale tout ce qui n'est
 * pas une correspondance exacte pour confirmation.
 */
import type { SurveyPoint } from './points'

export type CodeKind = 'point' | 'ligne' | 'surface' | 'borne'
export type SymbolName = 'croix' | 'cercle' | 'carre' | 'triangle' | 'arbre' | 'borne' | 'poteau'

export interface CodeRule {
  code: string
  label: string
  kind: CodeKind
  layer: string
  /** Couleur 0xRRGGBB. */
  color: number
  symbol: SymbolName
  synonyms: string[]
  /** Épaisseur du trait en mm. */
  lw: number
  /** Les lignes de ce code sont des lignes de rupture du MNT (talus, fossé, bord de route…). */
  breakline?: boolean
  /** Les points de ce code entrent dans le MNT (faux pour un point qui n'est pas au sol). */
  inTin?: boolean
}

export const DEFAULT_RULES: CodeRule[] = [
  { code: 'BORN', label: 'Borne', kind: 'borne', layer: '05_BORNES', color: 0xff0000, symbol: 'borne', synonyms: ['BORNE', 'BN', 'BM', 'B'], lw: 0.5 },
  { code: 'LIM', label: 'Limite', kind: 'ligne', layer: '06_LIMITES', color: 0xff0000, symbol: 'croix', synonyms: ['LIMITE', 'LIMIT'], lw: 0.5 },
  { code: 'BAT', label: 'Bâtiment', kind: 'surface', layer: '07_BATIMENTS', color: 0x000000, symbol: 'croix', synonyms: ['BATIMENT', 'BATI', 'MAISON', 'CONST'], lw: 0.35 },
  { code: 'MUR', label: 'Mur', kind: 'ligne', layer: '08_CLOTURES', color: 0x7f3f00, symbol: 'croix', synonyms: ['MURET'], lw: 0.35 },
  { code: 'CL', label: 'Clôture', kind: 'ligne', layer: '08_CLOTURES', color: 0x7f3f00, symbol: 'croix', synonyms: ['CLOTURE', 'CLOT', 'HAIE', 'GRILLAGE'], lw: 0.25 },
  { code: 'AXE', label: 'Axe de route', kind: 'ligne', layer: '09_VOIRIES', color: 0x0000ff, symbol: 'croix', synonyms: ['AXEROUTE', 'AX'], lw: 0.18, breakline: true },
  { code: 'ROUTE', label: 'Bord de chaussée', kind: 'ligne', layer: '09_VOIRIES', color: 0x000000, symbol: 'croix', synonyms: ['RTE', 'CHAUSSEE', 'BORD', 'BC', 'PISTE', 'VOIE'], lw: 0.35, breakline: true },
  { code: 'CAN', label: 'Caniveau', kind: 'ligne', layer: '09_VOIRIES', color: 0x007fff, symbol: 'croix', synonyms: ['CANIVEAU'], lw: 0.25, breakline: true },
  { code: 'FOS', label: 'Fossé', kind: 'ligne', layer: '09_VOIRIES', color: 0x007fff, symbol: 'croix', synonyms: ['FOSSE'], lw: 0.25, breakline: true },
  { code: 'TAL', label: 'Talus', kind: 'ligne', layer: '09_TALUS', color: 0x7f7f00, symbol: 'croix', synonyms: ['TALUS'], lw: 0.25, breakline: true },
  { code: 'SOM', label: 'Sommet de talus', kind: 'ligne', layer: '09_TALUS', color: 0x7f7f00, symbol: 'croix', synonyms: ['SOMMET', 'HT', 'HAUT'], lw: 0.25, breakline: true },
  { code: 'PIED', label: 'Pied de talus', kind: 'ligne', layer: '09_TALUS', color: 0x7f7f00, symbol: 'croix', synonyms: ['PT', 'BAS', 'PIEDTALUS'], lw: 0.18, breakline: true },
  { code: 'ARB', label: 'Arbre', kind: 'point', layer: '10_VEGETATION', color: 0x007f00, symbol: 'arbre', synonyms: ['ARBRE', 'PALMIER', 'MANGUIER'], lw: 0.25 },
  { code: 'POT', label: 'Poteau', kind: 'point', layer: '10_RESEAUX', color: 0xff00ff, symbol: 'poteau', synonyms: ['POTEAU', 'PTT', 'PE'], lw: 0.25 },
  { code: 'ELEC', label: 'Réseau électrique', kind: 'point', layer: '10_RESEAUX', color: 0xff00ff, symbol: 'poteau', synonyms: ['ELECTRICITE', 'ENEO', 'BT', 'HTA'], lw: 0.25 },
  { code: 'EAU', label: 'Réseau d’eau', kind: 'point', layer: '10_RESEAUX', color: 0x0000ff, symbol: 'cercle', synonyms: ['AEP', 'CAMWATER', 'BF', 'FONTAINE', 'PUITS'], lw: 0.25 },
  { code: 'REG', label: 'Regard', kind: 'point', layer: '10_RESEAUX', color: 0x0000ff, symbol: 'carre', synonyms: ['REGARD', 'RV'], lw: 0.25 },
  { code: 'TN', label: 'Terrain naturel', kind: 'point', layer: '01_POINTS', color: 0x000000, symbol: 'croix', synonyms: ['TERRAIN', 'SOL', 'PTN', 'COTE', 'SEMIS'], lw: 0.18 },
]

/** Ligne de rupture : choix de l'utilisateur, sinon valeur par défaut du code. */
export function isBreaklineRule(r: CodeRule): boolean {
  if (r.breakline !== undefined) return r.breakline
  return DEFAULT_RULES.find((d) => d.code === r.code)?.breakline ?? false
}

/** Le point entre-t-il dans le MNT ? Oui par défaut. */
export function inTinRule(r: CodeRule): boolean {
  return r.inTin !== false
}

/** Clé d'un code pour le dictionnaire : sans suffixe numérique (BAT1 → BAT). */
export function codeKey(raw: string): string {
  const n = normalizeCode(raw)
  return n.replace(/\d+$/, '') || n
}

export const UNKNOWN_RULE: CodeRule = { code: '?', label: 'Code non reconnu', kind: 'point', layer: '01_POINTS', color: 0x000000, symbol: 'croix', synonyms: [], lw: 0.18 }
export const NOCODE_RULE: CodeRule = { code: '', label: 'Point levé', kind: 'point', layer: '01_POINTS', color: 0x000000, symbol: 'croix', synonyms: [], lw: 0.18 }

const STORAGE_KEY = 'appstock.codes.v1'

export function loadRules(): CodeRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as CodeRule[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch {
    /* stockage indisponible : dictionnaire par défaut */
  }
  return DEFAULT_RULES.map((r) => ({ ...r, synonyms: [...r.synonyms] }))
}

export function saveRules(rules: CodeRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  } catch {
    /* stockage indisponible */
  }
}

export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
      last = tmp
    }
  }
  return prev[b.length]
}

export interface CodeMatch {
  rule: CodeRule
  /** Suffixe numérique : distingue plusieurs objets du même code (BAT1, BAT2). */
  group: string
  /** exact : correspondance certaine ; approx : à confirmer ; inconnu : aucune règle. */
  quality: 'exact' | 'approx' | 'inconnu' | 'vide'
}

export function matchCode(raw: string, rules: CodeRule[]): CodeMatch {
  const full = normalizeCode(raw)
  if (!full) return { rule: NOCODE_RULE, group: '', quality: 'vide' }
  const m = /^([A-Z]+)(\d*)$/.exec(full)
  const base = m ? m[1] : full
  const group = m ? m[2] : ''
  const names = (r: CodeRule) => [normalizeCode(r.code), ...r.synonyms.map(normalizeCode)]
  for (const r of rules) if (names(r).includes(full)) return { rule: r, group: '', quality: 'exact' }
  for (const r of rules) if (names(r).includes(base)) return { rule: r, group, quality: 'exact' }
  // Préfixe : « BORNE4 » → BORN, « BATIM » → BAT
  let best: CodeRule | null = null
  let bestLen = 0
  for (const r of rules) {
    for (const n of names(r)) {
      if (n.length >= 3 && base.startsWith(n) && n.length > bestLen) {
        best = r
        bestLen = n.length
      }
    }
  }
  if (best) return { rule: best, group, quality: 'approx' }
  if (base.length >= 4) {
    for (const r of rules) for (const n of names(r)) if (n.length >= 4 && levenshtein(base, n) <= 1) return { rule: r, group, quality: 'approx' }
  }
  return { rule: { ...UNKNOWN_RULE, code: raw.trim() }, group, quality: 'inconnu' }
}

export interface CodeSummary {
  raw: string
  count: number
  match: CodeMatch
}

/** Bilan des codes rencontrés dans un levé. */
export function summarizeCodes(points: SurveyPoint[], rules: CodeRule[]): CodeSummary[] {
  const map = new Map<string, CodeSummary>()
  for (const p of points) {
    const key = p.code.trim()
    let s = map.get(key)
    if (!s) map.set(key, (s = { raw: key, count: 0, match: matchCode(key, rules) }))
    s.count++
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export interface CodedObject {
  rule: CodeRule
  group: string
  points: SurveyPoint[]
}

/**
 * Construit les objets linéaires et surfaciques à partir des codes.
 * Deux points ne sont reliés que s'ils portent le même code : soit avec le même
 * suffixe numérique (BAT1…), soit, sans suffixe, s'ils se suivent dans le fichier.
 * La proximité géométrique seule ne relie jamais deux points.
 */
export function buildObjects(points: SurveyPoint[], rules: CodeRule[]): CodedObject[] {
  const objects: CodedObject[] = []
  const grouped = new Map<string, CodedObject>()
  let run: CodedObject | null = null
  for (const p of points) {
    const m = matchCode(p.code, rules)
    if (m.quality === 'inconnu' || m.quality === 'vide' || m.rule.kind === 'point') {
      run = null
      continue
    }
    if (m.group) {
      run = null
      const key = m.rule.code + '#' + m.group
      let obj = grouped.get(key)
      if (!obj) {
        obj = { rule: m.rule, group: m.group, points: [] }
        grouped.set(key, obj)
        objects.push(obj)
      }
      obj.points.push(p)
    } else {
      if (!run || run.rule.code !== m.rule.code) {
        run = { rule: m.rule, group: '', points: [] }
        objects.push(run)
      }
      run.points.push(p)
    }
  }
  return objects.filter((o) => o.points.length >= 2)
}
