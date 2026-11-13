import assert from "node:assert/strict";
import {
  buildAppointmentDraft,
  heuristicAppointmentSlots,
  normalizeTime,
} from "../src/lib/agents/appointment-draft.ts";
import {
  buildDishDraft,
  chosenMeal,
  ingredientsFromThread,
  isBareAffirmation,
  mealChoiceFollowUp,
  mealDishContext,
  MEAL_CHOICE_DRAFT,
} from "../src/lib/agents/meal-choice.ts";
import {
  heuristicIntent,
  matchAppointment,
  matchFood,
} from "../src/lib/agents/match.ts";
import type { RouterIntent } from "../src/lib/agents/types.ts";

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
assert.equal(chosenMeal("Cena"), "cena");
assert.equal(chosenMeal("per il pranzo"), "pranzo");
assert.equal(chosenMeal("cena alle 20"), null);
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

console.log("specialist heuristic checks ok");
