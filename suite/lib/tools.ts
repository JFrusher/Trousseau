import { Armchair, ClipboardList, Clock, Contact, type LucideIcon } from "lucide-react";

/** The four tools, in the order the day is planned in. Nav and landing share this. */
export interface Tool {
  href: "/seating" | "/place-cards" | "/timeline" | "/delegation";
  name: string;
  tagline: string;
  icon: LucideIcon;
}

export const TOOLS: readonly Tool[] = [
  {
    href: "/seating",
    name: "Seating",
    tagline: "Build the room, then put people in it.",
    icon: Armchair,
  },
  {
    href: "/place-cards",
    name: "Place cards",
    tagline: "Print-ready cards from the plan you just made.",
    icon: Contact,
  },
  {
    href: "/timeline",
    name: "Timeline",
    tagline: "The run of the day, and what collides.",
    icon: Clock,
  },
  {
    href: "/delegation",
    name: "Delegation",
    tagline: "The jobs, and the hands doing them.",
    icon: ClipboardList,
  },
];
