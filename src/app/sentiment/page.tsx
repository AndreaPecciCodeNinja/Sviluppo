import type { Metadata } from "next";
import { SentimentView } from "@/components/SentimentView";
import type { SentimentReport } from "@/lib/sentiment";
import reportJson from "../../../data/sentiment.json";

export const metadata: Metadata = {
  title: "Sentiment · Bird WhatsApp Inbox",
  description:
    "Browse offline WhatsApp chat sentiment for the CodeNinja Bird number.",
};

export default function SentimentPage() {
  const report = reportJson as SentimentReport;
  return <SentimentView report={report} />;
}
