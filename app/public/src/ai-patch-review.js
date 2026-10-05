import { applyManifestPatch, validateManifestPatch } from "./ai-model-router.js";
import { diffStudioManifests, migrateStudioManifest, validateStudioManifest } from "./manifest-versioning.js";

const clone = (value) => structuredClone(value);
const nowIso = (options) => options.now || new Date().toISOString();

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function patchHash(patch) {
  return hashText(JSON.stringify(patch));
}

export function createAiPatchReview(input, options = {}) {
  const validation = validateManifestPatch(input.patch);
  if (!validation.valid) throw new Error(`invalid manifest patch: ${validation.issues[0].message}`);
  const manifest = migrateStudioManifest(input.manifest);
  const previewManifest = migrateStudioManifest(applyManifestPatch(manifest, input.patch));
  const previewValidation = validateStudioManifest(previewManifest);
  if (!previewValidation.valid) throw new Error(`invalid AI manifest result: ${previewValidation.issues[0].message}`);
  const createdAt = nowIso(options);
  const hash = patchHash(input.patch);
  return {
    id: input.id || `review_${hash}_${String(input.manifestVersion)}`,
    projectId: input.projectId,
    status: "pending_review",
    manifestVersion: Number(input.manifestVersion),
    patch: clone(input.patch),
    patchHash: hash,
    previewManifest,
    diff: diffStudioManifests(manifest, previewManifest),
    createdBy: input.createdBy || "ai",
    createdAt,
    updatedAt: createdAt,
    decision: null,
  };
}

function assertReview(review) {
  if (!review || !["pending_review", "approved", "rejected", "undone", "expired"].includes(review.status)) throw new Error("invalid AI patch review");
}

export function approveAiPatchReview(review, context, options = {}) {
  assertReview(review);
  if (review.status === "approved") return { review: clone(review), manifest: clone(context.manifest), idempotent: true };
  if (review.status !== "pending_review") throw new Error(`cannot approve review in ${review.status} state`);
  if (Number(context.manifestVersion) !== review.manifestVersion) throw new Error("stale manifest version");
  if (patchHash(review.patch) !== review.patchHash) throw new Error("patch hash mismatch");
  const validation = validateManifestPatch(review.patch);
  if (!validation.valid) throw new Error(`invalid manifest patch: ${validation.issues[0].message}`);
  const previousManifest = migrateStudioManifest(context.manifest);
  const manifest = migrateStudioManifest(applyManifestPatch(previousManifest, review.patch));
  const manifestValidation = validateStudioManifest(manifest);
  if (!manifestValidation.valid) throw new Error(`invalid AI manifest result: ${manifestValidation.issues[0].message}`);
  const updatedAt = nowIso(options);
  return {
    review: {
      ...clone(review),
      status: "approved",
      updatedAt,
      decision: { by: context.actor || "unknown", at: updatedAt, manifestVersion: review.manifestVersion + 1 },
      previousManifest,
    },
    manifest,
    idempotent: false,
    audit: { action: "ai_patch.approved", reviewId: review.id, actor: context.actor || "unknown", at: updatedAt, patchHash: review.patchHash },
  };
}

export function rejectAiPatchReview(review, context = {}, options = {}) {
  assertReview(review);
  if (review.status === "rejected") return { review: clone(review), idempotent: true };
  if (review.status !== "pending_review") throw new Error(`cannot reject review in ${review.status} state`);
  const updatedAt = nowIso(options);
  return {
    review: { ...clone(review), status: "rejected", updatedAt, decision: { by: context.actor || "unknown", at: updatedAt, reason: context.reason || "" } },
    idempotent: false,
    audit: { action: "ai_patch.rejected", reviewId: review.id, actor: context.actor || "unknown", at: updatedAt, reason: context.reason || "" },
  };
}

export function undoAiPatchReview(review, context = {}, options = {}) {
  assertReview(review);
  if (review.status === "undone") return { review: clone(review), manifest: clone(context.manifest), idempotent: true };
  if (review.status !== "approved" || !review.previousManifest) throw new Error("only an approved review can be undone");
  if (context.manifestVersion !== undefined && Number(context.manifestVersion) !== Number(review.decision.manifestVersion)) throw new Error("stale manifest version");
  const updatedAt = nowIso(options);
  return {
    review: { ...clone(review), status: "undone", updatedAt, undo: { by: context.actor || "unknown", at: updatedAt } },
    manifest: clone(review.previousManifest),
    idempotent: false,
    audit: { action: "ai_patch.undone", reviewId: review.id, actor: context.actor || "unknown", at: updatedAt },
  };
}

export function expireAiPatchReview(review, options = {}) {
  assertReview(review);
  if (review.status !== "pending_review") return clone(review);
  return { ...clone(review), status: "expired", updatedAt: nowIso(options) };
}
