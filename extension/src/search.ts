/**
 * Champ de recherche du panneau (saisie manuelle) avec suggestions d'adresses.
 *
 * Les suggestions viennent du géocodeur IGN en mode autocomplétion, après une
 * courte pause de frappe. Choisir une suggestion lance directement la lecture
 * de couverture au lieu choisi ; Entrée lance une recherche sur le texte saisi.
 * Clavier : ↓/↑ parcourent les suggestions, Échap les ferme.
 */
import { geocode, normalizeQuery, type GeocodeResult } from '@couverture/core';

const DEBOUNCE_MS = 250;

export interface SearchBoxHandlers {
  /** Recherche sur un texte libre (Entrée / bouton). */
  onSubmit(text: string): void;
  /** Lieu choisi dans les suggestions. */
  onPick(place: GeocodeResult): void;
}

export class SearchBox {
  private input: HTMLInputElement;
  private list: HTMLUListElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: AbortController | undefined;
  private results: GeocodeResult[] = [];

  constructor(form: HTMLFormElement, handlers: SearchBoxHandlers) {
    this.input = form.querySelector('input')!;
    this.list = form.querySelector('.suggestions')!;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.close();
      if (normalizeQuery(this.input.value)) handlers.onSubmit(this.input.value);
    });

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.suggest(), DEBOUNCE_MS);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.list.querySelector('button')?.focus();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    this.list.addEventListener('keydown', (e) => {
      const buttons = [...this.list.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        buttons[Math.min(i + 1, buttons.length - 1)]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (i <= 0 ? this.input : buttons[i - 1]).focus();
      } else if (e.key === 'Escape') {
        this.close();
        this.input.focus();
      }
    });

    this.list.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button');
      if (!button) return;
      const place = this.results[Number(button.dataset.i)];
      this.input.value = place.label;
      this.close();
      handlers.onPick(place);
    });
  }

  private async suggest() {
    this.pending?.abort();
    const text = this.input.value;
    if (!normalizeQuery(text)) return this.close();
    const ctrl = (this.pending = new AbortController());
    try {
      this.results = await geocode(text, { limit: 5, autocomplete: true, signal: ctrl.signal });
    } catch {
      return; // saisie suivante ou réseau indisponible : la recherche par Entrée affichera l'erreur
    }
    if (ctrl.signal.aborted || this.input.value !== text) return;
    this.list.innerHTML = this.results
      .map((_, i) => `<li><button type="button" data-i="${i}"></button></li>`)
      .join('');
    // textContent plutôt qu'innerHTML : les libellés viennent du réseau.
    this.list.querySelectorAll('button').forEach((b, i) => {
      b.append(this.results[i].label, Object.assign(document.createElement('small'), { textContent: this.results[i].context }));
    });
    this.list.hidden = !this.results.length;
  }

  close() {
    clearTimeout(this.timer);
    this.pending?.abort();
    this.list.hidden = true;
    this.list.innerHTML = '';
  }

  /** Affiche le texte recherché (ex. sélection du clic droit) dans le champ. */
  setText(text: string) {
    this.input.value = text.replace(/\s+/g, ' ').trim();
    this.close();
  }

  focus() {
    this.input.focus();
  }
}
