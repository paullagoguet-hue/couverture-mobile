/**
 * Mini-carte du panneau : fond Plan IGN (gris) + couche de couverture
 * choisie, centrée sur le point recherché.
 *
 * Tout passe par les deux origines autorisées par la CSP : data.geopf.fr
 * (fond de carte, polices, icônes) et l'hébergement des tuiles de couverture.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import { FILL_COLOR_EXPRESSION, SOURCE_LAYER, type LayerInfo } from '@couverture/core';
import {
  addProtocol,
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
} from 'maplibre-gl';
// Le worker MapLibre est empaqueté dans l'extension (CSP script-src 'self') :
// MapLibre ne sait pas le trouver seul sous chrome-extension:// / moz-extension://.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';

import { TILES_BASE_URL } from './config.ts';

/** Plan IGN en niveaux de gris : les couleurs de couverture ressortent. */
const BASEMAP_STYLE_URL = 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json';
const ARCEP_ATTRIBUTION = '© Arcep';

setWorkerUrl(maplibreWorkerUrl);
addProtocol('pmtiles', new Protocol().tile);

export class MiniMap {
  private map: MapLibreMap;
  private ready: Promise<unknown>;
  private marker: Marker;
  private shownLayer: string | undefined;

  constructor(container: HTMLElement) {
    this.map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE_URL,
      center: [2.4, 46.6],
      zoom: 13,
      attributionControl: false,
      // Carte de contexte : pas de rotation, zoom à la molette seulement sur demande.
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new AttributionControl({ compact: true, customAttribution: ARCEP_ATTRIBUTION }), 'bottom-right');
    this.marker = new Marker({ color: '#b3261e' });
    this.ready = this.map.once('load');
  }

  /** Centre la carte sur le point et y affiche la couche demandée. */
  async show(layer: LayerInfo, lng: number, lat: number) {
    await this.ready;
    const map = this.map;
    if (!map.getSource(layer.id)) {
      map.addSource(layer.id, { type: 'vector', url: `pmtiles://${new URL(layer.tiles.file, TILES_BASE_URL).href}` });
      // Sous les libellés du fond de carte pour qu'ils restent lisibles.
      const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id: layer.id,
          type: 'fill',
          source: layer.id,
          'source-layer': SOURCE_LAYER,
          paint: { 'fill-color': FILL_COLOR_EXPRESSION as unknown as ExpressionSpecification, 'fill-opacity': 0.55 },
        },
        firstLabel,
      );
    }
    if (this.shownLayer && this.shownLayer !== layer.id) map.setLayoutProperty(this.shownLayer, 'visibility', 'none');
    map.setLayoutProperty(layer.id, 'visibility', 'visible');
    this.shownLayer = layer.id;

    this.marker.setLngLat([lng, lat]).addTo(map);
    // Zoom 13 : quartier / village, au-dessus du zoom mini des tuiles 4G (z10).
    map.jumpTo({ center: [lng, lat], zoom: Math.max(13, layer.tiles.minzoom ?? 0) });
  }

  /** Le panneau peut changer de taille : MapLibre doit recalculer son canevas. */
  resize() {
    this.map.resize();
  }
}
