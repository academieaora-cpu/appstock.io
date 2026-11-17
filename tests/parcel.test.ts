import { describe, expect, it } from 'vitest'
import { clockwiseFromNorth, crossings, parcelProposals, signedArea, simpleOrder } from '../src/topo/parcel'

// Bornes du plan de Mimboman (tableau des coordonnées du modèle fourni).
const REF = [
  { id: 'B.1', x: 783643.653, y: 427227.772 },
  { id: 'B.2', x: 783650.829, y: 427210.757 },
  { id: 'B.3', x: 783639.247, y: 427172.135 },
  { id: 'B.4', x: 783624.996, y: 427177.778 },
  { id: 'B.5', x: 783632.079, y: 427197.03 },
  { id: 'B.6', x: 783632.809, y: 427221.321 },
]

describe('parcelle à partir des bornes', () => {
  it('le modèle : contour simple de 778 m², côtés 18,47 · 40,32 · 15,33 · 20,51 · 24,30 · 12,62', () => {
    expect(crossings(REF)).toHaveLength(0)
    expect(Math.round(Math.abs(signedArea(REF)))).toBe(778)
    const sides = REF.map((p, i) => Math.hypot(REF[(i + 1) % 6].x - p.x, REF[(i + 1) % 6].y - p.y).toFixed(2))
    expect(sides).toEqual(['18.47', '40.32', '15.33', '20.51', '24.30', '12.62'])
  })
  it('fichier dans le désordre avec des numéros de points : contour corrigé et renuméroté comme le modèle', () => {
    // Ordre du fichier qui donnait un contour croisé (282 m²) sur la plateforme.
    const file = [REF[1], REF[0], REF[2], REF[3], REF[5], REF[4]].map((p, i) => ({ ...p, id: String(101 + i) }))
    expect(crossings(file).length).toBeGreaterThan(0)
    const { proposals, recommended } = parcelProposals(file)
    expect(recommended).toBe('nord-horaire')
    const best = proposals.find((p) => p.mode === recommended)!
    expect(best.simple).toBe(true)
    expect(Math.round(best.area)).toBe(778)
    expect(best.vertices.map((v) => [v.label, v.x, v.y])).toEqual(REF.map((p) => [p.id, p.x, p.y]))
    const asFile = proposals.find((p) => p.mode === 'fichier')!
    expect(asFile.simple).toBe(false)
  })
  it('bornes déjà nommées B.x : noms et numérotation du géomètre respectés', () => {
    const shuffled = [REF[3], REF[0], REF[5], REF[2], REF[1], REF[4]]
    const { proposals, recommended } = parcelProposals(shuffled)
    expect(recommended).toBe('numeros')
    expect(proposals[0].vertices.map((v) => v.label)).toEqual(['B.1', 'B.2', 'B.3', 'B.4', 'B.5', 'B.6'])
    expect(Math.round(proposals[0].area)).toBe(778)
  })
  it('contour sans croisement pour un polygone concave', () => {
    const u = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 30, y: 0 },
      { id: 'c', x: 30, y: 30 },
      { id: 'd', x: 20, y: 30 },
      { id: 'e', x: 20, y: 10 },
      { id: 'f', x: 10, y: 10 },
      { id: 'g', x: 10, y: 30 },
      { id: 'h', x: 0, y: 30 },
    ]
    const shuffled = [u[4], u[0], u[7], u[2], u[5], u[1], u[6], u[3]]
    const o = clockwiseFromNorth(simpleOrder(shuffled))
    expect(crossings(o)).toHaveLength(0)
  })
})

import { cleaningFlags, parsePointsText, sourceDecimals } from '../src/topo/points'

describe('nettoyage des points', () => {
  const text = [
    'Point;X;Y;Z;Code',
    '1;783650.829;427210.757;744.94;BORN',
    '2;783643.653;427227.772;747.24;BORN',
    '3;783639.247;427172.135;748.74;BORN',
    '4;783624.996;427177.778;746.40;BORN',
    '5;783632.809;427221.321;743.71;BORN',
    '6;783632.079;427197.030;745.87;BORN',
    '6;783632.079;427197.030;745.87;BORN',
    '8;0;427190.000;746.00;TN',
    '9;793640.000;427190.000;746.50;TN',
    '10;783629.400;427186.600;0;TN',
    '11;783633.100;427214.200;-9999;TN',
  ].join('\n')
  it('propose une action par point suspect, sans rien appliquer', () => {
    const f = parsePointsText(text)
    const flags = cleaningFlags(f.points)
    const by = (id: string) => flags.filter((x) => f.points[x.index].id === id).map((x) => x.suggestion)
    expect(by('6')).toEqual(['exclure'])
    expect(by('8')).toEqual(['exclure'])
    expect(by('9')).toEqual(['exclure'])
    expect(by('10')).toEqual(['sans-altitude'])
    expect(by('11')).toEqual(['sans-altitude'])
    expect(by('1')).toEqual([])
    expect(f.points).toHaveLength(11)
  })
  it('garde la précision du fichier source', () => {
    expect(sourceDecimals(parsePointsText(text))).toBe(3)
    expect(sourceDecimals(parsePointsText('P;X;Y\n1;100.12;200.34\n2;101.5;201.25'))).toBe(2)
  })
})
