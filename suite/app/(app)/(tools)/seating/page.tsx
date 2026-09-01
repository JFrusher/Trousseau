import type { Metadata } from "next";
import { TableauxApp } from "./TableauxClient";

export const metadata: Metadata = {
  title: "Seating",
  description: "Build the room to scale, then put people in it.",
};

export default function SeatingPage() {
  return <TableauxApp />;
}
