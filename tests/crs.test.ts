import { describe, expect, it } from 'vitest'
import { WORK_REGIONS, candidateInRegion, describePlace, detectCrs, transform } from '../src/core/crs'

/** UTM WGS 84 par les séries de Krüger d'ordre 6 (Karney 2011) : référence indépendante. */
function krugerUtm(lon: number, lat: number, zone: number): [number, number] {
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const n = f / (2 - f)
  const [n2, n3, n4, n5, n6] = [n ** 2, n ** 3, n ** 4, n ** 5, n ** 6]
  const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256)
  const al = [0, n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360, (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440, (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600, (34729 * n5) / 80640 - (3418889 * n6) / 1995840, (212378941 * n6) / 319334400]
  const lon0 = (((zone - 1) * 6 - 177) * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const lam = (lon * Math.PI) / 180 - lon0
  const e = Math.sqrt(f * (2 - f))
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)))
  const xi1 = Math.atan2(t, Math.cos(lam))
  const eta1 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t))
  let xi = xi1
  let eta = eta1
  for (let j = 1; j <= 6; j++) {
    xi += al[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1)
    eta += al[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1)
  }
  return [500000 + k0 * A * eta, k0 * A * xi]
}

const CM = WORK_REGIONS.find((r) => r.id === 'CM')!
const TOWNS: [string, number, number][] = [
  ['Ebolowa', 11.1543, 2.9154],
  ['Foumbot', 10.6333, 5.5083],
  ['Yaoundé', 11.5021, 3.848],
  ['Douala', 9.7679, 4.0511],
  ['Garoua', 13.3977, 9.3017],
]

describe('positionnement', () => {
  it('projection UTM exacte : écart nul avec la référence de Krüger, aller-retour sans perte', () => {
    for (const [, lon, lat] of TOWNS) {
      const ref = krugerUtm(lon, lat, 32)
      const p = transform('EPSG:4326', 'EPSG:32632', lon, lat)
      expect(Math.hypot(p[0] - ref[0], p[1] - ref[1])).toBeLessThan(1e-6)
      const back = transform('EPSG:32632', 'EPSG:4326', p[0], p[1])
      expect(Math.abs(back[0] - lon) + Math.abs(back[1] - lat)).toBeLessThan(1e-11)
    }
  })
  it('un point d’Ebolowa reste à Ebolowa, quel que soit le fuseau horaire de l’appareil', () => {
    const [e, n] = krugerUtm(11.1543, 2.9154, 32)
    const c = detectCrs([e - 50, n - 50, e + 50, n + 50], CM)
    expect(c[0].def.code).toBe('EPSG:32632')
    expect(candidateInRegion(c[0], CM)).toBe(true)
    expect(describePlace(c[0].lon, c[0].lat)).toMatch(/^près d’Ebolowa/)
    // Les anciens systèmes camerounais sont proposés, jamais choisis d'office.
    const f = krugerUtm(9.7679, 4.0511, 32)
    const d = detectCrs([f[0] - 50, f[1] - 50, f[0] + 50, f[1] + 50], CM)
    expect(d[0].def.code).toBe('EPSG:32632')
    expect(d.some((x) => x.def.code === 'EPSG:2215')).toBe(true)
  })
  it('Foumbot et Ebolowa ne sont jamais confondus', () => {
    const eb = krugerUtm(11.1543, 2.9154, 32)
    const fo = krugerUtm(10.6333, 5.5083, 32)
    const pe = detectCrs([eb[0], eb[1], eb[0], eb[1]], CM)[0]
    const pf = detectCrs([fo[0], fo[1], fo[0], fo[1]], CM)[0]
    expect(describePlace(pe.lon, pe.lat)).toMatch(/Ebolowa/)
    expect(describePlace(pf.lon, pf.lat)).toMatch(/Foumbot/)
  })
  it('datum Manoca 1962 : décalage connu de l’ordre de 200 m avec le WGS 84', () => {
    const [x, y] = krugerUtm(9.7679, 4.0511, 32)
    const ll = transform('EPSG:2215', 'EPSG:4326', x, y)
    const dm = Math.hypot((ll[0] - 9.7679) * 111000, (ll[1] - 4.0511) * 110600)
    expect(dm).toBeGreaterThan(50)
    expect(dm).toBeLessThan(400)
  })
})
