"use client";

import { useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { guestName } from "@/lib/model/slices";
import type { Seating } from "@/lib/model/types";
import type { Plan } from "@/lib/seating/actions";
import {
  addConstraint,
  addGroup,
  danglingConstraints,
  describeConstraint,
  removeConstraint,
  removeGroup,
  renameGroup,
  type Collection,
} from "@/lib/seating/organise";
import {
  Button,
  Empty,
  IconButton,
  Panel,
  Segmented,
  SelectField,
  TextField,
} from "@/components/ui/controls";

/**
 * Who belongs with whom.
 *
 * Groups and subgroups organise the list; families and constraints carry rules
 * the warnings engine enforces. All four live in one panel because in practice
 * they are one thought: "these people go together, and those two absolutely do
 * not".
 */
export function OrganisePanel({
  plan,
  onSetSeating,
  onCommit,
}: {
  plan: Plan;
  onSetSeating: (next: Seating, label: string) => void;
  onCommit: (next: Plan, label: string) => void;
}) {
  const [kind, setKind] = useState<Collection>("groups");
  const [name, setName] = useState("");
  const entries = Object.values(plan.seating[kind]);

  const counts = new Map<string, number>();
  const field = kind === "groups" ? "groupId" : kind === "subgroups" ? "subgroupId" : "familyId";
  for (const guest of Object.values(plan.guests)) {
    const id = guest[field];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (
    <>
      <Panel title="Groups">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "groups", label: "Groups" },
            { value: "subgroups", label: "Subgroups" },
            { value: "families", label: "Families" },
          ]}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSetSeating(addGroup(plan.seating, kind, name), "adding a group");
            setName("");
          }}
          className="mt-2 flex gap-2"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "families" ? "The Smiths" : "Bride's side"}
            className="min-w-0 flex-1 rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm outline-none focus:border-gold"
          />
          <button
            type="submit"
            aria-label="Add"
            className="rounded border border-charcoal/15 px-2 text-slate transition hover:border-gold hover:text-charcoal"
          >
            <Plus size={15} />
          </button>
        </form>

        {entries.length === 0 ? (
          <p className="mt-2 text-xs text-slate">
            {kind === "families"
              ? "A family is a group with a rule: split one across two tables and you will be told."
              : "Groups only organise the list. They do not constrain the seating."}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: entry.colour ?? "var(--color-slate)" }}
                />
                <input
                  value={entry.name}
                  onChange={(e) =>
                    onSetSeating(
                      renameGroup(plan.seating, kind, entry.id, e.target.value),
                      "renaming a group",
                    )
                  }
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-charcoal outline-none hover:border-charcoal/15 focus:border-gold"
                />
                <span className="shrink-0 text-xs text-slate">{counts.get(entry.id) ?? 0}</span>
                <IconButton
                  onClick={() => onCommit(removeGroup(plan, kind, entry.id), "deleting a group")}
                  icon={Trash2}
                  label={`Delete ${entry.name}`}
                  tone="danger"
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConstraintsPanel plan={plan} onSetSeating={onSetSeating} />
    </>
  );
}

function ConstraintsPanel({
  plan,
  onSetSeating,
}: {
  plan: Plan;
  onSetSeating: (next: Seating, label: string) => void;
}) {
  const [rule, setRule] = useState<"apart" | "together">("apart");
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  const guests = Object.values(plan.guests).sort((x, y) =>
    guestName(x).localeCompare(guestName(y)),
  );
  const options = [{ value: "", label: "—" }, ...guests.map((g) => ({ value: g.id, label: guestName(g) }))];
  const dangling = new Set(danglingConstraints(plan).map((c) => c.id));

  return (
    <Panel title="Who sits with whom">
      <Segmented
        value={rule}
        onChange={setRule}
        options={[
          { value: "apart", label: "Keep apart" },
          { value: "together", label: "Keep together" },
        ]}
      />

      <div className="mt-2 grid grid-cols-2 gap-2">
        <SelectField value={a} onChange={setA} options={options} />
        <SelectField value={b} onChange={setB} options={options} />
      </div>

      <div className="mt-2">
        <Button
          icon={Plus}
          disabled={a === "" || b === "" || a === b}
          onClick={() => {
            onSetSeating(addConstraint(plan.seating, rule, a, b), "adding a rule");
            setA("");
            setB("");
          }}
        >
          Add rule
        </Button>
      </div>

      {plan.seating.constraints.length === 0 ? (
        <p className="mt-2 text-xs text-slate">
          Nothing yet. A rule never moves anybody — it tells you when the plan breaks it.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {plan.seating.constraints.map((constraint) => (
            <li key={constraint.id} className="flex items-start gap-1.5 text-sm">
              <span
                className={`mt-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${
                  constraint.kind === "apart"
                    ? "bg-rose/20 text-charcoal"
                    : "bg-sage/20 text-charcoal"
                }`}
              >
                {constraint.kind === "apart" ? "Apart" : "Together"}
              </span>
              <span className="min-w-0 flex-1 text-charcoal">
                {describeConstraint(plan, constraint)}
                {dangling.has(constraint.id) ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-xs text-rose">
                    <AlertTriangle size={11} />
                    no longer on the list
                  </span>
                ) : null}
              </span>
              <IconButton
                onClick={() =>
                  onSetSeating(removeConstraint(plan.seating, constraint.id), "deleting a rule")
                }
                icon={Trash2}
                label="Delete rule"
                tone="danger"
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function EmptyOrganise() {
  return <Empty>Add some guests first.</Empty>;
}

export { TextField };
