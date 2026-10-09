/**
 * Page « Infos » du panneau : lecture des couleurs, zone évaluée, limites,
 * sources et dates des données, confidentialité, réglage de l'encadré.
 * Affichée à la place du résultat, qui reste intact derrière (mini-carte
 * comprise) : « Retour » le réaffiche tel quel.
 */
import { STATUS_COLORS, type Manifest, type StatusKind } from '@couverture/core';

import { PRIVACY_URL } from './config.ts';
import { ICONS } from './illustrations.ts';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const LEGEND: [StatusKind, string, string][] = [
  ['5g', '5G', 'la 5G partout dans la zone'],
  ['5g-partial', '5G partielle', 'la 5G sur plus de la moitié de la zone (en %)'],
  ['4g', '4G', 'pas de 5G, ou sur moins de la moitié de la zone'],
  ['4g-partial', '4G partielle', 'la 4G sur moins de la moitié de la zone'],
  ['none', 'Pas de réseau', 'ni 4G ni 5G'],
];

export class InfoPage {
  private section = document.getElementById('info')!;
  private content = document.getElementById('info-content')!;
  private result = document.getElementById('result')!;
  private getManifest: () => Promise<Manifest>;

  constructor(getManifest: () => Promise<Manifest>) {
    this.getManifest = getManifest;
    this.section.querySelector('.back')!.addEventListener('click', () => this.hide());
  }

  get visible() {
    return !this.section.hidden;
  }

  async show() {
    this.content.innerHTML = this.render(null);
    this.result.hidden = true;
    this.section.hidden = false;
    window.scrollTo(0, 0);
    // Dates des données : depuis le manifeste (déjà en cache après une recherche).
    try {
      const manifest = await this.getManifest();
      if (this.visible) this.content.innerHTML = this.render(manifest);
    } catch {
      // Hors ligne : la page s'affiche sans les dates.
    }
  }

  hide() {
    this.section.hidden = true;
    this.result.hidden = false;
  }

  private render(manifest: Manifest | null): string {
    // La 4G et la 5G ne sont pas publiées au même trimestre.
    const dates = ['4g', '5g']
      .map((t) => manifest?.layers.find((l) => l.techno === t))
      .filter((l) => l !== undefined)
      .map((l) => `${l.techno.toUpperCase()} au ${formatDate(l.date)}`)
      .join(', ');
    return `
      <section class="card">
        <h3>Les couleurs</h3>
        <ul class="legend">${LEGEND.map(
          ([k, label, text]) =>
            `<li><span class="pill" style="background:${STATUS_COLORS[k].color};color:${STATUS_COLORS[k].textColor}">${label}</span><span>${text}</span></li>`,
        ).join('')}</ul>
        <p class="hint">Le meilleur opérateur est marqué d'une ${ICONS.star}. Survolez un opérateur pour le détail.</p>
      </section>
      <section class="card">
        <h3>La zone évaluée</h3>
        <ul class="facts">
          <li><strong>Adresse</strong> : à l'endroit exact.</li>
          <li><strong>Annonce sans adresse exacte</strong> : dans un rayon de 1 à 2 km.</li>
          <li><strong>Commune</strong> : part des habitants couverts, là où ils vivent (les zones inhabitées ne comptent pas).</li>
        </ul>
      </section>
      <section class="card">
        <h3>À savoir</h3>
        <ul class="facts">
          <li>Couverture <strong>théorique, en extérieur</strong> : à l'intérieur, le signal peut être plus faible.</li>
          <li>« 5G » inclut la bande 700 MHz, de longue portée mais au débit proche de la 4G.</li>
        </ul>
      </section>
      <section class="card">
        <h3>Sources</h3>
        <ul class="facts">
          <li>Couverture : Arcep, « Mon Réseau Mobile »${dates ? ` (${dates})` : ''}.</li>
          <li>Population : Insee, Filosofi 2019 (carreaux de 200 m).</li>
          <li>Adresses et fond de carte : IGN, Géoplateforme.</li>
          <li>Données publiques sous Licence Ouverte. Extension indépendante, non affiliée à ces organismes ni aux opérateurs.</li>
        </ul>
      </section>
      <section class="card">
        <h3>Confidentialité</h3>
        <p class="hint">Pas de compte, pas de pistage. Les pages ne sont lues qu'à votre demande.
          <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Politique de confidentialité</a></p>
      </section>`;
  }
}
