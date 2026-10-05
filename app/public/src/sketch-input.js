export const SKETCH_MAX_DATA_URL_LENGTH = 750000;
export const SKETCH_WIDTH = 640;
export const SKETCH_HEIGHT = 480;

export function validateSketchInput(sketch) {
  if (sketch === undefined || sketch === null) return { valid: true, sketch: null };
  if (!sketch || typeof sketch !== "object" || Array.isArray(sketch) || sketch.mimeType !== "image/png" || typeof sketch.dataUrl !== "string") {
    return { valid: false, status: 400, code: "invalid_sketch", message: "sketch must be a PNG data URL" };
  }
  if (!sketch.dataUrl.startsWith("data:image/png;base64,")) {
    return { valid: false, status: 400, code: "invalid_sketch", message: "sketch must be a PNG data URL" };
  }
  if (sketch.dataUrl.length > SKETCH_MAX_DATA_URL_LENGTH) {
    return { valid: false, status: 413, code: "sketch_too_large", message: "Sketch image exceeds the size limit" };
  }
  if (sketch.width !== SKETCH_WIDTH || sketch.height !== SKETCH_HEIGHT) {
    return { valid: false, status: 400, code: "invalid_sketch_dimensions", message: "Sketch dimensions must be 640x480" };
  }
  try {
    const encoded = sketch.dataUrl.slice("data:image/png;base64,".length);
    const bytes = typeof Buffer !== "undefined"
      ? Uint8Array.from(Buffer.from(encoded, "base64"))
      : Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) throw new Error("invalid signature");
  } catch {
    return { valid: false, status: 400, code: "invalid_sketch", message: "sketch must contain a valid PNG image" };
  }
  return { valid: true, sketch };
}
