/**
 * Test de bout en bout dans un vrai navigateur Chromium (Edge ou Chrome),
 * sans interface : l'extension compilée (dist/chrome) est chargée dans un
 * profil temporaire, puis le panneau est ouvert sous son adresse
 * chrome-extension:// — donc avec la CSP réelle de l'extension — sur
 * plusieurs cas. Relève les verdicts, la mini-carte et les erreurs (CSP,
 * réseau, exceptions).
 *
 * Prérequis : extension compilée, serveur de tuiles lancé (npm run dev -w couverture-mobile-web).
 * Usage : node scripts/e2e-edge.ts   (CHROMIUM_PATH pour un autre navigateur)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const BROWSER = process.env.CHROMIUM_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const EXT_DIR = resolve(import.meta.dirname, '../dist/chrome');

const CASES = [
  { name: 'Adresse exacte (Paris)', query: 'q=10 Rue de Rivoli 75004 Paris' },
  { name: 'Commune (habitants)', query: 'q=Bonneval-sur-Arc' },
  {
    name: 'Annonce approximative (1 km)',
    query: `page=${JSON.stringify({ name: 'Test', address: 'Tours', lat: 47.4066, lng: 0.6819, precision: 'approximate', radiusM: 1000 })}`,
  },
  { name: 'Adresse introuvable', query: 'q=xqzwv kkjjhh' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connexion CDP minimale à une cible ; collecte console, exceptions et journal. */
async function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map<number, (m: any) => void>();
  const problems: string[] = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(`exception : ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(`console.${msg.params.type} : ${msg.params.args.map((a: any) => a.value ?? a.description).join(' ')}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(`journal : ${msg.params.entry.text}`);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method: string, params: object = {}) =>
    new Promise<any>((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Log.enable');
  return { send, problems, close: () => ws.close() };
}

const profile = mkdtempSync(join(tmpdir(), 'e2e-edge-'));
const browser = spawn(
  BROWSER,
  [
    '--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, `--remote-debugging-port=${PORT}`, 'about:blank',
  ],
  { stdio: 'ignore' },
);

let failures = 0;
try {
  // Attente du navigateur et du service worker de l'extension.
  let extId: string | undefined;
  for (let i = 0; i < 40 && !extId; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      extId = targets.map((t: any) => t.url.match(/^chrome-extension:\/\/([a-p]{32})\/background\.js$/)?.[1]).find(Boolean);
    } catch {
      // navigateur pas encore prêt
    }
  }
  if (!extId) throw new Error("service worker de l'extension introuvable");
  console.log(`Extension chargée : ${extId}\n`);

  for (const c of CASES) {
    const url = `chrome-extension://${extId}/panel.html?${c.query.replace(/ /g, '%20')}`;
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
    const page = await connect(target.webSocketDebuggerUrl);
    await sleep(7000);
    const { result } = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `({
        titre: document.querySelector('h2')?.innerText ?? document.querySelector('#result')?.innerText.slice(0, 80),
        verdicts: [...document.querySelectorAll('.coverage tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim()),
        carte: !!document.querySelector('#minimap canvas'),
        note: document.querySelector('.area-note')?.innerText ?? null,
      })`,
    });
    const r = result.result.value;
    const ok = !page.problems.length;
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${c.name} — ${r.titre}`);
    for (const v of r.verdicts) console.log(`    ${v}`);
    if (r.note) console.log(`    note : ${r.note}`);
    if (r.verdicts.length) console.log(`    mini-carte : ${r.carte ? 'affichée' : 'ABSENTE'}`);
    if (r.verdicts.length && !r.carte) failures++;
    for (const p of page.problems) console.log(`    ⚠ ${p}`);
    page.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
  }
} finally {
  // Sous Windows, Edge relance des processus qui verrouillent le profil : on
  // arrête tous ceux qui l'utilisent (repérés par leur ligne de commande).
  browser.kill();
  if (process.platform === 'win32') {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
    spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  }
  await sleep(1500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    console.warn(`(profil temporaire non supprimé : ${profile})`);
  }
}
console.log(failures ? `\n${failures} problème(s)` : '\nAucun problème détecté');
process.exit(failures ? 1 : 0);
