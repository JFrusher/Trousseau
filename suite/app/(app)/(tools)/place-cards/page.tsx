import type { Metadata } from "next";
import { PlaqueApp } from "./PlaqueClient";

export const metadata: Metadata = {
  title: "Place cards",
  description: "Print-ready place cards and table signs, from the seating plan itself.",
};

export default function PlaceCardsPage() {
  return <PlaqueApp />;
}
