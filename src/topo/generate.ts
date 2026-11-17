/**
 * Génération automatique du dessin à partir d'un levé de points : symboles,
 * numéros, altitudes, lignes et surfaces selon les codes, parcelle bornée avec
 * côtés cotés, modèle de terrain et courbes de niveau.
 *
 * Le dessin est produit pour une échelle donnée : les tailles de texte et de
 * symbole sont fixées en millimètres papier. Les coordonnées du levé ne sont
 * jamais modifiées.
 */
import { ringArea } from '../core/geom'
import { BYBLOCK, FOREGROUND, ensureLayer, newDataset, type Block, type Color, type Dataset, type EText, type Entity } from '../core/types'
import { buildObjects, matchCode, type CodeRule, type SymbolName } from './codes'
import type { SurveyPoint } from './points'
import { buildTin, contours, smooth, type Tin } from './tin'

export interface PlanOptions {
  /** Dénominateur de l'échelle (500 pour 1/500). */
  scale: number
  showIds: boolean
  showZ: boolean
  showCodes: boolean
  /** Relier les bornes en parcelle (dans l'ordre du fichier). */
  parcel: boolean
  sideLengths: boolean
  /** Équidistance des courbes de niveau en mètres (0 = pas de courbes). */
  contourInterval: number
  /** Une courbe maîtresse toutes les n courbes. */
  majorEvery: number
  smoothContours: boolean
  showTin: boolean
  /** Nombre de décimales de l'attribut altitude. */
  altDecimals: number
  /** Insérer les points en 3D (altitude portée par le point) ou en 2D. */
  insert3d: boolean
  /** Insérer aussi les points dont l'altitude vaut exactement 0. */
  includeZeroZ: boolean
  /** Insérer aussi les symboles (arbre, poteau, regard…) sur les points. */
  symbols: boolean
  /** Changement de repère demandé par l'utilisateur : décalage en X, Y, Z. */
  offset: [number, number, number]
}

export const DEFAULT_PLAN: PlanOptions = {
  scale: 500,
  showIds: true,
  showZ: true,
  showCodes: false,
  parcel: true,
  sideLengths: true,
  contourInterval: 0,
  majorEvery: 5,
  smoothContours: true,
  showTin: false,
  altDecimals: 3,
  insert3d: true,
  includeZeroZ: true,
  symbols: true,
  offset: [0, 0, 0],
}

export interface ParcelVertex {
  label: string
  x: number
  y: number
}

export interface Parcel {
  vertices: ParcelVertex[]
  /** Longueur du côté partant de chaque sommet. */
  sides: number[]
  area: number
  perimeter: number
}

export interface LegendItem {
  label: string
  kind: 'point' | 'ligne' | 'surface' | 'borne'
  color: Color
  symbol: SymbolName
  lw: number
}

export interface PlanResult {
  dataset: Dataset
  parcel: Parcel | null
  legend: LegendItem[]
  tin: Tin | null
  /** Journal de ce qui a été fait et de ce qui reste à valider par le géomètre. */
  report: { level: 'ok' | 'alerte' | 'info'; message: string }[]
}

const black = (c: number): Color => (c === 0x000000 ? FOREGROUND : c)

/** Blocs de symboles, dessinés en millimètres papier (mis à l'échelle à l'insertion). */
export function symbolBlock(name: SymbolName): Block {
  const e: Entity[] = []
  const b = { layer: '0', color: BYBLOCK }
  const line = (x1: number, y1: number, x2: number, y2: number) => e.push({ t: 'line', ...b, x1, y1, x2, y2 })
  const square = (r: number) => e.push({ t: 'pline', ...b, pts: Float64Array.from([-r, -r, r, -r, r, r, -r, r]), closed: true })
  switch (name) {
    case 'croix':
      line(-0.7, 0, 0.7, 0)
      line(0, -0.7, 0, 0.7)
      break
    case 'cercle':
      e.push({ t: 'circle', ...b, cx: 0, cy: 0, r: 0.7 })
      break
    case 'carre':
      square(0.7)
      break
    case 'triangle':
      e.push({ t: 'pline', ...b, pts: Float64Array.from([-0.8, -0.5, 0.8, -0.5, 0, 0.9]), closed: true })
      break
    case 'arbre':
      e.push({ t: 'circle', ...b, cx: 0, cy: 0, r: 1.2 })
      line(-0.35, 0, 0.35, 0)
      line(0, -0.35, 0, 0.35)
      break
    case 'borne':
      square(0.6)
      e.push({ t: 'circle', ...b, cx: 0, cy: 0, r: 0.15 })
      break
    case 'poteau':
      e.push({ t: 'circle', ...b, cx: 0, cy: 0, r: 0.6 })
      line(-0.42, -0.42, 0.42, 0.42)
      break
  }
  return { name: 'SYM_' + name.toUpperCase(), bx: 0, by: 0, entities: e }
}

/**
 * Bloc de point topographique repris de Covadis (TCPOINT) : un point et trois définitions
 * d'attributs, MAT (matricule) sur TopoMat, ALT (altitude) et COD (code) sur TopoAlt.
 */
export function tcpointBlock(): Block {
  const attdef = (tag: string, layer: string, x: number, y: number, ha: 0 | 2, va: 0 | 3): EText => ({ t: 'text', layer, color: -1, x, y, h: 0.75, rot: 0, text: '', ha, va, tag })
  return {
    name: 'TCPOINT',
    bx: 0,
    by: 0,
    entities: [{ t: 'point', layer: '0', color: BYBLOCK, x: 0, y: 0 }],
    attdefs: [attdef('MAT', 'TopoMat', 0.25, 0.25, 0, 0), attdef('ALT', 'TopoAlt', 0.25, -0.25, 0, 3), attdef('COD', 'TopoAlt', -0.25, -0.25, 2, 3)],
  }
}

const isBorneName = (id: string) => /^B[.\s-]?\d+[A-Za-z]?$/i.test(id.trim())

/** Angle de texte lisible (jamais à l'envers). */
function readable(angle: number): number {
  let a = angle
  while (a > Math.PI / 2 + 1e-9) a -= Math.PI
  while (a <= -Math.PI / 2 + 1e-9) a += Math.PI
  return a
}

export function computeParcel(vertices: ParcelVertex[]): Parcel {
  const n = vertices.length
  const flat: number[] = []
  for (const v of vertices) flat.push(v.x, v.y)
  const sides = vertices.map((v, i) => {
    const w = vertices[(i + 1) % n]
    return Math.hypot(w.x - v.x, w.y - v.y)
  })
  return { vertices, sides, area: Math.abs(ringArea(flat)), perimeter: sides.reduce((a, b) => a + b, 0) }
}

export function generatePlan(input: SurveyPoint[], rules: CodeRule[], options: PlanOptions, name = 'Plan'): PlanResult {
  const ds = newDataset(name, 'Dessin généré', 'cad')
  const k = options.scale / 1000 // mètres terrain par millimètre papier
  const report: PlanResult['report'] = []
  let points = input
  const [ox, oy, oz] = options.offset
  if (ox || oy || oz) {
    points = points.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy, z: p.z === null ? null : p.z + oz }))
    report.push({ level: 'alerte', message: `Changement de repère appliqué à votre demande : décalage X ${ox} m, Y ${oy} m, Z ${oz} m. Les coordonnées du dessin diffèrent du fichier source.` })
  }
  if (!options.includeZeroZ) {
    const kept = points.filter((p) => p.z !== 0)
    if (kept.length < points.length) report.push({ level: 'alerte', message: `${points.length - kept.length} point(s) d'altitude nulle non insérés (option « insérer les points pour Z = 0 » décochée).` })
    points = kept
  }
  const legend = new Map<string, LegendItem>()
  const useLegend = (r: CodeRule) => {
    if (!legend.has(r.label)) legend.set(r.label, { label: r.label, kind: r.kind, color: black(r.color), symbol: r.symbol, lw: r.lw })
  }

  ensureLayer(ds, '0')
  const L = (layerName: string, color: Color, lw = 0): string => {
    const layer = ensureLayer(ds, layerName, color)
    layer.color = color
    layer.lineweight = lw
    return layerName
  }
  const lPoints = L('01_POINTS', FOREGROUND, 0.18)
  // Calques et bloc de point topographique repris de Covadis : un dessin exporté est
  // reconnu par Covadis (bloc TCPOINT, attributs MAT, ALT, COD).
  const lJis = L('TOPOJIS', FOREGROUND, 0.18)
  const lMat = L('TopoMat', FOREGROUND)
  const lAlt = L('TopoAlt', 0x009a00)
  const s500 = options.scale / 500 // échelle d'insertion des blocs (1 pour un plan au 1/500)
  ds.blocks.set('TCPOINT', tcpointBlock())

  const text = (layer: string, x: number, y: number, mm: number, str: string, extra: Partial<EText> = {}): EText => ({
    t: 'text',
    layer,
    color: -1,
    x,
    y,
    h: mm * k,
    rot: 0,
    text: str,
    ha: 0,
    va: 0,
    ...extra,
  })

  // --- Points : bloc TCPOINT (matricule, altitude, code) + symbole ------------
  const usedSymbols = new Set<SymbolName>()
  let unknown = 0
  const isBornePoint = (p: SurveyPoint) => {
    const m = matchCode(p.code, rules)
    return m.rule.kind === 'borne' || (m.quality === 'vide' && isBorneName(p.id))
  }
  const borneCandidates: SurveyPoint[] = points.filter(isBornePoint)
  const parcelOn = options.parcel && borneCandidates.length >= 3
  for (const p of points) {
    const m = matchCode(p.code, rules)
    const rule = m.rule
    const isBorne = isBornePoint(p)
    if (m.quality === 'inconnu') unknown++
    const props: Record<string, string | number> = { MAT: p.id }
    if (p.z !== null) props.ALT = p.z
    if (p.code) props.COD = p.code
    const attribs: EText[] = []
    const attr = (tag: string, layer: string, dx: number, dy: number, ha: 0 | 2, va: 0 | 3, value: string) =>
      attribs.push({ t: 'text', layer, color: -1, x: p.x + dx * s500, y: p.y + dy * s500, h: 0.75 * s500, rot: 0, text: value, ha, va, tag })
    // Le nom d'une borne est déjà écrit en grand à côté de la parcelle.
    if (options.showIds && p.id && !(isBorne && parcelOn)) attr('MAT', lMat, 0.25, 0.25, 0, 0, p.id)
    if (options.showZ && p.z !== null) attr('ALT', lAlt, 0.25, -0.25, 0, 3, p.z.toFixed(options.altDecimals))
    if (options.showCodes && p.code) attr('COD', lAlt, -0.25, -0.25, 2, 3, p.code)
    ds.entities.push({
      t: 'insert',
      layer: lJis,
      color: -1,
      block: 'TCPOINT',
      x: p.x,
      y: p.y,
      ...(options.insert3d && p.z !== null ? { z: p.z } : {}),
      sx: s500,
      sy: s500,
      rot: 0,
      props,
      ...(attribs.length ? { attribs } : {}),
    })
    if (options.symbols) {
      const symbol: SymbolName = isBorne ? 'borne' : rule.symbol
      usedSymbols.add(symbol)
      const layer = isBorne ? L('05_BORNES', 0xff0000, 0.35) : rule.kind === 'point' && rule.layer !== lPoints ? L(rule.layer, black(rule.color), rule.lw) : lPoints
      ds.entities.push({ t: 'insert', layer, color: -1, block: 'SYM_' + symbol.toUpperCase(), x: p.x, y: p.y, sx: k, sy: k, rot: 0 })
    }
    if (m.quality !== 'vide' && m.quality !== 'inconnu') useLegend(isBorne ? { ...rule, kind: 'borne', symbol: 'borne' } : rule)
  }
  for (const sym of usedSymbols) {
    const blk = symbolBlock(sym)
    ds.blocks.set(blk.name, blk)
  }
  report.push({ level: 'ok', message: `${points.length} points reportés à leurs coordonnées exactes, en blocs TCPOINT (attributs MAT, ALT, COD) comme dans Covadis.` })
  if (unknown) report.push({ level: 'alerte', message: `${unknown} point(s) portent un code non reconnu : dessinés comme simples points, sans liaison. Complétez le dictionnaire de codes si nécessaire.` })

  // --- Lignes et surfaces selon les codes ---------------------------------
  const objects = buildObjects(points, rules)
  let lines = 0
  for (const obj of objects) {
    if (obj.rule.kind === 'borne') continue
    const closed = obj.rule.kind === 'surface' && obj.points.length >= 3
    const pts: number[] = []
    const zs: number[] = []
    let hasZ = true
    for (const p of obj.points) {
      pts.push(p.x, p.y)
      if (p.z === null) hasZ = false
      zs.push(p.z ?? 0)
    }
    ds.entities.push({
      t: 'pline',
      layer: L(obj.rule.layer, black(obj.rule.color), obj.rule.lw),
      color: -1,
      pts: Float64Array.from(pts),
      ...(hasZ ? { zs: Float64Array.from(zs) } : {}),
      closed,
      props: { CODE: obj.rule.code, OBJET: obj.rule.label },
    })
    useLegend(obj.rule)
    lines++
  }
  if (lines) report.push({ level: 'ok', message: `${lines} ligne(s) ou contour(s) tracé(s) d'après les codes (points de même code, dans l'ordre du fichier).` })

  // --- Parcelle : bornes reliées dans l'ordre -----------------------------
  let parcel: Parcel | null = null
  if (options.parcel && borneCandidates.length >= 3) {
    const vertices = borneCandidates.map((p, i) => ({ label: isBorneName(p.id) ? p.id.trim() : 'B.' + (i + 1), x: p.x, y: p.y }))
    parcel = computeParcel(vertices)
    const lLim = L('06_LIMITES', FOREGROUND, 0.5)
    const flat: number[] = []
    for (const v of vertices) flat.push(v.x, v.y)
    ds.entities.push({ t: 'pline', layer: lLim, color: -1, pts: Float64Array.from(flat), closed: true, props: { OBJET: 'Parcelle', SURFACE_M2: Math.round(parcel.area * 100) / 100 } })
    const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length
    const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length
    const lBornes = L('05_BORNES', 0xff0000, 0.35)
    const lCot = L('14_COTATIONS', FOREGROUND)
    vertices.forEach((v, i) => {
      // Nom de borne, à l'extérieur de la parcelle
      const dx = v.x - cx
      const dy = v.y - cy
      const d = Math.hypot(dx, dy) || 1
      ds.entities.push(text(lBornes, v.x + (dx / d) * 3.2 * k, v.y + (dy / d) * 3.2 * k, 2.2, v.label, { ha: 1, va: 2 }))
      if (options.sideLengths) {
        const w = vertices[(i + 1) % vertices.length]
        const mx = (v.x + w.x) / 2
        const my = (v.y + w.y) / 2
        const ang = Math.atan2(w.y - v.y, w.x - v.x)
        // Décalage vers l'extérieur
        let nx = -(w.y - v.y)
        let ny = w.x - v.x
        const nl = Math.hypot(nx, ny) || 1
        nx /= nl
        ny /= nl
        if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) {
          nx = -nx
          ny = -ny
        }
        ds.entities.push(text(lCot, mx + nx * 2.0 * k, my + ny * 2.0 * k, 1.9, parcel!.sides[i].toFixed(2), { ha: 1, va: 2, rot: readable(ang) }))
      }
    })
    report.push({
      level: 'alerte',
      message: `Parcelle construite en reliant ${vertices.length} bornes dans l'ordre du fichier : superficie ${parcel.area.toFixed(2)} m², périmètre ${parcel.perimeter.toFixed(2)} m. Limite à valider par le géomètre — elle n'a pas de valeur juridique en soi.`,
    })
  }

  // --- Modèle de terrain et courbes de niveau -----------------------------
  let tin: Tin | null = null
  if (options.contourInterval > 0 || options.showTin) {
    tin = buildTin(points)
    if (!tin) {
      report.push({ level: 'alerte', message: 'Moins de 3 points avec altitude : pas de modèle de terrain ni de courbes de niveau.' })
    } else {
      if (tin.discarded) {
        report.push({
          level: 'info',
          message: `${tin.discarded} triangle(s) de bordure écartés (arêtes de plus de ${tin.maxEdge.toFixed(1)} m) : aucune courbe n'est extrapolée dans les zones non levées.`,
        })
      }
      if (options.showTin) {
        const lTin = L('13_TRIANGULATION', 0x9a9a9a, 0.09)
        const { xs, ys, zs, triangles } = tin
        for (let t = 0; t < triangles.length; t += 3) {
          const a = triangles[t]
          const b = triangles[t + 1]
          const c = triangles[t + 2]
          ds.entities.push({
            t: 'polygon',
            layer: lTin,
            color: -1,
            rings: [Float64Array.from([xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]])],
            zs: [Float64Array.from([zs[a], zs[b], zs[c]])],
            filled: false,
          })
        }
        report.push({ level: 'ok', message: `Modèle de terrain : ${triangles.length / 3} triangles sur ${xs.length} points.` })
      }
      if (options.contourInterval > 0) {
        const lMinor = L('11_COURBES_NIVEAU', 0xff9f00, 0.13)
        const lMajor = L('12_COURBES_MAITRESSES', 0xff0000, 0.3)
        const list = contours(tin, options.contourInterval)
        const major = Math.max(1, options.majorEvery)
        const decimals = options.contourInterval < 1 ? 2 : 1
        let count = 0
        for (const c of list) {
          const isMajor = Math.round(c.z / options.contourInterval) % major === 0
          const pts = options.smoothContours ? smooth(c.pts, c.closed, 2) : c.pts
          ds.entities.push({ t: 'pline', layer: isMajor ? lMajor : lMinor, color: -1, pts: Float64Array.from(pts), closed: c.closed, elev: c.z, props: { ALTITUDE: c.z } })
          count++
          // Cote de la courbe, au milieu, orientée le long de la courbe
          const n = pts.length >> 1
          const length = pts.length >= 4 ? Math.hypot(pts[pts.length - 2] - pts[0], pts[pts.length - 1] - pts[1]) : 0
          if (isMajor && n >= 4 && (c.closed || length > 12 * k)) {
            const i = (n >> 1) * 2
            const ang = Math.atan2(pts[i + 1] - pts[i - 1], pts[i] - pts[i - 2])
            ds.entities.push(text(lMajor, pts[i], pts[i + 1], 1.3, c.z.toFixed(decimals), { ha: 1, va: 2, rot: readable(ang) }))
          }
        }
        legend.set('Courbe de niveau', { label: `Courbe de niveau (équidistance ${options.contourInterval} m)`, kind: 'ligne', color: 0xff9f00, symbol: 'croix', lw: 0.13 })
        legend.set('Courbe maîtresse', { label: 'Courbe maîtresse', kind: 'ligne', color: 0xff0000, symbol: 'croix', lw: 0.3 })
        report.push({
          level: 'ok',
          message: `${count} courbe(s) de niveau à l'équidistance ${options.contourInterval} m, interpolées linéairement sur la triangulation${options.smoothContours ? ' puis lissées (lissage cosmétique)' : ''}.`,
        })
      }
    }
  }

  if (ds.layers.get('13_TRIANGULATION')) ds.layers.get('13_TRIANGULATION')!.visible = options.showTin
  ds.meta.echelle = '1/' + options.scale
  ds.meta.points = points.length
  return { dataset: ds, parcel, legend: [...legend.values()], tin, report }
}
