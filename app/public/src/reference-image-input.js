import { validateSketchInput } from "./sketch-input.js";

export const REFERENCE_DESCRIPTION_MAX_LENGTH = 2000;

export function validateReferenceImageInput(reference) {
  if (reference === undefined || reference === null) return { valid: true, reference: null };
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return { valid: false, status: 400, code: "invalid_reference", message: "reference must be an object" };
  const image = validateSketchInput(reference);
  if (!image.valid) return { valid: false, status: image.status, code: image.code.replace("sketch", "reference"), message: image.message.replaceAll("sketch", "reference image").replaceAll("Sketch", "Reference image") };
  if (reference.description !== undefined && (typeof reference.description !== "string" || reference.description.length > REFERENCE_DESCRIPTION_MAX_LENGTH)) return { valid: false, status: 400, code: "invalid_reference_description", message: `reference description must be at most ${REFERENCE_DESCRIPTION_MAX_LENGTH} characters` };
  if (reference.fileName !== undefined && (typeof reference.fileName !== "string" || reference.fileName.length > 255)) return { valid: false, status: 400, code: "invalid_reference_metadata", message: "reference file name is invalid" };
  for (const key of ["originalWidth", "originalHeight"]) if (reference[key] !== undefined && (!Number.isInteger(reference[key]) || reference[key] < 1 || reference[key] > 10000)) return { valid: false, status: 400, code: "invalid_reference_metadata", message: "reference dimensions are invalid" };
  return { valid: true, reference };
}

export function multimodalStudioInput(input, sketch, reference) {
  if (!sketch && !reference) return input;
  const content = [{ type: "input_text", text: String(input) }];
  if (sketch) content.push({ type: "input_text", text: "The next image is a structural layout sketch." }, { type: "input_image", image_url: sketch.dataUrl, detail: "high" });
  if (reference) content.push(
    { type: "input_text", text: `The next image is visual reference only. Requirements take priority. Do not copy logos, trademarks, personal data, or visible secrets. Reference note: ${reference.description || "none"}` },
    { type: "input_image", image_url: reference.dataUrl, detail: "high" }
  );
  return [{ role: "user", content }];
}
