export function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

export function createSketchPad({ canvas, colorInput, sizeInput, historyLimit = 12, backgroundColor = "#ffffff" }) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) throw new Error("A 2D canvas is required");
  let drawing = false;
  let erasing = false;
  let dirty = false;
  let history = [];

  const paintBackground = () => {
    context.globalCompositeOperation = "source-over";
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
  };
  paintBackground();

  const onPointerDown = (event) => {
    history = [...history, canvas.toDataURL("image/png")].slice(-historyLimit);
    drawing = true;
    dirty = true;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };
  const onPointerMove = (event) => {
    if (!drawing) return;
    const point = canvasPoint(canvas, event);
    context.strokeStyle = erasing ? backgroundColor : colorInput.value;
    context.lineWidth = Number(sizeInput.value);
    context.lineTo(point.x, point.y);
    context.stroke();
  };
  const stop = (event) => {
    if (!drawing) return;
    drawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  const restore = (dataUrl) => new Promise((resolve) => {
    if (!dataUrl) return resolve(false);
    const image = new Image();
    image.onload = () => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(true); };
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });

  return {
    setEraser(value) { erasing = Boolean(value); return erasing; },
    async undo() { const restored = await restore(history.pop()); dirty = restored && history.length > 0; return restored; },
    clear() { history = [...history, canvas.toDataURL("image/png")].slice(-historyLimit); paintBackground(); dirty = false; },
    isDirty() { return dirty; },
    toPngDataUrl() { return canvas.toDataURL("image/png"); },
    destroy() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
    },
  };
}
