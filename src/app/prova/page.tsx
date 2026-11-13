import type { Metadata } from "next";
import { ProvaFiammetta } from "@/components/ProvaFiammetta";

export const metadata: Metadata = {
  title: "Prova agenti",
  description:
    "Pagina separata per provare Fiammetta senza Bird e senza invio WhatsApp.",
};

export default function ProvaPage() {
  return <ProvaFiammetta />;
}
