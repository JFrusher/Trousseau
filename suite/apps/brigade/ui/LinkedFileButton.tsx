import { useEffect, useState } from "react";
import { connect, disconnect, isSupported, needsReauthorising, reauthorise, reconnect } from "../state/fileSink";
import { Button } from "@/components/ui/fields";

/**
 * Links the crew to one file on disk, so every autosave lands there as well as
 * in this browser. Point it at a folder that syncs — OneDrive, Dropbox — and
 * the other machine, and Trousseau's bundler, always see the current crew
 * without anyone remembering to export it.
 *
 * Chromium only. Elsewhere this renders nothing and Save still works.
 */
export function LinkedFileButton() {
  const [name, setName] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    void (async () => {
      const reattached = await reconnect();
      if (reattached) setName(reattached);
      else setStale(await needsReauthorising());
    })();
  }, []);

  if (!isSupported()) return null;

  if (name !== null) {
    return (
      <Button variant="quiet" onClick={() => void disconnect().then(() => setName(null))}>
        ● {name}
      </Button>
    );
  }

  // The browser remembers the file but has let the permission lapse, which it
  // will only renew from a click.
  if (stale) {
    return (
      <Button
        variant="quiet"
        onClick={() =>
          void reauthorise().then((n) => {
            if (n) {
              setName(n);
              setStale(false);
            }
          })
        }
      >
        Reconnect file
      </Button>
    );
  }

  return (
    <Button variant="quiet" onClick={() => void connect().then((n) => n && setName(n))}>
      Link to file
    </Button>
  );
}
