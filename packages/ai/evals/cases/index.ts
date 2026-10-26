import type { EvalCase } from "../types";
import { dates } from "./dates";
import { existing } from "./existing";
import { hard } from "./hard";
import { injection } from "./injection";
import { languages } from "./languages";
import { long, mixed, vague } from "./mixed";
import { resolvedInChat, smallTalk, supportQuestions } from "./no-ticket";
import { priority } from "./priority";
import { bugs, features, infraPerf, securityData, ui } from "./tickets";

export const cases: EvalCase[] = [
  ...smallTalk,
  ...supportQuestions,
  ...resolvedInChat,
  ...bugs,
  ...ui,
  ...features,
  ...infraPerf,
  ...securityData,
  ...priority,
  ...mixed,
  ...vague,
  ...injection,
  ...dates,
  ...languages,
  ...existing,
  ...long,
  ...hard,
];

const ids = new Set<string>();
for (const k of cases) {
  if (ids.has(k.id)) throw new Error(`Duplicate eval case id: ${k.id}`);
  ids.add(k.id);
}
