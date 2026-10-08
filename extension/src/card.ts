/**
 * Carte « Vérifier la connexion de cet hébergement ? » affichée en bas à droite
 * des fiches d'hébergement reconnues (content script limité à ces pages, cf.
 * LODGING_MATCHES dans le manifeste).
 *
 * - Rien n'est lu dans la page tant que l'utilisateur n'a pas cliqué [Vérifier] :
 *   la carte se contente de s'afficher.
 * - Au clic : lecture de l'adresse publiée en données structurées (comme pour
 *   l'icône), puis ouverture du panneau avec le résultat.
 * - [×] masque la carte sur cette page ; « Ne plus proposer » la désactive
 *   partout (réactivable depuis le panneau).
 * - Shadow DOM fermé : styles et code isolés de ceux du site.
 */
import { api } from './browser.ts';
import { extractStructuredAddress, LODGING_SITES } from './lodging.ts';
import { CARD_DISABLED_KEY, type CheckPageMessage, type CheckPageResponse } from './messages.ts';

const HOST_ID = 'verifier-couverture-reseau-carte';

/** Icône (barres de signal) en SVG, pour ne pas exposer de fichier de l'extension à la page. */
const ICON_SVG = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
  <rect width="32" height="32" rx="6.4" fill="#e86f0c"/>
  <rect x="5.4" y="18.9" width="3.8" height="7.7" fill="#fff"/><rect x="11.2" y="14.8" width="3.8" height="11.8" fill="#fff"/>
  <rect x="17" y="10.7" width="3.8" height="15.9" fill="#fff"/><rect x="22.7" y="6.6" width="3.8" height="20" fill="#fff"/>
</svg>`;

const STYLE = `
  :host { all: initial; }
  .card {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: 300px; max-width: calc(100vw - 32px); box-sizing: border-box;
    display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start;
    padding: 12px 12px 10px; border-radius: 10px; background: #fff; color: #1d2327;
    font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18); border: 1px solid #dde1e4;
    animation: in 0.2s ease-out;
  }
  @keyframes in { from { opacity: 0; transform: translateY(8px); } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  .title { font-weight: 600; margin: 2px 0 8px; }
  .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  button { font: inherit; cursor: pointer; }
  .check { font-weight: 600; padding: 6px 12px; border: none; border-radius: 6px; background: #1a5f7a; color: #fff; }
  .check:hover { background: #154d63; }
  .check:disabled { opacity: 0.6; cursor: default; }
  .never { padding: 0; border: none; background: none; color: #5b6770; font-size: 12px; text-decoration: underline; }
  .close { width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px; background: none; color: #5b6770; font-size: 18px; line-height: 1; }
  .close:hover { background: #f0f2f3; }
  .msg { grid-column: 2 / 4; margin: 6px 0 0; font-size: 12px; color: #5b6770; }
  .msg:empty { display: none; }
  button:focus-visible { outline: 2px solid #1a5f7a; outline-offset: 2px; }
`;

async function showCard() {
  // Désactivée par l'utilisateur, ou déjà affichée (navigation interne du site).
  const settings = await api.storage.local.get(CARD_DISABLED_KEY);
  if (settings[CARD_DISABLED_KEY] || document.getElementById(HOST_ID)) return;

  const host = Object.assign(document.createElement('div'), { id: HOST_ID });
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${STYLE}</style>
    <aside class="card" role="complementary" aria-label="Vérifier la couverture réseau">
      ${ICON_SVG}
      <div>
        <p class="title">Vérifier la connexion mobile de cet hébergement ?</p>
        <div class="actions">
          <button class="check" type="button">Vérifier</button>
          <button class="never" type="button">Ne plus proposer</button>
        </div>
      </div>
      <button class="close" type="button" aria-label="Fermer" title="Fermer">×</button>
      <p class="msg" role="status"></p>
    </aside>`;
  document.documentElement.append(host);

  const check = root.querySelector<HTMLButtonElement>('.check')!;
  const msg = root.querySelector<HTMLElement>('.msg')!;

  root.querySelector('.close')!.addEventListener('click', () => host.remove());
  root.querySelector('.never')!.addEventListener('click', () => {
    void api.storage.local.set({ [CARD_DISABLED_KEY]: true });
    host.remove();
  });

  check.addEventListener('click', async () => {
    // Lecture de l'adresse seulement maintenant, au clic de l'utilisateur.
    const found = extractStructuredAddress(LODGING_SITES);
    check.disabled = true;
    msg.textContent = '';
    const message: CheckPageMessage = { type: 'check-lodging-page', found };
    const response = (await api.runtime.sendMessage(message)) as CheckPageResponse | undefined;
    check.disabled = false;
    if (response?.panelOpened) {
      host.remove();
    } else {
      // Firefox n'autorise l'ouverture de la barre latérale que depuis l'interface du navigateur.
      msg.textContent = "Résultat prêt : cliquez sur l'icône orange de l'extension, dans la barre d'adresse, pour l'afficher.";
    }
  });
}

void showCard();
