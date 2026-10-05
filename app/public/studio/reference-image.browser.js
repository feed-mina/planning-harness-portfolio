const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 480;
const SOURCE_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function createReferenceImageEditor({ canvas, zoomInput, status }) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) throw new Error("A 2D reference canvas is required");
  let image = null;
  let fileMeta = null;
  let zoom = 1;
  let baseScale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let previous = null;

  const draw = () => {
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    const scale = baseScale * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2 + offsetX, (canvas.height - height) / 2 + offsetY, width, height);
  };
  const resetView = () => {
    if (!image) return;
    baseScale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    zoom = 1; offsetX = 0; offsetY = 0;
    zoomInput.value = "1";
    draw();
  };
  const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
  const pointerDown = (event) => { if (!image) return; dragging = true; previous = point(event); canvas.setPointerCapture(event.pointerId); };
  const pointerMove = (event) => { if (!dragging) return; const next = point(event); offsetX += next.x - previous.x; offsetY += next.y - previous.y; previous = next; draw(); };
  const pointerUp = (event) => { dragging = false; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  const zoomChanged = () => { zoom = Number(zoomInput.value); draw(); };
  const loadSource = async (src, meta) => {
    const loaded = await new Promise((resolve, reject) => { const next = new Image(); next.onload = () => resolve(next); next.onerror = () => reject(new Error("이미지를 읽지 못했습니다")); next.src = src; });
    image = loaded; fileMeta = { fileName: meta.fileName, originalWidth: meta.originalWidth || loaded.naturalWidth, originalHeight: meta.originalHeight || loaded.naturalHeight }; resetView();
    status.textContent = `${fileMeta.fileName} · ${fileMeta.originalWidth}×${fileMeta.originalHeight}`;
    return fileMeta;
  };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove); canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerUp); zoomInput.addEventListener("input", zoomChanged);
  draw();

  return {
    async loadFile(file) {
      if (!file || !ACCEPTED_TYPES.has(file.type)) throw new Error("PNG, JPEG, WebP 이미지만 사용할 수 있습니다");
      if (file.size > SOURCE_MAX_BYTES) throw new Error("원본 이미지는 10MB 이하여야 합니다");
      const url = URL.createObjectURL(file);
      try {
        return await loadSource(url, { fileName: file.name });
      } finally { URL.revokeObjectURL(url); }
    },
    async loadReference(reference) { return loadSource(reference.dataUrl, reference); },
    resetView,
    remove() { image = null; fileMeta = null; draw(); status.textContent = "이미지를 놓거나 선택하세요"; },
    hasImage() { return Boolean(image); },
    toReference(description = "") {
      if (!image || !fileMeta) return null;
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length > 750000) throw new Error("편집한 레퍼런스 이미지가 750KB를 초과합니다");
      return { mimeType: "image/png", width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, dataUrl, description: String(description).slice(0, 2000), ...fileMeta };
    },
    destroy() { canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerUp); zoomInput.removeEventListener("input", zoomChanged); },
  };
}
