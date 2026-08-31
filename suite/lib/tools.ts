import { Armchair, ClipboardList, Clock, Contact, type LucideIcon } from "lucide-react";

/** The four tools, in the order the day is planned in. Nav and landing share this. */
export interface Tool {
  href: "/seating" | "/place-cards" | "/timeline" | "/delegation";
  name: string;
  tagline: string;
  icon: LucideIcon;
  /**
   * The token class carrying this tool's palette.
   *
   * The tab is where a tool is identified now that the wordmarks have gone, so
   * the active one is underlined in the colour that tool uses throughout. The
   * class rather than a hex value, because the colour is decided once in
   * `lib/design/tokens.css` and this should not hold a second opinion about it.
   */
  tokens: string;
}

export const TOOLS: readonly Tool[] = [
  {
    href: "/seating",
    tokens: "tableaux-tokens",
    name: "Seating",
    tagline: "Build the room, then put people in it.",
    icon: Armchair,
  },
  {
    href: "/place-cards",
    tokens: "plaque-tokens",
    name: "Place cards",
    tagline: "Print-ready cards from the plan you just made.",
    icon: Contact,
  },
  {
    href: "/timeline",
    tokens: "cadence-tokens",
    name: "Timeline",
    tagline: "The run of the day, and what collides.",
    icon: Clock,
  },
  {
    href: "/delegation",
    tokens: "brigade-tokens",
    name: "Delegation",
    tagline: "The jobs, and the hands doing them.",
    icon: ClipboardList,
  },
];
