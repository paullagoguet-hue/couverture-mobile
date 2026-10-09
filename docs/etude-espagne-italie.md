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
