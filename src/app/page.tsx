import type { Metadata } from "next";
import { ProvaFiammetta } from "@/components/ProvaFiammetta";

export const metadata: Metadata = {
  title: "Prova agenti",
  description: "Due box per provare Fiammetta, senza inbox WhatsApp.",
};

export default function HomePage() {
  return <ProvaFiammetta />;
}
