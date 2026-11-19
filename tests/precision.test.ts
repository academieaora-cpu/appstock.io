import { describe, expect, it } from 'vitest'
import { buildTin, checkContours, contours, elevationAt, intervalDecimals, levelValue, smooth } from '../src/topo/tin'

let seed = 12345
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

describe('MNT et courbes de niveau : exactitude', () => {
  it('plan incliné en coordonnées UTM : chaque sommet de courbe est exactement à sa cote', () => {
    const f = (x: number, y: number) => 700 + 0.0312 * (x - 783600) - 0.0174 * (y - 427150)
    const pts = Array.from({ length: 600 }, () => {
      const x = 783600 + rnd() * 120
      const y = 427150 + rnd() * 90
      return { x, y, z: f(x, y) }
    })
    const tin = buildTin(pts)!
    const list = contours(tin, 0.25)
    expect(list.length).toBeGreaterThan(10)
    let worst = 0
    for (const c of list) for (let i = 0; i < c.pts.length; i += 2) worst = Math.max(worst, Math.abs(f(c.pts[i], c.pts[i + 1]) - c.z))
    // Précision des nombres à virgule flottante sur des coordonnées de 783 600 m : 1e-9 m.
    expect(worst).toBeLessThan(1e-9)
    const check = checkContours(tin, list)
    expect(check.maxError).toBeLessThan(1e-9)
    expect(check.crossings).toBe(0)
  })

  it('cotes des courbes en décimales exactes (pas de 745.6000000000001)', () => {
    expect(intervalDecimals(0.25)).toBe(2)
    expect(intervalDecimals(0.1)).toBe(1)
    expect(levelValue(7456, 0.1)).toBe(745.6)
    expect(levelValue(2983, 0.25)).toBe(745.75)
    const pts = [
      { x: 0, y: 0, z: 744.93 },
      { x: 30, y: 0, z: 746.31 },
      { x: 0, y: 30, z: 745.07 },
      { x: 30, y: 30, z: 746.88 },
    ]
    for (const c of contours(buildTin(pts)!, 0.1)) expect(String(c.z)).toMatch(/^\d+(\.\d)?$/)
  })

  it('terrain courbe : contrôle indépendant sans écart ni croisement', () => {
    const f = (x: number, y: number) => 700 + 5 * Math.sin((x - 783600) / 20) * Math.cos((y - 427150) / 25)
    const pts = Array.from({ length: 800 }, () => {
      const x = 783600 + rnd() * 150
      const y = 427150 + rnd() * 150
      return { x, y, z: f(x, y) }
    })
    const tin = buildTin(pts)!
    const list = contours(tin, 0.5)
    const check = checkContours(tin, list)
    expect(check.vertices).toBeGreaterThan(1000)
    expect(check.maxError).toBeLessThan(1e-9)
    expect(check.crossings).toBe(0)
    for (const c of list) for (let i = 2; i < c.pts.length; i += 2) expect(c.pts[i] === c.pts[i - 2] && c.pts[i + 1] === c.pts[i - 1]).toBe(false)
  })

  it('sommets exactement à la cote d’une courbe : courbes continues, sans doublon', () => {
    const pts = []
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) pts.push({ x: 783600 + i * 5, y: 427150 + j * 5, z: 740 + (i % 3) * 0.5 + (j % 2) * 0.5 })
    const tin = buildTin(pts)!
    const list = contours(tin, 0.5)
    const check = checkContours(tin, list)
    expect(check.maxError).toBeLessThan(1e-9)
    expect(check.crossings).toBe(0)
  })

  it('ligne de rupture : le fond de fossé garde son altitude (sans rupture, le MNT est faux)', () => {
    // Berges à 10 m tous les 10 m, fond de fossé à 8 m levé seulement aux deux extrémités.
    const banks = []
    for (let x = 0; x <= 100; x += 10) banks.push({ x: 783600 + x, y: 427150 - 5, z: 10 }, { x: 783600 + x, y: 427150 + 5, z: 10 })
    const axis = [
      { x: 783600 - 10, y: 427150, z: 8 },
      { x: 783600 + 110, y: 427150, z: 8 },
    ]
    const free = buildTin([...banks, ...axis])!
    const ditch = buildTin(banks, { breaklines: [axis] })!
    expect(elevationAt(free, 783650, 427150)).toBeCloseTo(10, 6)
    expect(ditch.constrained).toBe(1)
    expect(elevationAt(ditch, 783650, 427150)).toBeCloseTo(8, 9)
    const check = checkContours(ditch, contours(ditch, 0.5))
    expect(check.maxError).toBeLessThan(1e-9)
    expect(check.crossings).toBe(0)
  })

  it('conflits signalés, jamais tranchés en silence', () => {
    const pts = [
      { x: 0, y: 0, z: 10, id: 'A' },
      { x: 10, y: 0, z: 11, id: 'B' },
      { x: 0, y: 10, z: 12, id: 'C' },
      { x: 10, y: 10, z: 13, id: 'D' },
      { x: 0, y: 0, z: 10.5, id: 'A2' },
      { x: 5, y: 5, z: 12, id: 'E' },
    ]
    const crossing = [
      [{ x: 0, y: 0, z: 10 }, { x: 10, y: 10, z: 13 }],
      [{ x: 10, y: 0, z: 11 }, { x: 0, y: 10, z: 12 }],
    ]
    const tin = buildTin(pts, { breaklines: crossing })!
    expect(tin.conflicts.some((c) => c.includes('Deux altitudes au même endroit') && c.includes('A2'))).toBe(true)
    // La première diagonale passe sur E, la seconde la croise : aucune n'est imposée en silence.
    expect(tin.conflicts.some((c) => c.includes('passe exactement sur le point'))).toBe(true)
  })

  it('lissage d’affichage : la courbe passe exactement par les sommets calculés', () => {
    const pts = [0, 0, 10, 2, 20, 1, 30, 6, 40, 4]
    const s = smooth(pts, false, 4)
    for (let i = 0; i < pts.length; i += 2) {
      let found = false
      for (let j = 0; j < s.length; j += 2) if (s[j] === pts[i] && s[j + 1] === pts[i + 1]) found = true
      expect(found).toBe(true)
    }
  })
})
