/**
 * Construit l'extension pour Chrome/Edge et pour Firefox :
 *   dist/chrome/   (charger via chrome://extensions ou edge://extensions > « Charger l'extension non empaquetée »)
 *   dist/firefox/  (charger via about:debugging > « Ce Firefox » > « Charger un module complémentaire temporaire »)
 *
 * Les deux versions partagent le même code ; seul le manifeste diffère :
 *   - arrière-plan : service worker (Chrome) / page d'événements (Firefox,
 *     qui ne gère pas les service workers d'extension) ;
 *   - panneau : side_panel + permission sidePanel (Chrome) / sidebar_action (Firefox).
 *
 * Usage : node build.ts   (variables VITE_TILES_BASE_URL et VITE_SITE_URL pour la prod)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, loadEnv } from 'vite';

import { ICON_SIZES } from './src/icon.ts';
import { LANGS, messagesFor } from './src/i18n.ts';
import { LODGING_MATCHES } from './src/lodging.ts';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = (await import('./package.json', { with: { type: 'json' } })).default;

const env = { ...loadEnv('production', root, 'VITE_'), ...process.env };
const tilesBase = env.VITE_TILES_BASE_URL ?? 'http://127.0.0.1:5173/tiles/';
/** Notre géocodeur Photon (cf. src/config.ts). */
const photonUrl = env.VITE_PHOTON_URL ?? 'http://127.0.0.1:2322/api';
/**
 * Services contactés, en plus de l'hébergement des tuiles :
 *  - data.geopf.fr : géocodage et fond de carte en France (IGN) ;
 *  - www.cartociudad.es : géocodage en Espagne (IGN España) ;
 *  - notre serveur Photon : géocodage au Portugal, en Belgique, au Luxembourg, en Italie (OpenStreetMap) ;
 *  - tiles.openfreemap.org : fond de carte hors de France (OpenStreetMap) ;
 *  - geo3.agcom.it : nombre de réseaux en Italie et images de la carte (AGCOM) ;
 *  - api3.geo.admin.ch, data.geo.admin.ch, wmts.geo.admin.ch : géocodage, nombre
 *    de réseaux et images de la carte en Suisse (swisstopo, OFCOM).
 */
const SERVICE_ORIGINS = [
  'https://data.geopf.fr',
  'https://www.cartociudad.es',
  new URL(photonUrl).origin,
  'https://tiles.openfreemap.org',
  'https://geo3.agcom.it',
  'https://api3.geo.admin.ch',
  'https://data.geo.admin.ch',
  'https://wmts.geo.admin.ch',
];

/**
 * CSP des pages de l'extension. `connect-src` liste les SEULES origines que
 * l'extension peut contacter : les services ci-dessus et l'hébergement des tuiles.
 * Aucune permission d'hôte n'est demandée : ces serveurs autorisent le CORS.
 */
const csp = [
  "script-src 'self'",
  "object-src 'self'",
  `connect-src ${SERVICE_ORIGINS.join(' ')} ${new URL(tilesBase).origin}`,
].join('; ');

/**
 * Développement uniquement : quand les tuiles sont servies par la machine
 * locale, Chromium (protection « accès au réseau local ») exige une permission
 * d'hôte explicite pour cette adresse. Le build de production (tuiles en ligne)
 * n'a AUCUNE permission d'hôte.
 */
const isLoopbackUrl = (url: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
const localOrigins = [tilesBase, photonUrl].filter(isLoopbackUrl).map((url) => `${new URL(url).origin}/*`);
const isLoopback = localOrigins.length > 0;
const devHostPermissions = isLoopback ? { host_permissions: localOrigins } : {};

const icons = Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/icon-${s}.png`]));
const detectedIcons = Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/icon-${s}-detected.png`]));

/**
 * Permissions communes, toutes sans avertissement à l'installation :
 *  - contextMenus : entrées « Vérifier la couverture réseau » (sélection) et
 *    « Vérifier la connexion de cet hébergement » (pages reconnues) ;
 *  - storage : transmettre la requête de l'arrière-plan au panneau ;
 *  - activeTab + scripting : au clic de l'utilisateur seulement, lire l'adresse
 *    publiée par la page d'hébergement active (accès temporaire à cet onglet).
 */
const basePermissions = ['contextMenus', 'storage', 'activeTab', 'scripting'];

/**
 * Carte « Vérifier la connexion de cet hébergement ? » : content script limité
 * aux fiches d'hébergement reconnues. Il n'affiche que la carte ; la page n'est
 * lue qu'au clic sur [Vérifier]. (Implique un accès à ces seules pages, signalé
 * à l'installation.)
 */
const contentScripts = [{ matches: LODGING_MATCHES, js: ['card.js'], run_at: 'document_idle' }];

const common = {
  manifest_version: 3,
  // Nom, description et titres traduits par le navigateur (fichiers _locales, cf. writeLocales).
  name: '__MSG_extName__',
  version: pkg.version,
  description: '__MSG_extDescription__',
  default_locale: 'fr',
  icons,
  action: { default_title: '__MSG_extName__', default_icon: icons },
  content_security_policy: { extension_pages: csp },
  content_scripts: contentScripts,
  ...devHostPermissions,
};

const manifests = {
  chrome: {
    ...common,
    // declarativeContent : pastille sur l'icône des pages d'hébergement, évaluée par le navigateur.
    permissions: [...basePermissions, 'sidePanel', 'declarativeContent'],
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'panel.html' },
    minimum_chrome_version: '116', // sidePanel.open()
  },
  firefox: {
    ...common,
    permissions: basePermissions,
    background: { scripts: ['background.js'] },
    // Icône dans la barre d'adresse, affichée par Firefox sur les seules pages d'hébergement.
    page_action: { default_title: '__MSG_menuPage__', default_icon: detectedIcons, show_matches: LODGING_MATCHES },
    sidebar_action: { default_panel: 'panel.html', default_title: '__MSG_extName__', open_at_install: false },
    browser_specific_settings: {
      gecko: {
        id: '{7c3e9a52-4b1d-4f0e-9d8a-2f6b1e5c0a13}',
        // Consentement intégré à Firefox pour les données transmises : 140+.
        strict_min_version: '140.0',
        // Données qui quittent le navigateur (catégories Mozilla), toutes nécessaires au service :
        //  - websiteContent : texte sélectionné / adresse lue sur la page -> géocodeur IGN ;
        //  - searchTerms    : adresse tapée dans le panneau -> géocodeur IGN ;
        //  - locationInfo   : position du lieu, déductible des tuiles demandées -> hébergement des tuiles.
        data_collection_permissions: { required: ['websiteContent', 'searchTerms', 'locationInfo'] },
      },
    },
  },
};

/** _locales/<langue>/messages.json : textes du manifeste, tirés du dictionnaire de l'extension. */
/** Noms de dossier imposés par Chrome (liste fermée : « pt » et « zh » seuls sont refusés). */
const LOCALE_DIRS: Partial<Record<(typeof LANGS)[number], string>> = { pt: 'pt_PT', zh: 'zh_CN' };

function writeLocales(outDir: string) {
  for (const lang of LANGS) {
    const m = messagesFor(lang);
    const messages = Object.fromEntries((['extName', 'extDescription', 'menuPage'] as const).map((k) => [k, { message: m[k] }]));
    const dir = resolve(outDir, '_locales', LOCALE_DIRS[lang] ?? lang);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'messages.json'), JSON.stringify(messages, null, 2) + '\n');
  }
}

for (const [target, manifest] of Object.entries(manifests)) {
  const outDir = resolve(root, 'dist', target);

  // Panneau (page HTML + modules).
  await build({
    root,
    base: './',
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'panel.html') },
      // MapLibre (~1 Mo) est chargé depuis le paquet de l'extension, pas par le réseau.
      chunkSizeWarningLimit: 1500,
    },
  });

  // Arrière-plan et carte : chacun un seul fichier sans import (scripts classiques :
  // service worker Chrome, script d'arrière-plan Firefox, content script).
  for (const name of ['background', 'card']) {
    await build({
      root,
      logLevel: 'warn',
      build: {
        outDir,
        emptyOutDir: false,
        lib: { entry: resolve(root, `src/${name}.ts`), formats: ['iife'], name, fileName: () => `${name}.js` },
      },
    });
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeLocales(outDir);
  console.log(`dist/${target} : OK (CSP ${csp}${isLoopback ? ' ; build de DEV : permissions d\x27hôte ' + localOrigins.join(' ') : ''})`);
}
