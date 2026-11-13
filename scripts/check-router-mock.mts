/**
 * Routes one appointment and one food message through mocked Ollama JSON.
 * No network and no API keys.
 */
import assert from "node:assert/strict";
import { routeInboundMessage } from "../src/lib/agents/router";

type ChatBody = {
  messages?: Array<{ role?: string; content?: string }>;
};

function reply(content: unknown): Response {
  return new Response(
    JSON.stringify({ message: { content: JSON.stringify(content) } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let providerCalls = 0;

globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
  providerCalls += 1;
  const body = JSON.parse(String(init?.body ?? "{}")) as ChatBody;
  const system =
    body.messages?.find((message) => message.role === "system")?.content ?? "";
  if (system.includes("route one inbound")) {
    if (system.includes("pomodori") || /ingredient|pranzo/i.test(system)) {
      /* system prompt is static; the user text is in the next message */
    }
    const user =
      body.messages?.find((message) => message.role === "user")?.content ?? "";
    if (/appuntament/i.test(user)) {
      return reply({ intent: "generic", rationale: "modello incerto" });
    }
    if (/pomodori/i.test(user)) {
      return reply({ intent: "food_meal", rationale: "lista ingredienti" });
    }
    return reply({ intent: "generic", rationale: "saluto" });
  }
  if (system.includes("extract appointment")) {
    return reply({
      date: "",
      time: "",
      purpose: "",
      rationale: "slot vuoti, euristica sul testo",
    });
  }
  if (system.includes("reply template") || system.includes("Catalog:")) {
    return reply({
      template_id: "food_ingredients_meal",
      slots: { ingredients: "pomodori, mozzarella, basilico, olio" },
      rationale: "lista ingredienti",
      intent_summary: "pranzo o cena",
    });
  }
  return new Response("unexpected prompt", { status: 500 });
}) as typeof fetch;

process.env.REPLY_PROVIDER = "ollama";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
process.env.OLLAMA_MODEL = "mock";

const appointment = await routeInboundMessage(
  "Vorrei un appuntamento martedì alle 15",
);
assert.equal(appointment.specialistId, "appointments");
assert.equal(appointment.routeLabel, "Router → Appuntamenti");
assert.equal(appointment.autoEligible, true);
assert.match(appointment.draft, /martedì/);
assert.match(appointment.draft, /15:00/);
assert.match(appointment.draft, /Confermi\?/);
assert.equal(appointment.intent, "appointment");

const food = await routeInboundMessage("pomodori, mozzarella, basilico, olio");
assert.equal(food.specialistId, "food");
assert.equal(food.routeLabel, "Router → Cibo");
assert.equal(food.autoEligible, true);
assert.match(food.draft, /pomodori, mozzarella, basilico, olio/);
assert.match(food.draft, /pranzo/i);

const generic = await routeInboundMessage("ciao, grazie");
assert.equal(generic.specialistId, "generic");
assert.equal(generic.routeLabel, "Router → Generico");
assert.equal(generic.autoEligible, false);
assert.match(generic.draft, /Grazie per il messaggio/);

const callsBeforeMeal = providerCalls;
const meal = await routeInboundMessage("sì", {
  priorTexts: ["pomodori, mozzarella, basilico, olio"],
});
assert.equal(providerCalls, callsBeforeMeal);
assert.equal(meal.draft, "Perfetto. Preferisci il pranzo o la cena?");
assert.equal(meal.autoEligible, true);
assert.equal(meal.specialistId, "food");
assert.equal(meal.routeLabel, "Router → Cibo");
assert.equal(meal.templateId, "food_meal_choice");

const namedMeal = await routeInboundMessage("pranzo", {
  priorTexts: ["pomodori, mozzarella, basilico, olio"],
});
assert.notEqual(namedMeal.templateId, "food_meal_choice");
assert.ok(providerCalls > callsBeforeMeal);

process.env.SPECIALIST_APPOINTMENTS = "0";
const disabled = await routeInboundMessage(
  "Vorrei un appuntamento martedì alle 15",
);
assert.equal(disabled.specialistId, "generic");
assert.equal(disabled.routeLabel, "Router → Generico");
assert.equal(disabled.autoEligible, false);

console.log("router mock checks ok");
