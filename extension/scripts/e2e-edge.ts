/**
 * Test de bout en bout dans un vrai navigateur Chromium (Edge ou Chrome),
 * sans interface : l'extension compilée (dist/chrome) est chargée dans un
 * profil temporaire, puis le panneau est ouvert sous son adresse
 * chrome-extension:// — donc avec la CSP réelle de l'extension — sur
 * plusieurs cas. Relève les verdicts, la mini-carte et les erreurs (CSP,
 * réseau, exceptions). Les cas « clics rapprochés » enchaînent deux demandes
 * presque simultanées : seule la dernière doit s'afficher, sans erreur.
 *
 * Prérequis : extension compilée, serveur de tuiles lancé (npm run dev -w couverture-mobile-web).
 * Usage : npm run test:e2e   (CHROMIUM_PATH pour un autre navigateur)
 */
import { launch, sleep } from './edge.ts';

/** Saisie manuelle dans le panneau, puis Entrée. */
const type = (text: string) =>
  `{ const i = document.querySelector('#search input'); i.value = ${JSON.stringify(text)}; document.querySelector('#search').requestSubmit(); }`;
/** Demande déposée par l'arrière-plan (clic sur l'encadré d'une annonce). */
const fromCard = (page: object) =>
  `await chrome.storage.session.set({ pendingQuery: { kind: 'page', ...${JSON.stringify(page)}, at: Date.now() } });`;
const pause = (ms: number) => `await new Promise((r) => setTimeout(r, ${ms}));`;
/** Attend que la recherche en cours télécharge la couverture (moment où l'annuler était risqué). */
const whileReading = `for (let t = 0; t < 5000 && !document.querySelector('.loading')?.textContent.includes('Lecture'); t++) ${pause(2)}`;
const TOURS = { name: 'Gîte', address: 'Tours', lat: 47.4066, lng: 0.6819, precision: 'approximate', radiusM: 1000 };

interface Case {
  name: string;
  /** Paramètres de panel.html (q= ou page=) ; absent : panneau ouvert sur l'accueil. */
  query?: string;
  /** Actions enchaînées dans le panneau après son ouverture. */
  actions?: string;
  /** Résultat attendu : titre affiché, note de zone, bandeau « lu sur la page ». */
  expect?: { titre?: string; note?: RegExp; fromPage?: boolean };
}

const CASES: Case[] = [
  { name: 'Adresse exacte (Paris)', query: 'q=10 Rue de Rivoli 75004 Paris' },
  { name: 'Commune (habitants)', query: 'q=Bonneval-sur-Arc', expect: { note: /habitants/ } },
  { name: 'Annonce approximative (1 km)', query: `page=${JSON.stringify(TOURS)}`, expect: { note: /1 km/, fromPage: true } },
  { name: 'Adresse introuvable', query: 'q=xqzwv kkjjhh' },
  { name: 'Espagne : adresse (pays choisi)', query: 'pays=es&q=Calle Mayor 1 Madrid', expect: { titre: 'Calle Mayor 1' } },
  { name: 'Espagne : clic droit, pays reconnu', query: 'q=Gran Vía 28, Madrid', expect: { titre: 'Gran Via 28' } },
  { name: 'Espagne : clic droit sur un nom de ville', query: 'q=Benidorm', expect: { titre: 'Benidorm' } },
  {
    name: 'Espagne : annonce sans coordonnées, pays publié',
    query: `page=${JSON.stringify({ name: 'Hotel', address: 'Calle Mayor 1, 28013 Madrid', country: 'ES' })}`,
    expect: { titre: 'Calle Mayor 1', fromPage: true },
  },
  {
    name: 'Espagne : annonce avec coordonnées',
    query: `page=${JSON.stringify({ name: 'Piso', address: 'Madrid', lat: 40.4168, lng: -3.7038, precision: 'approximate', radiusM: 1000 })}`,
    expect: { titre: 'Madrid', note: /1 km/, fromPage: true },
  },
  { name: 'Portugal : adresse (pays choisi)', query: 'pays=pt&q=Rua Augusta 100 Lisboa', expect: { titre: 'Rua Augusta 100' } },
  { name: 'Portugal : clic droit, pays reconnu', query: 'q=Rua Augusta 100, Lisboa', expect: { titre: 'Rua Augusta 100' } },
  {
    name: 'Portugal : annonce avec coordonnées',
    query: `page=${JSON.stringify({ name: 'Apartamento', address: 'Lisboa', lat: 38.7223, lng: -9.1393, precision: 'approximate', radiusM: 1000 })}`,
    expect: { titre: 'Lisboa', note: /1 km/, fromPage: true },
  },
  { name: 'Belgique : adresse (pays choisi)', query: 'pays=be&q=Rue de la Loi 16 Bruxelles', expect: { titre: 'Rue de la Loi' } },
  { name: 'Belgique : clic droit, pays reconnu', query: 'q=Meir 50, Antwerpen', expect: { titre: 'Meir 50' } },
  {
    name: 'Belgique : annonce avec coordonnées',
    query: `page=${JSON.stringify({ name: 'Appartement', address: 'Bruxelles', lat: 50.8467, lng: 4.3525, precision: 'approximate', radiusM: 1000 })}`,
    expect: { titre: 'Bruxelles', note: /1 km/, fromPage: true },
  },
  { name: 'Anglais : commune', query: 'lang=en&q=Bonneval-sur-Arc', expect: { titre: 'Bonneval-sur-Arc', note: /250 residents/ } },
  {
    name: 'Espagnol : annonce à Madrid',
    query: `lang=es&page=${JSON.stringify({ name: 'Piso', address: 'Madrid', lat: 40.4168, lng: -3.7038, precision: 'approximate', radiusM: 1000 })}`,
    expect: { titre: 'Madrid', note: /radio de 1 km/, fromPage: true },
  },
  {
    name: 'Clics rapprochés : France puis Espagne',
    actions: type('10 Rue de Rivoli 75004 Paris') + whileReading + fromCard({ name: 'Piso', address: 'Madrid', lat: 40.4168, lng: -3.7038, precision: 'approximate', radiusM: 1000 }),
    expect: { titre: 'Madrid', fromPage: true },
  },
  {
    name: 'Clics rapprochés : saisie puis encadré',
    actions: type('15 Boulevard de la Liberté 59800 Lille') + whileReading + fromCard(TOURS),
    expect: { titre: 'Tours', note: /1 km/, fromPage: true },
  },
  {
    name: 'Clics rapprochés : encadré puis saisie',
    actions: fromCard(TOURS) + pause(150) + type('Place Bellecour 69002 Lyon'),
    expect: { titre: 'Bellecour', fromPage: false },
  },
  {
    name: 'Clics rapprochés : deux communes du même département',
    actions: type('Bonneval-sur-Arc') + whileReading + type('Bessans'),
    expect: { titre: 'Bessans', note: /habitants/ },
  },
];

const browser = await launch();
console.log(`Extension chargée : ${browser.extensionId}\n`);
let failures = 0;
try {
  for (const c of CASES) {
    // Français sauf indication contraire (la langue du navigateur de test peut varier).
    const query = /(^|&)lang=/.test(c.query ?? '') ? c.query! : [c.query, 'lang=fr'].filter(Boolean).join('&');
    const page = await browser.open(`panel.html?${query.replace(/ /g, '%20')}`);
    if (c.actions) {
      await sleep(1500);
      await page.evaluate(`(async () => { ${c.actions} })()`);
    }
    await sleep(7000);
    const r = await page.evaluate<{
      titre: string;
      verdicts: string[];
      carte: boolean;
      note: string | null;
      fromPage: boolean;
      encart: string | null;
    }>(`({
      titre: document.querySelector('h2')?.innerText ?? document.querySelector('#result')?.innerText.slice(0, 80),
      verdicts: [...document.querySelectorAll('.operators li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()),
      carte: !!document.querySelector('#minimap canvas'),
      note: document.querySelector('.area-note')?.innerText ?? null,
      fromPage: !!document.querySelector('.from-page'),
      encart: document.querySelector('.encart')?.innerText.replace(/\\s+/g, ' ') ?? null,
    })`);
    const x = c.expect;
    const mismatch = [
      x?.titre && !r.titre?.includes(x.titre) && `titre attendu : « ${x.titre} »`,
      x?.note && !x.note.test(r.note ?? '') && `note attendue : ${x.note}`,
      x?.fromPage !== undefined && x.fromPage !== r.fromPage && `bandeau « lu sur la page » ${x.fromPage ? 'absent' : 'en trop'}`,
    ].filter((m): m is string => !!m);
    const ok = !page.problems.length && !mismatch.length && (!r.verdicts.length || r.carte);
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${c.name} — ${r.titre}`);
    for (const v of r.verdicts) console.log(`    ${v}`);
    if (r.note) console.log(`    note : ${r.note}`);
    if (r.encart) console.log(`    encart : ${r.encart}`);
    if (r.verdicts.length) console.log(`    mini-carte : ${r.carte ? 'affichée' : 'ABSENTE'}`);
    for (const p of [...mismatch, ...page.problems]) console.log(`    ⚠ ${p}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} problème(s)` : '\nAucun problème détecté');
process.exit(failures ? 1 : 0);
