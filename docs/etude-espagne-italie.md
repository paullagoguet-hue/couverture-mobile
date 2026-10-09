# Étude : ajouter l'Espagne et l'Italie

*Octobre 2026. Données vérifiées en interrogeant directement les services officiels.*

## Résumé

| | Espagne | Italie |
|---|---|---|
| Source officielle | Ministère pour la Transformation numérique (Secrétariat d'État aux télécoms), « Mapa de servicios de banda ancha » | AGCOM (régulateur), « Broadband Map » |
| **Détail par opérateur** | **Oui** : liste des opérateurs qui couvrent chaque zone | **Non** : seulement le *nombre* d'opérateurs (1 à 4) par carré de 100 m |
| Technologies | 4G, 5G (avec débit estimé) | 4G, 5G, 5G-DSS |
| Finesse | carrés de 50 m | carrés de 100 m (grille INSPIRE) |
| Date des données | 4G : 2025 ; 5G : 2025 (mise à jour mai 2026) | 27 janvier 2026 |
| Accès | Service ArcGIS public, interrogeable (CORS ouvert) | Service ArcGIS public, interrogeable (CORS ouvert) ; téléchargement complet sur demande par e-mail |
| Licence | Non indiquée sur le service : à confirmer auprès du ministère (le régime espagnol de réutilisation autorise en général la réutilisation avec citation de la source) | Creative Commons BY 4.0 (citer AGCOM) |
| Verdict possible | **Le même qu'en France** (par opérateur, 4G/5G, rayon, commune) | « 5G : 3 opérateurs sur 4 ici », sans dire lesquels |

**Recommandation** : commencer par l'**Espagne**, qui permet exactement le même service
qu'en France. Pour l'Italie, publier une version « nombre d'opérateurs » ou demander à
AGCOM le détail par opérateur (collecté au titre de l'article 22 du code européen des
communications électroniques, mais pas publié).

## Espagne

### Opérateurs (réseaux)

Identifiés dans les données par leur numéro fiscal (CIF) :

| CIF | Société | Marques |
|---|---|---|
| A78923125 | Telefónica Móviles España | Movistar, O2, Tuenti |
| A80907397 | Vodafone España (groupe Zegona) | Vodafone, Lowi |
| A82009812 | Orange Espagne (groupe MasOrange) | Orange, Jazztel, Simyo |
| A82528548 | Xfera Móviles (groupe MasOrange) | Yoigo, MásMóvil, Pepephone |

Orange et Yoigo appartiennent au même groupe depuis 2024 mais leurs réseaux sont encore
déclarés séparément : on les affiche séparément. Digi (4e opérateur commercial) n'a pas
de réseau déclaré : ses clients utilisent surtout le réseau Movistar (à expliquer dans Infos).

### Données

Services ArcGIS publics (compte « conectemos » du ministère) :

- 4G : `https://services-eu1.arcgis.com/3LqdsBPalJaUFvo1/arcgis/rest/services/InfoCob4G_2024/FeatureServer/0`
  — champ `COBERTURA` = liste des CIF séparés par « ; », découpé par commune (`Municipio`, `NATCODE`).
- 5G : `https://services-eu1.arcgis.com/3LqdsBPalJaUFvo1/arcgis/rest/services/InfoCob5G_2025/FeatureServer/0`
  — `COBERTURA` + `VELOCIDAD` (débit estimé, Mbit/s) ; 11,4 millions de polygones (carrés de 50 m).
- Test (Madrid, Puerta del Sol) : 4G = les 4 opérateurs ; 5G = Vodafone + Orange, 500 Mbit/s.

### Mise en œuvre

1. **Pipeline** (GitHub Actions, comme pour l'Arcep) : téléchargement paginé des deux
   couches (2 000 objets par requête, environ 6 000 requêtes pour la 5G, à espacer),
   éclatement de `COBERTURA` en 4 couches par opérateur × 4G/5G, tippecanoe → PMTiles,
   statistiques par commune (population : grille Eurostat GEOSTAT 1 km, ou JRC GHS-POP 100 m).
   Hébergé sur R2 comme la France : aucune dépendance au service du ministère pour les utilisateurs.
2. *Prototype rapide possible* : interroger le service du ministère en direct depuis
   l'extension (un point = deux requêtes). Utile pour tester, à éviter en production
   (quota du ministère, adresse des utilisateurs envoyée à arcgis.com).
3. **Géocodage** : l'IGN ne couvre que la France. Pour l'Espagne, CartoCiudad (IGN
   espagnol, gratuit, sans clé) ; à défaut Photon (OpenStreetMap).
4. **Fond de carte** : le Plan IGN s'arrête à la frontière. Passer à un fond
   OpenStreetMap sans clé (OpenFreeMap, ou Protomaps hébergé sur R2).
5. **Sites d'annonces** : Idealista, Fotocasa, Habitaclia, Airbnb .es, Booking (déjà).
6. Licence à confirmer par écrit avant publication.

## Italie

### Opérateurs (réseaux)

TIM, Vodafone (fusionné avec Fastweb, groupe Swisscom), WindTre (CK Hutchison), Iliad.

### Données

- Couches publiques, carrés de 100 m :
  `https://geo3.agcom.it/MapET-SFS/rest/services/Grid100/mobile_4G/MapServer/0`,
  `.../mobile_5G/MapServer/0`, `.../mobile_5G_DSS/MapServer/0`
  — champ `n_infrastrutture_totali` (1 à 4) et code commune Istat `PRO_COM_T`.
- Test (Rome) : 4G = 4 réseaux, 5G = 4 réseaux.
- Téléchargement complet : formulaire sur `geo3.agcom.it/opendata`, puis demande par
  e-mail à opendata.bbmap@agcom.it.
- Détail par opérateur : non publié. Les cartes des opérateurs eux-mêmes ne sont pas
  des données ouvertes (pas réutilisables).

### Options

- **A. Version « nombre d'opérateurs »** : verdict du type « 5G : 4 réseaux sur 4 », sans
  meilleur opérateur. Moins utile, mais honnête et disponible tout de suite.
- **B. Demander à AGCOM** les couches par opérateur (réutilisation pour un service
  d'information des consommateurs). Réponse incertaine.
- Géocodage : pas de géocodeur national gratuit ; Photon (OpenStreetMap) ou un service
  commercial à clé. Sites d'annonces : Immobiliare.it, Idealista.it, Subito, Airbnb .it.

## Changements communs dans le code

- Notion de **pays** dans le manifeste (opérateurs, sources, type de verdict : par
  opérateur ou par nombre de réseaux) et choix automatique selon l'adresse trouvée.
- Géocodeur par pays derrière la même interface (`geocode`, `suggestAddresses`).
- Fond de carte OpenStreetMap hors de France.
- Page Infos et politique de confidentialité : sources et destinataires par pays.

## Portugal (vérifié en octobre 2026)

- **Source** : ANACOM (régulateur), portail GEO.ANACOM, service ArcGIS public
  `https://geo.anacom.pt/server/rest/services/publico/CoberturaQoS_Pub/MapServer`
  (groupe « Rede Móvel »).
- **Détail par opérateur : oui**, une couche raster par opérateur et techno :
  DIGI, MEO, NOS, Vodafone × 2G (voix), 4G, 5G (« dados provisórios »).
- **Valeur de chaque pixel = débit estimé** par classe : 4G ≥ 300, ≥ 100, ≥ 30, ≥ 2,
  > 0 Mbit/s ; 5G jusqu'à ≥ 1 000 Mbit/s. Plus riche que l'Arcep (on pourrait
  distinguer « 5G rapide » et « 5G lente »).
- **Date** : 2e trimestre 2026, mise à jour trimestrielle.
- Test (Lisbonne) : 4G et 5G chez les 4 opérateurs ; DIGI 4G ≥ 100, les autres ≥ 300 ;
  5G ≥ 1 000 sauf DIGI ≥ 300.
- Accès : interrogation d'un point possible (identify), accès depuis l'extension
  autorisé (CORS). Pas de téléchargement complet trouvé : il faudrait reconstituer
  les rasters par l'export d'images du service, ou demander les fichiers à ANACOM.
- Licence : mention « © ANACOM », conditions de réutilisation à vérifier.
- **Faisable avec le même verdict qu'en France**, et même un niveau de débit.

## Suisse (vérifié en octobre 2026)

- **Source** : OFCOM (Office fédéral de la communication), « Atlas du haut débit »,
  couches `ch.bakom.mobilnetz-4g` et `ch.bakom.mobilnetz-5g` sur map.geo.admin.ch.
- **Détail par opérateur : non** : pour chaque carré de 100 m, seulement le *nombre*
  d'opérateurs (Salt, Sunrise, Swisscom) qui couvrent en extérieur. Même limite que l'Italie.
- Date : 30 avril 2026. Téléchargement direct (GeoTIFF et ZIP) sur data.geo.admin.ch.
- **Version possible : « 5G : 2 réseaux sur 3 »**, sans meilleur opérateur.

## Bilan des pays étudiés

| Pays | Par opérateur | Débit | Téléchargement | État |
|---|---|---|---|---|
| France | oui | niveaux (4G) | oui | en ligne |
| Espagne | oui | 5G (champ VELOCIDAD) | par le service, 6 000 requêtes | construit |
| Portugal | oui | oui, par classes | non (service seulement) | prochain candidat |
| Italie | non (nombre) | non | sur demande | **construit (0.24.0)** : nombre de réseaux lu en direct (zones AGCOM) |
| Suisse | non (nombre) | non | oui | **construit (0.24.0)** : nombre de réseaux lu dans le GeoTIFF de l'OFCOM |

## Tour d'horizon (octobre 2026)

| Pays | Données par opérateur | État | Raison |
|---|---|---|---|
| Espagne | oui (ministère) | **construit** | — |
| Portugal | oui + débit (ANACOM) | **construit** | reconstitution des images du service, validée point par point |
| Belgique | oui + 3 niveaux de signal (IBPT, WFS) | **construit** | téléchargement direct, licence CC BY à confirmer |
| Allemagne | oui (BNetzA, tuiles par opérateur) | en attente | licence CC BY-ND : reconstituer = adapter, interdit sans accord |
| États-Unis | oui (FCC, hexagones H3 par opérateur et État) | faisable, gros chantier | volume (4 opérateurs × 50 États), géocodeur US à prévoir |
| Royaume-Uni | oui (Ofcom, API par adresse) | faisable avec serveur | clé d'API personnelle + relais pour la cacher |
| Irlande | carte ComReg seulement | non | pas de données téléchargeables |
| Pays-Bas | rien d'officiel par opérateur | non | aucune carte publique du régulateur |
| Canada | cartes globales (CRTC) | non | pas de détail par opérateur exploitable |
| Brésil | % par commune (Anatel) | non (pour l'instant) | pas de carte fine |
| Mexique | carte participative (Ookla via IFT) | non | données privées, pas de téléchargement |
| Argentine | rien | non | ENACOM ne publie pas par opérateur |
| Italie, Suisse | nombre d'opérateurs seulement | **construits** (« 3 sur 4 ») | — |

Géocodage : Photon public (komoot) saturé par nos tests (blocage temporaire de
l'adresse IP) : pour la production, un géocodeur Photon auto-hébergé (données
OpenStreetMap du monde entier) remplacera Photon public, et pourra servir tous
les pays sans géocodeur national ouvert.

### Deuxième tour (octobre 2026)

| Pays | Données par opérateur | État | Raison |
|---|---|---|---|
| Luxembourg | oui, carrés de 100 m (ILR, CC BY) | **construit** | liste des opérateurs par carré + grille du cadastre (CC0) |
| Tchéquie | oui (ČTÚ, VPortal, téléchargeable) | en attente | conditions d'utilisation : usage personnel seulement sans accord de la ČTÚ |
| Slovénie | cartes calculées (AKOS) | abandonné | portail protégé contre l'accès automatisé |
| Autriche | collectées par la RTR | abandonné | portail réservé aux opérateurs, rien de public par opérateur |
| Norvège, Danemark, Finlande, Croatie | non trouvé | abandonné pour l'instant | statistiques ou mesures seulement, pas de carte par opérateur téléchargeable |

## Italie et Suisse : mise en œuvre (octobre 2026)

- **Lecture en direct**, sans tuiles hébergées :
  - Italie : une requête par techno au service AGCOM. Elle renvoie les zones autour du lieu ; le nombre est lu localement, et les zones sont dessinées sur la mini-carte. La couche « 5G_DSS » compte toute la 5G : elle a partout au moins autant de réseaux que la couche « 5G » (45 points testés).
  - Suisse : GeoTIFF optimisé de l'OFCOM (3 Mo), lu par morceaux (requêtes Range, décompression LZW). Les adresses viennent de swisstopo (geo.admin.ch).
- **Images AGCOM non utilisées.** Une partie des zones y manque : leurs contours sont enregistrés à l'envers (convention ArcGIS) et sont ignorés au rendu. Sur 19 points, 4 étaient affichés « sans réseau » alors que la donnée en compte 2 ou 3. La règle pair-impair donne 0 écart sur 38 points.
- **Micro-États** (Saint-Marin, Vatican, Monaco, Andorre, Liechtenstein) : ils sont absents des données des régulateurs voisins, qui y indiquent 0 réseau. Comme ils ont leurs propres opérateurs, ils sont exclus et l'extension affiche « pays non couvert ».
