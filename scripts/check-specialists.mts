import assert from "node:assert/strict";
import {
  buildAppointmentDraft,
  heuristicAppointmentSlots,
  normalizeTime,
} from "../src/lib/agents/appointment-draft.ts";
import {
  fiammettaRouteLabel,
  withFiammettaIntro,
} from "../src/lib/agents/fiammetta.ts";
import {
  bareMealChoice,
  buildDishDraft,
  chosenMeal,
  customerNameFromDisplay,
  ingredientMealQuestion,
  ingredientsFromThread,
  isBareAffirmation,
  isOwnFoodReply,
  spokenCustomerName,
  mealAcceptedDraft,
  mealChoiceFollowUp,
  mealDishContext,
  mealFollowUpQuestion,
  MEAL_CHOICE_DRAFT,
} from "../src/lib/agents/meal-choice.ts";
import { answerCustomer } from "../src/lib/agents/customer-turn.ts";
import { provaFiammettaReply } from "../src/lib/agents/prova-reply.ts";
import {
  heuristicIntent,
  matchAppointment,
  matchFood,
} from "../src/lib/agents/match.ts";
import type { RouterIntent } from "../src/lib/agents/types.ts";
import {
  isWindowClosedSendError,
  normalizeOutboundText,
  parseFoodSendMode,
  shouldAutoSendFoodDraft,
} from "../src/lib/food-send-mode.ts";

const enabled = new Set<RouterIntent>(["appointment", "food_meal", "generic"]);

const appointment = heuristicIntent(
  "Vorrei un appuntamento martedì alle 15",
  enabled,
);
assert.equal(appointment.intent, "appointment");
assert.equal(appointment.strong, true);
assert.equal(matchAppointment("Vorrei un appuntamento martedì alle 15"), true);
assert.equal(matchFood("Vorrei un appuntamento martedì alle 15"), false);

const food = heuristicIntent("pomodori, mozzarella, basilico, olio", enabled);
assert.equal(food.intent, "food_meal");
assert.equal(food.strong, true);
assert.equal(matchFood("pomodori, mozzarella, basilico, olio"), true);

const lunch = heuristicIntent("Cosa cuciniamo per pranzo?", enabled);
assert.equal(lunch.intent, "food_meal");

const generic = heuristicIntent("ciao, grazie", enabled);
assert.equal(generic.intent, "generic");
assert.equal(generic.strong, false);

const foodOff = heuristicIntent(
  "pranzo con pomodori",
  new Set<RouterIntent>(["generic"]),
);
assert.equal(foodOff.intent, "generic");

assert.equal(normalizeTime("15"), "15:00");
assert.equal(normalizeTime("alle 15:30"), "15:30");
assert.equal(normalizeTime("9.05"), "09:05");

const slots = heuristicAppointmentSlots(
  "Vorrei un appuntamento martedì alle 15",
);
assert.match(slots.date, /marted/i);
assert.equal(slots.time, "15:00");

const confirm = buildAppointmentDraft({
  date: "martedì",
  time: "15",
  purpose: "",
});
assert.equal(confirm.kind, "confirm");
assert.match(confirm.draft, /martedì/);
assert.match(confirm.draft, /15:00/);
assert.match(confirm.draft, /Confermi\?/);

const withPurpose = buildAppointmentDraft({
  date: "domani",
  time: "09:30",
  purpose: "consulenza",
});
assert.match(withPurpose.draft, /per consulenza/);

const ask = buildAppointmentDraft({ date: "", time: "15:00", purpose: "" });
assert.equal(ask.kind, "ask");
assert.match(ask.draft, /giorno/);

const ingredients = ["pomodori, mozzarella, basilico, olio"];
const question = [
  "Hai elencato questi ingredienti: pomodori, mozzarella.\nVuoi che ti prepari il *pranzo* o la *cena* con questi?",
];
assert.equal(isBareAffirmation("Sì!"), true);
assert.equal(isBareAffirmation("va bene"), true);
assert.equal(isBareAffirmation("ok pranzo"), false);
assert.equal(mealChoiceFollowUp("sì", ingredients), MEAL_CHOICE_DRAFT);
assert.equal(mealChoiceFollowUp("Ok.", question), MEAL_CHOICE_DRAFT);
assert.equal(mealChoiceFollowUp("va bene", ["ciao"]), null);
assert.equal(mealChoiceFollowUp("pranzo", ingredients), null);
assert.equal(mealChoiceFollowUp("sì, cena", question), null);
assert.equal(mealChoiceFollowUp("grazie", ingredients), null);

const cacao = ["uova, farina, zucchero, cacao"];
const questionAndList = [
  ...cacao,
  "Hai elencato questi ingredienti: uova, farina, zucchero, cacao.\nVuoi che ti prepari il *pranzo* o la *cena* con questi?",
];
assert.equal(bareMealChoice("cena"), "cena");
assert.equal(bareMealChoice("Pranzo."), "pranzo");
assert.equal(bareMealChoice("per la cena"), "cena");
assert.equal(chosenMeal("Cena"), "cena");
assert.equal(chosenMeal("per il pranzo"), "pranzo");
assert.equal(chosenMeal("Si, preparami il pranzo."), "pranzo");
assert.equal(chosenMeal("cena alle 20"), "cena");
assert.equal(chosenMeal("pranzo o cena"), null);
const dish = mealDishContext("Cena", questionAndList);
assert.ok(dish);
assert.equal(dish?.meal, "cena");
assert.equal(dish?.dish, "una torta al cacao");
assert.deepEqual(ingredientsFromThread(questionAndList), [
  "uova",
  "farina",
  "zucchero",
  "cacao",
]);
const draft = buildDishDraft("cena", dish?.dish || "", dish?.ingredients || []);
assert.match(draft, /Per la cena ti propongo una torta al cacao/);
assert.match(draft, /uova, farina, zucchero e cacao/);
assert.doesNotMatch(draft, /Vuoi che ti prepari|pranzo o la cena/i);
assert.equal(mealDishContext("sì", cacao), null);
const lunchPlate = mealDishContext("Si, preparami il pranzo.", [
  "carne, pane, pomodori, insalata",
]);
assert.equal(lunchPlate?.meal, "pranzo");
assert.equal(lunchPlate?.dish, "un panino con carne");
assert.deepEqual(lunchPlate?.ingredients, [
  "carne",
  "pane",
  "pomodori",
  "insalata",
]);
assert.equal(mealDishContext("cena alle 20", []), null);
const grocery =
  "Mi servirebbe del latte, delle uova, due zucchine e una salsiccia";
const groceryAsk = ingredientMealQuestion(grocery);
assert.ok(groceryAsk);
assert.match(groceryAsk || "", /latte, uova, zucchine, salsiccia/);
assert.match(groceryAsk || "", /pranzo o la cena/i);
assert.doesNotMatch(groceryAsk || "", /Mi servirebbe|delle|due|una/i);
assert.equal(ingredientMealQuestion("Cena"), null);
const asked =
  "Sono Fiammetta. Hai elencato questi ingredienti: latte, uova, zucchine, salsiccia.\nVuoi che ti prepari il pranzo o la cena con questi?";
const lunchFromQuestion = mealDishContext("Sì, preparami il pranzo.", [asked]);
assert.equal(lunchFromQuestion?.meal, "pranzo");
assert.equal(
  lunchFromQuestion?.dish,
  "una frittata di zucchine e salsiccia",
);
assert.deepEqual(lunchFromQuestion?.ingredients, [
  "latte",
  "uova",
  "zucchine",
  "salsiccia",
]);
const lunchDraft = buildDishDraft(
  "pranzo",
  lunchFromQuestion?.dish || "",
  lunchFromQuestion?.ingredients || [],
);
assert.match(
  lunchDraft,
  /^Per il pranzo ti propongo una frittata di zucchine e salsiccia/,
);
assert.match(lunchDraft, /uova e un goccio di latte/);
assert.doesNotMatch(
  lunchDraft,
  /Userò latte, uova, zucchine e salsiccia|torta|carne|Andrea|Vuoi che ti prepari/i,
);
assert.equal(ingredientMealQuestion("ciao"), null);
const pastaAsk = ingredientMealQuestion(
  "Pasta, formaggio, ragù di carne, peperoncino",
);
assert.match(pastaAsk || "", /Vuoi che ti prepari il pranzo o la cena/);
assert.doesNotMatch(pastaAsk || "", /ti propongo|Userò|Preparo la cena con/i);

const mixedThread = [
  "Ciao Andrea, farina, zucchero, cacao, uova",
  "Hai elencato questi ingredienti: Ciao Andrea, farina, zucchero, cacao, uova.\nVuoi che ti prepari il *pranzo* o la *cena* con questi?",
  "Carne, pane, pomodori, insalata",
];
const current = mealDishContext("Si, preparami il pranzo.", mixedThread, "Tommaso");
assert.equal(current?.dish, "un panino con carne");
assert.deepEqual(current?.ingredients, ["Carne", "pane", "pomodori", "insalata"]);
const currentDraft = buildDishDraft(
  "pranzo",
  current?.dish || "",
  current?.ingredients || [],
);
assert.match(currentDraft, /panino con carne/);
assert.match(currentDraft, /Carne, pane, pomodori e insalata/);
assert.doesNotMatch(currentDraft, /torta|cacao|Andrea|Ciao|Tommaso/i);
assert.equal(customerNameFromDisplay("Tommaso Rossi"), "Tommaso Rossi");
assert.equal(spokenCustomerName("Tommaso Pelucchini"), "Tommaso");
assert.equal(spokenCustomerName("Tommaso"), "Tommaso");
assert.equal(spokenCustomerName("Unknown"), null);
assert.equal(customerNameFromDisplay("Unknown"), null);
assert.equal(customerNameFromDisplay("+393337802795"), null);
assert.equal(customerNameFromDisplay(""), null);
assert.deepEqual(
  ingredientsFromThread(["Ciao Andrea, uova, farina, zucchero, cacao"]),
  ["uova", "farina", "zucchero", "cacao"],
);
assert.equal(fiammettaRouteLabel("Cibo"), "Fiammetta → Cibo");
assert.equal(fiammettaRouteLabel("Appuntamenti"), "Fiammetta → Appuntamenti");
assert.equal(
  withFiammettaIntro("Perfetto. Preferisci il pranzo o la cena?"),
  "Sono Fiammetta. Perfetto. Preferisci il pranzo o la cena?",
);
assert.equal(
  withFiammettaIntro("Sono Fiammetta. Già presentato."),
  "Sono Fiammetta. Già presentato.",
);

assert.equal(parseFoodSendMode(null), "manual");
assert.equal(parseFoodSendMode("automatic"), "automatic");
assert.equal(parseFoodSendMode("other"), "manual");
assert.equal(
  shouldAutoSendFoodDraft({ mode: "manual", messageId: "m1", tried: {} }),
  false,
);
assert.equal(
  shouldAutoSendFoodDraft({ mode: "automatic", messageId: "m1", tried: {} }),
  true,
);
assert.equal(
  shouldAutoSendFoodDraft({
    mode: "automatic",
    messageId: "m1",
    tried: { m1: "sent" },
  }),
  false,
);
assert.equal(
  shouldAutoSendFoodDraft({
    mode: "automatic",
    messageId: "m1",
    tried: { m1: "window" },
  }),
  false,
);
assert.equal(
  isWindowClosedSendError({ code: "E15044", message: "no" }),
  true,
);
assert.equal(
  isWindowClosedSendError({ message: "customer service window is closed" }),
  true,
);
assert.equal(isWindowClosedSendError({ message: "network down" }), false);
const caponataText =
  "Sono Fiammetta. Per la cena ti propongo una caponata di verdure. Le stufiamo in padella con un filo d'olio.";
assert.equal(
  shouldAutoSendFoodDraft({
    mode: "automatic",
    messageId: "m2",
    tried: {},
    text: caponataText,
    sentTexts: new Set([normalizeOutboundText(caponataText)]),
  }),
  false,
);
assert.equal(
  shouldAutoSendFoodDraft({
    mode: "automatic",
    messageId: "m2",
    tried: { m2: "sent" },
    text: "altro testo",
  }),
  false,
);
const vegQuestion =
  "Sono Fiammetta. Hai elencato questi ingredienti: Pomodori, zucchine, melanzane, aglio.\nVuoi che ti prepari il pranzo o la cena con questi?";
const quotedCena = `${vegQuestion}\ncena`;
assert.equal(chosenMeal(quotedCena), null);
assert.equal(bareMealChoice(quotedCena), "cena");
const quotedDish = mealDishContext(quotedCena, [
  "Pomodori, zucchine, melanzane, aglio",
  vegQuestion,
]);
assert.equal(quotedDish?.meal, "cena");
assert.equal(quotedDish?.dish, "una caponata di verdure");
const bareCena = mealDishContext("cena", [
  "Pomodori, zucchine, melanzane, aglio",
  vegQuestion,
]);
assert.equal(bareCena?.dish, "una caponata di verdure");
const veg = mealDishContext("Cena", ["Pomodori, zucchine, melanzane, aglio"]);
assert.equal(veg?.meal, "cena");
assert.equal(veg?.dish, "una caponata di verdure");
const vegDraft = buildDishDraft("cena", veg?.dish || "", veg?.ingredients || []);
assert.match(vegDraft, /^Per la cena ti propongo una caponata di verdure/);
assert.match(vegDraft, /filo d'olio/);
assert.doesNotMatch(vegDraft, /un piatto con|Userò Pomodori/i);
assert.equal(isOwnFoodReply(withFiammettaIntro(vegDraft)), true);
assert.equal(isOwnFoodReply("Cena"), false);
const followUp = mealFollowUpQuestion(
  "cena",
  [
    "Pomodori, zucchine, melanzane, aglio",
    "Sono Fiammetta. Hai elencato questi ingredienti: Pomodori, zucchine, melanzane, aglio.\nVuoi che ti prepari il pranzo o la cena con questi?",
  ],
  "Tommaso",
);
assert.equal(
  followUp,
  "Tommaso, per la cena con Pomodori, zucchine, melanzane e aglio va bene?",
);
assert.doesNotMatch(followUp || "", /ti propongo|un piatto con|Userò/i);
assert.equal(
  mealFollowUpQuestion("cena", ["Pomodori, zucchine, melanzane, aglio"], null),
  "Per la cena con Pomodori, zucchine, melanzane e aglio va bene?",
);
assert.equal(mealFollowUpQuestion("cena", [], "Tommaso"), null);
const yesPriors = [
  "Pomodori, zucchine, melanzane, aglio",
  "Sono Fiammetta. Hai elencato questi ingredienti: Pomodori, zucchine, melanzane, aglio.\nVuoi che ti prepari il pranzo o la cena con questi?",
];
const yesQuestion = withFiammettaIntro(followUp || "");
assert.equal(
  mealAcceptedDraft(yesQuestion, yesPriors, "Tommaso"),
  "Perfetto, Tommaso. Per la cena preparo una caponata di verdure.",
);
assert.equal(
  mealAcceptedDraft(
    "Per la cena con Pomodori, zucchine, melanzane e aglio va bene?",
    yesPriors,
    null,
  ),
  "Perfetto. Per la cena preparo una caponata di verdure.",
);
const lunchYes = mealAcceptedDraft(
  "Per il pranzo con latte, uova, zucchine e salsiccia va bene?",
  ["latte, uova, zucchine, salsiccia"],
  null,
);
assert.equal(
  lunchYes,
  "Perfetto. Per il pranzo preparo una frittata di zucchine e salsiccia.",
);
const plainYes = mealAcceptedDraft(
  "Per la cena con pollo, riso e zucchine va bene?",
  ["pollo, riso, zucchine"],
  "Tommaso",
);
assert.equal(
  plainYes,
  "Perfetto, Tommaso. Per la cena preparo un risotto di pollo e zucchine.",
);
const raguYes = mealAcceptedDraft(
  "Tommaso Pelucchini, per la cena con Pasta, formaggio, ragù di carne e peperoncino va bene?",
  ["Pasta, formaggio, ragù di carne, peperoncino"],
  "Tommaso Pelucchini",
);
assert.equal(
  raguYes,
  "Perfetto, Tommaso. Per la cena preparo una pasta al ragù piccante.",
);
assert.doesNotMatch(
  raguYes || "",
  /Preparo la cena con|Pelucchini|formaggio|peperoncino|ti propongo un piatto con|Userò/i,
);
assert.doesNotMatch(
  `${yesQuestion} ${mealAcceptedDraft(yesQuestion, yesPriors, "Tommaso")}`,
  /ti propongo un piatto con|Userò/i,
);
assert.equal(mealAcceptedDraft("cena", yesPriors, "Tommaso"), null);
assert.equal(
  isOwnFoodReply(
    "Sono Fiammetta. Perfetto, Tommaso. Per la cena preparo una caponata di verdure.",
  ),
  true,
);
assert.deepEqual(
  ingredientsFromThread([
    "Pomodori, zucchine, melanzane, aglio",
    "Tommaso, per la cena con Pomodori, zucchine, melanzane e aglio va bene?",
  ]),
  ["Pomodori", "zucchine", "melanzane", "aglio"],
);

const provaFood = provaFiammettaReply(
  "Pasta, formaggio, ragù di carne, peperoncino",
);
assert.match(provaFood?.draft || "", /Sono Fiammetta/);
assert.match(provaFood?.draft || "", /pranzo o la cena/);
assert.doesNotMatch(provaFood?.draft || "", /ti propongo un piatto con|Userò/i);
const provaCena = provaFiammettaReply("cena", [
  "Pasta, formaggio, ragù di carne, peperoncino",
  provaFood?.draft || "",
]);
assert.match(provaCena?.draft || "", /per la cena con Pasta, formaggio, ragù di carne e peperoncino va bene/i);
const provaYes = provaFiammettaReply("sì", [
  "Pasta, formaggio, ragù di carne, peperoncino",
  provaFood?.draft || "",
  "cena",
  provaCena?.draft || "",
]);
assert.match(provaYes?.draft || "", /pasta al ragù piccante/i);
assert.doesNotMatch(
  provaYes?.draft || "",
  /Preferisci il pranzo|Preparo la cena con|ti propongo un piatto con|Userò/i,
);
const carbonaraList = "uovo, pancetta, pecorino, spaghetti";
const carbonaraAsk = provaFiammettaReply(carbonaraList);
const carbonaraSi = provaFiammettaReply("si", [
  carbonaraList,
  carbonaraAsk?.draft || "",
]);
assert.match(carbonaraSi?.draft || "", /Preferisci il pranzo o la cena/);
const carbonaraCena = provaFiammettaReply("cena", [
  carbonaraList,
  carbonaraAsk?.draft || "",
  "si",
  carbonaraSi?.draft || "",
]);
assert.match(
  carbonaraCena?.draft || "",
  /per la cena con uovo, pancetta, pecorino e spaghetti va bene/i,
);
const carbonaraDish = provaFiammettaReply("si", [
  carbonaraList,
  carbonaraAsk?.draft || "",
  "si",
  carbonaraSi?.draft || "",
  "cena",
  carbonaraCena?.draft || "",
]);
assert.match(carbonaraDish?.draft || "", /una carbonara/i);
assert.doesNotMatch(
  carbonaraDish?.draft || "",
  /uovo|pancetta|pecorino|spaghetti|ti propongo un piatto con|Userò/i,
);
const carbonaraPrior = [
  carbonaraList,
  carbonaraAsk?.draft || "",
  "si",
  carbonaraSi?.draft || "",
  "cena",
  carbonaraCena?.draft || "",
  "si",
  carbonaraDish?.draft || "",
];
assert.equal(provaFiammettaReply(carbonaraList, carbonaraPrior), null);
assert.equal(
  provaFiammettaReply("si", [carbonaraList, carbonaraAsk?.draft || "", "si", carbonaraSi?.draft || ""]),
  null,
);
assert.equal(provaFiammettaReply("cena", carbonaraPrior.slice(0, 6)), null);
assert.equal(provaFiammettaReply("si", carbonaraPrior), null);
const nextList = provaFiammettaReply(
  "pomodori, mozzarella, basilico, olio",
  carbonaraPrior,
);
assert.match(nextList?.draft || "", /pranzo o la cena/);
assert.doesNotMatch(nextList?.draft || "", /carbonara/);
const nextCena = provaFiammettaReply("cena", [
  ...carbonaraPrior,
  "pomodori, mozzarella, basilico, olio",
  nextList?.draft || "",
]);
assert.match(nextCena?.draft || "", /per la cena con pomodori, mozzarella, basilico e olio va bene/i);
assert.equal(provaFiammettaReply("ciao"), null);
assert.equal(provaFiammettaReply("  "), null);
const manualAsk = await answerCustomer({
  question: "uovo, pancetta, pecorino, spaghetti",
  prior: [],
});
assert.match(manualAsk, /pranzo o la cena/);
const manualOther = await answerCustomer({
  question: "che ore sono?",
  prior: [],
});
assert.match(manualOther, /che ore sono\?/);
const pepperPrior: string[] = [];
const pepperAsk = await answerCustomer({
  question: "uova, spaghetti, pecorino, pepe",
  prior: pepperPrior,
});
pepperPrior.push("uova, spaghetti, pecorino, pepe", pepperAsk);
const pepperSi = await answerCustomer({ question: "si", prior: pepperPrior });
pepperPrior.push("si", pepperSi);
const originalFetch = globalThis.fetch;
const chefMenu = {
  menu: [
    {
      portata: "antipasto",
      piatto: null,
      ingredienti: [],
      alimento_principale: null,
      note: "Con questi alimenti non c'è un antipasto.",
    },
    {
      portata: "primo",
      piatto: "Spaghetti con uova, pecorino e pepe",
      ingredienti: ["spaghetti", "uova", "pecorino", "pepe"],
      alimento_principale: "spaghetti",
      preparazione: "Cuoci gli spaghetti e condisci con uova, pecorino e pepe.",
      note: "",
    },
    {
      portata: "secondo",
      piatto: null,
      ingredienti: [],
      alimento_principale: null,
      note: "Manca un secondo.",
    },
    {
      portata: "contorno",
      piatto: null,
      ingredienti: [],
      alimento_principale: null,
      note: "Manca un contorno.",
    },
    {
      portata: "dolce",
      piatto: null,
      ingredienti: [],
      alimento_principale: null,
      note: "Manca un dolce.",
    },
  ],
  alimenti_non_usati: [],
  note: "",
};
const badMenu = {
  ...chefMenu,
  menu: chefMenu.menu.map((course) =>
    course.portata === "primo"
      ? {
          ...course,
          piatto: "Spaghetti con upva, pecorino e pepe",
          ingredienti: course.ingredienti.map((item) => (item === "uova" ? "upva" : item)),
        }
      : course,
  ),
};
let calls: Array<{
  url: string;
  model: string;
  temperature: unknown;
  format: unknown;
  system: string;
  user: string;
  hasKey: boolean;
}> = [];
function mockChef(contents: string[]) {
  let n = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      temperature?: unknown;
      system?: string;
      output_config?: { format?: unknown };
      messages?: Array<{ content?: string }>;
    };
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(url),
      model: body.model ?? "",
      temperature: "temperature" in body ? body.temperature : undefined,
      format: body.output_config?.format,
      system: body.system ?? "",
      user: body.messages?.[0]?.content ?? "",
      hasKey: Boolean(headers["x-api-key"]),
    });
    const content = contents[Math.min(n, contents.length - 1)];
    n += 1;
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: content }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}
const savedKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
const missingKey = await answerCustomer({ question: "cena", prior: pepperPrior });
assert.match(missingKey, /Manca ANTHROPIC_API_KEY nell'ambiente/);
assert.doesNotMatch(missingKey, /incolla/i);
process.env.ANTHROPIC_API_KEY = "test-key";
calls = [];
mockChef([JSON.stringify(badMenu), JSON.stringify(chefMenu)]);
let pepperCena = "";
try {
  pepperCena = await answerCustomer({ question: "cena", prior: pepperPrior });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(calls.length, 2);
assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
assert.equal(calls[0].model, "claude-opus-5-5");
assert.equal(calls[0].temperature, undefined);
assert.equal(calls[0].hasKey, true);
assert.equal((calls[0].format as { type?: string }).type, "json_schema");
assert.ok((calls[0].format as { schema?: { properties?: { menu?: unknown } } }).schema?.properties?.menu);
assert.match(calls[0].system, /Usa SOLO gli alimenti dati, più sale, pepe, olio e acqua/);
assert.match(calls[0].system, /antipasto, primo, secondo, contorno, dolce/);
assert.match(calls[0].system, /piatto è null e note/);
assert.match(calls[0].system, /al massimo due portate/);
assert.match(calls[0].system, /Non dedurre allergeni/);
assert.match(calls[0].system, /alimenti_non_usati/);
assert.match(calls[0].user, /uova, spaghetti, pecorino e pepe/);
assert.match(calls[1].user, /Il nome «upva» non combacia con «uova»/);
assert.match(pepperCena, /^Antipasto\nPiatto: nessuno\nIngredienti: nessuno/);
assert.match(pepperCena, /Primo\nPiatto: Spaghetti con uova, pecorino e pepe\nIngredienti: spaghetti, uova, pecorino, pepe/);
assert.doesNotMatch(pepperCena, /Preparazione|Cuoci|\{|\}|"portata"|alimenti_non_usati/);
assert.doesNotMatch(pepperCena, /elenchi gli alimenti|allergen|upva/i);

calls = [];
globalThis.fetch = (async () => {
  throw new Error("Cannot reach Anthropic API");
}) as typeof fetch;
let claudeDown = "";
try {
  claudeDown = await answerCustomer({ question: "cena", prior: pepperPrior });
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(claudeDown, /Claude non ha scritto il menù/);
assert.match(claudeDown, /Anthropic/i);
assert.equal(calls.length, 0);

const menuPrior = [
  "uova, spaghetti, pepe, pecorino",
  "Vuoi che ti prepari il pranzo o la cena?",
  "Per la cena con uova, spaghetti, pepe e pecorino va bene?",
];
calls = [];
mockChef([JSON.stringify(chefMenu)]);
let menuReply = "";
try {
  menuReply = await answerCustomer({
    question: "OK. Fammi il menù",
    prior: menuPrior,
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(menuReply, /Piatto: Spaghetti con uova, pecorino e pepe/);
assert.doesNotMatch(menuReply, /Preparazione|Cuoci|\{|alimenti_non_usati/);
assert.match(calls[0].user, /uova/);
assert.match(calls[0].user, /pepe/);
assert.match(calls[0].user, /pecorino/);
assert.doesNotMatch(menuReply, /elenchi gli alimenti/);

const againPrior = [...menuPrior, "OK. Fammi il menù", menuReply];
calls = [];
const againAnswer = "Resto sulla cena con uova, spaghetti, pepe e pecorino.";
globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    system?: string;
    messages?: Array<{ content?: string }>;
  };
  calls.push({
    url: String(_url),
    model: "",
    temperature: undefined,
    format: undefined,
    system: body.system ?? "",
    user: body.messages?.[0]?.content ?? "",
    hasKey: false,
  });
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: againAnswer }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;
let againReply = "";
try {
  againReply = await answerCustomer({ question: "e dopo?", prior: againPrior });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(againReply, againAnswer);
assert.match(calls[0].system, /Non chiedere gli ingredienti/i);
assert.match(calls[0].system, /Non descrivere come si prepara/i);
assert.match(calls[0].user, /Pasto: la cena/);
assert.match(calls[0].user, /uova, spaghetti, pepe e pecorino/);
assert.match(calls[0].user, /Ha già detto sì/);
assert.match(calls[0].user, /Nuova frase: e dopo\?/);
assert.doesNotMatch(againReply, /elenchi gli alimenti/);

const peoplePrior = [
  "uova, spaghetti, pepe, pecorino",
  "Vuoi che ti prepari il pranzo o la cena?",
  "siamo in 4, niente piccante",
];
calls = [];
globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    system?: string;
    messages?: Array<{ content?: string }>;
  };
  calls.push({
    url: String(_url),
    model: "",
    temperature: undefined,
    format: undefined,
    system: body.system ?? "",
    user: body.messages?.[0]?.content ?? "",
    hasKey: false,
  });
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: "Va bene, in 4, senza piccante." }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;
let peopleReply = "";
try {
  peopleReply = await answerCustomer({
    question: "e il dolce lo saltiamo",
    prior: peoplePrior,
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.match(calls[0].user, /uova, spaghetti, pepe e pecorino/);
assert.match(calls[0].user, /Persone: 4/);
assert.match(calls[0].user, /niente piccante/);
assert.match(calls[0].user, /già chiesto, non ancora scelto/);
assert.match(calls[0].system, /Non chiedere gli ingredienti/i);
assert.doesNotMatch(peopleReply, /elenchi gli alimenti/);
if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
else process.env.ANTHROPIC_API_KEY = savedKey;

console.log("specialist heuristic checks ok");
