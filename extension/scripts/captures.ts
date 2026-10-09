/**
 * Visuels des stores : le vrai panneau de l'extension, rendu dans Edge sans
 * interface sur des données réelles.
 *  - captures 1280 × 800 : panneau posé sur un fond avec une phrase d'accroche ;
 *  - vignettes promotionnelles Chrome / Edge : 440 × 280 et 1400 × 560.
 * Aucun nom ni logo de site tiers.
 *
 * Prérequis : extension compilée, serveur de tuiles lancé.
 * Usage : npm run captures   -> store/captures/*.png, store/promo/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STATUS_COLORS } from '@couverture/core';
import { launch, sleep, type Page } from './edge.ts';

const OUT = resolve(import.meta.dirname, '../store/captures');
const PROMO_OUT = resolve(import.meta.dirname, '../store/promo');
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
    file: '0-accueil.png',
    title: 'Simple, sans compte',
    text: "Tapez une adresse, sélectionnez-la sur une page, ou laissez l'extension lire l'adresse d'une annonce de logement.",
    query: '',
  },
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
  await p.evaluate(`document.documentElement.style.scrollbarWidth = 'none'`);
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

/** Icône de l'extension (barres de signal), en SVG. */
const LOGO = (size: number) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}">
  <rect width="32" height="32" rx="7" fill="#fff"/>
  <rect x="5.4" y="18.9" width="3.8" height="7.7" rx="0.8" fill="#1a5f7a"/><rect x="11.2" y="14.8" width="3.8" height="11.8" rx="0.8" fill="#1a5f7a"/>
  <rect x="17" y="10.7" width="3.8" height="15.9" rx="0.8" fill="#1a5f7a"/><rect x="22.7" y="6.6" width="3.8" height="20" rx="0.8" fill="#1a5f7a"/>
</svg>`;

const pill = (k: keyof typeof STATUS_COLORS, label: string) =>
  `<span class="pill" style="background:${STATUS_COLORS[k].color};color:${STATUS_COLORS[k].textColor}">${label}</span>`;
const PILLS = pill('5g', '5G') + pill('5g-partial', '5G partielle') + pill('4g', '4G') + pill('none', 'Pas de réseau');

const PROMO_STYLE = `
  html, body { margin: 0; overflow: hidden; }
  body { box-sizing: border-box; color: #fff; font-family: 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(circle at 85% 15%, #2a7c9c 0%, transparent 55%), linear-gradient(135deg, #1a5f7a 0%, #0f3b4d 100%); }
  .brand { display: flex; align-items: center; gap: 14px; }
  .pill { display: inline-block; font-weight: 700; border-radius: 8px; white-space: nowrap; }
`;

/** Petite vignette 440 × 280 (Chrome « small promo tile », Edge). */
const smallPromo = () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${PROMO_STYLE}
  body { width: 440px; height: 280px; padding: 0 30px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
  h1 { font-size: 28px; line-height: 1.1; margin: 0; font-weight: 700; }
  p { font-size: 17px; line-height: 1.35; margin: 0; color: #d6e8ef; }
  .pills { display: flex; gap: 6px; }
  .pill { font-size: 13px; padding: 5px 9px; }
</style></head><body>
  <div class="brand">${LOGO(46)}<h1>Vérifier la<br>couverture réseau</h1></div>
  <p>4G et 5G des quatre opérateurs, à n'importe quelle adresse.</p>
  <div class="pills">${PILLS}</div>
</body></html>`;

/** Bannière 1400 × 560 (Chrome « marquee », Edge « large promotional tile »). */
const marquee = (panelPng: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${PROMO_STYLE}
  body { width: 1400px; height: 560px; padding: 0 80px; display: flex; align-items: center; gap: 70px; }
  .text { flex: 1; }
  .brand { margin-bottom: 28px; font-size: 22px; font-weight: 600; color: #d6e8ef; }
  h1 { font-size: 60px; line-height: 1.08; margin: 0 0 20px; font-weight: 700; letter-spacing: -0.01em; }
  p { font-size: 25px; line-height: 1.4; margin: 0 0 30px; color: #d6e8ef; max-width: 620px; }
  .pills { display: flex; gap: 10px; }
  .pill { font-size: 19px; padding: 9px 16px; border-radius: 10px; }
  .visual { position: relative; width: 400px; height: 560px; flex: none; }
  .waves { position: absolute; left: -70px; top: 60px; width: 540px; height: 540px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.10) 0 30%, transparent 30.5% 42%, rgba(255,255,255,0.07) 42.5% 54%, transparent 54.5% 66%, rgba(255,255,255,0.05) 66.5% 78%, transparent 78.5%); }
  .panel { position: absolute; left: 35px; top: 44px; width: 330px; height: 540px; border-radius: 16px 16px 0 0; overflow: hidden;
    background: #fff; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4); }
  .panel img { width: 330px; display: block; }
</style></head><body>
  <div class="text">
    <div class="brand">${LOGO(44)}Vérifier la couverture réseau</div>
    <h1>Votre téléphone<br>captera-t-il&nbsp;?</h1>
    <p>La couverture 4G et 5G des quatre opérateurs à n'importe quelle adresse, avant de réserver ou de louer. D'après les cartes de l'Arcep.</p>
    <div class="pills">${PILLS}</div>
  </div>
  <div class="visual">
    <div class="waves"></div>
    <div class="panel"><img src="data:image/png;base64,${panelPng}" alt=""></div>
  </div>
</body></html>`;

/** Rend une page HTML à la taille donnée et l'enregistre en PNG. */
async function render(browser: Awaited<ReturnType<typeof launch>>, html: string, width: number, height: number, file: string) {
  const canvas = await browser.open('about:blank');
  await canvas.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await canvas.evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close();`);
  await sleep(800);
  const shot = (await canvas.send('Page.captureScreenshot', { format: 'png' })).result.data as string;
  writeFileSync(file, Buffer.from(shot, 'base64'));
  await canvas.close();
}

mkdirSync(OUT, { recursive: true });
mkdirSync(PROMO_OUT, { recursive: true });
const browser = await launch();
try {
  let communePanel = '';
  for (const scene of SCENES) {
    const png = await panelShot(browser, scene);
    if (scene.file === '2-commune.png') communePanel = png;
    const canvas = await browser.open('about:blank');
    await canvas.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await canvas.evaluate(`document.open(); document.write(${JSON.stringify(compose(scene, png))}); document.close();`);
    await sleep(800);
    const shot = (await canvas.send('Page.captureScreenshot', { format: 'png' })).result.data as string;
    writeFileSync(resolve(OUT, scene.file), Buffer.from(shot, 'base64'));
    console.log(`store/captures/${scene.file}`);
    await canvas.close();
  }
  await render(browser, smallPromo(), 440, 280, resolve(PROMO_OUT, 'promo-440x280.png'));
  console.log('store/promo/promo-440x280.png');
  await render(browser, marquee(communePanel), 1400, 560, resolve(PROMO_OUT, 'promo-1400x560.png'));
  console.log('store/promo/promo-1400x560.png');
} finally {
  await browser.close();
}
