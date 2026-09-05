"use client";

import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { Button, Empty, Segmented } from "@/components/ui/controls";
import { ToolUndo } from "@/components/shell/ToolUndo";
import { useEvent, useGuests, useSeating, useShots, useStatus, useWriters } from "@/lib/model/useSuite";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { propose } from "@/lib/ensemble/propose";
import { CastPanel } from "./CastPanel";
import { PrintPanel } from "./PrintPanel";
import { ShotInspector } from "./ShotInspector";
import { ShotList } from "./ShotList";

type Tab = "shot" | "cast" | "print";

export function EnsembleBoard() {
  const status = useStatus();
  const event = useEvent();
  const guests = useGuests();
  const seating = useSeating();
  const shots = useShots();
  const { setShots } = useWriters();

  // Ensemble has no store of its own — its edits land on the suite-wide undo
  // stack, so that is the one the header's undo has to drive.
  const past = useTrousseauStore((s) => s.past);
  const future = useTrousseauStore((s) => s.future);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("shot");

  if (status !== "ready") return null;

  // The stack is shared, so the next undo may take back an edit made in another
  // tool. Saying which is the difference between a safe button and a surprise.
  const undo = (
    <ToolUndo
      canUndo={past.length > 0}
      canRedo={future.length > 0}
      onUndo={() => useTrousseauStore.getState().undo()}
      onRedo={() => useTrousseauStore.getState().redo()}
      undoLabel={past[past.length - 1]?.label ?? null}
      redoLabel={future[future.length - 1]?.label ?? null}
    />
  );

  if (Object.keys(guests).length === 0) {
    return (
      <>
        {undo}
        <div className="flex h-[calc(100dvh-var(--shell-header-h))] items-center justify-center">
          <Empty>Nothing to photograph yet. Add a guest list on the Seating tool first.</Empty>
        </div>
      </>
    );
  }

  const selectedShot = shots.sections.flatMap((section) => section.shots).find((shot) => shot.id === selectedId);

  return (
    <div className="flex h-[calc(100dvh-var(--shell-header-h))]">
      {undo}
      <div className="flex w-96 shrink-0 flex-col border-r border-charcoal/10">
        <div className="flex gap-2 border-b border-charcoal/10 p-3">
          <Button icon={Wand2} onClick={() => setShots({ ...shots, sections: propose(shots.sections, guests, seating, "template") })}>
            Seed the classic list
          </Button>
          <Button icon={Sparkles} onClick={() => setShots({ ...shots, sections: propose(shots.sections, guests, seating, "generate") })}>
            + families and groups
          </Button>
        </div>
        <ShotList
          shots={shots}
          guests={guests}
          seating={seating}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setTab("shot");
          }}
          onChange={setShots}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-charcoal/10 p-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "shot", label: "Shot" },
              { value: "cast", label: "Who's who" },
              { value: "print", label: "Print" },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "shot" &&
            (selectedShot ? (
              <ShotInspector shot={selectedShot} shots={shots} guests={guests} seating={seating} onChange={setShots} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty>Pick a shot on the left, or add one.</Empty>
              </div>
            ))}
          {tab === "cast" && <CastPanel shots={shots} guests={guests} onChange={setShots} />}
          {tab === "print" && <PrintPanel shots={shots} guests={guests} seating={seating} coupleNames={event.coupleNames} />}
        </div>
      </div>
    </div>
  );
}
