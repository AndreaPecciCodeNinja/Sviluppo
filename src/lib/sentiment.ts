export type SentimentLabel =
  | "positive"
  | "neutral"
  | "negative"
  | "mixed"
  | "insufficient";

export interface SentimentConversation {
  id: string;
  contact: string;
  phone: string;
  label: SentimentLabel;
  urgent: boolean;
  urgencyRank: number | null;
  rationale: string;
  themes: string[];
}

export interface SentimentBucket {
  label: SentimentLabel;
  count: number;
  pct: number;
}

export interface SentimentReport {
  meta: {
    title: string;
    phoneName: string;
    phone: string;
    numberId: string;
    analyzedAt: string;
    language: string;
    source: string;
    conversationsListed: number;
    deepAnalyzedApprox: number;
    headline: string;
    notes: string[];
  };
  distribution: SentimentBucket[];
  urgentIds: string[];
  topPositiveIds: string[];
  themesRecurring: string[];
  conversations: SentimentConversation[];
}

export const LABEL_ORDER: SentimentLabel[] = [
  "negative",
  "mixed",
  "neutral",
  "positive",
  "insufficient",
];

export const LABEL_META: Record<
  SentimentLabel,
  { it: string; color: string; soft: string }
> = {
  positive: { it: "Positivo", color: "#2f9e6e", soft: "rgba(47, 158, 110, 0.16)" },
  neutral: { it: "Neutro", color: "#6b8499", soft: "rgba(107, 132, 153, 0.18)" },
  negative: { it: "Negativo / urgente", color: "#d45b5b", soft: "rgba(212, 91, 91, 0.16)" },
  mixed: { it: "Misto", color: "#d4a017", soft: "rgba(212, 160, 23, 0.16)" },
  insufficient: {
    it: "Insufficiente",
    color: "#7a6f9b",
    soft: "rgba(122, 111, 155, 0.18)",
  },
};

export function sortConversations(
  items: SentimentConversation[],
): SentimentConversation[] {
  return [...items].sort((a, b) => {
    const aRank = a.urgencyRank ?? (a.urgent ? 99 : 1000);
    const bRank = b.urgencyRank ?? (b.urgent ? 99 : 1000);
    if (aRank !== bRank) return aRank - bRank;
    if (a.label === "negative" && b.label !== "negative") return -1;
    if (b.label === "negative" && a.label !== "negative") return 1;
    return a.contact.localeCompare(b.contact, "it");
  });
}
