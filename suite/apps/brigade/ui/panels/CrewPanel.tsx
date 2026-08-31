import { guestName, readGuests } from "@/lib/model/slices";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { assigneeNames, type Person } from "../../core/model/types";
import { getDoc, useStore } from "../../state/store";
import { Button, Panel, TextField } from "@/components/ui/fields";
import styles from "./CrewPanel.module.css";

/**
 * Teams and the people in them, and the one place assignment happens: pick a
 * job on the board, then click the people doing it. No dragging — a name is a
 * click, and a click cannot be dropped in the wrong lane.
 */
export function CrewPanel() {
  const doc = useStore(getDoc);
  const selectedJobId = useStore((state) => state.selectedJobId);
  const filter = useStore((state) => state.filter);
  const addTeam = useStore((state) => state.addTeam);
  const updateTeam = useStore((state) => state.updateTeam);
  const deleteTeam = useStore((state) => state.deleteTeam);
  const addPerson = useStore((state) => state.addPerson);
  const updatePerson = useStore((state) => state.updatePerson);
  const deletePerson = useStore((state) => state.deletePerson);
  const toggleAssignment = useStore((state) => state.toggleAssignment);
  const setFilter = useStore((state) => state.setFilter);

  /**
   * Guests who are not already on the crew.
   *
   * Offering the whole list would mean the same best man could be added twice,
   * which is the duplication this is here to remove.
   */
  const guests = useTrousseauStore((state) => readGuests(state.doc));
  const linked = new Set(doc.people.map((person) => person.guestId).filter(Boolean));
  const addable = Object.values(guests)
    .filter((guest) => !linked.has(guest.id) && guestName(guest))
    .sort((a, b) => guestName(a).localeCompare(guestName(b), "en"));

  const job = doc.jobs.find((entry) => entry.id === selectedJobId) ?? null;
  const unteamed = doc.people.filter((person) => person.teamId === null);

  const personRow = (person: Person) => {
    const on = job?.personIds.includes(person.id) ?? false;
    return (
      <li key={person.id} className={styles.person}>
        <button
          type="button"
          className={[styles.assign, on ? styles.on : ""].filter(Boolean).join(" ")}
          disabled={job === null}
          title={
            job === null
              ? "Pick a job on the board first"
              : on
                ? `Take ${person.name} off ${job.label}`
                : `Put ${person.name} on ${job.label}`
          }
          onClick={() => job && toggleAssignment(job.id, person.id)}
        >
          {on ? "✓" : "+"}
        </button>
        {/*
          * A linked name is the guest list's to change, so it is not editable
          * here — typing over it would only be undone on the next read, which
          * is worse than not offering it.
          */}
        <input
          className={styles.name}
          value={person.name}
          readOnly={person.guestId !== null}
          title={
            person.guestId !== null
              ? `${person.name} is on the guest list. Change the spelling there and it changes here.`
              : undefined
          }
          aria-label={`Name: ${person.name}`}
          onChange={(event) => updatePerson(person.id, { name: event.target.value })}
        />
        <button
          type="button"
          className={styles.icon}
          title={`Show only ${person.name}'s jobs`}
          aria-pressed={filter.personId === person.id}
          onClick={() =>
            setFilter({ personId: filter.personId === person.id ? null : person.id })
          }
        >
          ◎
        </button>
        <button
          type="button"
          className={styles.icon}
          title={`Remove ${person.name}`}
          onClick={() => deletePerson(person.id)}
        >
          ×
        </button>
      </li>
    );
  };

  return (
    <Panel title="Crew">
      {job === null ? (
        <p className={styles.hint}>Pick a job on the board to put names on it.</p>
      ) : (
        <p className={styles.hint}>
          Assigning <strong>{job.label}</strong>
          {assigneeNames(doc, job).length > 0 && ` — ${assigneeNames(doc, job).join(", ")}`}
        </p>
      )}

      {doc.teams.map((team) => (
        <section key={team.id} className={styles.team}>
          <div className={styles.teamHead}>
            <TextField
              label=""
              value={team.name}
              onChange={(name) => updateTeam(team.id, { name })}
            />
            <button
              type="button"
              className={styles.icon}
              title={`Show only ${team.name}'s jobs`}
              aria-pressed={filter.teamId === team.id}
              onClick={() => setFilter({ teamId: filter.teamId === team.id ? null : team.id })}
            >
              ◎
            </button>
            <button
              type="button"
              className={styles.icon}
              title={`Remove ${team.name}. Its people and jobs stay.`}
              onClick={() => deleteTeam(team.id)}
            >
              ×
            </button>
          </div>

          <ul className={styles.list}>
            {doc.people.filter((person) => person.teamId === team.id).map(personRow)}
          </ul>

          <div className={styles.teamFoot}>
            <Button
              variant="quiet"
              onClick={() => addPerson({ teamId: team.id })}
              title={`Add someone to ${team.name}`}
            >
              + Person
            </Button>
            {job !== null && (
              <Button
                variant="quiet"
                onClick={() =>
                  useStore
                    .getState()
                    .updateJob(job.id, { teamId: job.teamId === team.id ? null : team.id })
                }
                title={`Put the job on ${team.name} without naming anybody yet`}
              >
                {job.teamId === team.id ? "On this team" : "Give to team"}
              </Button>
            )}
          </div>
        </section>
      ))}

      {unteamed.length > 0 && (
        <section className={styles.team}>
          <div className={styles.teamHead}>
            <span className={styles.loose}>No team</span>
          </div>
          <ul className={styles.list}>{unteamed.map(personRow)}</ul>
        </section>
      )}

      <div className={styles.foot}>
        <Button variant="quiet" onClick={() => addTeam()}>
          + Team
        </Button>
        <Button variant="quiet" onClick={() => addPerson()}>
          + Person
        </Button>
        {/*
          * Somebody already on the guest list is added by picking them, not by
          * typing their name again. Linked, their name is read from the guest
          * list, so it is only ever corrected in one place.
          */}
        {addable.length > 0 && (
          <select
            className={styles.fromGuests}
            value=""
            aria-label="Add someone from the guest list"
            onChange={(event) => {
              const guest = guests[event.target.value];
              if (guest) addPerson({ guestId: guest.id, name: guestName(guest) });
              event.target.value = "";
            }}
          >
            <option value="">+ From the guest list…</option>
            {addable.map((guest) => (
              <option key={guest.id} value={guest.id}>
                {guestName(guest)}
              </option>
            ))}
          </select>
        )}
        {(filter.personId !== null || filter.teamId !== null || filter.unassignedOnly) && (
          <Button
            variant="quiet"
            onClick={() => setFilter({ personId: null, teamId: null, unassignedOnly: false })}
          >
            Clear filter
          </Button>
        )}
      </div>
    </Panel>
  );
}
