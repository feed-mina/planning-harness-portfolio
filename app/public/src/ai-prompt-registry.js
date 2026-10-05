import { MANIFEST_PATCH_ALLOWED_ROOTS } from "./ai-model-router.js";

const TASK_INSTRUCTIONS = Object.freeze({
  "theme-token-suggest": "Suggest coherent theme token changes for the requested visual direction.",
  "element-style-suggest": "Suggest narrowly scoped style changes for the selected element.",
  "screen-generate": "Create or revise page and element declarations for the requested screen.",
  "publish-quality-gate": "Return only fixes required for publish readiness.",
  "i18n-draft": "Add draft locale messages without changing existing source-language messages.",
  "i18n-refine": "Improve locale messages for meaning, tone, and UI length constraints.",
  "manifest-error-explain": "Correct the supplied manifest validation errors.",
  "metadata-generate": "Add concise metadata for the requested page or component.",
  "white-label-design": "Apply the requested brand system through theme and element declarations.",
});

const SHARED_INSTRUCTIONS = [
  "You edit an SDUI template manifest.",
  "Return only the structured response required by the supplied JSON Schema.",
  `Only edit these roots: ${MANIFEST_PATCH_ALLOWED_ROOTS.join(", ")}.`,
  "Do not edit identity, runtime adapters, plugins, API, environment, gating, or plan fields.",
  "Prefer the smallest patch that satisfies the request.",
  "For interactions, use only page-local state plus node events.onClick with setState, toggleState, or navigate.",
  "Conditions may only use visibleWhen or enabledWhen in the form { state, equals }.",
  "Never emit JavaScript, inline event handlers, arbitrary CSS, external workflow actions, or undeclared state/route targets.",
  "Transitions may only use opacity or transform, 0-1000ms, and linear/ease/ease-in/ease-out/ease-in-out.",
].join("\n");

export const DEFAULT_AI_PROMPTS = Object.freeze(Object.fromEntries(
  Object.entries(TASK_INSTRUCTIONS).map(([taskType, taskInstruction]) => [
    taskType,
    Object.freeze({ id: `sdui_${taskType.replaceAll("-", "_")}`, version: "1", instructions: `${SHARED_INSTRUCTIONS}\nTask: ${taskInstruction}` }),
  ])
));

export function resolveStudioAiPrompt(taskType, context = {}, registry = DEFAULT_AI_PROMPTS) {
  const definition = registry[taskType];
  if (!definition) throw Object.assign(new Error(`no prompt registered for task: ${taskType}`), { code: "missing_ai_prompt" });
  const intent = String(context.intent || "").trim();
  if (!intent) throw Object.assign(new Error("AI task intent is required"), { code: "missing_ai_intent" });
  if (!context.manifest || typeof context.manifest !== "object" || Array.isArray(context.manifest)) {
    throw Object.assign(new Error("AI task manifest must be an object"), { code: "invalid_ai_manifest" });
  }
  return {
    id: definition.id,
    version: definition.version,
    instructions: definition.instructions,
    input: JSON.stringify({ intent, locale: context.locale || null, selection: context.selection || null, manifest: context.manifest }),
    cacheKey: `sdui-studio:${definition.id}:v${definition.version}`,
  };
}
