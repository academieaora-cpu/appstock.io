import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectCrs, transform } from '../src/core/crs'
import { ringArea, tessellateBulges } from '../src/core/geom'
import { parseDxf } from '../src/io/dxf-reader'
import { exportDxf } from '../src/io/export'
import { buildDisplayList, layerVisibility } from '../src/render/scene'
import { DEFAULT_RULES, buildObjects, matchCode } from '../src/topo/codes'
import { DEFAULT_PLAN, generatePlan } from '../src/topo/generate'
import { checkPoints, parsePointsText } from '../src/topo/points'
import { fitInfo, EMPTY_INFO, type SheetSpec } from '../src/topo/sheet'
import { buildTin, contours } from '../src/topo/tin'

const csv = readFileSync(new URL('../public/samples/leve_demo_utm32n.csv', import.meta.url), 'utf8')
const pnezd = readFileSync(new URL('../public/samples/leve_demo_pnezd.txt', import.meta.url), 'utf8')
const YAOUNDE: [number, number] = [11.5, 4.5]

describe('import de points', () => {
  it('reconnaît un CSV à en-tête (Point;X;Y;Z;Code)', () => {
    const f = parsePointsText(csv)
    expect(f.delimiter).toBe(';')
    expect(f.hasHeader).toBe(true)
    expect(f.columns).toEqual({ id: 0, x: 1, y: 2, z: 3, code: 4 })
    expect(f.points).toHaveLength(150)
    expect(f.points[0]).toMatchObject({ id: 'B.1', x: 783627.6, y: 427226.8, z: 745.57, code: 'BORN' })
    expect(f.questions).toHaveLength(0)
  })

  it('lit le même levé en « numéro nord est altitude code » séparé par des espaces', () => {
    const f = parsePointsText(pnezd, { x: 2, y: 1 })
    expect(f.delimiter).toBe(' ')
    expect(f.hasHeader).toBe(false)
    expect(f.points[0]).toMatchObject({ id: 'B.1', x: 783627.6, y: 427226.8 })
  })

  it('accepte la virgule décimale et signale les lignes illisibles sans les corriger', () => {
    const f = parsePointsText('N°;X;Y;Z\n1;100,50;200,25;10,1\n2;abc;200;10\n3;101;201;')
    expect(f.points).toHaveLength(2)
    expect(f.points[0]).toMatchObject({ x: 100.5, y: 200.25, z: 10.1 })
    expect(f.points[1].z).toBeNull()
    expect(f.rejected).toHaveLength(1)
    expect(f.rejected[0].line).toBe(3)
  })

  it('détecte doublons, coordonnées nulles et altitudes aberrantes', () => {
    const f = parsePointsText('P;X;Y;Z\n1;100;200;10\n1;100;200;10\n2;0;210;11\n3;105;205;999\n4;106;206;10.5\n5;107;207;10.2\n6;108;208;10.4')
    const messages = checkPoints(f).anomalies.map((a) => a.message).join(' | ')
    expect(messages).toMatch(/identifiant\(s\) de point répété/)
    expect(messages).toMatch(/en double à la même position/)
    expect(messages).toMatch(/coordonnée nulle/)
    expect(messages).toMatch(/très différente/)
  })
})

describe('codes terrain', () => {
  it('reconnaît codes exacts, suffixes, synonymes et fautes de frappe', () => {
    expect(matchCode('BAT1', DEFAULT_RULES)).toMatchObject({ group: '1', quality: 'exact' })
    expect(matchCode('bat1', DEFAULT_RULES).rule.code).toBe('BAT')
    expect(matchCode('Clôture', DEFAULT_RULES).rule.code).toBe('CL')
    expect(matchCode('BATIMANT', DEFAULT_RULES)).toMatchObject({ quality: 'approx' })
    expect(matchCode('XYZ42', DEFAULT_RULES).quality).toBe('inconnu')
    expect(matchCode('', DEFAULT_RULES).quality).toBe('vide')
  })

  it('ne relie que des points de même code, jamais par simple proximité', () => {
    const f = parsePointsText('P;X;Y;Z;Code\n1;0;0;1;MUR\n2;1;0;1;MUR\n3;1.01;0;1;TN\n4;2;0;1;MUR\n5;3;0;1;MUR')
    const objects = buildObjects(f.points, DEFAULT_RULES)
    expect(objects.map((o) => o.points.map((p) => p.id))).toEqual([
      ['1', '2'],
      ['4', '5'],
    ])
  })
})

describe('modèle de terrain', () => {
  it('trace des courbes exactes sur un plan incliné', () => {
    const pts = []
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push({ x: 1000 + i * 10, y: 5000 + j * 10, z: 100 + i * 2 })
    const tin = buildTin(pts)!
    expect(tin.triangles.length / 3).toBe(32)
    const list = contours(tin, 1)
    // Courbe 103 : x = 1015 sur toute la hauteur
    const c = list.find((k) => k.z === 103)!
    for (let i = 0; i < c.pts.length; i += 2) expect(c.pts[i]).toBeCloseTo(1015, 6)
    // La courbe 100 se confond avec le bord du modèle : elle n'est pas tracée.
    expect(list.map((k) => k.z)).toEqual([101, 102, 103, 104, 105, 106, 107, 108])
  })
})

describe('génération du plan', () => {
  const f = parsePointsText(csv)
  const plan = generatePlan(f.points, DEFAULT_RULES, { ...DEFAULT_PLAN, contourInterval: 0.5 }, 'essai')

  it('calcule la parcelle à partir des bornes sans modifier les coordonnées', () => {
    expect(plan.parcel!.vertices).toHaveLength(6)
    expect(plan.parcel!.vertices[0]).toMatchObject({ label: 'B.1', x: 783627.6, y: 427226.8 })
    const flat = plan.parcel!.vertices.flatMap((v) => [v.x, v.y])
    expect(plan.parcel!.area).toBeCloseTo(Math.abs(ringArea(flat)), 6)
    expect(plan.parcel!.area).toBeCloseTo(1470.16, 1)
    expect(plan.parcel!.sides[0]).toBeCloseTo(Math.hypot(783650.9 - 783627.6, 427230.1 - 427226.8), 9)
  })

  it('organise le dessin en calques et signale ce qui reste à valider', () => {
    for (const layer of ['01_POINTS', '05_BORNES', '06_LIMITES', '07_BATIMENTS', '11_COURBES_NIVEAU', '12_COURBES_MAITRESSES']) expect(plan.dataset.layers.has(layer)).toBe(true)
    expect(plan.report.some((r) => r.level === 'alerte' && /à valider par le géomètre/.test(r.message))).toBe(true)
  })

  it('tient sur un A4 au 1/500 mais pas au 1/200, sans jamais déformer', () => {
    const dl = buildDisplayList(plan.dataset, null)
    const spec: SheetSpec = { paper: 'A4', landscape: false, scale: 500, template: 'cameroun', info: EMPTY_INFO, center: null, showGrid: true, showNorth: true, showTable: true, showLegend: true, showArea: true, monochrome: false, unit: 1 }
    expect(fitInfo(spec, dl.extent).fits).toBe(true)
    const tight = fitInfo({ ...spec, scale: 200 }, dl.extent)
    expect(tight.fits).toBe(false)
    expect(tight.bestScale).toBe(500)
    expect(tight.bestPaper).toBe('A2')
  })

  it('exporte un DXF relu à l’identique (entités, calques, blocs, attributs, emprise)', () => {
    plan.dataset.crs = 'EPSG:32632'
    const dl = buildDisplayList(plan.dataset, null)
    const out = exportDxf([{ ds: plan.dataset, dl, vis: layerVisibility(dl, plan.dataset) }], 'EPSG:32632', 'essai')
    const back = parseDxf(new TextEncoder().encode(out.data as string), { name: 'retour' })
    expect(back.entities.length).toBe(plan.dataset.entities.length)
    expect(back.layers.size).toBe(plan.dataset.layers.size)
    expect(back.blocks.size).toBe(plan.dataset.blocks.size)
    expect(back.unsupported).toEqual({})
    const dl2 = buildDisplayList(back, null)
    expect(dl2.counts).toEqual(dl.counts)
    for (let i = 0; i < 4; i++) expect(dl2.extent[i]).toBeCloseTo(dl.extent[i], 6)
    const borne = back.entities.find((e) => e.t === 'insert' && e.props?.MAT === 'B.1')
    expect(borne?.props).toMatchObject({ MAT: 'B.1', ALT: '745.57', COD: 'BORN' })
  })
})

describe('systèmes de coordonnées', () => {
  it('propose UTM 32 Nord pour des coordonnées de Yaoundé', () => {
    const c = detectCrs([783606, 427140, 783700, 427279], YAOUNDE)
    expect(c[0].def.code).toBe('EPSG:32632')
    expect(c[0].lat).toBeCloseTo(3.861, 2)
    expect(c[0].lon).toBeCloseTo(11.554, 2)
  })

  it('propose Lambert-93 pour des coordonnées françaises et WGS 84 pour des degrés', () => {
    expect(detectCrs([652000, 6862000, 652500, 6862400], [2.5, 46.6])[0].def.code).toBe('EPSG:2154')
    expect(detectCrs([11.5, 3.8, 11.6, 3.9], YAOUNDE)[0].def.code).toBe('EPSG:4326')
  })

  it('convertit UTM 32 Nord en longitude/latitude et retour au millimètre', () => {
    const [lon, lat] = transform('EPSG:32632', 'EPSG:4326', 783640, 427200)
    const [x, y] = transform('EPSG:4326', 'EPSG:32632', lon, lat)
    expect(x).toBeCloseTo(783640, 3)
    expect(y).toBeCloseTo(427200, 3)
  })
})

describe('géométrie CAO', () => {
  it('développe un arc de polyligne (bulge) en restant sur le cercle', () => {
    // Demi-cercle de (0,0) à (2,0) : bulge = 1, centre (1,0), rayon 1
    const pts = tessellateBulges([0, 0, 2, 0], [1, 0], false, 0.0001)
    expect(pts.length).toBeGreaterThan(20)
    for (let i = 0; i < pts.length; i += 2) expect(Math.hypot(pts[i] - 1, pts[i + 1])).toBeCloseTo(1, 9)
    expect(pts[pts.length - 2]).toBe(2)
  })

  it('lit un DXF minimal avec bloc, attribut et polyligne fermée', () => {
    const dxf = ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'PT', '10', '0', '20', '0', '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '40', '0.5', '0', 'ENDBLK', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '8', 'TopoMat', '66', '1', '2', 'PT', '10', '100', '20', '200', '0', 'ATTRIB', '8', 'TopoMat', '10', '101', '20', '201', '40', '0.5', '1', 'S12', '2', 'MAT', '0', 'SEQEND',
      '0', 'LWPOLYLINE', '8', 'Parcelle', '90', '3', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10',
      '0', 'ENDSEC', '0', 'EOF'].join('\n')
    const ds = parseDxf(new TextEncoder().encode(dxf), { name: 'mini.dxf' })
    expect(ds.entities).toHaveLength(2)
    expect(ds.entities[0]).toMatchObject({ t: 'insert', block: 'PT', x: 100, y: 200, props: { MAT: 'S12' } })
    expect(ds.entities[1]).toMatchObject({ t: 'pline', closed: true, layer: 'Parcelle' })
    expect(ds.blocks.get('PT')!.entities).toHaveLength(1)
  })
})
