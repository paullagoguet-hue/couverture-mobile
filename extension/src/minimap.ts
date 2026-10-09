/**
 * Mini-carte du panneau : fond de carte du pays + couche de couverture
 * choisie, centrée sur le point recherché.
 *
 * Fonds : Plan IGN gris en France (data.geopf.fr), OpenFreeMap « Positron »
 * (OpenStreetMap, tiles.openfreemap.org) ailleurs, le Plan IGN s'arrêtant à
 * la frontière. Tout passe par les origines autorisées par la CSP.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import { FILL_COLOR_EXPRESSION, SOURCE_LAYER, type CountryCode, type LayerInfo } from '@couverture/core';
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

/** Fond de carte et mention de la source de couverture, par pays. */
const BASEMAPS: Record<CountryCode, { style: string; attribution: string }> = {
  // Plan IGN en niveaux de gris : les couleurs de couverture ressortent.
  fr: { style: 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json', attribution: '© Arcep' },
  es: { style: 'https://tiles.openfreemap.org/styles/positron', attribution: '© Ministerio para la Transformación Digital' },
};

setWorkerUrl(maplibreWorkerUrl);
addProtocol('pmtiles', new Protocol().tile);

export class MiniMap {
  private map: MapLibreMap;
  private ready: Promise<unknown>;
  private marker: Marker;
  private shownLayer: string | undefined;
  private country: CountryCode;
  private attribution: AttributionControl;

  /** Créée avec le fond du pays du premier résultat (changer de style en cours de chargement est coûteux). */
  constructor(container: HTMLElement, country: CountryCode) {
    this.country = country;
    this.map = new MapLibreMap({
      container,
      style: BASEMAPS[country].style,
      center: [2.4, 46.6],
      zoom: 13,
      attributionControl: false,
      // Carte de contexte : pas de rotation, zoom à la molette seulement sur demande.
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    this.attribution = new AttributionControl({ compact: true, customAttribution: BASEMAPS[country].attribution });
    this.map.addControl(this.attribution, 'bottom-right');
    // Tuile du fond ou de couverture indisponible (réseau, requête annulée en
    // changeant d'opérateur…) : la carte continue avec le reste, rien à signaler
    // à l'utilisateur. Sans ce gestionnaire, MapLibre écrit l'événement brut en erreur.
    this.map.on('error', (e) => console.debug('Mini-carte :', e.error?.message ?? e));
    // Le style OpenFreeMap réclame des pictogrammes de routes absents de ses
    // icônes : une image vide à la place, sans avertissement.
    this.map.setMissingStyleImageResolver((id) => {
      if (!this.map.hasImage(id)) this.map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    this.marker = new Marker({ color: '#b3261e' });
    this.ready = this.map.once('load');
    // Mentions des sources repliées (bouton ⓘ) : dépliées, elles masquent la mini-carte.
    this.map.on('styledata', () => this.collapseAttribution());
  }

  /** Change de fond de carte (et de mention de source) si le pays change. */
  private setCountry(country: CountryCode) {
    if (country === this.country) return;
    this.country = country;
    this.shownLayer = undefined; // les couches ajoutées disparaissent avec l'ancien style
    this.ready = this.map.once('style.load');
    // Fonds sans rapport : nouveau style complet, sans calcul de différence.
    this.map.setStyle(BASEMAPS[country].style, { diff: false });
    this.map.removeControl(this.attribution);
    this.attribution = new AttributionControl({ compact: true, customAttribution: BASEMAPS[country].attribution });
    this.map.addControl(this.attribution, 'bottom-right');
  }

  /**
   * Centre la carte sur le point et y affiche la couche demandée.
   * @param tilesUrl URL absolue du fichier PMTiles de la couche
   */
  async show(country: CountryCode, layer: LayerInfo, tilesUrl: string, lng: number, lat: number, zoom = 13) {
    this.setCountry(country);
    await this.ready;
    const map = this.map;
    // Identifiants préfixés par le pays : « orange-4g » existe en France et en Espagne.
    const id = `${country}:${layer.id}`;
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'vector', url: `pmtiles://${tilesUrl}` });
      // Sous les libellés du fond de carte pour qu'ils restent lisibles.
      const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      map.addLayer(
        {
          id,
          type: 'fill',
          source: id,
          'source-layer': SOURCE_LAYER,
          paint: { 'fill-color': FILL_COLOR_EXPRESSION as unknown as ExpressionSpecification, 'fill-opacity': 0.55 },
        },
        firstLabel,
      );
    }
    if (this.shownLayer && this.shownLayer !== id && map.getLayer(this.shownLayer)) map.setLayoutProperty(this.shownLayer, 'visibility', 'none');
    map.setLayoutProperty(id, 'visibility', 'visible');
    this.shownLayer = id;

    this.marker.setLngLat([lng, lat]).addTo(map);
    // Zoom 13 : quartier / village ; 11 : commune. Jamais sous le zoom mini des tuiles.
    map.jumpTo({ center: [lng, lat], zoom: Math.max(zoom, layer.tiles.minzoom ?? 0) });
  }

  private collapseAttribution() {
    this.map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  }

  /** Le panneau peut changer de taille : MapLibre doit recalculer son canevas. */
  resize() {
    this.map.resize();
  }
}
