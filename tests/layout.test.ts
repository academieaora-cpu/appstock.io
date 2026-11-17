import { describe, expect, it } from 'vitest'
import { Project } from '../src/core/project'
import { newDataset, type Entity } from '../src/core/types'
import { REGIONS, findArrondissement, findDepartement } from '../src/data/cameroun'
import { pointsFromSelection } from '../src/edit/selpoints'
import type { Painter } from '../src/render/painter'
import { groundResolution, mercatorPx, zoomFor } from '../src/render/situation'
import { EMPTY_INFO, drawSheet, sheetGeometry, type SheetContent, type SheetSpec } from '../src/topo/sheet'

describe('découpage administratif du Cameroun', () => {
  it('10 régions, 58 départements, 360 arrondissements, sans doublon par département', () => {
    expect(REGIONS).toHaveLength(10)
    const deps = REGIONS.flatMap((r) => r.departements)
    expect(deps).toHaveLength(58)
    expect(deps.reduce((a, d) => a + d.arrondissements.length, 0)).toBe(360)
    for (const d of deps) expect(new Set(d.arrondissements).size).toBe(d.arrondissements.length)
  })
  it('retrouve département et région d’un arrondissement, sans tenir compte des accents', () => {
    const f = findArrondissement('yaounde ive')!
    expect(f.departement.nom).toBe('Mfoundi')
    expect(f.region.nom).toBe('Centre')
    expect(findDepartement('Département du Wouri')?.region.nom).toBe('Littoral')
    expect(findArrondissement('Garoua Ier')?.region.nom).toBe('Nord')
  })
})

describe('plan de situation : calcul de l’échelle', () => {
  it('pixels Web Mercator et niveau de tuiles pour l’échelle demandée', () => {
    expect(mercatorPx(0, 0, 0)).toEqual([128, 128])
    const lat = 3.87
    const { z, factor } = zoomFor(lat, 10000)
    // 1/10 000 à 6 px/mm : 1,667 m par pixel de l'image finale.
    expect(groundResolution(lat, z) / factor).toBeCloseTo(10000 / 1000 / 6, 9)
    expect(factor).toBeLessThanOrEqual(1)
    expect(factor).toBeGreaterThan(0.5)
  })
})

describe('tableau des coordonnées depuis la sélection', () => {
  it('sommets nommés par les numéros de bornes, points topo par leur matricule', () => {
    const project = new Project()
    project.crs = 'EPSG:32632'
    const ds = newDataset('Dessin', 'Dessin', 'cad')
    ds.crs = 'EPSG:32632'
    const parcel: Entity = { t: 'pline', layer: '0', color: -1, pts: Float64Array.from([0, 0, 20, 0, 20, 10, 0, 10]), closed: true }
    const label: Entity = { t: 'text', layer: 'SOMMETS', color: -1, x: 21, y: 11, h: 1, rot: 0, text: 'B.7', ha: 0, va: 0 }
    const pt: Entity = { t: 'insert', layer: 'TOPOJIS', color: -1, block: 'TCPOINT', x: 50, y: 50, sx: 1, sy: 1, rot: 0, props: { MAT: '104' } }
    ds.entities.push(parcel, label, pt)
    const item = project.add(ds)
    const one = pointsFromSelection(project, [{ item, entity: 0 }])
    expect(one.parcel).toBe(true)
    expect(one.rows.map((r) => r.label)).toEqual(['B.1', 'B.2', 'B.7', 'B.3'])
    const two = pointsFromSelection(project, [{ item, entity: 2 }, { item, entity: 0 }])
    expect(two.parcel).toBe(false)
    expect(two.rows[0]).toEqual({ label: '104', x: 50, y: 50 })
    expect(two.rows).toHaveLength(5)
  })
})

describe('mise en page camerounaise', () => {
  const texts: { x: number; y: number; s: string }[] = []
  const p: Painter = {
    beginStroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    endStroke() {},
    fillPolygon() {},
    dot() {},
    text(x, y, _c, _r, s) {
      texts.push({ x, y, s })
    },
    textWidth: (s, c) => s.length * c * 0.6,
    save() {},
    clipRect() {},
    restore() {},
  }
  const spec: SheetSpec = { paper: 'A4', landscape: false, scale: 500, template: 'cameroun', info: { ...EMPTY_INFO, region: 'Centre', departement: 'Mfoundi', arrondissement: 'Yaoundé IVe' }, center: null, showGrid: false, showNorth: true, showTable: true, showLegend: false, showArea: false, monochrome: false, unit: 1, showSituation: true, situationScale: 10000 }
  const content: SheetContent = { layers: [], extent: [0, 0, 40, 30], parcel: null, legend: [], table: [{ label: 'S1', x: 783640.123, y: 427200.456 }], situation: 'Système de coordonnées inconnu' }
  it('nord au milieu, encart de situation, échelle sans barre, tableau de la sélection', () => {
    texts.length = 0
    drawSheet(p, spec, content)
    const g = sheetGeometry(spec, content.extent)
    const n = texts.find((t) => t.s === 'N' && t.y < g.map.y)!
    expect(Math.abs(n.x - (g.map.x + g.map.w / 2))).toBeLessThan(6)
    expect(Math.abs(n.x - (g.frame.x + g.frame.w / 2))).toBeLessThan(0.01)
    expect(texts.some((t) => t.s.startsWith('Plan de Situation - Echelle 1/10'))).toBe(true)
    expect(texts.some((t) => t.s === 'Emplacement')).toBe(true)
    expect(texts.some((t) => t.s === 'Echelle: 1/500')).toBe(true)
    // Plan de situation : moitié droite du bandeau, sur toute sa hauteur
    expect(g.situation!.image.x).toBeCloseTo(g.frame.x + g.frame.w / 2, 6)
    expect(g.situation!.image.x + g.situation!.image.w).toBeCloseTo(g.frame.x + g.frame.w, 6)
    expect(g.situation!.caption.y + g.situation!.caption.h).toBeCloseTo(g.frame.y + g.band, 6)
    // Plus de graduations de barre d'échelle (« 0 », « 25 m »…)
    expect(texts.some((t) => t.s === '0' || / m$/.test(t.s))).toBe(false)
    expect(texts.some((t) => t.s === 'S1')).toBe(true)
    expect(texts.some((t) => t.s === '783640.123')).toBe(true)
    expect(texts.some((t) => t.s === 'Région: Centre')).toBe(true)
    expect(texts.some((t) => t.s === 'MAT')).toBe(true)
  })
})
