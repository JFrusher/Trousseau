import type { Metadata } from "next";
import { PlaceCardsStudio } from "@/components/placecards/PlaceCardsStudio";

export const metadata: Metadata = {
  title: "Place cards · Trousseau",
  description: "Print-ready place cards and table signs, from the seating plan itself.",
};

export default function PlaceCardsPage() {
  return <PlaceCardsStudio />;
}
