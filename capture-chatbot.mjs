#!/usr/bin/env node
/**
 * capture-chatbot.mjs — outil de constat horodaté pour le Dossier de transparence IA
 * ACADÉMIE AORA — Moteur d'opportunités, chantier n°001
 *
 * CE QUE FAIT CE SCRIPT
 *   Ouvre une page publique dans un vrai navigateur, laisse le widget de chat se
 *   charger, tente de l'ouvrir, puis enregistre TROIS pièces horodatées :
 *     1. une capture pleine page      -> <slug>_<horodatage>_page.png
 *     2. une capture du widget ouvert -> <slug>_<horodatage>_widget.png
 *     3. un relevé factuel JSON       -> <slug>_<horodatage>.json
 *        (URL, horodatage UTC + local, éditeur détecté par les scripts tiers
 *         réellement chargés, texte visible dans le widget)
 *
 * CE QU'IL NE FAIT PAS
 *   Il ne qualifie RIEN. Il ne dit pas si le site est conforme. Il enregistre ce
 *   que l'interface affiche. La qualification est faite ensuite, à la main, dans
 *   le dossier. C'est la règle « zéro chiffre inventé » appliquée à la preuve.
 *
 * INSTALLATION (une seule fois, sur une machine avec accès Internet)
 *   npm install playwright
 *   npx playwright install chromium
 *
 * USAGE
 *   node capture-chatbot.mjs https://exemple.com
 *   node capture-chatbot.mjs https://exemple.com --lang fr-FR --wait 12000
 *   node capture-chatbot.mjs --batch cibles.txt        (une URL par ligne)
 *
 * SORTIE
 *   Dossier ./captures/
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Signatures d'éditeurs : on ne devine pas, on lit les requêtes réellement émises
const EDITEURS = [
  [/intercomcdn\.com|widget\.intercom\.io|js\.intercomcdn/i, 'Intercom'],
  [/crisp\.chat|client\.crisp\.chat/i,                       'Crisp'],
  [/code\.tidio\.co|widget-v\d+\.tidiochat\.com|tidio/i,     'Tidio (agent Lyro)'],
  [/general-runtime\.voiceflow\.com|cdn\.voiceflow\.com/i,   'Voiceflow'],
  [/cdn\.botpress\.cloud|messaging\.botpress\.cloud/i,       'Botpress'],
  [/static\.landbot\.io|landbot\.io/i,                       'Landbot'],
  [/js\.driftt\.com|drift\.com/i,                            'Drift'],
  [/embed\.tawk\.to/i,                                       'Tawk.to'],
  [/static\.zdassets\.com|zopim|zendesk/i,                   'Zendesk / Zopim'],
  [/widget\.freshworks\.com|freshchat/i,                     'Freshchat'],
  [/hs-scripts\.com|hubspot/i,                               'HubSpot'],
  [/livechatinc\.com/i,                                      'LiveChat'],
  [/ada\.support|static\.ada\.support/i,                     'Ada'],
  [/chatfuel/i,                                              'Chatfuel'],
  [/manychat/i,                                              'ManyChat'],
  [/getzowie\.com|zowie/i,                                   'Zowie'],
  [/kustomer/i,                                              'Kustomer'],
  [/gorgias\.chat|gorgias/i,                                 'Gorgias'],
];

// Sélecteurs de déclencheurs de widget, du plus spécifique au plus générique
const DECLENCHEURS = [
  '#intercom-container', '.intercom-launcher', '[class*="intercom-launcher"]',
  '#crisp-chatbox', '.crisp-client a[role="button"]', '#crisp-chatbox a',
  '#tidio-chat iframe', '#tidio-chat-button', '[id*="tidio"]',
  '#voiceflow-chat', '.vfrc-launcher',
  '#webchat', '#bp-web-widget-container', '[id*="botpress"]',
  '#tawkchat-minified-wrapper', '#tawkchat-container',
  '#launcher', '#chat-widget-container', '#hubspot-messages-iframe-container',
  '[aria-label*="chat" i]', '[aria-label*="messag" i]', '[aria-label*="assistant" i]',
  'button[class*="chat" i]', 'div[class*="chat-launcher" i]', 'div[class*="chat-button" i]',
];

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LANG = flag('--lang', 'fr-FR');
const WAIT = parseInt(flag('--wait', '10000'), 10);
const OUT  = flag('--out', './captures');

function slugify(u) {
  return u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '').slice(0, 60).toLowerCase();
}

async function auditer(browser, url) {
  const debutISO = new Date().toISOString();
  const stamp = debutISO.replace(/[:.]/g, '-').slice(0, 19);
  const slug = slugify(url);

  const ctx = await browser.newContext({
    locale: LANG,
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Europe/Paris',
  });

  const requetes = new Set();
  ctx.on('request', r => requetes.add(r.url()));

  const page = await ctx.newPage();
  const releve = {
    url, horodatage_utc: debutISO,
    horodatage_local: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }),
    fuseau: 'Europe/Paris', langue_navigateur: LANG,
    editeur_detecte: [], declencheur_trouve: null, widget_ouvert: false,
    texte_visible_widget: null, erreur: null,
    avertissement: "Relevé factuel automatisé. Aucune qualification juridique. À relire avant usage.",
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(WAIT);                      // laisser charger les scripts tiers

    // Bannière cookies : on tente d'accepter, sinon le widget reste masqué
    for (const t of ['Accepter', 'Tout accepter', 'Accept all', 'Accept', 'J\'accepte', 'OK']) {
      const b = page.getByRole('button', { name: new RegExp(`^${t}$`, 'i') }).first();
      if (await b.count().catch(() => 0)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await page.waitForTimeout(2500);

    for (const [re, nom] of EDITEURS)
      if ([...requetes].some(u => re.test(u))) releve.editeur_detecte.push(nom);

    await page.screenshot({ path: path.join(OUT, `${slug}_${stamp}_page.png`), fullPage: true });

    for (const sel of DECLENCHEURS) {
      const el = page.locator(sel).first();
      if (await el.count().catch(() => 0) && await el.isVisible().catch(() => false)) {
        releve.declencheur_trouve = sel;
        await el.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(6000);
        releve.widget_ouvert = true;
        break;
      }
    }

    // Texte réellement affiché dans le widget, page principale + iframes
    const morceaux = [];
    if (releve.declencheur_trouve) {
      const t = await page.locator(releve.declencheur_trouve)
        .locator('xpath=ancestor-or-self::*[3]').innerText().catch(() => '');
      if (t) morceaux.push(t);
    }
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      if (!/chat|messeng|intercom|crisp|tidio|voiceflow|botpress|tawk|drift|zopim|landbot|gorgias/i.test(f.url())) continue;
      const t = await f.locator('body').innerText().catch(() => '');
      if (t && t.trim()) morceaux.push(`[iframe ${f.url().slice(0, 90)}]\n${t.trim()}`);
    }
    releve.texte_visible_widget = morceaux.join('\n---\n').slice(0, 4000) || null;

    await page.screenshot({ path: path.join(OUT, `${slug}_${stamp}_widget.png`) });
  } catch (e) {
    releve.erreur = String(e.message || e);
  } finally {
    await ctx.close();
  }

  await fs.writeFile(path.join(OUT, `${slug}_${stamp}.json`),
                     JSON.stringify(releve, null, 2), 'utf8');

  console.log(`\n▸ ${url}`);
  console.log(`  horodatage        : ${releve.horodatage_local} (Europe/Paris)`);
  console.log(`  éditeur détecté   : ${releve.editeur_detecte.join(', ') || 'aucun'}`);
  console.log(`  widget ouvert     : ${releve.widget_ouvert ? 'oui' : 'non'}`);
  if (releve.texte_visible_widget)
    console.log(`  texte relevé      : ${releve.texte_visible_widget.replace(/\n/g, ' ⏎ ').slice(0, 200)}…`);
  if (releve.erreur) console.log(`  ⚠ erreur          : ${releve.erreur}`);
  return releve;
}

const cibles = args.includes('--batch')
  ? (await fs.readFile(flag('--batch'), 'utf8')).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : args.filter(a => a.startsWith('http'));

if (!cibles.length) {
  console.error('Usage : node capture-chatbot.mjs <url> [...] | --batch cibles.txt');
  process.exit(1);
}

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const resultats = [];
for (const u of cibles) resultats.push(await auditer(browser, u));
await browser.close();

await fs.writeFile(path.join(OUT, `_synthese_${new Date().toISOString().slice(0, 10)}.json`),
                   JSON.stringify(resultats, null, 2), 'utf8');
console.log(`\n${resultats.length} cible(s) relevée(s). Pièces dans ${path.resolve(OUT)}`);
console.log('Rappel : ce relevé est un constat, pas une qualification juridique.\n');
