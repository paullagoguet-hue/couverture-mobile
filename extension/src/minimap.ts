/**
 * Mini-carte du panneau : fond de carte du pays + couche de couverture
 * choisie, centrée sur le point recherché.
 *
 * Fonds : Plan IGN gris en France (data.geopf.fr), OpenFreeMap « Positron »
 * (OpenStreetMap, tiles.openfreemap.org) ailleurs, le Plan IGN s'arrêtant à
 * la frontière. Tout passe par les origines autorisées par la CSP.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

import { FILL_COLOR_EXPRESSION, SOURCE_LAYER, type CountryCode, type LayerInfo, type NetworkShapes, type NetworkSource, type NetworkTechno } from '@couverture/core';
import {
  addProtocol,
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
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
  pt: { style: 'https://tiles.openfreemap.org/styles/positron', attribution: '© ANACOM' },
  be: { style: 'https://tiles.openfreemap.org/styles/positron', attribution: '© IBPT-BIPT' },
  lu: { style: 'https://tiles.openfreemap.org/styles/positron', attribution: '© ILR' },
  it: { style: 'https://tiles.openfreemap.org/styles/positron', attribution: '© AGCOM' },
  ch: { style: 'https://tiles.openfreemap.org/styles/positron', attribution: '© OFCOM, swisstopo' },
};

/** Images des cartes officielles (Italie, Suisse) : lisibles à partir de ce zoom. */
const NETWORKS_MIN_ZOOM = 7;

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
  /** `fill` : couleur des zones (expression MapLibre) ; par défaut, les niveaux de l'Arcep. */
  async show(country: CountryCode, layer: LayerInfo, tilesUrl: string, lng: number, lat: number, zoom = 13, fill: unknown = FILL_COLOR_EXPRESSION) {
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
          paint: { 'fill-color': fill as ExpressionSpecification, 'fill-opacity': 0.55 },
        },
        firstLabel,
      );
    }
    if (this.shownLayer && this.shownLayer !== id && map.getLayer(this.shownLayer)) map.setLayoutProperty(this.shownLayer, 'visibility', 'none');
    map.setLayoutProperty(id, 'visibility', 'visible');
    this.shownLayer = id;

    // Pas de dézoom sous le zoom mini des tuiles : la couverture y disparaîtrait
    // (4G et Espagne : zoom 10, soit environ 40 km de large).
    this.center(lng, lat, zoom, layer.tiles.minzoom ?? 0);
  }

  /**
   * Nombre de réseaux (Italie, Suisse), sous les libellés du fond de carte :
   * zones lues autour du lieu (`shapes`, Italie), sinon images de la carte
   * officielle (Suisse), aux couleurs de la légende officielle.
   */
  async showNetworks(source: NetworkSource, techno: NetworkTechno, shapes: NetworkShapes | undefined, lng: number, lat: number, zoom = 13) {
    this.setCountry(source.country);
    await this.ready;
    const map = this.map;
    const id = `${source.country}:reseaux-${techno}`;
    const firstLabel = () => map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    if (shapes) {
      // Zones propres à ce lieu : remplacées à chaque recherche.
      const existing = map.getSource(id) as GeoJSONSource | undefined;
      if (existing) existing.setData(shapes as GeoJSON.FeatureCollection);
      else {
        map.addSource(id, { type: 'geojson', data: shapes as GeoJSON.FeatureCollection });
        const color = ['match', ['get', 'n'], ...source.colors.flatMap((c, i) => [i + 1, c]), 'transparent'] as unknown as ExpressionSpecification;
        map.addLayer({ id, type: 'fill', source: id, paint: { 'fill-color': color, 'fill-opacity': 0.55 } }, firstLabel());
      }
    } else if (source.overlay && !map.getSource(id)) {
      map.addSource(id, { type: 'raster', tiles: [source.overlay[techno]], tileSize: 256, maxzoom: 16 });
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.55 } }, firstLabel());
    }
    if (this.shownLayer && this.shownLayer !== id && map.getLayer(this.shownLayer)) map.setLayoutProperty(this.shownLayer, 'visibility', 'none');
    map.setLayoutProperty(id, 'visibility', 'visible');
    this.shownLayer = id;
    this.center(lng, lat, zoom, NETWORKS_MIN_ZOOM);
  }

  private center(lng: number, lat: number, zoom: number, minZoom: number) {
    this.map.setMinZoom(minZoom);
    this.marker.setLngLat([lng, lat]).addTo(this.map);
    // Zoom 13 : quartier / village ; 11 : commune.
    this.map.jumpTo({ center: [lng, lat], zoom: Math.max(zoom, minZoom) });
  }

  private collapseAttribution() {
    this.map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  }

  /** Le panneau peut changer de taille : MapLibre doit recalculer son canevas. */
  resize() {
    this.map.resize();
  }
}
