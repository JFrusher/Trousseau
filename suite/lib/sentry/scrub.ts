/**
 * Take the secrets out of an error report before it leaves the browser.
 *
 * This is the one piece of the Sentry integration that is not optional, and the
 * reason is specific to this app rather than general caution.
 *
 * A guest link is `/seat/{token}#k={key}`. The fragment holds the key that
 * decrypts the plan, and it is in the fragment precisely because browsers never
 * send fragments to a server — that is the whole design. But `location.href`
 * includes it, and `location.href` is exactly what an error reporter attaches
 * to every event. Reporting an error from a guest page with default settings
 * would hand a third party the ability to decrypt the wedding it was published
 * from, defeating the encryption completely and silently.
 *
 * So every URL leaving here loses its fragment, wherever it appears.
 */

/** The part after `#`, which is where every key in this app lives. */
export function stripFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : `${url.slice(0, hash)}#redacted`;
}

interface Breadcrumb {
  data?: Record<string, unknown> | undefined;
}

export interface ScrubbableEvent {
  request?: { url?: string | undefined; headers?: Record<string, string> | undefined } | undefined;
  breadcrumbs?: Breadcrumb[] | undefined;
  extra?: Record<string, unknown> | undefined;
}

const URL_KEYS = ["url", "to", "from", "href"];

function scrubRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string" && URL_KEYS.includes(key) && value.includes("#")) {
      record[key] = stripFragment(value);
    }
  }
}

/**
 * Mutates and returns the event, which is the shape Sentry's `beforeSend`
 * expects — returning null would drop the report entirely, and an error worth
 * reporting is still worth reporting once its secrets are gone.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request?.url) event.request.url = stripFragment(event.request.url);

  // Navigation breadcrumbs carry the previous and next URL, and a guest
  // arriving on a link is precisely a navigation.
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.data) scrubRecord(crumb.data);
  }

  if (event.extra) scrubRecord(event.extra);

  // The Referer can carry a fragment when a page links to itself, and costs
  // nothing to remove.
  if (event.request?.headers) scrubRecord(event.request.headers);

  return event;
}
