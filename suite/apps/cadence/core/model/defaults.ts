import type {
  Block,
  DaySettings,
  OutputId,
  OutputSpec,
  StyleSpec,
  TimelineDoc,
} from "./types";

export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";

export const DEFAULT_LANES = ["Main day", "Suppliers", "Transport"];

export const DEFAULT_OUTPUTS: OutputSpec[] = [
  { id: "run-sheet", label: "Master run-sheet", pageSize: "A4" },
  { id: "call-sheet", label: "Call sheets", pageSize: "A4" },
  { id: "order-of-day", label: "Order of the day", pageSize: "A5" },
  { id: "contact-sheet", label: "Contact sheet", pageSize: "A4" },
];

function style(overrides: Partial<StyleSpec> = {}): StyleSpec {
  return {
    fontFamily: "Lato",
    typeScale: 1,
    ruleWeightPt: 0.5,
    accentHex: "#37548a",
    showLogo: true,
    ...overrides,
  };
}

export function defaultStyles(): Record<OutputId, StyleSpec> {
  return {
    "run-sheet": style(),
    "call-sheet": style(),
    "order-of-day": style({ fontFamily: "Crimson Text", typeScale: 1.15 }),
    "contact-sheet": style(),
  };
}

/** Blocks are on the run-sheet by default; guest-facing pieces are opt-in. */
export const DEFAULT_BLOCK_OUTPUTS: OutputId[] = ["run-sheet"];

export function defaultDay(): DaySettings {
  return {
    date: "2026-06-20",
    coupleNames: "",
    venueName: "",
    latitude: 51.5074,
    longitude: -0.1278,
    utcOffsetMin: 60,
    curfewMin: 1500,
    logoKey: null,
  };
}

export function emptyDoc(): TimelineDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    day: defaultDay(),
    lanes: [...DEFAULT_LANES],
    blocks: [],
    tagDetails: [],
    outputs: DEFAULT_OUTPUTS.map((output) => ({ ...output })),
    styles: defaultStyles(),
    fonts: [],
  };
}

interface BlockSeed {
  id: string;
  label: string;
  durationMin: number;
  anchorMin?: number;
  gapMin?: number;
  bufferMin?: number;
  tags?: string[];
  location?: string;
  notes?: string;
  guest?: boolean;
}

function makeBlocks(lane: string, seeds: BlockSeed[]): Block[] {
  return seeds.map((seed) => {
    const tags = seed.tags ?? [];
    const outputs: OutputId[] = ["run-sheet"];
    if (tags.length > 0) outputs.push("call-sheet");
    if (seed.guest) outputs.push("order-of-day");
    return {
      id: seed.id,
      label: seed.label,
      durationMin: seed.durationMin,
      anchorMin: seed.anchorMin ?? null,
      gapMin: seed.gapMin ?? 0,
      bufferMin: seed.bufferMin ?? 0,
      lane,
      tags,
      location: seed.location ?? "",
      notes: seed.notes ?? "",
      outputs,
    };
  });
}

/**
 * A realistic day, used as the fixture every later epic tests against.
 * Identifiers are fixed, not generated, so the fixture file is stable.
 * It resolves with no conflicts and no advisories — tests break it deliberately.
 */
export function sampleDoc(): TimelineDoc {
  const mainDay = makeBlocks("Main day", [
    { id: "blk-prep", label: "Bridal preparations", durationMin: 180, anchorMin: 480, location: "Bridal suite", tags: ["photographer"], notes: "Dress on by 10:30." },
    { id: "blk-travel", label: "Travel to ceremony", durationMin: 30, bufferMin: 10, location: "Courtyard" },
    { id: "blk-guests", label: "Guests arrive", durationMin: 30, anchorMin: 780, location: "Orangery", guest: true },
    { id: "blk-rings", label: "Rings to the best man", durationMin: 0, anchorMin: 795, location: "Orangery", tags: ["registrar"] },
    { id: "blk-ceremony", label: "Ceremony", durationMin: 45, anchorMin: 810, location: "Orangery", tags: ["registrar", "photographer"], notes: "Registrar will not move this.", guest: true },
    { id: "blk-confetti", label: "Confetti", durationMin: 15, location: "Front steps", tags: ["photographer"], guest: true },
    { id: "blk-drinks", label: "Drinks reception", durationMin: 75, location: "Lawn", tags: ["caterer"], guest: true },
    { id: "blk-groups", label: "Group photographs", durationMin: 30, location: "Lawn", tags: ["photographer"], notes: "Eight groupings, list with the photographer." },
    { id: "blk-portraits", label: "Couple portraits", durationMin: 30, location: "Walled garden", tags: ["photographer", "photo"] },
    { id: "blk-call", label: "Call to dinner", durationMin: 10, location: "Lawn", guest: true },
    { id: "blk-breakfast", label: "Wedding breakfast", durationMin: 90, location: "Great hall", tags: ["caterer"], guest: true },
    { id: "blk-speeches", label: "Speeches", durationMin: 45, location: "Great hall", guest: true },
    { id: "blk-turnaround", label: "Room turnaround", durationMin: 30, bufferMin: 10, location: "Great hall", tags: ["caterer"] },
    { id: "blk-cake", label: "Cake cutting", durationMin: 10, location: "Great hall", tags: ["photographer"], guest: true },
    { id: "blk-firstdance", label: "First dance", durationMin: 10, anchorMin: 1230, location: "Great hall", tags: ["band"], guest: true },
    { id: "blk-evefood", label: "Evening food", durationMin: 45, anchorMin: 1320, location: "Great hall", tags: ["caterer"], guest: true },
    { id: "blk-lastdance", label: "Last dance", durationMin: 10, anchorMin: 1470, location: "Great hall", tags: ["band"], guest: true },
    { id: "blk-carriages", label: "Carriages", durationMin: 20, location: "Front drive", guest: true },
  ]);

  const suppliers = makeBlocks("Suppliers", [
    { id: "blk-florist", label: "Florist install", durationMin: 120, anchorMin: 420, location: "Orangery", tags: ["florist"] },
    { id: "blk-caterer", label: "Caterer arrives", durationMin: 30, anchorMin: 660, location: "Kitchen", tags: ["caterer"] },
    { id: "blk-bandsetup", label: "Band load in and set up", durationMin: 90, anchorMin: 1080, location: "Great hall", tags: ["band"] },
    { id: "blk-soundcheck", label: "Sound check", durationMin: 30, location: "Great hall", tags: ["band"], notes: "Before guests return from dinner." },
    { id: "blk-bandset1", label: "Band, first set", durationMin: 45, anchorMin: 1245, location: "Great hall", tags: ["band"] },
    { id: "blk-bandset2", label: "Band, second set", durationMin: 45, anchorMin: 1350, location: "Great hall", tags: ["band"] },
  ]);

  const transport = makeBlocks("Transport", [
    { id: "blk-cars", label: "Cars to venue", durationMin: 45, anchorMin: 690, location: "Bridal suite", tags: ["transport"] },
    { id: "blk-bus", label: "Guest coach arrives", durationMin: 30, anchorMin: 750, location: "Front drive", tags: ["transport"] },
    { id: "blk-latebus", label: "Late coach home", durationMin: 30, anchorMin: 1470, location: "Front drive", tags: ["transport"] },
  ]);

  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    day: {
      date: "2026-06-20",
      coupleNames: "Charis & Jacob",
      venueName: "Vane House",
      latitude: 51.5074,
      longitude: -0.1278,
      utcOffsetMin: 60,
      curfewMin: 1500,
      logoKey: null,
    },
    lanes: [...DEFAULT_LANES],
    blocks: [...mainDay, ...suppliers, ...transport],
    tagDetails: [
      { tag: "photographer", displayName: "Eleanor Vane Photography", phone: "07700 900141", arrivalMin: 465, notes: "Arrives 07:45, away after the evening food." },
      { tag: "band", displayName: "The Wrights", phone: "07700 900272", arrivalMin: 1080, notes: "Two 45 minute sets." },
      { tag: "caterer", displayName: "Smith & Doyle Catering", phone: "07700 900318", arrivalMin: 660, notes: "" },
      { tag: "florist", displayName: "Ivy & Vane", phone: "07700 900455", arrivalMin: 420, notes: "" },
      { tag: "transport", displayName: "County Cars", phone: "07700 900506", arrivalMin: 690, notes: "" },
      { tag: "registrar", displayName: "County Registrar", phone: "07700 900610", arrivalMin: 780, notes: "" },
    ],
    outputs: DEFAULT_OUTPUTS.map((output) => ({ ...output })),
    styles: defaultStyles(),
    fonts: [],
  };
}
