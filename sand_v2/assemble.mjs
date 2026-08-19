import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const parts = [
  'part00.js.txt','part01.js.txt','part02.js.txt','part03.js.txt',
  'part04.js.txt','part05.js.txt','part06.js.txt','part07.js.txt',
];
let sourceText = parts.map((name) =>
  readFileSync(new URL(`./source_parts/${name}`, import.meta.url), 'utf8')
).join('');

function replaceOrThrow(search, replacement, label) {
  if (!sourceText.includes(search)) throw new Error(`SAND Core V2 transform anchor missing: ${label}`);
  sourceText = sourceText.replace(search, replacement);
}

replaceOrThrow(
  '    "Required top-level keys are intent, continuation, goal, thread_summary, focus, actions, clarification, reply, confidence. focus.mode is keep, set, or clear. If focus.mode is set, focus.target uses the same target string contract. actions is always an array. clarification is either null or an object with question and reason.",',
  '    "Required top-level keys are effect, intent, continuation, goal, thread_summary, focus, actions, clarification, reply, confidence. effect is exactly answer, mutate, or clarify. Use mutate whenever the user asks to create, change, remove, remember, forget, schedule, cancel, or otherwise alter durable state; answer when no durable state change is requested; clarify only when a genuinely essential ambiguity blocks execution.",\n    "A mutate plan MUST contain at least one real domain mutation action; changing focus alone is never enough to satisfy a requested state change.",\n    "focus.mode is keep, set, or clear. If focus.mode is set, focus.target uses the same target string contract. actions is always an array. clarification is either null or an object with question and reason.",',
  'planner effect contract',
);

replaceOrThrow(
  '  const actionsRaw = Array.isArray(input.actions) ? input.actions : [];\n  if (actionsRaw.length > PLANNER_MAX_ACTIONS) throw new SandPlanError("TOO_MANY_ACTIONS", "Planner exceeded action budget");\n\n  const actions = actionsRaw.map((action, index) => {',
  '  const effect = String(input.effect ?? "");\n  if (!new Set(["answer", "mutate", "clarify"]).has(effect)) {\n    throw new SandPlanError("BAD_EFFECT", "Plan effect must be answer, mutate, or clarify");\n  }\n\n  const actionsRaw = Array.isArray(input.actions) ? input.actions : [];\n  if (actionsRaw.length > PLANNER_MAX_ACTIONS) throw new SandPlanError("TOO_MANY_ACTIONS", "Planner exceeded action budget");\n\n  const actions = actionsRaw.map((action, index) => {',
  'validate effect',
);

replaceOrThrow(
  '    if (type === "object.patch") {\n      return { type, args: { target: validateTarget(args.target, snapshot), fields: sanitizeObjectFields(args.fields) } };',
  '    if (type === "object.patch") {\n      const target = validateTarget(args.target, snapshot);\n      const fields = sanitizeObjectFields(args.fields);\n      if (Object.keys(fields).length === 0) throw new SandPlanError("EMPTY_PATCH", "Object patch has no fields");\n      const current = target.mode === "id"\n        ? snapshot.objects.find((object) => object.id === target.id) ?? null\n        : snapshot.focus ?? (snapshot.workspace.focus_object_id\n          ? snapshot.objects.find((object) => object.id === snapshot.workspace.focus_object_id) ?? null\n          : null);\n      if (current) {\n        const preview = mergeObjectState(current.state, fields, current.title);\n        if (JSON.stringify(preview) === JSON.stringify(current.state)) {\n          throw new SandPlanError("NOOP_PATCH", "Object patch would not change the target state");\n        }\n      }\n      return { type, args: { target, fields } };',
  'reject no-op object patch',
);

replaceOrThrow(
  '  let focus = { mode: "keep" };',
  '  const domainMutationTypes = new Set([\n    "object.create", "object.patch", "object.archive",\n    "reminder.set", "reminder.cancel", "memory.upsert", "memory.forget",\n  ]);\n  if (effect === "mutate" && !actions.some((action) => domainMutationTypes.has(action.type))) {\n    throw new SandPlanError("EMPTY_MUTATION", "Mutation intent requires a real domain mutation action");\n  }\n\n  let focus = { mode: "keep" };',
  'require domain mutation',
);

replaceOrThrow(
  '  return {\n    intent: compactText(input.intent, 120) || "conversation",',
  '  return {\n    effect,\n    intent: compactText(input.intent, 120) || "conversation",',
  'store effect',
);

const source = Buffer.from(sourceText, 'utf8');
const sha = createHash('sha256').update(source).digest('hex');
writeFileSync('SAND_CORE_V2.js', source);
console.log(`SAND_CORE_V2_SOURCE_OK ${sha} ${source.length} bytes`);
