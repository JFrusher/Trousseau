"use client";

import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { Button, Empty, Segmented } from "@/components/ui/controls";
import { useEvent, useGuests, useSeating, useShots, useStatus, useWriters } from "@/lib/model/useSuite";
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("shot");

  if (status !== "ready") return null;

  if (Object.keys(guests).length === 0) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <Empty>Nothing to photograph yet. Add a guest list on the Seating tool first.</Empty>
      </div>
    );
  }

  const selectedShot = shots.sections.flatMap((section) => section.shots).find((shot) => shot.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
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
