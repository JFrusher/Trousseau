/**
 * The faces the printed pieces are set in.
 *
 * Cadence resolved these through Vite's `?url` imports. Here they are static
 * files under `public/fonts`, served from this app's own origin — so nothing is
 * fetched off-origin either way, and the same paths work for the Node tests.
 */

export interface BundledFont {
  family: string;
  /** Served from this app's own origin. */
  url: string;
  /** The bold companion, where the family has one. */
  boldUrl?: string;
  /** Node reads the file directly for headless renders and tests. */
  file: string;
  boldFile?: string;
}

export const BUNDLED_FONTS: BundledFont[] = [
  {
    family: "Lato",
    url: "/fonts/Lato-Regular.ttf",
    file: "public/fonts/Lato-Regular.ttf",
  },
  {
    family: "Crimson Text",
    url: "/fonts/CrimsonText-Regular.ttf",
    boldUrl: "/fonts/CrimsonText-SemiBold.ttf",
    file: "public/fonts/CrimsonText-Regular.ttf",
    boldFile: "public/fonts/CrimsonText-SemiBold.ttf",
  },
  {
    family: "Marcellus",
    url: "/fonts/Marcellus-Regular.ttf",
    file: "public/fonts/Marcellus-Regular.ttf",
  },
  {
    family: "Great Vibes",
    url: "/fonts/GreatVibes-Regular.ttf",
    file: "public/fonts/GreatVibes-Regular.ttf",
  },
];

export const DEFAULT_FONT_FAMILY = "Lato";

export function bundledFont(family: string): BundledFont | null {
  return BUNDLED_FONTS.find((font) => font.family === family) ?? null;
}
