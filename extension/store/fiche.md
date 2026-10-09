# Fiches des stores — « Vérifier la couverture réseau »

Textes prêts à copier dans le Chrome Web Store (et Edge Add-ons, mêmes
champs) et sur addons.mozilla.org (AMO). Les éléments **[à compléter]**
dépendent de l'éditeur ou de l'hébergement, pas encore choisis.

Règle : aucun nom ni logo de site tiers (plateformes de réservation,
d'annonces) dans les textes publics, le nom ou les captures. Les domaines ne
figurent que dans les justifications de permissions, lues par les relecteurs.

---

## Textes publics

**Nom** (45 caractères max.) : `Vérifier la couverture réseau`

**Résumé** (132 caractères max., 119 ici) :
> Couverture 4G et 5G des quatre opérateurs à une adresse, d'après les cartes publiques de l'Arcep. Un clic, sans compte.

**Description** :

> Avant de réserver un logement, de louer ou d'acheter, vérifiez que votre téléphone captera.
>
> **Comment ça marche**
> • Sélectionnez une adresse sur n'importe quelle page, faites un clic droit puis « Vérifier la couverture réseau ».
> • Ou cliquez sur l'icône et tapez une adresse ou un nom de commune.
> • Sur les pages d'annonces des principaux sites de réservation d'hébergements et d'annonces immobilières, l'extension vous propose de vérifier la connexion du logement en un clic.
>
> **Un verdict clair pour chaque opérateur** (Orange, SFR, Bouygues Telecom, Free Mobile)
> 🟢 5G partout · 🟡 5G sur une partie · 🟠 4G · 🔴 4G faible ou pas de réseau
> Le meilleur opérateur est mis en avant, avec une mini-carte et un lien vers la carte complète.
>
> **Des résultats honnêtes**
> • Adresse précise : couverture à l'endroit exact.
> • Annonce dont l'adresse n'est pas publiée : couverture évaluée dans un rayon de 1 à 2 km.
> • Commune : part des habitants couverts, là où ils vivent (les zones inhabitées ne comptent pas).
>
> **Respect de votre vie privée**
> L'extension ne lit pas les pages que vous visitez : elle n'utilise que le texte que vous sélectionnez, ce que vous tapez ou, à votre clic, l'adresse publiée par l'annonce. Pas de compte, pas de publicité, pas de mesure d'audience.
>
> **Sources** : cartes de couverture théorique de l'Arcep (« Mon Réseau Mobile »), population Insee, géocodage et fond de carte IGN (Géoplateforme). Données publiques sous Licence Ouverte. Couverture théorique extérieure, à titre indicatif.
>
> Extension indépendante, non affiliée à l'Arcep, à l'IGN, aux opérateurs ni aux sites d'annonces.

**Catégorie** : Chrome « Outils » (ou « Voyages ») · AMO « Recherche et outils » / « Voyages ».
**Langue** : français.
**Politique de confidentialité** : `https://github.com/paullagoguet-hue/couverture-mobile/blob/main/PRIVACY.md`
**Site** : [à compléter : URL de la carte en ligne].

**Captures** (1280 × 800) : voir `store/captures/` (générées par `npm run captures`).
1. Résultat sur une adresse précise : 4 verdicts 5G et mini-carte.
2. Commune de montagne : verdicts variés, calcul sur les habitants.
3. Annonce à emplacement approximatif : rayon de 1 km.
4. Saisie d'une adresse avec suggestions.

---

## Chrome Web Store : onglet « Pratiques de confidentialité »

**Objectif unique** :
> Afficher la couverture mobile théorique (données publiques de l'Arcep) des opérateurs à une adresse choisie par l'utilisateur.

**Justification des permissions** :

| Permission | Justification |
|---|---|
| `contextMenus` | Entrée « Vérifier la couverture réseau » du clic droit sur un texte sélectionné, et « Vérifier la connexion de ce logement » sur les pages d'annonces. |
| `storage` | Transmettre la demande de l'arrière-plan au panneau latéral (stockage de session) et mémoriser la préférence « Ne plus proposer » de l'encadré. |
| `sidePanel` | Afficher le résultat dans le panneau latéral. |
| `activeTab` | Après un clic de l'utilisateur sur l'icône ou le menu, lire la localisation publiée par l'annonce de l'onglet actif. Aucun accès sans clic. |
| `scripting` | Exécuter, dans l'onglet actif et à la demande de l'utilisateur seulement, la fonction qui lit la localisation publiée (données structurées schema.org). |
| `declarativeContent` | Colorer l'icône sur les pages d'annonces reconnues ; la comparaison d'adresse est faite par le navigateur, l'extension ne lit pas l'URL. |
| Accès aux sites (scripts de contenu) | Afficher, sur les seules pages d'annonces des sites suivants, un encadré proposant la vérification : booking.com, expedia (.fr .com .be .ca .ch), hotels.com, tripadvisor (.fr .com .be .ch .ca), airbnb (.fr .com .be .ch .ca), gites-de-france.com, leboncoin.fr (annonces immobilières), pap.fr, bienici.com, seloger.com. Le script n'affiche que l'encadré ; la page n'est lue qu'au clic sur « Vérifier ». |
| Code distant | Aucun : tout le code est dans le paquet. |

**Données utilisateur** (cases à cocher) :
- Contenu de sites web : **oui** (texte sélectionné ou adresse de l'annonce, envoyés au géocodeur de l'IGN pour obtenir une position).
- Localisation : **oui** (position du lieu recherché, déductible des tuiles de carte demandées).
- Toutes les autres catégories : non.
- Certifications : pas de vente, pas d'usage sans rapport avec l'objectif unique, pas d'usage pour du crédit.

---

## AMO (Firefox)

- **Données collectées** : déclarées dans le manifeste (`data_collection_permissions` requises : `websiteContent`, `searchTerms`, `locationInfo`), affichées par Firefox à l'installation (Firefox 140+).
- **Plateformes** : Firefox pour ordinateur uniquement (pas d'Android : la barre latérale n'y existe pas).
- **Code source** : le paquet contient du code compilé et minifié (Vite, MapLibre) : joindre l'archive des sources du dépôt et ces instructions pour les relecteurs :

  ```
  Node.js 24+ requis.
  npm ci
  npm run build -w @couverture/extension
  -> extension/dist/firefox/ (identique au paquet soumis)
  VITE_TILES_BASE_URL=[URL des tuiles] VITE_SITE_URL=[URL du site] pour le build de production.
  ```
- **Notes pour les relecteurs** :
  - Le lint signale des affectations `innerHTML` (panneau et encadré) : les valeurs venant du réseau ou des pages sont échappées (`escapeHtml`) ou insérées via `textContent` ; l'encadré n'utilise que des constantes.
  - Les avertissements dans `maplibre-gl-worker-*.mjs` proviennent de la bibliothèque MapLibre GL JS 6 (BSD-3), non modifiée.

---

## Avant de publier

- [ ] Choisir l'hébergement des tuiles, puis compiler avec `VITE_TILES_BASE_URL` / `VITE_SITE_URL` (la permission d'accès à `127.0.0.1` disparaît d'elle-même du build de production).
- [ ] Compléter l'éditeur, le contact, le domaine et la date dans `PRIVACY.md`.
- [ ] Générer les captures.
- [ ] Faire valider juridiquement l'encadré automatique sur les sites tiers (conditions d'utilisation de ces sites).
- [ ] Comptes développeur : Chrome Web Store (frais d'inscription unique), Microsoft Partner Center (Edge, gratuit), addons.mozilla.org (gratuit).
