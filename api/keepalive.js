// « Bip » de maintien en vie, exécuté chaque jour par Vercel (voir vercel.json).
// Il envoie une requête vide au service en ligne pour qu'il ne soit pas mis en pause
// pour inactivité. Aucune donnée n'est lue ni écrite.
const CLOUD_URL = 'https://krsbyrpmejgqgfynoizh.supabase.co'
const CLOUD_KEY = 'sb_publishable_ywZ-1Y4o7blQ0xLPsqP9GA_xOk_nI2U'

export default async function handler(_req, res) {
  try {
    const r = await fetch(CLOUD_URL + '/rest/v1/rpc/geo_ping', {
      method: 'POST',
      headers: { apikey: CLOUD_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    })
    res.setHeader('Cache-Control', 'no-store')
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, statut: r.status, date: new Date().toISOString() })
  } catch (err) {
    res.status(502).json({ ok: false, erreur: String((err && err.message) || err) })
  }
}
