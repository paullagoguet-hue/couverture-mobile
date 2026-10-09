/**
 * Page « Infos » du panneau : lecture des couleurs, zone évaluée, limites,
 * sources et dates des données, confidentialité, réglages (langue, encadré).
 * Affichée à la place du résultat, qui reste intact derrière (mini-carte
 * comprise) : « Retour » le réaffiche tel quel.
 */
import { STATUS_COLORS, type CountryCode, type Manifest, type StatusKind } from '@couverture/core';

import { PRIVACY_URL } from './config.ts';
import { formatDate, locale, t, type MessageKey } from './i18n.ts';
import { ICONS } from './illustrations.ts';

const regionName = (c: CountryCode) => new Intl.DisplayNames([locale()], { type: 'region' }).of(c.toUpperCase()) ?? c;

/** Couleur, libellé du badge, explication. */
const LEGEND: [StatusKind, MessageKey, MessageKey][] = [
  ['5g', 'status_5g', 'legend_5g'],
  ['5g-partial', 'status_5gPartialShort', 'legend_5gPartial'],
  ['4g', 'status_4g', 'legend_4g'],
  ['4g-partial', 'status_4gPartial', 'legend_4gPartial'],
  ['none', 'status_none', 'legend_none'],
];

export class InfoPage {
  private section = document.getElementById('info')!;
  private content = document.getElementById('info-content')!;
  private result = document.getElementById('result')!;
  private getManifest: (country: CountryCode) => Promise<Manifest>;

  constructor(getManifest: (country: CountryCode) => Promise<Manifest>) {
    this.getManifest = getManifest;
    this.section.querySelector('.back')!.addEventListener('click', () => this.hide());
  }

  get visible() {
    return !this.section.hidden;
  }

  async show() {
    this.content.innerHTML = this.render({});
    this.result.hidden = true;
    this.section.hidden = false;
    window.scrollTo(0, 0);
    // Dates des données : depuis les manifestes (déjà en cache après une recherche).
    // Hors ligne, la page s'affiche sans les dates.
    const [fr, es, pt, be] = await Promise.all((['fr', 'es', 'pt', 'be'] as const).map((c) => this.getManifest(c).catch(() => undefined)));
    if (this.visible) this.content.innerHTML = this.render({ fr, es, pt, be });
  }

  hide() {
    this.section.hidden = true;
    this.result.hidden = false;
  }

  private render(manifests: Partial<Record<CountryCode, Manifest>>): string {
    // La 4G et la 5G ne sont pas forcément publiées à la même date.
    const dates = (manifest: Manifest | undefined, key: 'dateAt' | 'datePublished') => {
      const text = ['4g', '5g']
        .map((techno) => manifest?.layers.find((l) => l.techno === techno))
        .filter((l) => l !== undefined)
        .map((l) => t(key, { techno: l.techno.toUpperCase(), date: formatDate(l.date) }))
        .join(', ');
      return text ? ` (${text})` : '';
    };
    return `
      <section class="card">
        <h3>${t('infoColors')}</h3>
        <ul class="legend">${LEGEND.map(
          ([k, label, text]) =>
            `<li><span class="pill" style="background:${STATUS_COLORS[k].color};color:${STATUS_COLORS[k].textColor}">${t(label)}</span><span>${t(text)}</span></li>`,
        ).join('')}</ul>
        <p class="hint">${t('bestHint', { star: ICONS.star })}</p>
      </section>
      <section class="card">
        <h3>${t('infoZone')}</h3>
        <ul class="facts">
          <li>${t('zoneAddress')}</li>
          <li>${t('zoneListing')}</li>
          <li>${t('zoneCommune')}</li>
        </ul>
      </section>
      <section class="card">
        <h3>${t('infoNotes')}</h3>
        <ul class="facts">
          <li>${t('noteTheoretical')}</li>
          <li>${t('note700')}</li>
          <li>${t('noteDigi')}</li>
        </ul>
      </section>
      <section class="card">
        <h3>${t('sourcesFr')}</h3>
        <ul class="facts">
          <li>${t('srcFrCoverage', { dates: dates(manifests.fr, 'dateAt') })}</li>
          <li>${t('srcFrPopulation')}</li>
          <li>${t('srcFrMaps')}</li>
        </ul>
        <h3 class="next">${t('sourcesEs')}</h3>
        <ul class="facts">
          <li>${t('srcEsCoverage', { dates: dates(manifests.es, 'datePublished') })}</li>
          <li>${t('srcEsMaps')}</li>
        </ul>
        <h3 class="next">${t('sourcesPt')}</h3>
        <ul class="facts">
          <li>${t('srcPtCoverage', { dates: dates(manifests.pt, 'dateAt') })}</li>
          <li>${t('srcPtMaps')}</li>
        </ul>
        <h3 class="next">${t('sourcesFor', { country: regionName('be') })}</h3>
        <ul class="facts">
          <li>${t('srcCoverage', { source: 'IBPT-BIPT, « Atlas mobile »', dates: '' })}</li>
          <li>${t('srcAddressesMaps', { geocoder: 'Photon, © OpenStreetMap', basemap: 'OpenFreeMap, © OpenStreetMap' })}</li>
        </ul>
        <p class="hint">${t('srcFooter')}</p>
      </section>
      <section class="card">
        <h3>${t('privacy')}</h3>
        <p class="hint">${t('privacyText')}
          <a href="${PRIVACY_URL}" target="_blank" rel="noopener">${t('privacyLink')}</a></p>
      </section>`;
  }
}
