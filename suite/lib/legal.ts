/**
 * The published policies, as content rather than markup.
 *
 * Kept as data so the effective date can be held to the words it belongs to.
 * A date that says January while the text changed in June is worse than no date
 * at all — it is a claim about when the reader was last told something, and it
 * is false. `lib/legal.test.ts` hashes these sections and fails if the words
 * move without `updated` moving with them.
 *
 * Written to be read. Everything here is a plain statement of what the code in
 * this repository actually does, and where that is inconvenient it says so
 * rather than reaching for a phrase that covers it.
 */

export interface Section {
  heading: string;
  paragraphs: string[];
}

export interface Policy {
  title: string;
  /** ISO date. Bump it whenever `sections` changes — the test insists. */
  updated: string;
  /** SHA-256 of the sections, recorded so a silent edit cannot pass. */
  digest: string;
  intro: string;
  sections: Section[];
}

export const CONTROLLER = {
  name: "Jacob Frusher",
  email: "jacob@frusher.co.uk",
  jurisdiction: "England and Wales",
} as const;

/** Also stated in `lib/sync/handlers.ts`. The two must not drift. */
export const RETENTION_MONTHS = 24;

export const PRIVACY: Policy = {
  title: "Privacy",
  updated: "2026-09-01",
  digest: "cf0ffa02b1dd0d37",
  intro:
    "Trousseau is a wedding planning tool that keeps your wedding in your own browser. This page says exactly what is stored, where, for how long, and what I can and cannot see.",
  sections: [
    {
      heading: "Who is responsible",
      paragraphs: [
        `This is run by ${CONTROLLER.name}, who can be reached at ${CONTROLLER.email}. It is a personal project, not a company.`,
        "For a wedding you create, you decide what goes into it. I hold it as encrypted bytes on your behalf and cannot read any of it.",
      ],
    },
    {
      heading: "Where your wedding lives",
      paragraphs: [
        "In your browser. Guests, seating, the running order, the crew and the stationery are all stored on the device you are using, in IndexedDB, and nothing is sent anywhere by default.",
        "You can use the whole application without any of it ever reaching a server. Two things change that, and both are things you have to turn on: syncing between machines, and publishing a link for your guests.",
      ],
    },
    {
      heading: "What the server holds when you sync",
      paragraphs: [
        "Ciphertext, and nothing else. Your passphrase is stretched in your browser with 600,000 rounds of PBKDF2 and split into two keys. One encrypts the wedding and never leaves the device. The other proves you are allowed to write, and the server keeps only a hash of it.",
        "That means the server cannot read a guest name, a dietary requirement, a phone number or a note, and neither could anyone who obtained a copy of the database. This is not a promise about how carefully the data is guarded; it is a statement about what is possible.",
        "Uploaded typefaces and artwork are encrypted the same way.",
        "Your passphrase is never sent, and cannot be recovered. If you lose it, nobody can open that wedding again — including me.",
      ],
    },
    {
      heading: "What a guest link contains",
      paragraphs: [
        "Deliberately less than the wedding does. A published link carries names and table numbers, and optionally the shape of the room. It does not carry email addresses, phone numbers, dietary requirements, notes, or anybody who has declined.",
        "It is encrypted under a key that lives in the link's own fragment — the part after the # — which browsers never send to a server. The server stores bytes it cannot read, and hands them to whoever has the link.",
        "There is only ever one live link per wedding. Publishing again replaces what the existing link shows, so a link you have already given out stays correct. Taking it down deletes it outright.",
      ],
    },
    {
      heading: "How long it is kept",
      paragraphs: [
        `A wedding that is not written to for ${RETENTION_MONTHS} months is deleted automatically, along with its uploaded files and its guest link. That is long enough to cover an engagement, the wedding, and a year of still wanting the seating plan.`,
        "There is no backup that outlives this. When it is deleted, it is gone.",
      ],
    },
    {
      heading: "Deleting it yourself",
      paragraphs: [
        "There is a button. In the Data manager, under Sharing, 'Erase this wedding from the server' removes everything: every slice, every uploaded file, and the guest link. It takes effect immediately.",
        "It erases the server copy only. The wedding stays in your own browser, because withdrawing from a server is not the same as wanting to lose your seating plan. To remove that too, clear this site's data in your browser.",
        "Deleting needs your passphrase, like every other write. That is the unavoidable cost of a server that cannot read what it stores: there is no reset link and nobody to appeal to. If you have lost your passphrase I cannot delete your wedding on request, because I have no way to tell it is yours — the automatic deletion above is what eventually removes it.",
      ],
    },
    {
      heading: "Cookies and tracking",
      paragraphs: [
        "There are none. No cookies are set, by this site or anyone else. There is no analytics, no advertising, no tracking pixels, and no third-party scripts on the page.",
        "The browser storage that is used — IndexedDB — holds your wedding, which is the thing you came here to work on. Nothing about you is stored for any other purpose.",
      ],
    },
    {
      heading: "Error reporting",
      paragraphs: [
        "When something breaks, a diagnostic report may be sent to Sentry, an error-monitoring service, so the fault can be found and fixed. This is the only third party involved in running this site.",
        "It is configured narrowly and on purpose. No session recording, no personal data, and no console output — the tools log parts of the document while they work, and that is the guest list. Web addresses have their fragment removed before anything is sent, so the key in a guest link can never reach it.",
        "This is done on the basis of legitimate interest: keeping the application working. It sets no cookies and reads nothing from your device.",
      ],
    },
    {
      heading: "Staying signed in",
      paragraphs: [
        "If you sync, the credential derived from your passphrase stays in this browser until you sign out or clear the site's data. It is what lets the application keep syncing without asking for the passphrase again.",
        "The practical consequence is worth stating: on a shared or borrowed computer, signing out matters. Anyone using that browser afterwards can reach the wedding.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "Under UK GDPR you have rights of access, correction, erasure and portability. Two of them are already buttons: 'Export backup' gives you the entire wedding as one file, and the erase button above removes it from the server.",
        `For anything else, or if you think something here is wrong, write to ${CONTROLLER.email}. You can also complain to the Information Commissioner's Office.`,
      ],
    },
    {
      heading: "Changes",
      paragraphs: [
        "The date at the top of this page is the date these words last changed, and it is kept honest by a test that fails if the text moves without it.",
      ],
    },
  ],
};

export const TERMS: Policy = {
  title: "Terms",
  updated: "2026-09-01",
  digest: "2738c1f6c298401f",
  intro:
    "Short, because there is not much to agree about: this is free software, given as it is, that mostly runs on your own machine.",
  sections: [
    {
      heading: "What this is",
      paragraphs: [
        "A free wedding planning tool, open source under the MIT licence. There is no account, no subscription, and nothing to pay.",
        "It was built for one wedding and then made available to anyone who wants it. It is offered as it is, with no warranty and no promise that it is fit for any particular purpose.",
      ],
    },
    {
      heading: "Your guest list is yours",
      paragraphs: [
        "If you put other people's names, dietary requirements or contact details into this tool, you are the one responsible for them. You need your own reason to hold that information, and you should tell those people what you are doing with it if they would not otherwise expect it.",
        "The design helps: it stays on your device unless you choose otherwise, and a guest link deliberately publishes far less than you hold.",
      ],
    },
    {
      heading: "Using the shared backend fairly",
      paragraphs: [
        "Syncing and guest links run on a small server paid for personally. There are limits — how often a wedding can be created, how large a wedding can get, and how much can be uploaded to one — and they are set generously for planning a wedding and meanly for anything else.",
        "Do not use it as file storage, do not try to work around the limits, and do not attempt to guess other people's passphrases.",
      ],
    },
    {
      heading: "It may not always be there",
      paragraphs: [
        "There is no uptime guarantee, no support commitment, and no promise that the sharing service will continue to exist. It may be withdrawn at any time.",
        "This is why the export button matters. A backup file is the whole wedding, it opens in any copy of this application, and it does not depend on me at all. Take one.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "To the extent the law allows, I am not liable for any loss arising from using this — including lost data, a plan that turned out to be wrong, or a service that was unavailable when you needed it.",
        "Nothing here limits liability for death or personal injury caused by negligence, or for fraud, because it cannot.",
      ],
    },
    {
      heading: "Law",
      paragraphs: [
        `These terms are governed by the law of ${CONTROLLER.jurisdiction}, and its courts have exclusive jurisdiction.`,
      ],
    },
  ],
};

export const POLICIES = [PRIVACY, TERMS];

/** The words, in the order they are published. What the digest is taken over. */
export function policyText(policy: Policy): string {
  return [
    policy.title,
    policy.intro,
    ...policy.sections.flatMap((section) => [section.heading, ...section.paragraphs]),
  ].join("\n");
}
