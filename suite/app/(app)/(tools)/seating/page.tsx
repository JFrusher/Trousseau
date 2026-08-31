import type { Metadata } from "next";
import { SeatingBoard } from "@/components/seating/SeatingBoard";

export const metadata: Metadata = {
  title: "Seating · Trousseau",
  description: "Build the room to scale, then put people in it.",
};

export default function SeatingPage() {
  return <SeatingBoard />;
}
