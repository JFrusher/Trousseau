import { z } from "zod";

/**
 * The slices whose interior shape belongs entirely to their owning app.
 *
 * This package validates that they are objects and nothing more. Tableaux owns
 * what a guest is; Plaque owns what a card looks like. Encoding those shapes
 * here would mean a Tableaux feature could not ship without a release of this
 * package, which is the coupling the whole design exists to avoid.
 *
 * `Tableaux/server/lib/planSchema.js` already takes exactly this position, in
 * its own words: "The client owns the rich per-entity shape; the server
 * enforces types and ceilings."
 */
// Every default is a factory, never a literal. A literal default is one object
// shared by every parse, and a caller who mutates what they were given would
// silently change the default for everyone else in the process.
export const guestsSchema = z.record(z.string(), z.unknown()).default(() => ({}));
export const seatingSchema = z.record(z.string(), z.unknown()).default(() => ({}));
export const crewSchema = z.looseObject({}).default(() => ({}));
export const stationerySchema = z.looseObject({}).default(() => ({}));

export type Guests = z.infer<typeof guestsSchema>;
export type Seating = z.infer<typeof seatingSchema>;
export type Crew = z.infer<typeof crewSchema>;
export type Stationery = z.infer<typeof stationerySchema>;
