import assert from "node:assert/strict";
import {
  buildAppointmentDraft,
  heuristicAppointmentSlots,
  normalizeTime,
} from "../src/lib/agents/appointment-draft.ts";
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

console.log("specialist heuristic checks ok");
