/**
 * Icône de l'extension dessinée en code (sans bibliothèque ni canvas) :
 * carré arrondi bleu + 4 barres de signal blanches. La variante « détectée »
 * est entièrement orange : bien visible dans la barre d'outils, elle signale
 * qu'on est sur une page d'hébergement vérifiable en un clic.
 *
 * Utilisée par scripts/make-icons.ts (PNG du paquet) et par background.ts
 * (icône dynamique, qui exige des ImageData).
 */

const BG = [0x1a, 0x5f, 0x7a];
const BAR = [0xff, 0xff, 0xff];
const DETECTED_BG = [0xe8, 0x6f, 0x0c];

type Shape = (x: number, y: number) => number[] | null;

/** Formes en coordonnées normalisées (0..1), de l'arrière vers l'avant. */
function shapes(highlight: boolean): Shape[] {
  const r = 0.2; // rayon des coins
  const background = highlight ? DETECTED_BG : BG;
  const roundedSquare: Shape = (x, y) => {
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? background : null;
  };
  // 4 barres de hauteur croissante, posées sur une même ligne.
  const bars: Shape[] = [0.3, 0.45, 0.6, 0.75].map((h, i) => (x, y) => {
    const x0 = 0.17 + i * 0.18;
    return x >= x0 && x <= x0 + 0.12 && y <= 0.83 && y >= 0.83 - h * 0.85 ? BAR : null;
  });
  return [roundedSquare, ...bars];
}

/** Pixels RGBA (size × size) avec anticrénelage par suréchantillonnage 4×4. */
export function iconPixels(size: number, highlight = false): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4);
  const layers = shapes(highlight);
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          let color: number[] | null = null;
          for (const shape of layers) color = shape(x, y) ?? color;
          if (color) { r += color[0]; g += color[1]; b += color[2]; a++; }
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        out[i] = r / a; out[i + 1] = g / a; out[i + 2] = b / a;
        out[i + 3] = (255 * a) / (S * S);
      }
    }
  }
  return out;
}

export const ICON_SIZES = [16, 32, 48, 128] as const;
