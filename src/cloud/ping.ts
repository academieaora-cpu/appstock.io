import { CLOUD_KEY, CLOUD_URL } from './config'

const PING_KEY = 'appstock.ping'

/**
 * « Bip » de maintien en vie : au plus une fois toutes les 12 heures, une requête sans
 * aucune donnée signale au service en ligne que la plateforme est utilisée, pour qu'il
 * ne soit pas mis en pause pour inactivité.
 */
export function ping(): void {
  try {
    const last = Number(localStorage.getItem(PING_KEY) ?? 0)
    if (Date.now() - last < 12 * 3600 * 1000) return
    localStorage.setItem(PING_KEY, String(Date.now()))
  } catch {
    return
  }
  void fetch(CLOUD_URL + '/rest/v1/rpc/geo_ping', { method: 'POST', headers: { apikey: CLOUD_KEY, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {
    /* hors ligne : sans importance */
  })
}
