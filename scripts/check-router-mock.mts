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
  if (system.includes("Non svolgi tu il lavoro specialistico")) {
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
  if (system.includes("name one Italian home dish")) {
    return reply({ dish: "un risotto con pollo e zucchine" });
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
assert.equal(appointment.routeLabel, "Fiammetta → Appuntamenti");
assert.match(appointment.draft, /^Sono Fiammetta\. /);
assert.equal(appointment.autoEligible, true);
assert.match(appointment.draft, /martedì/);
assert.match(appointment.draft, /15:00/);
assert.match(appointment.draft, /Confermi\?/);
assert.equal(appointment.intent, "appointment");

const callsBeforeList = providerCalls;
const food = await routeInboundMessage("pomodori, mozzarella, basilico, olio");
assert.equal(providerCalls, callsBeforeList);
assert.equal(food.model, "heuristic");
assert.equal(food.specialistId, "food");
assert.equal(food.routeLabel, "Fiammetta → Cibo");
assert.match(food.draft, /^Sono Fiammetta\. /);
assert.equal(food.autoEligible, true);
assert.match(food.draft, /pomodori, mozzarella, basilico, olio/);
assert.match(food.draft, /pranzo/i);

const callsBeforeGrocery = providerCalls;
const grocery = await routeInboundMessage(
  "Mi servirebbe del latte, delle uova, due zucchine e una salsiccia",
);
assert.equal(providerCalls, callsBeforeGrocery);
assert.equal(grocery.templateId, "food_ingredients_meal");
assert.equal(grocery.autoEligible, true);
assert.match(
  grocery.draft,
  /^Sono Fiammetta\. Hai elencato questi ingredienti: latte, uova, zucchine, salsiccia/,
);
assert.match(grocery.draft, /pranzo o la cena/i);
assert.doesNotMatch(grocery.draft, /Mi servirebbe|Andrea/);

const callsBeforeLunchPlate = providerCalls;
const lunchPlate = await routeInboundMessage("Sì, preparami il pranzo.", {
  priorTexts: [
    "Mi servirebbe del latte, delle uova, due zucchine e una salsiccia",
    "Sono Fiammetta. Hai elencato questi ingredienti: latte, uova, zucchine, salsiccia.\nVuoi che ti prepari il pranzo o la cena con questi?",
  ],
});
assert.equal(providerCalls, callsBeforeLunchPlate);
assert.equal(lunchPlate.templateId, "food_dish_proposal");
assert.equal(lunchPlate.model, "heuristic");
assert.match(
  lunchPlate.draft,
  /^Sono Fiammetta\. Per il pranzo ti propongo una frittata di zucchine e salsiccia/,
);
assert.match(lunchPlate.draft, /uova e un goccio di latte/);
assert.doesNotMatch(
  lunchPlate.draft,
  /Userò latte, uova, zucchine e salsiccia|torta|carne|Andrea|Failed to fetch/i,
);

const generic = await routeInboundMessage("ciao, grazie");
assert.equal(generic.specialistId, "generic");
assert.equal(generic.routeLabel, "Fiammetta → Generico");
assert.match(generic.draft, /^Sono Fiammetta\. Grazie per il messaggio/);
assert.equal(generic.autoEligible, false);
assert.match(generic.draft, /Grazie per il messaggio/);

const callsBeforeMeal = providerCalls;
const meal = await routeInboundMessage("sì", {
  priorTexts: ["pomodori, mozzarella, basilico, olio"],
});
assert.equal(providerCalls, callsBeforeMeal);
assert.equal(
  meal.draft,
  "Sono Fiammetta. Perfetto. Preferisci il pranzo o la cena?",
);
assert.equal(meal.autoEligible, true);
assert.equal(meal.specialistId, "food");
assert.equal(meal.routeLabel, "Fiammetta → Cibo");
assert.equal(meal.templateId, "food_meal_choice");

const callsBeforeDish = providerCalls;
const cacaoDish = await routeInboundMessage("Cena", {
  priorTexts: ["uova, farina, zucchero, cacao"],
});
assert.equal(providerCalls, callsBeforeDish);
assert.equal(cacaoDish.templateId, "food_dish_proposal");
assert.equal(cacaoDish.autoEligible, true);
assert.equal(cacaoDish.routeLabel, "Fiammetta → Cibo");
assert.match(
  cacaoDish.draft,
  /^Sono Fiammetta\. Per la cena ti propongo una torta al cacao/,
);
assert.doesNotMatch(cacaoDish.draft, /Vuoi che ti prepari|pranzo o la cena/i);

const callsBeforeLunch = providerCalls;
const lunchDish = await routeInboundMessage("Si, preparami il pranzo.", {
  priorTexts: ["carne, pane, pomodori, insalata"],
});
assert.equal(providerCalls, callsBeforeLunch);
assert.equal(lunchDish.templateId, "food_dish_proposal");
assert.equal(lunchDish.autoEligible, true);
assert.match(
  lunchDish.draft,
  /^Sono Fiammetta\. Per il pranzo ti propongo un panino con carne/,
);
assert.match(lunchDish.draft, /carne, pane, pomodori e insalata/);
assert.doesNotMatch(lunchDish.draft, /Vuoi che ti prepari|pranzo o la cena/i);

const mixedDish = await routeInboundMessage("Si, preparami il pranzo.", {
  contactDisplayName: "Tommaso",
  priorTexts: [
    "Ciao Andrea, farina, zucchero, cacao, uova",
    "Hai elencato questi ingredienti: Ciao Andrea, farina, zucchero, cacao, uova.\nVuoi che ti prepari il *pranzo* o la *cena* con questi?",
    "Carne, pane, pomodori, insalata",
  ],
});
assert.equal(mixedDish.templateId, "food_dish_proposal");
assert.match(mixedDish.draft, /panino con carne/);
assert.match(mixedDish.draft, /Carne, pane, pomodori e insalata/);
assert.doesNotMatch(mixedDish.draft, /torta|cacao|Andrea|Ciao Tommaso|Tommaso/i);

const otherDish = await routeInboundMessage("pranzo", {
  priorTexts: ["pollo, riso, zucchine"],
});
assert.equal(otherDish.templateId, "food_dish_proposal");
assert.match(
  otherDish.draft,
  /^Sono Fiammetta\. Per il pranzo ti propongo un piatto con pollo, riso e zucchine/,
);
assert.doesNotMatch(otherDish.draft, /Vuoi che ti prepari/i);
assert.equal(providerCalls, callsBeforeLunch);

process.env.SPECIALIST_APPOINTMENTS = "0";
const disabled = await routeInboundMessage(
  "Vorrei un appuntamento martedì alle 15",
);
assert.equal(disabled.specialistId, "generic");
assert.equal(disabled.routeLabel, "Fiammetta → Generico");
assert.equal(disabled.autoEligible, false);

console.log("router mock checks ok");
