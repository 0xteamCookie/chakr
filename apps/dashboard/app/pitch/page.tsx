import type { Metadata } from "next";
import { Deck } from "@/components/pitch/deck";

export const metadata: Metadata = { title: "AgentShield pitch", description: "CB-05, teamCookie(), CHAKRAVYUH 2026" };

export default function PitchPage() {
  return <Deck />;
}
