/**
 * Commandes avancées inspirées des enchaînements AutoCAD et des logiciels de topographie
 * et de VRD : ajuster, prolonger, raccorder ; talus, carroyage, implantation, division de
 * parcelle ; cubatures et profil en long sur le MNT. Chaque commande porte sa fiche de
 * mode d'emploi, reprise telle quelle dans le manuel intégré.
 */
import type { Item } from '../core/project'
import { FOREGROUND, type Color, type EText, type Entity } from '../core/types'
import { cutFill, divideParallel, dividePivot, drape, gridStep, gridValues, longProfile, signedArea, stakeout, tabulate, talusHachures, type Division } from '../topo/calc'
import { formatArea } from '../topo/sheet'
import { buildTin } from '../topo/tin'
import { points3d } from './commands'
import { edgePrims, extendEntity, filletLines, filletPolyline, toPrims, trimEntity, type Prim } from './curves'
import { fmt, type CommandDef, type Editor, type Keyword } from './editor'
import { centroid, closedRing, vertices, type Pt } from './ops'
import { isEditable, toProjectFn, type Selection } from './query'

const BYLAYER: Color = -1

const yesNo: Keyword[] = [
  ['O', 'Oui'],
  ['N', 'Non'],
]

/** Arêtes de coupe ou limites : objets désignés, ou tous les objets visibles modifiables. */
function collectEdges(ed: Editor, chosen: Set<Entity> | null, exclude: Entity): Prim[] {
  const out: Prim[] = []
  if (chosen) {
    for (const e of chosen) if (e !== exclude) out.push(...edgePrims(e))
    return out
  }
  for (const item of ed.project.items) {
    if (!item.ds.visible || !isEditable(ed.project, item)) continue
    for (const e of item.ds.entities) {
      if (e === exclude || item.ds.layers.get(e.layer)?.visible === false) continue
      out.push(...edgePrims(e))
    }
  }
  return out
}

/** Contour fermé d'un objet, ramené dans les coordonnées du projet. */
function ringOf(ed: Editor, s: Selection): number[] | null {
  const ring = closedRing(ed.entity(s))
  if (!ring) return null
  if (isEditable(ed.project, s.item)) return ring
  const toP = toProjectFn(ed.project, s.item)
  const out: number[] = []
  for (let i = 0; i < ring.length; i += 2) out.push(...toP(ring[i], ring[i + 1]))
  return out
}

function text(layer: string, x: number, y: number, h: number, s: string, ha: 0 | 1 | 2 = 0, va: 0 | 1 | 2 | 3 = 2, rot = 0): EText {
  return { t: 'text', layer, color: BYLAYER, x, y, h, rot, text: s, ha, va }
}

/** Tableau simple (cadre, lignes, colonnes, textes) dont le coin supérieur gauche est `at`. */
function table(layer: string, at: Pt, k: number, title: string, head: string[], widths: number[], rows: string[][]): Entity[] {
  const W = widths.reduce((a, b) => a + b, 0)
  const rowH = 5 * k
  const H = rowH * (rows.length + 2)
  const [x0, y0] = at
  const b = { layer, color: BYLAYER }
  const ents: Entity[] = [{ t: 'pline', ...b, pts: Float64Array.from([x0, y0, x0 + W, y0, x0 + W, y0 - H, x0, y0 - H]), closed: true }]
  for (let r = 1; r < rows.length + 2; r++) ents.push({ t: 'line', ...b, x1: x0, y1: y0 - r * rowH, x2: x0 + W, y2: y0 - r * rowH })
  let x = x0
  for (let c = 0; c < widths.length - 1; c++) {
    x += widths[c]
    ents.push({ t: 'line', ...b, x1: x, y1: y0 - rowH, x2: x, y2: y0 - H })
  }
  ents.push(text(layer, x0 + W / 2, y0 - rowH / 2, 2 * k, title, 1))
  x = x0
  head.forEach((hd, c) => {
    ents.push(text(layer, x + widths[c] / 2, y0 - rowH * 1.5, 1.8 * k, hd, 1))
    x += widths[c]
  })
  rows.forEach((row, r) => {
    let cx = x0
    row.forEach((cell, c) => {
      const numeric = /^-?[\d .,]+$/.test(cell)
      ents.push(text(layer, numeric ? cx + widths[c] - 1.2 * k : cx + widths[c] / 2, y0 - rowH * (r + 2.5), 1.8 * k, cell, numeric ? 2 : 1))
      cx += widths[c]
    })
  })
  return ents
}

function tableSize(widths: number[], rows: number, k: number): [number, number] {
  return [widths.reduce((a, b) => a + b, 0), 5 * k * (rows + 2)]
}

/** Nom lisible d'un point (matricule d'un point topographique, sinon numéro). */
function pointName(e: Entity, fallback: string): string {
  const p = e.props
  const fromProps = p?.MAT ?? p?.NUM ?? p?.NOM ?? p?.name ?? p?.id
  if (fromProps !== undefined && fromProps !== null && String(fromProps)) return String(fromProps)
  if (e.t === 'insert') {
    const a = e.attribs?.find((x) => x.tag === 'MAT') ?? e.attribs?.[0]
    if (a?.text) return a.text
  }
  return fallback
}

function downloadText(ed: Editor, name: string, content: string): void {
  ed.actions.downloadText?.(JSON.stringify({ name, content }))
}

let lastFillet = 0
let lastDivision: 'P' | 'O' = 'P'

export const ADVANCED_COMMANDS: CommandDef[] = [
  // --- Modification -------------------------------------------------------------------
  {
    id: 'AJUSTER',
    label: 'Ajuster (couper)',
    aliases: ['AJ', 'TR', 'TRIM', 'COUPER'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'trim',
    tip: 'Coupe la partie d’une ligne, polyligne, arc ou cercle comprise entre deux arêtes de coupe (ou jusqu’à son extrémité).',
    steps: [
      'Désignez les arêtes de coupe puis Entrée, ou Entrée tout de suite : tous les objets visibles servent d’arêtes.',
      'Cliquez la partie à supprimer : elle disparaît jusqu’aux intersections les plus proches.',
      'Recommencez sur d’autres objets ; Entrée pour terminer. Ctrl+Z annule une coupe.',
    ],
    async run(ed) {
      const edges = await ed.select('Arêtes de coupe (Entrée = tous les objets)', { editable: false, allowEmpty: true })
      const chosen = edges.length ? new Set(edges.map((s) => ed.entity(s))) : null
      for (;;) {
        const [s] = await ed.select('Cliquez la partie à supprimer (Entrée pour terminer)', { single: true, filter: (x) => !!toPrims(ed.entity(x)) })
        const target = ed.entity(s)
        const pick = ed.lastPick ?? ed.cursor
        if (!pick) continue
        const res = trimEntity(target, collectEdges(ed, chosen, target), pick)
        if (res === null) {
          ed.message('Aucune arête de coupe ne croise cette partie de l’objet : utilisez Effacer pour le supprimer entièrement.')
          continue
        }
        ed.modify('Ajuster', new Map([[s.item, { remove: new Set([s.entity]), add: res }]]))
        if (chosen?.has(target)) {
          chosen.delete(target)
          for (const e of res) chosen.add(e)
        }
      }
    },
  },
  {
    id: 'PROLONGER',
    label: 'Prolonger',
    aliases: ['PRO', 'EX', 'EXTEND', 'ETIRER'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'extend',
    tip: 'Allonge une ligne ou l’extrémité droite d’une polyligne jusqu’à la première limite rencontrée.',
    steps: [
      'Désignez les objets limites puis Entrée, ou Entrée tout de suite : tous les objets visibles servent de limites.',
      'Cliquez l’objet près de l’extrémité à prolonger.',
      'Recommencez ; Entrée pour terminer.',
    ],
    async run(ed) {
      const edges = await ed.select('Objets limites (Entrée = tous les objets)', { editable: false, allowEmpty: true })
      const chosen = edges.length ? new Set(edges.map((s) => ed.entity(s))) : null
      for (;;) {
        const [s] = await ed.select('Cliquez près de l’extrémité à prolonger (Entrée pour terminer)', { single: true, filter: (x) => { const e = ed.entity(x); return e.t === 'line' || (e.t === 'pline' && !e.closed) } })
        const target = ed.entity(s)
        const pick = ed.lastPick ?? ed.cursor
        if (!pick) continue
        const res = extendEntity(target, collectEdges(ed, chosen, target), pick)
        if (!res) {
          ed.message('Aucune limite dans le prolongement de cette extrémité (ou extrémité en arc).')
          continue
        }
        ed.modify('Prolonger', new Map([[s.item, { replace: new Map([[s.entity, res]]) }]]))
        if (chosen?.has(target)) {
          chosen.delete(target)
          chosen.add(res)
        }
      }
    },
  },
  {
    id: 'RACCORD',
    label: 'Raccord (congé)',
    aliases: ['RA', 'CONGE', 'FILLET'],
    menu: 'Modification',
    ribbon: ['Début', 'Modification'],
    icon: 'fillet',
    tip: 'Raccorde deux lignes par un arc tangent de rayon donné (rayon 0 : angle vif, les lignes sont coupées ou prolongées jusqu’à leur intersection), ou arrondit tous les angles d’une polyligne.',
    steps: [
      'Tapez le rayon (0 pour joindre les deux lignes en angle vif).',
      'Choisissez D (deux lignes) ou P (tous les sommets d’une polyligne).',
      'Deux lignes : cliquez chaque ligne du côté à conserver.',
      'Polyligne : cliquez-la ; les sommets où le rayon ne tient pas restent anguleux.',
    ],
    async run(ed) {
      const r = await ed.number('Rayon du raccord (0 = angle vif)', lastFillet)
      if (r < 0) throw new Error('Le rayon doit être positif ou nul.')
      lastFillet = r
      const mode = await ed.choice('Raccorder', [['D', 'Deux lignes'], ['P', 'Polyligne']], 'D')
      if (mode === 'P') {
        const [s] = await ed.select('Sélectionnez la polyligne', { single: true, filter: (x) => { const e = ed.entity(x); return (e.t === 'pline' && !e.bulges?.some((b) => b !== 0)) || e.t === 'polygon' } })
        const v = vertices(ed.entity(s))
        if (!v) return
        const src = ed.entity(s)
        const res = filletPolyline(v.pts, v.closed, r)
        const e: Entity = { t: 'pline', layer: src.layer, color: src.color, ...(src.props ? { props: src.props } : {}), pts: Float64Array.from(res.pts), bulges: Float64Array.from(res.bulges), closed: v.closed }
        ed.modify('Raccord de polyligne', new Map([[s.item, { replace: new Map([[s.entity, e]]) }]]))
        ed.message(`${res.done} angle(s) arrondi(s)${res.skipped ? `, ${res.skipped} laissé(s) tel(s) quel(s) : rayon trop grand pour les segments` : ''}.`)
        return
      }
      const isLine = (x: Selection) => ed.entity(x).t === 'line'
      const [s1] = await ed.select('Première ligne (côté à conserver)', { single: true, filter: isLine })
      const p1 = ed.lastPick ?? ed.cursor!
      const [s2] = await ed.select('Seconde ligne (côté à conserver)', { single: true, filter: (x) => isLine(x) && !(x.item === s1.item && x.entity === s1.entity) })
      const p2 = ed.lastPick ?? ed.cursor!
      const e1 = ed.entity(s1)
      const e2 = ed.entity(s2)
      if (e1.t !== 'line' || e2.t !== 'line') return
      const res = filletLines([[e1.x1, e1.y1], [e1.x2, e1.y2]], p1, [[e2.x1, e2.y1], [e2.x2, e2.y2]], p2, r)
      if (typeof res === 'string') throw new Error(res)
      const n1: Entity = { ...e1, x1: res.a[0][0], y1: res.a[0][1], x2: res.a[1][0], y2: res.a[1][1], z1: undefined, z2: undefined }
      const n2: Entity = { ...e2, x1: res.b[0][0], y1: res.b[0][1], x2: res.b[1][0], y2: res.b[1][1], z1: undefined, z2: undefined }
      const changes = new Map<Item, { replace: Map<number, Entity>; add?: Entity[] }>()
      changes.set(s1.item, { replace: new Map([[s1.entity, n1]]) })
      const c2 = changes.get(s2.item)
      if (c2) c2.replace.set(s2.entity, n2)
      else changes.set(s2.item, { replace: new Map([[s2.entity, n2]]) })
      if (res.arc) changes.get(s1.item)!.add = [{ t: 'arc', layer: e1.layer, color: e1.color, ...res.arc }]
      ed.modify('Raccord', changes)
      if (!res.arc) ed.message(`Angle vif : lignes jointes en X ${res.a[1][0].toFixed(3)} · Y ${res.a[1][1].toFixed(3)}.`)
      if (res.arc) {
        const sweep = (((res.arc.a1 - res.arc.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        ed.message(`Raccord de rayon ${fmt(r)} m, longueur d’arc ${(res.arc.r * sweep).toFixed(3)} m.`)
      }
    },
  },
  // --- Topo 2D : habillage --------------------------------------------------------------
  {
    id: 'TALUS',
    label: 'Talus',
    aliases: ['TAL', 'HACHTALUS'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Habillage'],
    icon: 'talus',
    tip: 'Dessine les hachures normalisées d’un talus entre sa crête (haut) et son pied (bas) : traits longs et courts alternés, perpendiculaires à la crête.',
    steps: ['Cliquez la ligne de crête (haut du talus).', 'Cliquez la ligne de pied (bas du talus).', 'Validez l’espacement proposé (adapté à l’échelle du plan) et la longueur des traits courts.', 'Les hachures sont créées sur le calque TALUS.'],
    async run(ed) {
      const lin = (x: Selection) => !!vertices(ed.entity(x)) && ed.entity(x).t !== 'polygon'
      const [a] = await ed.select('Ligne de crête (haut du talus)', { single: true, filter: lin, editable: false })
      const [b] = await ed.select('Ligne de pied (bas du talus)', { single: true, filter: (x) => lin(x) && !(x.item === a.item && x.entity === a.entity), editable: false })
      const conv = (s: Selection) => {
        const v = vertices(ed.entity(s))!
        const toP = toProjectFn(ed.project, s.item)
        const out: number[] = []
        for (let i = 0; i < v.pts.length; i += 2) out.push(...toP(v.pts[i], v.pts[i + 1]))
        if (v.closed) out.push(out[0], out[1])
        return out
      }
      const spacing = await ed.number('Espacement des hachures (m)', Number((2 * ed.k).toFixed(2)), { positive: true })
      const short = await ed.number('Longueur des traits courts (fraction du talus)', 0.5, { positive: true })
      const segs = talusHachures(conv(a), conv(b), spacing, Math.min(1, short))
      if (!segs.length) throw new Error('Aucune hachure : vérifiez les deux lignes.')
      ed.add('Talus', segs.map((s) => ({ t: 'line', layer: 'TALUS', color: BYLAYER, x1: s[0], y1: s[1], x2: s[2], y2: s[3] }) as Entity), { layers: [['TALUS', 0xa0522d]] })
      ed.message(`${segs.length} hachure(s) de talus dessinée(s).`)
    },
  },
  {
    id: 'CARROYAGE',
    label: 'Carroyage (quadrillage)',
    aliases: ['CAR', 'GRILLE', 'QUADRILLAGE'],
    menu: 'Topo 2D',
    ribbon: ['Topographie', 'Habillage'],
    icon: 'grid',
    tip: 'Dessine dans le dessin un quadrillage de coordonnées (croisillons ou lignes) avec les valeurs X et Y écrites en bordure.',
    steps: ['Cliquez deux coins opposés de la zone à quadriller.', 'Validez le pas proposé (au plus 10 cm sur le papier) ou tapez le vôtre.', 'Choisissez C (croisillons) ou L (lignes continues).'],
    async run(ed) {
      const a = await ed.getPoint('Premier coin de la zone')
      const b = await ed.getPoint('Coin opposé', { base: a, noSnap: true, preview: (c) => ({ lines: [[a[0], a[1], c[0], a[1], c[0], c[1], a[0], c[1]]], closed: [true] }) })
      const x0 = Math.min(a[0], b[0])
      const x1 = Math.max(a[0], b[0])
      const y0 = Math.min(a[1], b[1])
      const y1 = Math.max(a[1], b[1])
      if (x1 - x0 <= 0 || y1 - y0 <= 0) throw new Error('Zone vide.')
      const step = await ed.number('Pas du quadrillage (m)', gridStep(x1 - x0, y1 - y0, ed.docScale), { positive: true })
      const style = await ed.choice('Style', [['C', 'Croisillons'], ['L', 'Lignes']], 'C')
      const xs = gridValues(x0, x1, step)
      const ys = gridValues(y0, y1, step)
      if (!xs.length || !ys.length || xs.length * ys.length > 40000) throw new Error('Pas inadapté à la zone.')
      const k = ed.k
      const L = 'CARROYAGE'
      const ents: Entity[] = [{ t: 'pline', layer: L, color: BYLAYER, pts: Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1]), closed: true }]
      if (style === 'L') {
        for (const x of xs) ents.push({ t: 'line', layer: L, color: BYLAYER, x1: x, y1: y0, x2: x, y2: y1 })
        for (const y of ys) ents.push({ t: 'line', layer: L, color: BYLAYER, x1: x0, y1: y, x2: x1, y2: y })
      } else {
        const arm = 2.5 * k
        for (const x of xs) for (const y of ys) ents.push({ t: 'line', layer: L, color: BYLAYER, x1: x - arm, y1: y, x2: x + arm, y2: y }, { t: 'line', layer: L, color: BYLAYER, x1: x, y1: y - arm, x2: x, y2: y + arm })
      }
      const dec = step < 1 ? 2 : 0
      for (const x of xs) ents.push(text(L, x, y0 - 1.5 * k, 1.8 * k, x.toFixed(dec), 1, 3))
      for (const y of ys) ents.push(text(L, x0 - 1.5 * k, y, 1.8 * k, y.toFixed(dec), 1, 3, Math.PI / 2))
      ed.add('Carroyage', ents, { layers: [[L, 0x808080]] })
      ed.message(`Carroyage de ${fmt(step)} m : ${xs.length} × ${ys.length} intersections.`)
    },
  },
  // --- Calculs ---------------------------------------------------------------------------
  {
    id: 'IMPLANTATION',
    label: 'Implantation (station, gisement, distance)',
    aliases: ['IMP', 'IMPL', 'STAKEOUT'],
    menu: 'Topo Calculs',
    ribbon: ['Topographie', 'Calculs'],
    icon: 'stakeout',
    tip: 'Prépare l’implantation de points depuis une station : gisement, distance horizontale et lecture d’angle par rapport à une référence ; tableau sur le plan et carnet CSV.',
    steps: [
      'Cliquez la station (point connu où sera l’appareil).',
      'Cliquez le point de référence (orientation, lu à 0 gr), ou Entrée s’il n’y en a pas.',
      'Désignez les points à implanter (points topo, sommets de polylignes ou de parcelles) puis Entrée.',
      'Placez le tableau d’implantation ; le carnet CSV peut aussi être téléchargé.',
    ],
    async run(ed) {
      const st = await ed.getPoint('Station')
      const r = await ed.point('Point de référence (orientation) — Entrée = aucun', { base: st })
      const ref = Array.isArray(r) ? r : null
      const sel = await ed.select('Points à implanter', { editable: false, filter: (x) => ['insert', 'point', 'pline', 'polygon', 'line'].includes(ed.entity(x).t) })
      const pts: { name: string; x: number; y: number }[] = []
      let n = 1
      for (const s of sel) {
        const e = ed.entity(s)
        const toP = toProjectFn(ed.project, s.item)
        if (e.t === 'insert' || e.t === 'point') {
          const p = toP(e.x, e.y)
          pts.push({ name: pointName(e, 'P' + n++), x: p[0], y: p[1] })
        } else {
          const v = vertices(e)
          if (!v) continue
          for (let i = 0; i < v.pts.length; i += 2) {
            const p = toP(v.pts[i], v.pts[i + 1])
            if (!pts.some((q) => Math.abs(q.x - p[0]) < 1e-4 && Math.abs(q.y - p[1]) < 1e-4)) pts.push({ name: 'S' + n++, x: p[0], y: p[1] })
          }
        }
      }
      if (!pts.length) throw new Error('Aucun point à implanter.')
      const rows = stakeout(st, ref, pts)
      const head = ['Point', 'X', 'Y', 'Gisement (gr)', 'Distance (m)', ...(ref ? ['Lecture Hz (gr)'] : [])]
      const k = ed.k
      const widths = [14 * k, 24 * k, 24 * k, 20 * k, 18 * k, ...(ref ? [20 * k] : [])]
      const cells = rows.map((q) => [q.name, q.x.toFixed(3), q.y.toFixed(3), q.gisement.toFixed(4), q.distance.toFixed(3), ...(q.hz !== null ? [q.hz.toFixed(4)] : [])])
      for (const q of rows) ed.message(`${q.name} : G = ${q.gisement.toFixed(4)} gr · Dh = ${q.distance.toFixed(3)} m${q.hz !== null ? ` · Hz = ${q.hz.toFixed(4)} gr` : ''}`)
      if ((await ed.choice('Dessiner le tableau d’implantation ?', yesNo, 'O')) === 'O') {
        const [W, H] = tableSize(widths, rows.length, k)
        const at = await ed.getPoint('Coin supérieur gauche du tableau', { noSnap: true, preview: (c) => ({ lines: [[c[0], c[1], c[0] + W, c[1], c[0] + W, c[1] - H, c[0], c[1] - H]], closed: [true] }) })
        const title = `Implantation depuis la station X ${st[0].toFixed(3)} Y ${st[1].toFixed(3)}${ref ? ' (référence à 0 gr)' : ''}`
        const visees: Entity[] = (await ed.choice('Tracer les lignes de visée ?', yesNo, 'N')) === 'O' ? rows.map((q) => ({ t: 'line', layer: 'IMPLANTATION', color: BYLAYER, x1: st[0], y1: st[1], x2: q.x, y2: q.y }) as Entity) : []
        ed.add('Tableau d’implantation', [...table('TABLEAUX', at, k, title, head, widths, cells), ...visees], { layers: [['TABLEAUX', FOREGROUND], ['IMPLANTATION', 0x00a0ff]] })
      }
      if ((await ed.choice('Télécharger le carnet d’implantation (CSV) ?', yesNo, 'N')) === 'O') {
        const csv = [head.join(';'), ...cells.map((c) => c.join(';'))].join('\n')
        downloadText(ed, 'implantation.csv', `Station;${st[0].toFixed(3)};${st[1].toFixed(3)}\n${ref ? `Reference;${ref[0].toFixed(3)};${ref[1].toFixed(3)}\n` : ''}${csv}\n`)
      }
    },
  },
  {
    id: 'DIVPARC',
    label: 'Division de parcelle',
    aliases: ['DIV', 'DIVISION', 'MORCELLEMENT'],
    menu: 'Topo 2D',
    ribbon: ['Projets', 'Parcelles'],
    icon: 'divide',
    tip: 'Détache d’une parcelle une surface exacte, par une ligne parallèle à une direction ou pivotant autour d’un point (borne).',
    steps: [
      'Cliquez la parcelle (objet fermé) : sa surface s’affiche.',
      'Tapez la surface à détacher en m².',
      'Choisissez P (parallèle à une direction) ou O (pivot autour d’un point).',
      'Parallèle : cliquez deux points de la direction (par exemple un côté de la parcelle) ; la bande détachée part de ce côté.',
      'Pivot : cliquez le point fixe puis un point indiquant à peu près la direction de la ligne ; la partie détachée est à gauche de la ligne.',
      'Les deux nouvelles parcelles, la ligne de division et les surfaces sont dessinées ; la parcelle d’origine est conservée.',
    ],
    async run(ed) {
      const [s] = await ed.select('Parcelle à diviser', { single: true, editable: false, filter: (x) => !!closedRing(ed.entity(x)) })
      const ring = ringOf(ed, s)
      if (!ring) return
      const total = Math.abs(signedArea(ring))
      ed.message(`Surface de la parcelle : ${total.toFixed(2)} m² (${formatArea(total)}).`)
      const target = await ed.number(`Surface à détacher (m², moins de ${total.toFixed(2)})`, undefined, { positive: true })
      const method = (await ed.choice('Méthode', [['P', 'Parallèle'], ['O', 'pivOt']], lastDivision)) as 'P' | 'O'
      lastDivision = method
      let res: Division | string
      if (method === 'P') {
        const a = await ed.getPoint('Premier point de la direction')
        const b = await ed.getPoint('Second point de la direction', { base: a })
        res = divideParallel(ring, a, b, target)
      } else {
        const f = await ed.getPoint('Point fixe (pivot)')
        const t = await ed.getPoint('Direction approximative de la ligne de division', { base: f })
        res = dividePivot(ring, f, t, target)
      }
      if (typeof res === 'string') throw new Error(res)
      const k = ed.k
      const L = 'DIVISION'
      const ents: Entity[] = [
        { t: 'pline', layer: L, color: BYLAYER, pts: Float64Array.from(res.part), closed: true, props: { SURFACE: Number(res.partArea.toFixed(2)) } },
        { t: 'pline', layer: L, color: BYLAYER, pts: Float64Array.from(res.rest), closed: true, props: { SURFACE: Number(res.restArea.toFixed(2)) } },
        ...res.cut.map((c) => ({ t: 'line', layer: 'DIVISION_LIGNE', color: BYLAYER, x1: c[0], y1: c[1], x2: c[2], y2: c[3] }) as Entity),
      ]
      const label = (r: number[], area: number) => {
        const c = centroid(r)
        ents.push(text('SURFACES', c[0], c[1], 3 * k, `S = ${formatArea(area)}`, 1, 2))
      }
      label(res.part, res.partArea)
      label(res.rest, res.restArea)
      ed.add('Division de parcelle', ents, { layers: [[L, 0xff00ff], ['DIVISION_LIGNE', 0xff0000], ['SURFACES', FOREGROUND]] })
      const len = res.cut.reduce((a, c) => a + Math.hypot(c[2] - c[0], c[3] - c[1]), 0)
      const msg = `Partie détachée : ${res.partArea.toFixed(2)} m² · reste : ${res.restArea.toFixed(2)} m² · longueur de la ligne de division : ${len.toFixed(2)} m.`
      ed.message(msg)
      ed.actions.notify?.(msg)
    },
  },
  // --- Projets : terrain --------------------------------------------------------------
  {
    id: 'CUBATURES',
    label: 'Cubatures (déblai, remblai)',
    aliases: ['CUB', 'VOLUME', 'CUBATURE'],
    menu: 'Projets',
    ribbon: ['Projets', 'Volumes'],
    icon: 'volume',
    tip: 'Calcule les volumes de déblai et de remblai entre le terrain (MNT des points cotés visibles) et une plateforme horizontale, sur tout le MNT ou dans un contour.',
    steps: [
      'Affichez les points cotés du terrain naturel.',
      'Tapez l’altitude de la plateforme (projet).',
      'Choisissez T (tout le MNT) ou O (contour : cliquez un objet fermé).',
      'Le résultat s’affiche ; il peut être inscrit sur le plan. La partie d’un contour hors du MNT n’est pas calculée et est signalée.',
    ],
    async run(ed) {
      const pts = points3d(ed)
      const tin = buildTin(pts)
      if (!tin) throw new Error(`Il faut au moins trois points cotés visibles (trouvés : ${pts.length}).`)
      let zsum = 0
      for (const z of tin.zs) zsum += z
      const platform = await ed.number('Altitude de la plateforme (m)', Number((zsum / tin.zs.length).toFixed(2)))
      const where = await ed.choice('Zone', [['T', 'Tout le MNT'], ['O', 'Objet fermé']], 'T')
      let boundary: number[] | undefined
      if (where === 'O') {
        const [s] = await ed.select('Contour de la plateforme', { single: true, editable: false, filter: (x) => !!closedRing(ed.entity(x)) })
        boundary = ringOf(ed, s) ?? undefined
      }
      const r = cutFill(tin, platform, boundary)
      const lines = [
        `Plateforme : ${platform.toFixed(2)} m`,
        `Surface traitée : ${r.area.toFixed(2)} m²`,
        `Déblai : ${r.cut.toFixed(3)} m³`,
        `Remblai : ${r.fill.toFixed(3)} m³`,
        `Solde : ${(r.cut - r.fill).toFixed(3)} m³ (${r.cut >= r.fill ? 'excédent de déblai' : 'apport nécessaire'})`,
      ]
      if (r.uncovered > 0) lines.push(`Hors MNT, non calculé : ${r.uncovered.toFixed(2)} m²`)
      for (const l of lines) ed.message(l)
      ed.actions.notify?.(lines.join(' · '))
      if ((await ed.choice('Inscrire le résultat sur le plan ?', yesNo, 'O')) !== 'O') return
      const k = ed.k
      const widths = [40 * k, 30 * k]
      const rows = lines.map((l) => {
        const i = l.indexOf(' : ')
        return [l.slice(0, i), l.slice(i + 3)]
      })
      const [W, H] = tableSize(widths, rows.length, k)
      const at = await ed.getPoint('Coin supérieur gauche du tableau', { noSnap: true, preview: (c) => ({ lines: [[c[0], c[1], c[0] + W, c[1], c[0] + W, c[1] - H, c[0], c[1] - H]], closed: [true] }) })
      const ents = table('TABLEAUX', at, k, 'Cubatures', ['Désignation', 'Valeur'], widths, rows)
      if (boundary) ents.push({ t: 'pline', layer: 'PLATEFORME', color: BYLAYER, pts: Float64Array.from(boundary), closed: true, elev: platform })
      ed.add('Cubatures', ents, { layers: [['TABLEAUX', FOREGROUND], ['PLATEFORME', 0xff7f00]] })
    },
  },
  {
    id: 'PROFILLONG',
    label: 'Profil en long',
    aliases: ['PFL', 'PROFIL', 'PROFILEN'],
    menu: 'Projets',
    ribbon: ['Projets', 'Terrain'],
    icon: 'profile',
    tip: 'Dessine le profil en long du terrain naturel le long d’un axe (ligne ou polyligne), avec plan de comparaison, exagération verticale et guitare (altitudes, distances partielles et cumulées).',
    steps: [
      'Affichez les points cotés du terrain naturel.',
      'Cliquez l’axe (ligne ou polyligne, dans le sens de parcours voulu).',
      'Tapez le pas des points de la guitare (0 = sommets de l’axe et cassures du terrain uniquement).',
      'Validez l’exagération verticale (10 : échelle des hauteurs dix fois plus grande) et l’altitude du plan de comparaison.',
      'Cliquez l’emplacement du profil (origine du plan de comparaison).',
    ],
    async run(ed) {
      const pts = points3d(ed)
      const tin = buildTin(pts)
      if (!tin) throw new Error(`Il faut au moins trois points cotés visibles (trouvés : ${pts.length}).`)
      const [s] = await ed.select('Axe du profil', { single: true, editable: false, filter: (x) => { const e = ed.entity(x); return e.t === 'line' || e.t === 'pline' } })
      const v = vertices(ed.entity(s))!
      const toP = toProjectFn(ed.project, s.item)
      const axis: number[] = []
      for (let i = 0; i < v.pts.length; i += 2) axis.push(...toP(v.pts[i], v.pts[i + 1]))
      if (v.closed) axis.push(axis[0], axis[1])
      const e0 = ed.entity(s)
      if (e0.t === 'pline' && e0.bulges?.some((b) => b !== 0)) ed.message('Les arcs de l’axe sont remplacés par leurs cordes pour le profil.')
      const step = await ed.number('Pas des points de la guitare (m, 0 = cassures seules)', 0)
      const prof = longProfile(tin, axis, Math.max(0, step))
      const known = prof.filter((p) => p.z !== null)
      if (known.length < 2) throw new Error('L’axe ne traverse pas le MNT.')
      const zmin = Math.min(...known.map((p) => p.z!))
      const zmax = Math.max(...known.map((p) => p.z!))
      const ex = await ed.number('Exagération verticale', 10, { positive: true })
      const pc = await ed.number('Altitude du plan de comparaison (m)', Math.floor(zmin) - 1)
      const k = ed.k
      const L = prof[prof.length - 1].d
      const RH = 8 * k
      const W0 = 42 * k
      const top = (zmax - pc) * ex
      const o = await ed.getPoint('Origine du profil (plan de comparaison)', { noSnap: true, preview: (c) => ({ lines: [[c[0] - W0, c[1] + top, c[0] + L, c[1] + top, c[0] + L, c[1] - 3 * RH, c[0] - W0, c[1] - 3 * RH]], closed: [true] }) })
      const [ox, oy] = o
      const P = 'PROFIL'
      const ents: Entity[] = []
      const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => ents.push({ t: 'line', layer, color: BYLAYER, x1, y1, x2, y2 })
      // Cadre de la guitare et plan de comparaison
      for (let i = 0; i <= 3; i++) line(P, ox - W0, oy - i * RH, ox + L, oy - i * RH)
      for (const x of [ox - W0, ox, ox + L]) line(P, x, oy, x, oy - 3 * RH)
      const heads = ['Altitudes TN', 'Distances partielles', 'Distances cumulées']
      heads.forEach((t, i) => ents.push(text(P, ox - W0 + 1.5 * k, oy - (i + 0.5) * RH, 2 * k, t, 0, 2)))
      ents.push(text(P, ox - W0 + 1.5 * k, oy + 1.5 * k, 2 * k, `PC = ${pc.toFixed(2)} m`, 0, 0))
      // Terrain naturel (interrompu hors MNT)
      let run: number[] = []
      const flush = () => {
        if (run.length >= 4) ents.push({ t: 'pline', layer: 'PROFIL_TN', color: BYLAYER, pts: Float64Array.from(run), closed: false })
        run = []
      }
      for (const p of prof) {
        if (p.z === null) flush()
        else run.push(ox + p.d, oy + (p.z - pc) * ex)
      }
      flush()
      // Guitare : points retenus, sans chevauchement des textes verticaux
      const gap = 2.6 * k
      const chosen = prof.filter((p) => p.z !== null && (step > 0 ? p.kind !== 'mnt' : true))
      const shown: typeof prof = []
      for (const p of chosen) {
        const last = shown[shown.length - 1]
        if (!last || p.d - last.d >= gap || p === chosen[chosen.length - 1]) {
          if (last && p.d - last.d < gap) shown.pop()
          shown.push(p)
        }
      }
      shown.forEach((p, i) => {
        const x = ox + p.d
        line('PROFIL_RAPPELS', x, oy, x, oy + (p.z! - pc) * ex)
        line(P, x, oy - RH, x, oy - 2 * RH)
        ents.push(text(P, x, oy - 0.5 * RH, 1.6 * k, p.z!.toFixed(2), 1, 2, Math.PI / 2))
        ents.push(text(P, x, oy - 2.5 * RH, 1.6 * k, p.d.toFixed(2), 1, 2, Math.PI / 2))
        if (i > 0) {
          const q = shown[i - 1]
          const mid = ox + (p.d + q.d) / 2
          if (p.d - q.d >= 4 * k) ents.push(text(P, mid, oy - 1.5 * RH, 1.4 * k, (p.d - q.d).toFixed(2), 1, 2))
        }
      })
      ents.push(text(P, ox + L / 2, oy + top + 6 * k, 3 * k, `Profil en long — échelles H 1/${fmt(ed.docScale)} · V 1/${fmt(ed.docScale / ex)}`, 1, 2))
      ed.add('Profil en long', ents, { layers: [[P, FOREGROUND], ['PROFIL_TN', 0x00a000], ['PROFIL_RAPPELS', 0x808080]] })
      ed.message(`Profil en long : ${L.toFixed(2)} m, ${prof.length} points de terrain (${prof.filter((p) => p.z === null).length} hors MNT), altitudes ${zmin.toFixed(2)} à ${zmax.toFixed(2)} m.`)
    },
  },
  {
    id: 'PROFILTRAVERS',
    label: 'Profils en travers',
    aliases: ['PFT', 'TRAVERS', 'PROFILSTRAVERS'],
    menu: 'Projets',
    ribbon: ['Projets', 'Terrain'],
    icon: 'sections',
    tip: 'Tabule un axe et dessine les profils en travers du terrain naturel (vus dans le sens de l’axe, gauche à gauche), avec leurs traits repérés sur le plan.',
    steps: [
      'Affichez les points cotés du terrain naturel.',
      'Cliquez l’axe (ligne ou polyligne).',
      'Tapez le pas de tabulation (les sommets de l’axe sont toujours profilés) et la demi-largeur des profils.',
      'Validez l’exagération verticale (1 = même échelle que les longueurs).',
      'Cliquez l’emplacement de la planche : les profils sont rangés en lignes de quatre.',
    ],
    async run(ed) {
      const pts = points3d(ed)
      const tin = buildTin(pts)
      if (!tin) throw new Error(`Il faut au moins trois points cotés visibles (trouvés : ${pts.length}).`)
      const [s] = await ed.select('Axe', { single: true, editable: false, filter: (x) => { const e = ed.entity(x); return e.t === 'line' || e.t === 'pline' } })
      const v = vertices(ed.entity(s))!
      const toP = toProjectFn(ed.project, s.item)
      const axis: number[] = []
      for (let i = 0; i < v.pts.length; i += 2) axis.push(...toP(v.pts[i], v.pts[i + 1]))
      const step = await ed.number('Pas de tabulation (m)', 20, { positive: true })
      const half = await ed.number('Demi-largeur des profils (m)', 15, { positive: true })
      const ex = await ed.number('Exagération verticale', 1, { positive: true })
      const stations = tabulate(axis, step)
      if (stations.length > 300) throw new Error(`${stations.length} profils : augmentez le pas.`)
      const sections = stations.map((st) => {
        const L: Pt = [st.x + st.nx * half, st.y + st.ny * half]
        const R: Pt = [st.x - st.nx * half, st.y - st.ny * half]
        return { st, L, R, prof: longProfile(tin, [L[0], L[1], R[0], R[1]], 0) }
      })
      const valid = sections.filter((x) => x.prof.some((p) => p.z !== null))
      if (!valid.length) throw new Error('Aucun profil ne traverse le MNT.')
      const k = ed.k
      let hmax = 0
      for (const sec of valid) {
        const zs = sec.prof.filter((p) => p.z !== null).map((p) => p.z!)
        hmax = Math.max(hmax, (Math.max(...zs) - Math.floor(Math.min(...zs) - 1)) * ex)
      }
      const cellW = 2 * half + 20 * k
      const cellH = hmax + 22 * k
      const cols = 4
      const rows = Math.ceil(valid.length / cols)
      const o = await ed.getPoint('Coin supérieur gauche de la planche', { noSnap: true, preview: (c) => ({ lines: [[c[0], c[1], c[0] + cols * cellW, c[1], c[0] + cols * cellW, c[1] - rows * cellH, c[0], c[1] - rows * cellH]], closed: [true] }) })
      const P = 'PROFILS_TRAVERS'
      const ents: Entity[] = []
      const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => ents.push({ t: 'line', layer, color: BYLAYER, x1, y1, x2, y2 })
      valid.forEach((sec, i) => {
        const name = 'P' + (sections.indexOf(sec) + 1)
        // Trait du profil sur le plan
        line('TRAITS_PROFILS', sec.L[0], sec.L[1], sec.R[0], sec.R[1])
        ents.push(text('TRAITS_PROFILS', sec.L[0], sec.L[1], 1.8 * k, name, 1, 0, Math.atan2(sec.R[1] - sec.L[1], sec.R[0] - sec.L[0])))
        // Profil dessiné dans sa case
        const zs = sec.prof.filter((p) => p.z !== null).map((p) => p.z!)
        const pc = Math.floor(Math.min(...zs) - 1)
        const cx = o[0] + (i % cols) * cellW + 10 * k + half
        const by = o[1] - Math.floor(i / cols) * cellH - cellH + 12 * k
        line(P, cx - half, by, cx + half, by)
        line(P, cx, by, cx, by + (Math.max(...zs) - pc) * ex + 3 * k)
        let run: number[] = []
        const flush = () => {
          if (run.length >= 4) ents.push({ t: 'pline', layer: 'PROFILS_TRAVERS_TN', color: BYLAYER, pts: Float64Array.from(run), closed: false })
          run = []
        }
        for (const p of sec.prof) {
          if (p.z === null) flush()
          else run.push(cx - half + p.d, by + (p.z - pc) * ex)
        }
        flush()
        const zAxis = sec.prof.length ? elevationOnSection(sec.prof, half) : null
        ents.push(text(P, cx, by - 3 * k, 2 * k, `${name} — abscisse ${sec.st.s.toFixed(2)} m`, 1, 2))
        ents.push(text(P, cx - half, by + 1.2 * k, 1.5 * k, `PC ${pc.toFixed(2)}`, 0, 0))
        if (zAxis !== null) ents.push(text(P, cx + 1.2 * k, by + (zAxis - pc) * ex + 1.2 * k, 1.5 * k, `TN ${zAxis.toFixed(2)}`, 0, 0))
      })
      ed.add('Profils en travers', ents, { layers: [[P, FOREGROUND], ['PROFILS_TRAVERS_TN', 0x00a000], ['TRAITS_PROFILS', 0xff00ff]] })
      ed.message(`${valid.length} profil(s) en travers dessiné(s)${valid.length < sections.length ? ` ; ${sections.length - valid.length} hors MNT ignoré(s)` : ''}.`)
    },
  },
  {
    id: 'DRAPER',
    label: 'Transformation 2D → 3D (sur le MNT)',
    aliases: ['2D3D', 'DRAPE', 'PLAQUER'],
    menu: 'Topo 3D',
    ribbon: ['Topographie', 'Terrain'],
    icon: 'drape',
    tip: 'Donne aux lignes et polylignes 2D l’altitude du terrain (MNT des points cotés visibles) : polylignes 3D, avec si besoin les points de cassure du terrain.',
    steps: ['Affichez les points cotés.', 'Désignez les lignes ou polylignes puis Entrée.', 'Répondez Oui pour ajouter un sommet à chaque arête du MNT franchie (profil exact du terrain).', 'Un objet dont un sommet est hors du MNT est laissé tel quel (signalé).'],
    async run(ed) {
      const pts = points3d(ed)
      const tin = buildTin(pts)
      if (!tin) throw new Error(`Il faut au moins trois points cotés visibles (trouvés : ${pts.length}).`)
      const sel = await ed.select('Lignes ou polylignes à transformer', { filter: (x) => { const e = ed.entity(x); return e.t === 'line' || (e.t === 'pline' && !e.bulges?.some((b) => b !== 0)) } })
      const breaks = (await ed.choice('Ajouter les points de cassure du terrain ?', yesNo, 'O')) === 'O'
      const changes = new Map<Item, { replace: Map<number, Entity> }>()
      let done = 0
      let outside = 0
      for (const s of sel) {
        const e = ed.entity(s)
        const v = vertices(e)
        if (!v) continue
        const base = v.closed ? [...v.pts, v.pts[0], v.pts[1]] : v.pts
        const r = drape(tin, base, breaks)
        if (!r) {
          outside++
          continue
        }
        let p = r.pts
        let z = r.zs
        if (v.closed) {
          p = p.slice(0, -2)
          z = z.slice(0, -1)
        }
        const out: Entity = { t: 'pline', layer: e.layer, color: e.color, ...(e.props ? { props: e.props } : {}), pts: Float64Array.from(p), zs: Float64Array.from(z), closed: v.closed }
        let c = changes.get(s.item)
        if (!c) changes.set(s.item, (c = { replace: new Map() }))
        c.replace.set(s.entity, out)
        done++
      }
      ed.modify('Transformation 2D → 3D', changes)
      ed.message(`${done} objet(s) transformé(s) en 3D${outside ? ` ; ${outside} ignoré(s) car en partie hors du MNT` : ''}.`)
    },
  },
  {
    id: 'INFOMNT',
    label: 'Informations sur le MNT',
    aliases: ['IMNT', 'INFOTIN'],
    menu: 'Topo 3D',
    ribbon: ['Topographie', 'Terrain'],
    icon: 'tin',
    tip: 'Résume le modèle de terrain des points cotés visibles : nombre de points et de triangles, altitudes extrêmes, surfaces plane et réelle, triangles de bordure écartés.',
    steps: ['Affichez les points cotés puis lancez la commande ; le résumé s’affiche dans la ligne de commande.'],
    run(ed) {
      const pts = points3d(ed)
      const tin = buildTin(pts)
      if (!tin) throw new Error(`Il faut au moins trois points cotés visibles (trouvés : ${pts.length}).`)
      const { xs, ys, zs, triangles } = tin
      let a2 = 0
      let a3 = 0
      for (let t = 0; t < triangles.length; t += 3) {
        const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]]
        const ux = xs[b] - xs[a]
        const uy = ys[b] - ys[a]
        const uz = zs[b] - zs[a]
        const vx = xs[c] - xs[a]
        const vy = ys[c] - ys[a]
        const vz = zs[c] - zs[a]
        a2 += Math.abs(ux * vy - uy * vx) / 2
        a3 += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
      }
      let zmin = Infinity
      let zmax = -Infinity
      for (const z of zs) {
        zmin = Math.min(zmin, z)
        zmax = Math.max(zmax, z)
      }
      const msg = `MNT : ${xs.length} points, ${triangles.length / 3} triangles${tin.discarded ? ` (${tin.discarded} de bordure écartés, arête max ${tin.maxEdge.toFixed(1)} m)` : ''} · altitudes ${zmin.toFixed(2)} à ${zmax.toFixed(2)} m · surface plane ${a2.toFixed(2)} m² · surface réelle ${a3.toFixed(2)} m²`
      ed.message(msg)
      ed.actions.notify?.(msg)
    },
  },
]

/** Altitude du terrain sur l'axe (milieu du profil en travers), interpolée entre ses voisins. */
function elevationOnSection(prof: { d: number; z: number | null }[], half: number): number | null {
  for (let i = 0; i + 1 < prof.length; i++) {
    const a = prof[i]
    const b = prof[i + 1]
    if (a.z === null || b.z === null) continue
    if (a.d <= half + 1e-9 && b.d >= half - 1e-9) return b.d === a.d ? a.z : a.z + ((b.z - a.z) * (half - a.d)) / (b.d - a.d)
  }
  return null
}
