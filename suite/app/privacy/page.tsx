import type { Metadata } from "next";
import { PolicyPage } from "../legal";
import { PRIVACY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What is stored, where, for how long, and what the server can and cannot read.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return <PolicyPage policy={PRIVACY} />;
}
