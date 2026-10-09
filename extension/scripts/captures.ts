/**
 * Captures d'écran des stores (1280 × 800, PNG) : le vrai panneau de
 * l'extension, rendu dans Edge sans interface sur des données réelles, posé
 * sur un fond avec une phrase d'accroche. Aucun nom ni logo de site tiers.
 *
 * Prérequis : extension compilée, serveur de tuiles lancé.
 * Usage : npm run captures   -> store/captures/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { launch, sleep, type Page } from './edge.ts';

const OUT = resolve(import.meta.dirname, '../store/captures');
const PANEL_W = 400, PANEL_H = 770;

interface Scene {
  file: string;
  title: string;
  text: string;
  query: string;
  /** Action dans le panneau avant la capture (ex. saisie). */
  prepare?: (page: Page) => Promise<void>;
}

const page = (o: object) => `page=${encodeURIComponent(JSON.stringify(o))}`;

const SCENES: Scene[] = [
  {
    file: '1-adresse.png',
    title: 'Votre téléphone captera-t-il ?',
    text: "La couverture 4G et 5G des quatre opérateurs à n'importe quelle adresse, d'après les cartes publiques de l'Arcep.",
    query: 'q=10%20Rue%20de%20Rivoli%2075004%20Paris',
  },
  {
    file: '2-commune.png',
    title: 'Un verdict clair par opérateur',
    text: 'Vert : 5G partout. Jaune : 5G sur une partie. Orange : 4G. Rouge : 4G faible ou pas de réseau. Pour une commune, calculé sur ses habitants.',
    query: 'q=Bonneval-sur-Arc',
  },
  {
    file: '3-annonce.png',
    title: "Même quand l'adresse est cachée",
    text: "Pour une annonce dont l'adresse exacte n'est pas publiée, la couverture est évaluée dans un rayon de 1 à 2 km.",
    query: page({ name: 'Chalet en montagne', address: 'Freissinières', lat: 44.742, lng: 6.48946, precision: 'approximate', radiusM: 1000 }),
  },
  {
    file: '4-saisie.png',
    title: 'Sélectionnez, ou tapez une adresse',
    text: 'Clic droit sur une adresse dans une page, ou saisie avec suggestions : le résultat s’affiche dans le panneau latéral.',
    query: '',
    prepare: async (p) => {
      await p.evaluate(`(() => {
        const input = document.querySelector('#search input');
        input.value = '12 place bellecour ly';
        input.dispatchEvent(new Event('input'));
      })()`);
      await sleep(2500);
    },
  },
];

async function panelShot(browser: Awaited<ReturnType<typeof launch>>, scene: Scene): Promise<string> {
  const p = await browser.open(`panel.html${scene.query ? `?${scene.query}` : ''}`);
  await p.send('Emulation.setDeviceMetricsOverride', { width: PANEL_W, height: PANEL_H, deviceScaleFactor: 2, mobile: false });
  await sleep(7000); // géocodage, tuiles, mini-carte
  await scene.prepare?.(p);
  const shot = (await p.send('Page.captureScreenshot', { format: 'png' })).result.data as string;
  if (p.problems.length) console.warn(`  ⚠ ${scene.file} : ${p.problems.join(' | ')}`);
  await p.close();
  return shot;
}

function compose(scene: Scene, png: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
    body { display: flex; align-items: center; gap: 72px; padding: 0 96px; box-sizing: border-box;
      background: linear-gradient(135deg, #1a5f7a 0%, #123f52 100%); color: #fff;
      font-family: 'Segoe UI', system-ui, sans-serif; }
    .text { flex: 1; }
    h1 { font-size: 46px; line-height: 1.15; margin: 0 0 24px; font-weight: 700; }
    p { font-size: 23px; line-height: 1.45; margin: 0; color: #d6e8ef; }
    .bars { display: flex; gap: 6px; align-items: flex-end; height: 34px; margin-bottom: 28px; }
    .bars i { display: block; width: 12px; background: #fff; border-radius: 2px; }
    .panel { width: ${PANEL_W}px; height: ${PANEL_H - 40}px; border-radius: 14px; overflow: hidden; background: #fff;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35); flex: none; }
    .panel img { width: ${PANEL_W}px; display: block; }
  </style></head><body>
    <div class="text">
      <div class="bars"><i style="height:30%"></i><i style="height:52%"></i><i style="height:76%"></i><i style="height:100%"></i></div>
      <h1>${scene.title}</h1><p>${scene.text}</p>
    </div>
    <div class="panel"><img src="data:image/png;base64,${png}" alt=""></div>
  </body></html>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await launch();
try {
  for (const scene of SCENES) {
    const png = await panelShot(browser, scene);
    const canvas = await browser.open('about:blank');
    await canvas.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await canvas.evaluate(`document.open(); document.write(${JSON.stringify(compose(scene, png))}); document.close();`);
    await sleep(800);
    const shot = (await canvas.send('Page.captureScreenshot', { format: 'png' })).result.data as string;
    writeFileSync(resolve(OUT, scene.file), Buffer.from(shot, 'base64'));
    console.log(`store/captures/${scene.file}`);
    await canvas.close();
  }
} finally {
  await browser.close();
}
