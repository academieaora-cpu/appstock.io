/**
 * Assistant de production de plan : fichier de points → analyse → contrôle →
 * codes → dessin généré. L'utilisateur garde la main à chaque étape ; rien n'est
 * corrigé ni supposé en silence.
 */
import { WORK_REGIONS, candidateInRegion, describePlace, detectCrs, setWorkRegion, workRegion, type CrsCandidate } from '../core/crs'
import type { Item, Project } from '../core/project'
import { DEFAULT_RULES, codeKey, inTinRule, isBreaklineRule, loadRules, matchCode, normalizeCode, saveRules, summarizeCodes, type CodeRule } from '../topo/codes'
import { DEFAULT_PLAN, generatePlan, type PlanOptions, type PlanResult } from '../topo/generate'
import { parcelProposals, crossings, signedArea, type BorneVertex, type ParcelProposal } from '../topo/parcel'
import { checkPoints, cleaningFlags, delimiterName, parsePointsText, sourceDecimals, type CleanAction, type ColumnMap, type PointsFile, type SurveyPoint } from '../topo/points'
import { SCALES } from '../topo/sheet'
import { checkbox, field, h, modal, select, toast } from './dom'

export interface Understood {
  options: Partial<PlanOptions>
  paper?: string
  landscape?: boolean
  showTable?: boolean
  showLegend?: boolean
  /** Ce qui a été compris, en clair. */
  summary: string[]
}

/**
 * Interprète une instruction en français par mots-clés (règles déterministes).
 * Ce n'est pas un modèle de langage : seules les demandes listées dans `summary`
 * ont été comprises, le reste est ignoré et l'utilisateur le voit.
 */
export function parseInstruction(text: string): Understood {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  const u: Understood = { options: {}, summary: [] }
  const scale = /1\s*[/:]\s*(\d[\d\s]*)/.exec(t)
  if (scale) {
    const n = parseInt(scale[1].replace(/\s/g, ''))
    if (n >= 10 && n <= 100000) {
      u.options.scale = n
      u.summary.push('échelle 1/' + n)
    }
  }
  const paper = /\ba([0-4])\b/.exec(t)
  if (paper) {
    u.paper = 'A' + paper[1]
    u.summary.push('format ' + u.paper)
  }
  if (/paysage/.test(t)) {
    u.landscape = true
    u.summary.push('orientation paysage')
  } else if (/portrait/.test(t)) {
    u.landscape = false
    u.summary.push('orientation portrait')
  }
  const interval = /(?:courbes?|equidistance)[^.;]*?(\d+(?:[.,]\d+)?)\s*(m|metre|cm)\b/.exec(t)
  if (interval) {
    let v = parseFloat(interval[1].replace(',', '.'))
    if (interval[2] === 'cm') v /= 100
    if (v > 0 && v <= 100) {
      u.options.contourInterval = v
      u.summary.push(`courbes de niveau tous les ${v} m`)
    }
  } else if (/altimetri|courbes? de niveau|\bmnt\b/.test(t) && !/sans (les )?courbes/.test(t)) {
    u.options.contourInterval = 1
    u.summary.push('courbes de niveau (équidistance 1 m par défaut)')
  }
  if (/sans (les )?courbes|parcellaire/.test(t)) {
    if (/sans (les )?courbes/.test(t) || !interval) {
      u.options.contourInterval = 0
      if (/sans (les )?courbes/.test(t)) u.summary.push('sans courbes de niveau')
    }
  }
  if (/parcellaire|bornage/.test(t)) {
    u.options.parcel = true
    u.options.sideLengths = true
    u.showTable = true
    u.summary.push('plan parcellaire : parcelle, longueurs des côtés, superficie, tableau des coordonnées')
  }
  if (/sans (les )?(numeros|matricules)/.test(t)) {
    u.options.showIds = false
    u.summary.push('sans numéros de points')
  } else if (/numeros|matricules/.test(t)) {
    u.options.showIds = true
    u.summary.push('numéros de points affichés')
  }
  if (/sans (les )?(altitudes|cotes)/.test(t)) {
    u.options.showZ = false
    u.summary.push('sans altitudes')
  } else if (/altitudes|points cotes/.test(t)) {
    u.options.showZ = true
    u.summary.push('altitudes affichées')
  }
  if (/descriptions|codes/.test(t) && !/sans (les )?(descriptions|codes)/.test(t)) {
    u.options.showCodes = true
    u.summary.push('descriptions affichées')
  }
  if (/triangulation|\btin\b/.test(t)) {
    u.options.showTin = true
    u.summary.push('triangulation visible')
  }
  if (/tableau/.test(t)) {
    u.showTable = true
    if (!u.summary.some((s) => s.includes('tableau'))) u.summary.push('tableau des coordonnées')
  }
  if (/legende/.test(t)) {
    u.showLegend = !/sans (la )?legende/.test(t)
    u.summary.push(u.showLegend ? 'légende' : 'sans légende')
  }
  return u
}

export interface AssistantResult {
  item: Item
  plan: PlanResult
  paper?: string
  landscape?: boolean
  scale: number
  showTable?: boolean
  showLegend?: boolean
  /** Décimales des coordonnées du fichier source (pour le tableau des coordonnées). */
  coordDecimals: number
}

const IGNORE = '__ignorer'
const SIMPLE = ''


/** Petit aperçu du contour (SVG), bornes nommées, côtés qui se croisent en rouge. */
function parcelPreview(vertices: BorneVertex[]): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'parcel-preview')
  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  const x0 = Math.min(...xs)
  const y1 = Math.max(...ys)
  const w = Math.max(...xs) - x0 || 1
  const hh = y1 - Math.min(...ys) || 1
  const size = 260
  const k = (size - 60) / Math.max(w, hh)
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  const P = (v: BorneVertex) => [30 + (v.x - x0) * k, 30 + (y1 - v.y) * k]
  const bad = new Set(crossings(vertices.map((v) => ({ id: v.label, x: v.x, y: v.y }))).flat())
  vertices.forEach((v, i) => {
    const a = P(v)
    const b = P(vertices[(i + 1) % vertices.length])
    const l = document.createElementNS(NS, 'line')
    l.setAttribute('x1', String(a[0]))
    l.setAttribute('y1', String(a[1]))
    l.setAttribute('x2', String(b[0]))
    l.setAttribute('y2', String(b[1]))
    l.setAttribute('stroke', bad.has(i) ? '#ff5050' : '#e8e8e8')
    l.setAttribute('stroke-width', '2')
    svg.append(l)
  })
  for (const v of vertices) {
    const [x, y] = P(v)
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', String(x))
    c.setAttribute('cy', String(y))
    c.setAttribute('r', '3.5')
    c.setAttribute('fill', '#ff3b3b')
    svg.append(c)
    const t = document.createElementNS(NS, 'text')
    t.setAttribute('x', String(x + 5))
    t.setAttribute('y', String(y - 5))
    t.setAttribute('fill', '#ffd27a')
    t.setAttribute('font-size', '12')
    t.textContent = v.label
    svg.append(t)
  }
  return svg
}

export function openAssistant(project: Project, source: { name: string; text: string } | null, onDone: (r: AssistantResult) => void): void {
  let name = source?.name ?? ''
  let raw = source?.text ?? ''
  let file: PointsFile | null = raw ? parsePointsText(raw) : null
  let rules: CodeRule[] = loadRules()
  const options: PlanOptions = { ...DEFAULT_PLAN, offset: [0, 0, 0] }
  let confirmed = false
  let crs: string | null = null
  let candidates: CrsCandidate[] = []
  let understood: Understood | null = null
  let existing: Item | null = null
  let instructionText = ''
  // Nettoyage : décision par point (indice dans file.points)
  let decisions = new Map<number, CleanAction>()
  let flags: ReturnType<typeof cleaningFlags> = []
  let cleanValidated = false
  let extraExcluded = ''
  // Codes : choix de l'utilisateur par code (clé sans suffixe)
  let choices = new Map<string, string>()
  let codesValidated = false
  // MNT : participation des points et lignes de rupture, par code
  let tinChoice = new Map<string, boolean>()
  let breakChoice = new Map<string, boolean>()
  // Parcelle
  let parcelMode = ''
  let manualOrder = ''

  const root = h('div', { class: 'content steps' })
  const close = modal('Assistant de production de plan', root, { wide: true })

  const resetSteps = () => {
    decisions = new Map()
    flags = file ? cleaningFlags(file.points) : []
    for (const f of flags) if (f.suggestion !== 'garder') decisions.set(f.index, f.suggestion)
    cleanValidated = false
    choices = new Map()
    codesValidated = false
    tinChoice = new Map()
    breakChoice = new Map()
    parcelMode = ''
    manualOrder = ''
  }

  const reparse = (forced?: Partial<ColumnMap>) => {
    file = raw ? parsePointsText(raw, forced) : null
    confirmed = false
    resetSteps()
    detect()
    render()
  }

  /** Système proposé d'après les points gardés : un point aberrant ne doit pas fausser la détection. */
  const detect = () => {
    const pts = cleanedPoints()
    if (!pts.length) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
    candidates = detectCrs([x0, y0, x1, y1])
    crs = candidates.length && candidateInRegion(candidates[0]) ? candidates[0].def.code : null
  }

  const loadFile = async (f: File) => {
    name = f.name
    raw = await f.text()
    reparse()
  }

  /** Points retenus après nettoyage (altitude retirée si demandé). */
  const cleanedPoints = (): SurveyPoint[] => {
    if (!file) return []
    const extra = new Set(extraExcluded.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean))
    const out: SurveyPoint[] = []
    file.points.forEach((p, i) => {
      const d = decisions.get(i)
      if (d === 'exclure' || extra.has(p.id)) return
      out.push(d === 'sans-altitude' ? { ...p, z: null } : p)
    })
    return out
  }

  /** Choix effectif pour un code : celui de l'utilisateur, sinon la reconnaissance proposée. */
  const choiceFor = (rawCode: string): string => {
    const key = codeKey(rawCode)
    const c = choices.get(key)
    if (c !== undefined) return c
    const m = matchCode(rawCode, rules)
    return m.quality === 'exact' || m.quality === 'approx' ? m.rule.code : SIMPLE
  }

  /** Dictionnaire effectif : chaque code du fichier pointe exactement vers le choix validé. */
  const effectiveRules = (pts: SurveyPoint[]): CodeRule[] => {
    let eff = rules.map((r) => ({ ...r, synonyms: [...r.synonyms] }))
    const front: CodeRule[] = []
    const keys = new Set(pts.map((p) => p.code.trim()).filter(Boolean).map(codeKey))
    for (const key of keys) {
      const sample = pts.find((p) => codeKey(p.code) === key)!.code
      const c = choiceFor(sample)
      for (const r of eff) r.synonyms = r.synonyms.filter((x) => normalizeCode(x) !== key)
      let target = eff.find((r) => r.code === c)
      if (!target && c === SIMPLE) {
        target = { code: key, label: 'Point ' + key, kind: 'point', layer: '01_POINTS', color: 0x000000, symbol: 'croix', synonyms: [], lw: 0.18 }
        eff.push(target)
      }
      if (!target) continue
      if (normalizeCode(target.code) !== key) target.synonyms.push(key)
      // Le choix l'emporte sur une règle dont le code s'écrit pareil (ex. « BORN » attribué à autre chose).
      if (eff.some((r) => r !== target && normalizeCode(r.code) === key) && !front.includes(target)) front.push(target)
    }
    eff = [...front, ...eff.filter((r) => !front.includes(r))]
    return eff
  }

  const ruleFor = (rawCode: string) => rules.find((r) => r.code === choiceFor(rawCode))
  const inTinFor = (rawCode: string) => tinChoice.get(codeKey(rawCode)) ?? (ruleFor(rawCode) ? inTinRule(ruleFor(rawCode)!) : true)
  const breakFor = (rawCode: string) => breakChoice.get(codeKey(rawCode)) ?? (ruleFor(rawCode) ? isBreaklineRule(ruleFor(rawCode)!) : false)

  /** Points à dessiner : nettoyés, sans les codes « ne pas dessiner ». */
  const drawnPoints = (): SurveyPoint[] => cleanedPoints().filter((p) => !p.code.trim() || choiceFor(p.code) !== IGNORE)

  const bornesOf = (pts: SurveyPoint[], eff: CodeRule[]) => pts.filter((p) => {
    const m = matchCode(p.code, eff)
    return m.rule.kind === 'borne' || (m.quality === 'vide' && /^B[.\s-]?\d+[A-Za-z]?$/i.test(p.id.trim()))
  })

  const currentParcel = (): { proposals: ParcelProposal[]; recommended: string; chosen: BorneVertex[] | null; error: string | null } | null => {
    const pts = drawnPoints()
    const bornes = bornesOf(pts, effectiveRules(pts))
    if (!options.parcel || bornes.length < 3) return null
    const { proposals, recommended } = parcelProposals(bornes.map((b) => ({ id: b.id, x: b.x, y: b.y })))
    const mode = parcelMode || recommended
    if (mode === 'manuel') {
      const names = manualOrder.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
      const all = proposals.find((p) => p.mode === 'fichier')!.vertices
      const chosen: BorneVertex[] = []
      for (const n of names) {
        const v = all.find((x) => x.label === n || x.source === n)
        if (!v) return { proposals, recommended, chosen: null, error: `Borne « ${n} » inconnue. Noms disponibles : ${all.map((x) => x.label).join(', ')}` }
        chosen.push(v)
      }
      if (chosen.length < 3) return { proposals, recommended, chosen: null, error: 'Indiquez au moins trois bornes, dans l’ordre du parcours.' }
      if (new Set(chosen).size !== chosen.length) return { proposals, recommended, chosen: null, error: 'Une borne est citée deux fois.' }
      return { proposals, recommended, chosen, error: null }
    }
    const p = proposals.find((x) => x.mode === mode) ?? proposals[0]
    return { proposals, recommended, chosen: p.vertices, error: null }
  }

  const render = () => {
    root.replaceChildren()
    // 1. Fichier
    const input = h('input', { type: 'file', accept: '.txt,.csv,.xyz,.asc,.pts,.dat', onchange: () => input.files?.[0] && loadFile(input.files[0]) })
    const s1 = h('section', null, h('h3', null, '1 · Fichier de points'), h('div', { class: 'row' }, input, h('button', { onclick: loadSample }, 'Utiliser le levé d’exemple')))
    root.append(s1)
    if (!file) {
      s1.append(h('p', { class: 'muted' }, 'Formats acceptés : TXT, CSV, XYZ, ASC — séparateur et ordre des colonnes reconnus automatiquement (point, X, Y, Z, code ; numéro, nord, est, altitude, désignation ; etc.).'))
      return
    }
    const f = file
    const dec = sourceDecimals(f)
    const cols: [string, string][] = [['-1', '—']]
    for (let i = 0; i < f.columnCount; i++) cols.push([String(i), `Colonne ${i + 1}${f.header[i] ? ' (' + f.header[i] + ')' : ''}`])
    const pick = (key: keyof ColumnMap, label: string) => field(label, select(cols, String(f.columns[key]), (v) => reparse({ ...f.columns, [key]: Number(v) })))
    s1.append(
      h('p', null, h('b', null, name), ` — ${f.points.length} points lus · séparateur : ${delimiterName(f.delimiter)} · ${f.hasHeader ? 'ligne d’en-tête reconnue' : 'pas d’en-tête'} · coordonnées à ${dec} décimale(s), conservées telles quelles`),
      h('div', { class: 'row' }, pick('id', 'Identifiant'), pick('x', 'X (Est)'), pick('y', 'Y (Nord)'), pick('z', 'Altitude'), pick('code', 'Code / description')),
      h('div', { class: 'actions' }, h('button', { onclick: () => reparse({ ...f.columns, x: f.columns.y, y: f.columns.x }) }, 'Permuter X et Y')),
    )
    const head = ['Identifiant', 'X (Est)', 'Y (Nord)', 'Altitude', 'Code']
    s1.append(
      h(
        'div',
        { class: 'scroll' },
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, ...head.map((c) => h('th', null, c)))),
          h('tbody', null, ...f.points.slice(0, 8).map((p) => h('tr', null, h('td', null, p.id), h('td', { class: 'mono' }, p.x.toFixed(dec)), h('td', { class: 'mono' }, p.y.toFixed(dec)), h('td', { class: 'mono' }, p.z === null ? '—' : p.z.toFixed(3)), h('td', null, p.code)))),
        ),
      ),
    )
    if (f.questions.length) {
      s1.append(h('div', { class: 'note warn' }, ...f.questions.map((q) => h('div', null, '⚠ ' + q)), checkbox('Je confirme l’interprétation des colonnes ci-dessus', confirmed, (v) => {
        confirmed = v
        updateButton()
      })))
    }
    if (!f.points.length) return

    // 2. Nettoyage
    const q = checkPoints(f)
    const s2 = h('section', null, h('h3', null, '2 · Nettoyage des points'))
    s2.append(h('p', null, `${q.count} points, dont ${q.withZ} avec altitude${q.zRange ? ` (de ${q.zRange[0].toFixed(2)} à ${q.zRange[1].toFixed(2)} m)` : ''}. Étendue : ${(q.extent[2] - q.extent[0]).toFixed(1)} m × ${(q.extent[3] - q.extent[1]).toFixed(1)} m.`))
    for (const a of q.anomalies.filter((a) => a.level === 'erreur' && /non importée/.test(a.message))) s2.append(h('div', { class: 'note err' }, a.message))
    if (!flags.length) s2.append(h('div', { class: 'note ok' }, 'Aucun point suspect (doublon, coordonnée nulle, point isolé, altitude aberrante).'))
    else {
      const actionSel = (i: number) => select([['garder', 'Garder'], ['exclure', 'Exclure'], ['sans-altitude', 'Garder sans altitude']], decisions.get(i) ?? 'garder', (v) => {
        if (v === 'garder') decisions.delete(i)
        else decisions.set(i, v as CleanAction)
        cleanValidated = false
        render()
      })
      s2.append(
        h('p', { class: 'muted' }, `${flags.length} point(s) à examiner. Une action est proposée pour chacun ; c’est vous qui décidez. Le fichier source n’est jamais modifié.`),
        h(
          'div',
          { class: 'scroll' },
          h(
            'table',
            { class: 'grid' },
            h('thead', null, h('tr', null, ...['Point', 'X', 'Y', 'Z', 'Code', 'Problème', 'Décision'].map((c) => h('th', null, c)))),
            h(
              'tbody',
              null,
              ...flags.map((fl) => {
                const p = f.points[fl.index]
                return h('tr', null, h('td', null, p.id), h('td', { class: 'mono' }, p.x.toFixed(dec)), h('td', { class: 'mono' }, p.y.toFixed(dec)), h('td', { class: 'mono' }, p.z === null ? '—' : String(p.z)), h('td', null, p.code), h('td', null, fl.problem), h('td', null, actionSel(fl.index)))
              }),
            ),
          ),
        ),
      )
    }
    const extra = h('input', { type: 'text', value: extraExcluded, placeholder: 'ex. 12, 47, 103' }) as HTMLInputElement
    extra.addEventListener('change', () => {
      extraExcluded = extra.value
      cleanValidated = false
      render()
    })
    const kept = cleanedPoints()
    const noZ = [...decisions.values()].filter((d) => d === 'sans-altitude').length
    s2.append(
      field('Exclure aussi ces points (identifiants)', extra, 'Pour écarter d’autres points de contrôle ou de mauvaises mesures.'),
      h('div', { class: 'note ' + (cleanValidated ? 'ok' : '') }, `${kept.length} point(s) gardé(s) sur ${f.points.length} · ${f.points.length - kept.length} exclu(s) · ${noZ} altitude(s) ignorée(s).`),
      h('div', { class: 'actions' }, h('button', { class: cleanValidated ? '' : 'primary', onclick: () => {
        cleanValidated = true
        detect()
        render()
      } }, cleanValidated ? 'Nettoyage validé ✓' : 'Valider le nettoyage')),
    )
    root.append(s2)

    // 3. Système de coordonnées
    const s3 = h('section', null, h('h3', null, '3 · Système de coordonnées'))
    const crsOptions: [string, string][] = candidates.slice(0, 8).map((c) => [c.def.code, `${candidateInRegion(c) ? '' : '✗ '}${c.def.name} — le levé tombe ${describePlace(c.lon, c.lat)}`])
    crsOptions.push(['', 'Coordonnées locales (non géoréférencées)'])
    const chosen = candidates.find((c) => c.def.code === crs)
    s3.append(
      field('Pays de travail', select(WORK_REGIONS.map((r) => [r.id, r.name]), workRegion().id, (v) => {
        setWorkRegion(v)
        detect()
        render()
      }), 'Le système retenu doit placer le levé dans ce pays.'),
      field('Système du levé', select(crsOptions, crs ?? '', (v) => {
        crs = v || null
        render()
      }), candidates.length ? 'Chaque proposition dit où tomberait le levé. Les coordonnées du fichier ne sont jamais converties.' : 'Aucun système reconnu : coordonnées traitées comme locales.'),
      chosen ? h('div', { class: 'note ' + (candidateInRegion(chosen) ? 'ok' : 'err') }, `Avec ce système, le levé est ${describePlace(chosen.lon, chosen.lat)}.`) : '',
    )
    root.append(s3)

    // 4. Codes : rien n'est appliqué sans validation
    const pts = cleanedPoints()
    const summary = summarizeCodes(pts, rules)
    const s4 = h('section', null, h('h3', null, '4 · Codes terrain — à valider'))
    const ruleOptions: [string, string][] = [[SIMPLE, 'Point simple (non relié)'], ...rules.map((r): [string, string] => [r.code, `${r.label} (${{ point: 'point', ligne: 'ligne', surface: 'surface fermée', borne: 'borne' }[r.kind]})`]), [IGNORE, 'Ne pas dessiner (déchet, point de contrôle)']]
    const seenKeys = new Set<string>()
    const rows = summary.filter((c) => {
      if (!c.raw) return true
      const k = codeKey(c.raw)
      if (seenKeys.has(k)) return false
      seenKeys.add(k)
      return true
    })
    s4.append(
      h(
        'div',
        { class: 'scroll' },
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Code du fichier'), h('th', null, 'Points'), h('th', null, 'Attribuer à'), h('th', { title: 'Les points de ce code entrent dans le modèle de terrain (décochez un point qui n’est pas au sol)' }, 'MNT'), h('th', { title: 'Les lignes de ce code sont des lignes de rupture : aucun triangle ne les traverse' }, 'Rupture'), h('th', null, 'Proposition'))),
          h(
            'tbody',
            null,
            ...rows.map((c) => {
              const count = c.raw ? pts.filter((p) => codeKey(p.code) === codeKey(c.raw)).length : c.count
              const user = c.raw ? choices.has(codeKey(c.raw)) : false
              return h(
                'tr',
                null,
                h('td', null, c.raw ? codeKey(c.raw) + (pts.some((p) => codeKey(p.code) === codeKey(c.raw) && /\d$/.test(normalizeCode(p.code))) ? ' (avec suffixes)' : '') : '(vide)'),
                h('td', null, count),
                h(
                  'td',
                  null,
                  c.raw
                    ? select(ruleOptions, choiceFor(c.raw), (v) => {
                        choices.set(codeKey(c.raw), v)
                        codesValidated = false
                        parcelMode = ''
                        render()
                      })
                    : 'Point levé',
                ),
                h('td', null, (() => {
                  const cb = h('input', { type: 'checkbox', checked: c.raw ? inTinFor(c.raw) : true, disabled: !c.raw }) as HTMLInputElement
                  cb.addEventListener('change', () => {
                    tinChoice.set(codeKey(c.raw), cb.checked)
                    codesValidated = false
                    render()
                  })
                  return cb
                })()),
                h('td', null, (() => {
                  const kind = ruleFor(c.raw)?.kind
                  if (!c.raw || (kind !== 'ligne' && kind !== 'surface')) return '—'
                  const cb = h('input', { type: 'checkbox', checked: breakFor(c.raw) }) as HTMLInputElement
                  cb.addEventListener('change', () => {
                    breakChoice.set(codeKey(c.raw), cb.checked)
                    codesValidated = false
                    render()
                  })
                  return cb
                })()),
                h('td', null, user ? h('span', { class: 'badge ok' }, 'votre choix') : h('span', { class: 'badge ' + (c.match.quality === 'exact' ? 'ok' : c.match.quality === 'approx' ? 'warn' : c.match.quality === 'inconnu' ? 'err' : '') }, { exact: 'reconnu', approx: 'approché — à vérifier', inconnu: 'inconnu — à attribuer', vide: 'sans code' }[c.match.quality])),
              )
            }),
          ),
        ),
      ),
      h('p', { class: 'muted' }, 'Les points d’un même code sont reliés dans l’ordre du fichier (ou par suffixe : BAT1, BAT2…). « MNT » : le point entre dans le modèle de terrain (décochez les points qui ne sont pas au sol). « Rupture » : la ligne est imposée dans le MNT, aucun triangle ne la traverse (talus, fossés, bords de route). Rien n’est dessiné avant votre validation ; vos choix rejoignent alors votre dictionnaire.'),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: codesValidated ? '' : 'primary', onclick: () => {
          // Le dictionnaire mémorise les choix validés.
          const eff = effectiveRules(pts)
          rules = eff.filter((r) => rules.some((x) => x.code === r.code))
          // Les choix MNT et rupture portent sur l'objet attribué : ils rejoignent le dictionnaire.
          for (const c of rows) {
            if (!c.raw) continue
            const r = rules.find((x) => x.code === choiceFor(c.raw))
            if (!r) continue
            if (tinChoice.has(codeKey(c.raw))) r.inTin = tinChoice.get(codeKey(c.raw))
            if (breakChoice.has(codeKey(c.raw))) r.breakline = breakChoice.get(codeKey(c.raw))
          }
          saveRules(rules)
          for (const c of rows) if (c.raw) choices.set(codeKey(c.raw), choiceFor(c.raw))
          codesValidated = true
          render()
        } }, codesValidated ? 'Codes validés ✓' : 'Valider l’attribution des codes'),
        h('button', { onclick: () => {
          rules = DEFAULT_RULES.map((r) => ({ ...r, synonyms: [...r.synonyms] }))
          saveRules(rules)
          choices = new Map()
          codesValidated = false
          render()
        } }, 'Réinitialiser le dictionnaire'),
      ),
    )
    root.append(s4)

    // 5. Parcelle : contour des bornes validé (jamais croisé)
    const s5 = h('section', null, h('h3', null, '5 · Bornes et contour de la parcelle'))
    const par = codesValidated ? currentParcel() : null
    if (!codesValidated) s5.append(h('p', { class: 'muted' }, 'Validez d’abord les codes : les bornes sont les points attribués à « Borne ».'))
    else if (!options.parcel) s5.append(h('p', { class: 'muted' }, 'Parcelle désactivée (option « Parcelle par les bornes » à l’étape 6).'))
    else if (!par) s5.append(h('p', { class: 'muted' }, 'Moins de trois bornes : pas de parcelle.'))
    else {
      const mode = parcelMode || par.recommended
      const list = h('div', { class: 'parcel-choices' })
      for (const pr of par.proposals) {
        list.append(
          h(
            'label',
            { class: 'parcel-choice' + (mode === pr.mode ? ' sel' : '') },
            h('input', { type: 'radio', name: 'parcel-order', checked: mode === pr.mode, onchange: () => {
              parcelMode = pr.mode
              render()
            } }),
            h('span', null, h('b', null, pr.label), pr.mode === par.recommended ? ' (recommandé)' : '', h('br'), pr.simple ? `Superficie ${pr.area.toFixed(2)} m² · périmètre ${pr.perimeter.toFixed(2)} m` : 'Contour croisé : superficie impossible', h('br'), h('small', null, pr.vertices.map((v) => (v.label === v.source || !v.source ? v.label : `${v.label} (${v.source})`)).join(' → '))),
          ),
        )
      }
      list.append(
        h(
          'label',
          { class: 'parcel-choice' + (mode === 'manuel' ? ' sel' : '') },
          h('input', { type: 'radio', name: 'parcel-order', checked: mode === 'manuel', onchange: () => {
            parcelMode = 'manuel'
            render()
          } }),
          h('span', null, h('b', null, 'Ordre saisi à la main'), h('br'), (() => {
            const inp = h('input', { type: 'text', value: manualOrder, placeholder: 'ex. B.1, B.2, B.3, B.4' }) as HTMLInputElement
            inp.addEventListener('change', () => {
              manualOrder = inp.value
              parcelMode = 'manuel'
              render()
            })
            return inp
          })()),
        ),
      )
      s5.append(list)
      if (par.error) s5.append(h('div', { class: 'note err' }, par.error))
      if (par.chosen) {
        const cr = crossings(par.chosen.map((v) => ({ id: v.label, x: v.x, y: v.y })))
        const area = Math.abs(signedArea(par.chosen))
        s5.append(h('div', { class: 'parcel-view' }, parcelPreview(par.chosen), h('div', null, cr.length ? h('div', { class: 'note err' }, `Ce contour se croise (${cr.length} croisement(s), en rouge) : la superficie n’a pas de sens. Choisissez un autre ordre.`) : h('div', { class: 'note ok' }, `Contour valide : ${par.chosen.length} bornes, superficie ${area.toFixed(2)} m².`), h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'MAT'), h('th', null, 'X'), h('th', null, 'Y'))), h('tbody', null, ...par.chosen.map((v) => h('tr', null, h('td', null, v.label), h('td', { class: 'mono' }, v.x.toFixed(dec)), h('td', { class: 'mono' }, v.y.toFixed(dec)))))))))
      }
    }
    root.append(s5)

    // 6. Plan
    const s6 = h('section', null, h('h3', null, '6 · Plan à produire'))
    const instruction = h('textarea', { rows: 2, value: instructionText, placeholder: 'Exemple : plan topographique et altimétrique au 1/500, format A3 paysage, courbes de niveau tous les 0,50 m, avec le tableau des coordonnées', oninput: () => (instructionText = instruction.value) })
    const understoodBox = h('div')
    const showUnderstood = () => {
      understoodBox.replaceChildren()
      if (understood) understoodBox.append(h('div', { class: 'note ' + (understood.summary.length ? 'ok' : 'warn') }, understood.summary.length ? 'Compris : ' + understood.summary.join(' ; ') + '.' : 'Aucune consigne reconnue dans cette phrase (échelle, format, courbes, parcellaire, numéros, altitudes, tableau, légende).'))
    }
    s6.append(
      field('Décrivez le plan en une phrase (facultatif)', instruction, 'Interprétation par mots-clés, affichée ci-dessous pour vérification. Les calculs restent déterministes.'),
      h('div', { class: 'actions' }, h('button', { onclick: () => {
        understood = parseInstruction(instruction.value)
        Object.assign(options, understood.options)
        render()
      } }, 'Appliquer la phrase')),
      understoodBox,
      h(
        'div',
        { class: 'row' },
        field('Échelle du dessin', select(SCALES.map((s) => [String(s), '1/' + s]), String(SCALES.includes(options.scale) ? options.scale : 500), (v) => (options.scale = Number(v)))),
        field('Équidistance des courbes (m)', h('input', { type: 'number', min: 0, step: 0.25, value: options.contourInterval, onchange: (e: Event) => (options.contourInterval = Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0)) }), '0 = pas de courbes'),
        field('Courbe maîtresse toutes les', h('input', { type: 'number', min: 1, step: 1, value: options.majorEvery, onchange: (e: Event) => (options.majorEvery = Math.max(1, parseInt((e.target as HTMLInputElement).value) || 5)) })),
        field('Emprise des courbes', select([['all', 'Toute l’enveloppe des points (comme Covadis)'], ['auto', 'Sans les grands triangles de bordure'], ['20', 'Triangles de 20 m au plus'], ['40', 'Triangles de 40 m au plus']], options.maxEdge === undefined || options.maxEdge === Infinity ? 'all' : options.maxEdge ? String(options.maxEdge) : 'auto', (v) => (options.maxEdge = v === 'all' ? Infinity : v === 'auto' ? 0 : Number(v))), 'Bordure : un côté de plus de 6 fois la médiane traverse une zone sans points.'),
        field('Interrompre les courbes au-delà de', select([['0', 'Jamais (comme Covadis)'], ['3', '300 % (faces de murs, marches)'], ['5', '500 %']], String(options.maxSlope ?? 0), (v) => (options.maxSlope = Number(v))), 'Les talus (jusqu’à 100 %) restent toujours tracés.'),
      ),
      h(
        'div',
        { class: 'row' },
        field('Couleur des courbes', select([['degrade', 'Dégradé selon la cote'], ['maitresses', 'Maîtresses rouges, intermédiaires orange']], options.contourColors ?? 'degrade', (v) => (options.contourColors = v as 'degrade' | 'maitresses'))),
        field('Cotes le long des courbes, tous les (mm papier)', h('input', { type: 'number', min: 20, step: 10, value: options.labelSpacing ?? 80, onchange: (e: Event) => (options.labelSpacing = Math.max(20, parseFloat((e.target as HTMLInputElement).value) || 80)) })),
        checkbox('Coter aussi les courbes intermédiaires', !!options.labelMinor, (v) => (options.labelMinor = v)),
      ),
      h(
        'div',
        { class: 'row' },
        checkbox('Numéros de points', options.showIds, (v) => (options.showIds = v)),
        checkbox('Altitudes', options.showZ, (v) => (options.showZ = v)),
        checkbox('Descriptions', options.showCodes, (v) => (options.showCodes = v)),
        checkbox('Parcelle par les bornes', options.parcel, (v) => {
          options.parcel = v
          render()
        }),
        checkbox('Longueurs des côtés', options.sideLengths, (v) => (options.sideLengths = v)),
        checkbox('Triangulation visible', options.showTin, (v) => (options.showTin = v)),
        checkbox('Lisser les courbes (affichage, écart chiffré)', options.smoothContours, (v) => (options.smoothContours = v)),
      ),
      h('h3', null, 'Semis de points (options de chargement, comme dans Covadis)'),
      h(
        'div',
        { class: 'row' },
        field('Décimales de l’altitude', select([['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], String(options.altDecimals), (v) => (options.altDecimals = Number(v)))),
        field('Insertion du semis', select([['3d', 'en 3D (altitude sur le point)'], ['2d', 'en 2D']], options.insert3d ? '3d' : '2d', (v) => (options.insert3d = v === '3d'))),
        checkbox('Insérer les points pour Z = 0', options.includeZeroZ, (v) => (options.includeZeroZ = v)),
        checkbox('Insérer aussi les symboles', options.symbols, (v) => (options.symbols = v)),
      ),
      h(
        'div',
        { class: 'row' },
        ...(['X', 'Y', 'Z'] as const).map((axis, i) =>
          field(`Décalage selon ${axis} (m)`, h('input', { type: 'number', step: 0.001, value: options.offset[i], onchange: (e: Event) => (options.offset[i] = parseFloat((e.target as HTMLInputElement).value) || 0) })),
        ),
      ),
      h('p', { class: 'muted' }, 'Les points sont insérés en blocs TCPOINT (attributs MAT, ALT, COD) sur les calques TOPOJIS, TopoMat et TopoAlt : le DXF exporté est reconnu par Covadis. Laissez les décalages à 0 pour conserver les coordonnées du fichier.'),
    )
    showUnderstood()
    root.append(s6)

    root.append(h('div', { class: 'actions' }, button), blockers)
    updateButton()
  }

  const button = h('button', { class: 'primary', onclick: () => generate() }, 'Générer mon plan')
  const blockers = h('div', { class: 'note warn' })
  const missing = (): string[] => {
    const out: string[] = []
    if (!file || !file.points.length) return ['Chargez un fichier de points.']
    if (file.questions.length > 0 && !confirmed) out.push('Confirmez l’interprétation des colonnes (étape 1).')
    if (!cleanValidated) out.push('Validez le nettoyage des points (étape 2).')
    if (!codesValidated) out.push('Validez l’attribution des codes (étape 4).')
    else {
      const par = currentParcel()
      if (par && (!par.chosen || crossings(par.chosen.map((v) => ({ id: v.label, x: v.x, y: v.y }))).length)) out.push('Choisissez un contour de parcelle sans croisement (étape 5).')
    }
    return out
  }
  const updateButton = () => {
    const m = missing()
    button.disabled = m.length > 0
    blockers.replaceChildren(...m.map((x) => h('div', null, '• ' + x)))
    blockers.style.display = m.length ? '' : 'none'
  }

  const generate = () => {
    if (!file || missing().length) return
    const pts = drawnPoints()
    const eff = effectiveRules(pts)
    const par = currentParcel()
    const keys = [...new Set(pts.filter((p) => p.code.trim()).map((p) => p.code))]
    const noTinCodes = [...new Set(keys.filter((c) => !inTinFor(c)).map(codeKey))]
    const breaklineCodes = [...new Set(keys.filter((c) => breakFor(c)).map(codeKey))]
    const plan = generatePlan(pts, eff, { ...options, parcelVertices: par?.chosen ?? undefined, noTinCodes, breaklineCodes }, name.replace(/\.[^.]+$/, '') + '_plan')
    const excluded = file.points.length - cleanedPoints().length
    const ignored = cleanedPoints().length - pts.length
    if (excluded || ignored) plan.report.unshift({ level: 'alerte', message: `Nettoyage validé : ${excluded} point(s) exclu(s)${ignored ? `, ${ignored} point(s) aux codes « ne pas dessiner »` : ''}${[...decisions.values()].some((d) => d === 'sans-altitude') ? ', altitudes ignorées pour les points signalés' : ''}.` })
    plan.dataset.crs = crs
    plan.dataset.crsSource = crs ? 'user' : 'none'
    plan.dataset.meta.source = name
    if (existing && project.items.includes(existing)) project.replace(existing, plan.dataset, plan)
    else existing = project.add(plan.dataset, plan)
    close()
    onDone({ item: existing, plan, paper: understood?.paper, landscape: understood?.landscape, scale: options.scale, showTable: understood?.showTable, showLegend: understood?.showLegend, coordDecimals: sourceDecimals(file) })
  }

  const loadSample = async () => {
    try {
      const res = await fetch('samples/leve_demo_utm32n.csv')
      if (!res.ok) throw new Error(String(res.status))
      name = 'leve_demo_utm32n.csv'
      raw = await res.text()
      reparse()
    } catch {
      toast('Levé d’exemple introuvable.', 'erreur')
    }
  }

  if (file) reparse()
  else render()
}
