/**
 * Assistant de production de plan : fichier de points → analyse → contrôle →
 * codes → dessin généré. L'utilisateur garde la main à chaque étape ; rien n'est
 * corrigé ni supposé en silence.
 */
import { detectCrs, type CrsCandidate } from '../core/crs'
import type { Item, Project } from '../core/project'
import { DEFAULT_RULES, loadRules, saveRules, summarizeCodes, type CodeRule } from '../topo/codes'
import { DEFAULT_PLAN, generatePlan, type PlanOptions, type PlanResult } from '../topo/generate'
import { checkPoints, delimiterName, parsePointsText, type ColumnMap, type PointsFile } from '../topo/points'
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
}

export function openAssistant(project: Project, source: { name: string; text: string } | null, onDone: (r: AssistantResult) => void): void {
  let name = source?.name ?? ''
  let raw = source?.text ?? ''
  let file: PointsFile | null = raw ? parsePointsText(raw) : null
  let rules: CodeRule[] = loadRules()
  const options: PlanOptions = { ...DEFAULT_PLAN }
  let confirmed = false
  let crs: string | null = null
  let candidates: CrsCandidate[] = []
  let understood: Understood | null = null
  let existing: Item | null = null
  let instructionText = ''

  const root = h('div', { class: 'content steps' })
  const close = modal('Assistant de production de plan', root, { wide: true })

  const reparse = (forced?: Partial<ColumnMap>) => {
    file = raw ? parsePointsText(raw, forced) : null
    confirmed = false
    if (file?.points.length) {
      const q = checkPoints(file)
      candidates = detectCrs(q.extent)
      crs = candidates.length ? candidates[0].def.code : null
    }
    render()
  }

  const loadFile = async (f: File) => {
    name = f.name
    raw = await f.text()
    reparse()
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
    const cols: [string, string][] = [['-1', '—']]
    for (let i = 0; i < f.columnCount; i++) cols.push([String(i), `Colonne ${i + 1}${f.header[i] ? ' (' + f.header[i] + ')' : ''}`])
    const pick = (key: keyof ColumnMap, label: string) => field(label, select(cols, String(f.columns[key]), (v) => reparse({ ...f.columns, [key]: Number(v) })))
    s1.append(
      h('p', null, h('b', null, name), ` — ${f.points.length} points lus · séparateur : ${delimiterName(f.delimiter)} · ${f.hasHeader ? 'ligne d’en-tête reconnue' : 'pas d’en-tête'}`),
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
          h('tbody', null, ...f.points.slice(0, 8).map((p) => h('tr', null, h('td', null, p.id), h('td', { class: 'mono' }, p.x.toFixed(3)), h('td', { class: 'mono' }, p.y.toFixed(3)), h('td', { class: 'mono' }, p.z === null ? '—' : p.z.toFixed(3)), h('td', null, p.code)))),
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

    // 2. Contrôle
    const q = checkPoints(f)
    const s2 = h('section', null, h('h3', null, '2 · Contrôle des données'))
    s2.append(
      h('p', null, `${q.count} points, dont ${q.withZ} avec altitude${q.zRange ? ` (de ${q.zRange[0].toFixed(2)} à ${q.zRange[1].toFixed(2)} m)` : ''}. Étendue : ${(q.extent[2] - q.extent[0]).toFixed(1)} m × ${(q.extent[3] - q.extent[1]).toFixed(1)} m.`),
    )
    if (!q.anomalies.length) s2.append(h('div', { class: 'note ok' }, 'Aucune anomalie détectée (doublons, coordonnées nulles ou aberrantes, altitudes suspectes).'))
    for (const a of q.anomalies) s2.append(h('div', { class: 'note ' + (a.level === 'erreur' ? 'err' : a.level === 'alerte' ? 'warn' : '') }, a.message))
    s2.append(h('p', { class: 'muted' }, 'Aucune donnée n’est corrigée ni supprimée automatiquement : corrigez le fichier source si nécessaire.'))
    root.append(s2)

    // 3. Système de coordonnées
    const s3 = h('section', null, h('h3', null, '3 · Système de coordonnées'))
    const crsOptions: [string, string][] = candidates.slice(0, 8).map((c) => [c.def.code, `${c.def.name} — ${c.def.area}`])
    crsOptions.push(['', 'Coordonnées locales (non géoréférencées)'])
    s3.append(field('Système du levé', select(crsOptions, crs ?? '', (v) => (crs = v || null)), candidates.length ? 'Proposition déduite des coordonnées et de votre région — à confirmer. Les coordonnées ne sont jamais converties sans votre accord.' : 'Aucun système reconnu : coordonnées traitées comme locales.'))
    root.append(s3)

    // 4. Codes
    const summary = summarizeCodes(f.points, rules)
    const s4 = h('section', null, h('h3', null, '4 · Codes terrain'))
    const ruleOptions: [string, string][] = [['', 'Point simple (non relié)'], ...rules.map((r): [string, string] => [r.code, `${r.label} (${r.kind})`])]
    s4.append(
      h(
        'div',
        { class: 'scroll' },
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Code du fichier'), h('th', null, 'Points'), h('th', null, 'Interprété comme'), h('th', null, 'Reconnaissance'))),
          h(
            'tbody',
            null,
            ...summary.map((c) =>
              h(
                'tr',
                null,
                h('td', null, c.raw || '(vide)'),
                h('td', null, c.count),
                h(
                  'td',
                  null,
                  c.raw
                    ? select(ruleOptions, c.match.quality === 'inconnu' ? '' : c.match.rule.code, (v) => {
                        // Le choix de l'utilisateur est mémorisé comme synonyme dans son dictionnaire.
                        const key = c.raw.toUpperCase().replace(/\d+$/, '')
                        for (const r of rules) r.synonyms = r.synonyms.filter((s) => s !== key)
                        const target = rules.find((r) => r.code === v)
                        if (target && target.code !== key) target.synonyms.push(key)
                        saveRules(rules)
                        render()
                      })
                    : 'Point levé',
                ),
                h('td', null, h('span', { class: 'badge ' + (c.match.quality === 'exact' ? 'ok' : c.match.quality === 'approx' ? 'warn' : c.match.quality === 'inconnu' ? 'err' : '') }, { exact: 'certaine', approx: 'approchée — à confirmer', inconnu: 'code inconnu', vide: 'sans code' }[c.match.quality])),
              ),
            ),
          ),
        ),
      ),
      h('p', { class: 'muted' }, 'Les points de même code sont reliés dans l’ordre du fichier (ou par suffixe : BAT1, BAT2…). Deux points ne sont jamais reliés seulement parce qu’ils sont proches. Vos choix sont mémorisés dans votre dictionnaire.'),
      h('div', { class: 'actions' }, h('button', { onclick: () => {
        rules = DEFAULT_RULES.map((r) => ({ ...r, synonyms: [...r.synonyms] }))
        saveRules(rules)
        render()
      } }, 'Réinitialiser le dictionnaire')),
    )
    root.append(s4)

    // 5. Plan
    const s5 = h('section', null, h('h3', null, '5 · Plan à produire'))
    const instruction = h('textarea', { rows: 2, value: instructionText, placeholder: 'Exemple : plan topographique et altimétrique au 1/500, format A3 paysage, courbes de niveau tous les 0,50 m, avec le tableau des coordonnées', oninput: () => (instructionText = instruction.value) })
    const understoodBox = h('div')
    const showUnderstood = () => {
      understoodBox.replaceChildren()
      if (understood) understoodBox.append(h('div', { class: 'note ' + (understood.summary.length ? 'ok' : 'warn') }, understood.summary.length ? 'Compris : ' + understood.summary.join(' ; ') + '.' : 'Aucune consigne reconnue dans cette phrase (échelle, format, courbes, parcellaire, numéros, altitudes, tableau, légende).'))
    }
    s5.append(
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
      ),
      h(
        'div',
        { class: 'row' },
        checkbox('Numéros de points', options.showIds, (v) => (options.showIds = v)),
        checkbox('Altitudes', options.showZ, (v) => (options.showZ = v)),
        checkbox('Descriptions', options.showCodes, (v) => (options.showCodes = v)),
        checkbox('Parcelle par les bornes', options.parcel, (v) => (options.parcel = v)),
        checkbox('Longueurs des côtés', options.sideLengths, (v) => (options.sideLengths = v)),
        checkbox('Triangulation visible', options.showTin, (v) => (options.showTin = v)),
        checkbox('Lisser les courbes', options.smoothContours, (v) => (options.smoothContours = v)),
      ),
    )
    showUnderstood()
    root.append(s5)

    root.append(h('div', { class: 'actions' }, button))
    updateButton()
  }

  const button = h('button', { class: 'primary', onclick: () => generate() }, 'Analyser et générer mon plan')
  const updateButton = () => {
    button.disabled = !file || !file.points.length || (file.questions.length > 0 && !confirmed)
    button.title = button.disabled ? 'Confirmez d’abord l’interprétation des colonnes' : ''
  }

  const generate = () => {
    if (!file) return
    const plan = generatePlan(file.points, rules, options, name.replace(/\.[^.]+$/, '') + '_plan')
    plan.dataset.crs = crs
    plan.dataset.crsSource = crs ? 'user' : 'none'
    plan.dataset.meta.source = name
    if (existing && project.items.includes(existing)) project.replace(existing, plan.dataset, plan)
    else existing = project.add(plan.dataset, plan)
    close()
    onDone({ item: existing, plan, paper: understood?.paper, landscape: understood?.landscape, scale: options.scale, showTable: understood?.showTable, showLegend: understood?.showLegend })
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
