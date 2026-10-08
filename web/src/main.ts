import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import {
  COVERED_COLOR,
  FILL_COLOR_EXPRESSION,
  LEVELS,
  levelInfo,
  loadManifest,
  operatorsOf,
  SOURCE_LAYER,
  technosOf,
  type LayerInfo,
  type Manifest,
} from '@couverture/core';
import {
  addProtocol,
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
} from 'maplibre-gl';
// MapLibre 6 charge son worker depuis un fichier séparé, qu'il cherche à côté
// de son propre module : Vite déplace ce module, on fournit donc l'URL du
// worker explicitement (même mécanisme que dans l'extension).
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';

import { BASEMAP_STYLE_URL, FRANCE_BOUNDS, TILES_BASE_URL } from './config';

setWorkerUrl(maplibreWorkerUrl);

// Le protocole pmtiles:// lit les tuiles directement dans le fichier PMTiles
// par requêtes HTTP « Range » : aucun serveur de tuiles n'est nécessaire.
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

/** Couleur de remplissage selon l'attribut `niveau` (légende partagée avec l'extension). */
const FILL_COLOR = FILL_COLOR_EXPRESSION as unknown as ExpressionSpecification;

const tilesBase = new URL(TILES_BASE_URL, location.href).href;
const fillId = (layer: LayerInfo) => `${layer.id}-fill`;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Sélection opérateur × techno, lue dans l'URL (?operateur=…&techno=…). */
function initialSelection(manifest: Manifest) {
  const params = new URLSearchParams(location.search);
  const ops = operatorsOf(manifest).map((o) => o.id);
  const techs = technosOf(manifest).map((t) => t.id);
  const op = params.get('operateur') ?? '';
  const tech = params.get('techno') ?? '';
  return { operator: ops.includes(op) ? op : ops[0], techno: techs.includes(tech) ? tech : (techs.includes('5g') ? '5g' : techs[0]) };
}

function renderLegend(el: HTMLElement, manifest: Manifest, layer: LayerInfo | undefined, sel: { operator: string; techno: string }) {
  const option = (o: { id: string; label: string }, current: string) =>
    `<option value="${o.id}"${o.id === current ? ' selected' : ''}>${o.label}</option>`;
  const levels = !layer
    ? '<li>Couche non disponible.</li>'
    : layer.has_levels
      ? LEVELS.map(
          (l) => `<li title="${l.description}"><span class="swatch" style="background:${l.color}"></span>${l.label}</li>`,
        ).join('')
      : `<li><span class="swatch" style="background:${COVERED_COLOR}"></span>Zone couverte</li>`;

  el.innerHTML = `
    <div class="selects">
      <label>Opérateur
        <select name="operator">${operatorsOf(manifest).map((o) => option(o, sel.operator)).join('')}</select>
      </label>
      <label>Technologie
        <select name="techno">${technosOf(manifest).map((t) => option({ ...t, label: t.id.toUpperCase() }, sel.techno)).join('')}</select>
      </label>
    </div>
    <p class="zoom-hint" hidden>Zoomez pour afficher la couverture.</p>
    <ul class="levels">${levels}</ul>
    <p class="source">
      ${layer ? `Couverture théorique au ${formatDate(layer.date)}<br />` : ''}
      Source : <a href="${manifest.source.dataset_url}" target="_blank" rel="noopener">Arcep, Mon Réseau Mobile</a>
    </p>`;
}

async function main() {
  const map = new MapLibreMap({
    container: 'map',
    style: BASEMAP_STYLE_URL,
    bounds: FRANCE_BOUNDS,
    // Position dans l'URL (#zoom/lat/lng) : liens partageables, et cible du
    // lien « Voir sur la carte complète » de l'extension.
    hash: true,
    attributionControl: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

  const [manifest] = await Promise.all([loadManifest(tilesBase), map.once('load')]);
  if (!manifest.layers.length) throw new Error('aucune couche dans le manifeste');

  // Une source + une couche de remplissage par couche du manifeste, masquées
  // par défaut : MapLibre ne télécharge les tuiles que des couches visibles.
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  for (const layer of manifest.layers) {
    map.addSource(layer.id, {
      type: 'vector',
      url: `pmtiles://${new URL(layer.tiles.file, tilesBase).href}`,
      attribution: '<a href="https://www.arcep.fr/cartes-et-donnees.html" target="_blank">© Arcep</a>',
    });
    // Sous les libellés du fond de carte, pour qu'ils restent lisibles.
    map.addLayer(
      {
        id: fillId(layer),
        type: 'fill',
        source: layer.id,
        'source-layer': SOURCE_LAYER,
        layout: { visibility: 'none' },
        paint: { 'fill-color': FILL_COLOR, 'fill-opacity': 0.6 },
      },
      firstLabel,
    );
  }

  const legend = document.getElementById('legend')!;
  const sel = initialSelection(manifest);
  let current: LayerInfo | undefined;

  // Certaines couches ne sont tuilées qu'à partir d'un zoom donné (ex. 4G : z10).
  const updateHint = () => {
    const hint = legend.querySelector<HTMLElement>('.zoom-hint');
    if (hint) hint.hidden = !current || map.getZoom() >= (current.tiles.minzoom ?? 0);
  };

  const show = () => {
    if (current) map.setLayoutProperty(fillId(current), 'visibility', 'none');
    current = manifest.layers.find((l) => l.operator === sel.operator && l.techno === sel.techno);
    if (current) map.setLayoutProperty(fillId(current), 'visibility', 'visible');
    renderLegend(legend, manifest, current, sel);
    legend.querySelectorAll('select').forEach((s) =>
      s.addEventListener('change', () => {
        sel[s.name as 'operator' | 'techno'] = s.value;
        show();
      }),
    );
    // Garde la sélection dans l'URL sans toucher à la position (#zoom/lat/lng).
    const url = new URL(location.href);
    url.searchParams.set('operateur', sel.operator);
    url.searchParams.set('techno', sel.techno);
    history.replaceState(null, '', url);
    updateHint();
  };
  show();
  map.on('zoomend', updateHint);

  // Clic : niveau de couverture au point cliqué, pour la couche affichée.
  map.on('click', (e) => {
    if (!current) return;
    const feature = map.queryRenderedFeatures(e.point, { layers: [fillId(current)] })[0];
    if (!feature) return;
    const level = levelInfo(feature.properties?.niveau);
    new Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>${current.operator_label} ${current.techno.toUpperCase()}</strong><br />` +
          (level ? `${level.label}<br /><small>${level.description}</small>` : 'Zone couverte'),
      )
      .addTo(map);
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('legend')!.innerHTML = `<p class="error">Erreur : ${err.message}</p>`;
});
