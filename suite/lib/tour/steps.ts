/**
 * What the tour says, and what it points at.
 *
 * Pure data on purpose: the words are the part most likely to be edited, and
 * editing them should not mean reading any React. Each `anchor` matches a
 * `data-tour` attribute on a real control, and `steps.test.ts` fails if one
 * does not.
 *
 * Kept short deliberately. This covers what a tool is *for* and the two or
 * three things that are not self-evident — not every control. A tour long
 * enough to be complete is a tour people abandon in its first chapter.
 */

export interface TourStep {
  /** Matches a `data-tour` attribute on a real control. */
  anchor: string;
  title: string;
  body: string;
  route: string;
}

export interface TourChapter {
  id: ChapterId;
  title: string;
  steps: readonly TourStep[];
}

export type ChapterId =
  | "shell"
  | "seating"
  | "timeline"
  | "place-cards"
  | "delegation"
  | "group-shots";

export const CHAPTERS: readonly TourChapter[] = [
  {
    id: "shell",
    title: "The wedding at a glance",
    steps: [
      {
        anchor: "shell.countdown",
        title: "Your wedding",
        body: "Who is getting married, where, and when. Everything else in Trousseau hangs off these three facts, so it is worth filling them in first.",
        route: "/",
      },
      {
        anchor: "shell.stats",
        title: "Where things stand",
        body: "Guests, how many are seated, tables, and blocks of the day. These count the one shared wedding — not four separate copies of it.",
        route: "/",
      },
      {
        anchor: "shell.tools",
        title: "Five tools, one wedding",
        body: "Each tool owns one part of the day and reads what the others own. Seat someone in Seating and the place cards already know their table. You never type the same guest twice.",
        route: "/",
      },
      {
        anchor: "shell.whatisleft",
        title: "What is left",
        body: "Problems that no single tool can see on its own — a guest seated at a table that no longer exists, a job in a lane that was deleted. Each tool reports its own problems itself.",
        route: "/",
      },
      {
        anchor: "shell.pack",
        title: "The wedding pack",
        body: "One button, one PDF: the floor plan, the run sheet, the job list and the shot list, printed from the wedding as it stands right now.",
        route: "/",
      },
      {
        anchor: "shell.data",
        title: "Your data lives here",
        body: "Everything is saved in this browser as you work. Export a backup from here — without an account, it is the only copy that survives clearing your browser.",
        route: "/",
      },
    ],
  },
  {
    id: "seating",
    title: "Building the room",
    steps: [
      {
        anchor: "seating.toolbar",
        title: "Start with the tables",
        body: "Drag a table shape from here onto the canvas — dragging, not clicking. The room is drawn to scale, so a table that does not fit here will not fit on the day either.",
        route: "/seating",
      },
      {
        anchor: "seating.guests",
        title: "Your guest list",
        body: "Everyone you are inviting, with filters for the ones you tend to look for: unseated, each side, and every dietary requirement.",
        route: "/seating",
      },
      {
        anchor: "seating.import",
        title: "Bring a list you already have",
        body: "Import a CSV from Joy, Zola, The Knot or your own spreadsheet. Trousseau guesses the columns and asks about anything it cannot. Re-importing updates people rather than duplicating them.",
        route: "/seating",
      },
      {
        anchor: "seating.canvas",
        title: "Put people in seats",
        body: "Drag a guest from the list onto a seat. This is the moment the rest of the suite starts being useful — the place cards and the pack read these table numbers.",
        route: "/seating",
      },
      {
        anchor: "seating.overview",
        title: "Who is still standing",
        body: "How many are seated, and the dietary breakdown for your caterer. It updates as you go, so you can stop counting spreadsheet rows.",
        route: "/seating",
      },
    ],
  },
  {
    id: "timeline",
    title: "Planning the day",
    steps: [
      {
        anchor: "timeline.lanes",
        title: "The day, in lanes",
        body: "One lane per strand of the day — the main run of things, suppliers, transport. Lanes let two things happen at once without pretending they are one queue.",
        route: "/timeline",
      },
      {
        anchor: "timeline.add",
        title: "Add what happens",
        body: "A block is anything with a duration: the ceremony, the drinks, the band's setup. Give it a length and a name.",
        route: "/timeline",
      },
      {
        anchor: "timeline.anchor",
        title: "The one thing worth understanding",
        body: "Pick a block and this panel edits it. The field that matters is Anchored at: a block is either pinned to a clock time or it simply follows the one before it. Anchor the ceremony, let the rest follow, and moving the ceremony moves the whole afternoon with it.",
        route: "/timeline",
      },
      {
        anchor: "timeline.problems",
        title: "What collides",
        body: "Two things booked at once, or the day running past your curfew, are flagged while you work rather than discovered on the morning.",
        route: "/timeline",
      },
      {
        anchor: "timeline.export",
        title: "The run sheet",
        body: "Print the day as a timeline or a run sheet. Delegation reads the same times, so a job hanging off the ceremony moves when the ceremony does.",
        route: "/timeline",
      },
    ],
  },
  {
    id: "place-cards",
    title: "Printing the cards",
    steps: [
      {
        anchor: "placecards.useroom",
        title: "Use the room",
        body: "This pulls your guest list in with the table numbers already attached, straight from Seating. This is the button that saves you typing a hundred names again.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.sidebar",
        title: "Design the card once",
        body: "Everything that shapes the card is in here: text and images, the fonts, and the card and sheet size in real millimetres. Bind a text box to a field — type {{First Name}} or {{Table}} — and every card fills itself in with that guest's own details.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.canvas",
        title: "What you see is what prints",
        body: "The live card, drawn at its real size with a real guest's details in it. Step through guests to check the long names and the empty fields before you commit any card stock.",
        route: "/place-cards",
      },
      {
        anchor: "placecards.export",
        title: "Print a test first",
        body: "Export the PDF, then print two cards on plain paper and hold them against your real stock. Trousseau refuses to export a card with a missing font or a hole where a monogram should be, which is cheaper than finding out afterwards.",
        route: "/place-cards",
      },
    ],
  },
  {
    id: "delegation",
    title: "Handing out the jobs",
    steps: [
      {
        anchor: "delegation.day",
        title: "The day, again",
        body: "These are the blocks you made in Timeline, read straight from the same wedding. Change a time there and it changes here — Delegation never keeps its own copy of the schedule.",
        route: "/delegation",
      },
      {
        anchor: "delegation.jobs",
        title: "Jobs hang off the day",
        body: "Add a job to a block: buttonholes before the ceremony, cars after the photos. A job knows when it happens because the block does.",
        route: "/delegation",
      },
      {
        anchor: "delegation.crew",
        title: "Who is doing it",
        body: "Add teams and people, then assign a job by clicking. Someone already on your guest list is picked rather than retyped, so their name is only ever corrected in one place.",
        route: "/delegation",
      },
      {
        anchor: "delegation.export",
        title: "Call sheets",
        body: "Print a sheet per person or per team, so everyone gets their own jobs and their own times instead of the whole plan.",
        route: "/delegation",
      },
    ],
  },
  {
    id: "group-shots",
    title: "The photo list",
    steps: [
      {
        anchor: "groupshots.list",
        title: "Every shot, in order",
        body: "The list your photographer works through on the day. Drag to reorder — group the ones sharing people together and you spend less of the drinks reception rounding up relatives.",
        route: "/group-shots",
      },
      {
        anchor: "groupshots.seed",
        title: "Do not start from nothing",
        body: "Seed the classic list gives you the shots almost every wedding wants. The second button builds more from the families and groups you already set up in Seating, so the people are filled in for you.",
        route: "/group-shots",
      },
      {
        anchor: "groupshots.tabs",
        title: "Three views of the same list",
        body: "Shot edits the one you have picked. Who's who is where you name the parents, siblings and best man once, so a shot is built by choosing them rather than retyping names. Print is the sheet for your photographer.",
        route: "/group-shots",
      },
      {
        anchor: "groupshots.panel",
        title: "Building a shot",
        body: "Pick a shot on the left and this is where you add the people in it, from your guest list or from the cast. Print also warns about a shot naming somebody no longer on the guest list.",
        route: "/group-shots",
      },
    ],
  },
];

const BY_ROUTE = new Map<string, ChapterId>([
  ["/seating", "seating"],
  ["/timeline", "timeline"],
  ["/place-cards", "place-cards"],
  ["/delegation", "delegation"],
  ["/group-shots", "group-shots"],
]);

/** The chapter for wherever the user currently is. Anything unknown gets the shell. */
export function chapterForRoute(route: string): ChapterId {
  return BY_ROUTE.get(route) ?? "shell";
}
