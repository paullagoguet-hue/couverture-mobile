/**
 * Illustrations et pictogrammes du panneau, en SVG intégré (aucun fichier ni
 * requête externe). Constantes uniquement : insérées telles quelles.
 */

/** Scène d'accueil : maison, téléphone qui capte, antenne relais. */
export const HERO_SVG = `<svg class="hero" viewBox="0 0 300 132" aria-hidden="true">
  <defs>
    <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#dcedf3"/><stop offset="1" stop-color="#f3f9fb"/>
    </linearGradient>
  </defs>
  <rect width="300" height="132" rx="16" fill="url(#hero-sky)"/>
  <circle cx="58" cy="30" r="12" fill="#fff" opacity="0.9"/>
  <path d="M0 100 C55 82 100 90 150 98 C200 106 245 84 300 92 V132 H0 Z" fill="#c9e2eb"/>
  <path d="M0 113 C70 102 130 118 190 111 C235 106 265 108 300 111 V132 H0 Z" fill="#b2d6e2"/>
  <!-- Antenne relais et ondes -->
  <g fill="none" stroke-linecap="round">
    <path d="M238 104 L248 34 L258 104" stroke="#1a5f7a" stroke-width="3" stroke-linejoin="round"/>
    <path d="M241.5 84 H254.5 M243.5 64 H252.5 M245.5 46 H250.5" stroke="#1a5f7a" stroke-width="2"/>
    <path d="M236 22 A17 17 0 0 0 236 46" stroke="#e86f0c" stroke-width="2.5"/>
    <path d="M228 14 A28 28 0 0 0 228 54" stroke="#e86f0c" stroke-width="2.5" opacity="0.55"/>
    <path d="M260 22 A17 17 0 0 1 260 46" stroke="#e86f0c" stroke-width="2.5"/>
    <path d="M268 14 A28 28 0 0 1 268 54" stroke="#e86f0c" stroke-width="2.5" opacity="0.55"/>
  </g>
  <circle cx="248" cy="34" r="4.5" fill="#e86f0c"/>
  <!-- Maison -->
  <g transform="translate(64 50)">
    <path d="M-6 30 L34 0 L74 30" fill="#1a5f7a"/>
    <rect x="2" y="26" width="64" height="44" rx="2" fill="#fff"/>
    <rect x="12" y="36" width="14" height="12" rx="2" fill="#bfe0ea"/>
    <rect x="42" y="44" width="14" height="26" rx="2" fill="#e86f0c"/>
    <rect x="50" y="6" width="9" height="16" fill="#1a5f7a"/>
  </g>
  <!-- Téléphone qui capte -->
  <g transform="translate(150 38)">
    <rect width="40" height="70" rx="7" fill="#1d2327"/>
    <rect x="3.5" y="7" width="33" height="56" rx="3" fill="#fff"/>
    <rect x="9" y="42" width="4.5" height="9" rx="1" fill="#2e7d32"/>
    <rect x="15.5" y="36" width="4.5" height="15" rx="1" fill="#2e7d32"/>
    <rect x="22" y="29" width="4.5" height="22" rx="1" fill="#2e7d32"/>
    <rect x="28.5" y="22" width="4.5" height="29" rx="1" fill="#2e7d32"/>
    <text x="20" y="18" text-anchor="middle" font-size="9" font-weight="700" fill="#2e7d32" font-family="system-ui, sans-serif">5G</text>
    <circle cx="38" cy="4" r="9" fill="#2e7d32" stroke="#fff" stroke-width="2"/>
    <path d="M33.5 4.2 L36.8 7.3 L42.5 1.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const icon = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  search: icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  /** Texte sélectionné + clic droit. */
  select: icon('<path d="M4 6h10M4 10h7"/><rect x="3" y="13.5" width="9" height="4" rx="1" fill="currentColor" opacity="0.25" stroke="none"/><path d="M14 13l6 2.4-2.6 1.1-1.1 2.6z"/>'),
  /** Annonce de logement : maison avec pastille orange. */
  house: icon('<path d="M3 11l8-7 8 7"/><path d="M5 10v9h12v-9"/><path d="M9.5 19v-5h3v5"/><circle cx="19" cy="5" r="3" fill="#e86f0c" stroke="none"/>'),
  pin: icon('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  star: icon('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>'),
  alert: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>'),
  noSignal: icon('<path d="M5 18v-2M9.5 18v-5M14 18V9"/><path d="M18.5 18V5" opacity="0.3"/><path d="M15 4l7 7M22 4l-7 7" stroke="#b3261e"/>'),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>'),
  arrow: icon('<path d="M7 17L17 7M9 7h8v8"/>'),
  retry: icon('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
};

/** Drapeaux simplifiés (les émojis drapeaux ne s'affichent pas sous Windows). */
export const FLAGS: Record<'fr' | 'es', string> = {
  fr: `<svg class="flag-icon" viewBox="0 0 18 12" aria-hidden="true"><rect width="6" height="12" fill="#0055a4"/><rect x="6" width="6" height="12" fill="#fff"/><rect x="12" width="6" height="12" fill="#ef4135"/><rect width="18" height="12" rx="1.5" fill="none" stroke="rgba(0,0,0,.15)"/></svg>`,
  es: `<svg class="flag-icon" viewBox="0 0 18 12" aria-hidden="true"><rect width="18" height="12" fill="#aa151b"/><rect y="3" width="18" height="6" fill="#f1bf00"/><rect width="18" height="12" rx="1.5" fill="none" stroke="rgba(0,0,0,.15)"/></svg>`,
};
