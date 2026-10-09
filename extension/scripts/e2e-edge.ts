/**
 * Test de bout en bout dans un vrai navigateur Chromium (Edge ou Chrome),
 * sans interface : l'extension compilée (dist/chrome) est chargée dans un
 * profil temporaire, puis le panneau est ouvert sous son adresse
 * chrome-extension:// — donc avec la CSP réelle de l'extension — sur
 * plusieurs cas. Relève les verdicts, la mini-carte et les erreurs (CSP,
 * réseau, exceptions).
 *
 * Prérequis : extension compilée, serveur de tuiles lancé (npm run dev -w couverture-mobile-web).
 * Usage : npm run test:e2e   (CHROMIUM_PATH pour un autre navigateur)
 */
import { launch, sleep } from './edge.ts';

const CASES = [
  { name: 'Adresse exacte (Paris)', query: 'q=10 Rue de Rivoli 75004 Paris' },
  { name: 'Commune (habitants)', query: 'q=Bonneval-sur-Arc' },
  {
    name: 'Annonce approximative (1 km)',
    query: `page=${JSON.stringify({ name: 'Test', address: 'Tours', lat: 47.4066, lng: 0.6819, precision: 'approximate', radiusM: 1000 })}`,
  },
  { name: 'Adresse introuvable', query: 'q=xqzwv kkjjhh' },
];

const browser = await launch();
console.log(`Extension chargée : ${browser.extensionId}\n`);
let failures = 0;
try {
  for (const c of CASES) {
    const page = await browser.open(`panel.html?${c.query.replace(/ /g, '%20')}`);
    await sleep(7000);
    const r = await page.evaluate<{ titre: string; verdicts: string[]; carte: boolean; note: string | null; encart: string | null }>(`({
      titre: document.querySelector('h2')?.innerText ?? document.querySelector('#result')?.innerText.slice(0, 80),
      verdicts: [...document.querySelectorAll('.coverage tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim()),
      carte: !!document.querySelector('#minimap canvas'),
      note: document.querySelector('.area-note')?.innerText ?? null,
      encart: document.querySelector('.encart')?.innerText.replace(/\\s+/g, ' ') ?? null,
    })`);
    const ok = !page.problems.length && (!r.verdicts.length || r.carte);
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${c.name} — ${r.titre}`);
    for (const v of r.verdicts) console.log(`    ${v}`);
    if (r.note) console.log(`    note : ${r.note}`);
    if (r.encart) console.log(`    encart : ${r.encart}`);
    if (r.verdicts.length) console.log(`    mini-carte : ${r.carte ? 'affichée' : 'ABSENTE'}`);
    for (const p of page.problems) console.log(`    ⚠ ${p}`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} problème(s)` : '\nAucun problème détecté');
process.exit(failures ? 1 : 0);
