/**
 * Niveaux de couverture définis par l'Arcep, du meilleur au moins bon.
 * Libellés et descriptions repris de la documentation Arcep (version « data »).
 * Les couleurs sont partagées par le site et l'extension (légende cohérente).
 */
export const LEVELS = [
  {
    code: 'TBC',
    label: 'Très bonne couverture',
    short: 'Très bonne',
    description: "À l'extérieur des bâtiments et, dans la plupart des cas, à l'intérieur.",
    color: '#1a5f7a',
  },
  {
    code: 'BC',
    label: 'Bonne couverture',
    short: 'Bonne',
    description: "À l'extérieur des bâtiments dans la plupart des cas, et dans certains cas à l'intérieur.",
    color: '#4a9fbf',
  },
  {
    code: 'CL',
    label: 'Couverture limitée',
    short: 'Limitée',
    description: "À l'extérieur des bâtiments dans la plupart des cas, probablement pas à l'intérieur.",
    color: '#a8d5e2',
  },
] as const;

export type LevelCode = (typeof LEVELS)[number]['code'];

/** Couleur des couches sans niveaux (3G, 5G) : « zone couverte ». */
export const COVERED_COLOR = LEVELS[0].color;

/** Rang d'un niveau (0 = meilleur) ; Infinity si absent. */
export function levelRank(code: string | null | undefined): number {
  const i = LEVELS.findIndex((l) => l.code === code);
  return i === -1 ? Infinity : i;
}

export function levelInfo(code: string | null | undefined) {
  return LEVELS.find((l) => l.code === code);
}

/**
 * Expression MapLibre de couleur de remplissage selon l'attribut `niveau`
 * (même légende sur le site et dans l'extension). Typée sans dépendre de
 * MapLibre : les appelants la convertissent en ExpressionSpecification.
 */
export const FILL_COLOR_EXPRESSION = [
  'match',
  ['get', 'niveau'],
  ...LEVELS.flatMap((l) => [l.code, l.color]),
  COVERED_COLOR, // couches sans niveau (5G)
] as const;
