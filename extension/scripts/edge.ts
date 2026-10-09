/**
 * Pilotage d'un Chromium sans interface (Edge par défaut) avec l'extension
 * compilée chargée dans un profil temporaire, via le protocole de débogage
 * (CDP). Partagé par le test de bout en bout et la génération des captures.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const BROWSER = process.env.CHROMIUM_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const EXT_DIR = resolve(import.meta.dirname, '../dist/chrome');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Page {
  send(method: string, params?: object): Promise<any>;
  /** Exceptions, erreurs et avertissements de console, erreurs du journal (CSP, réseau…). */
  problems: string[];
  evaluate<T = unknown>(expression: string): Promise<T>;
  close(): Promise<void>;
}

/** Connexion CDP minimale à une cible ; collecte console, exceptions et journal. */
async function connect(wsUrl: string, onClose: () => Promise<void>): Promise<Page> {
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
  return {
    send,
    problems,
    evaluate: async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value,
    close: async () => {
      ws.close();
      await onClose();
    },
  };
}

export interface Browser {
  extensionId: string;
  /** Ouvre une page (URL absolue, ou chemin de l'extension : « panel.html?q=… »). */
  open(url: string): Promise<Page>;
  close(): Promise<void>;
}

export async function launch(): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-edge-'));
  const proc = spawn(
    BROWSER,
    [
      '--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
      `--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, `--remote-debugging-port=${PORT}`, 'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const close = async () => {
    // Sous Windows, Edge relance des processus qui verrouillent le profil : on
    // arrête tous ceux qui l'utilisent (repérés par leur ligne de commande).
    proc.kill();
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
  };

  // Attente du navigateur et du service worker de l'extension.
  let extensionId: string | undefined;
  for (let i = 0; i < 40 && !extensionId; i++) {
    await sleep(500);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      extensionId = targets.map((t: any) => t.url.match(/^chrome-extension:\/\/([a-p]{32})\/background\.js$/)?.[1]).find(Boolean);
    } catch {
      // navigateur pas encore prêt
    }
  }
  if (!extensionId) {
    await close();
    throw new Error("service worker de l'extension introuvable");
  }

  return {
    extensionId,
    async open(url) {
      const full = /^[a-z-]+:/.test(url) ? url : `chrome-extension://${extensionId}/${url}`;
      const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(full)}`, { method: 'PUT' })).json();
      return connect(target.webSocketDebuggerUrl, async () => {
        await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
      });
    },
    close,
  };
}
