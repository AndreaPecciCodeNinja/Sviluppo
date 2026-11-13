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
const provaOther = provaFiammettaReply("ciao");
assert.match(provaOther?.draft || "", /Sono Fiammetta/);
assert.equal(provaFiammettaReply("  "), null);

console.log("specialist heuristic checks ok");
