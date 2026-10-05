(() => {
  "use strict";

  const toolList = document.getElementById("toolList");
  const previewBox = document.getElementById("previewBox");
  const warningList = document.getElementById("warningList");
  const approvePreview = document.getElementById("approvePreview");
  const downloadScript = document.getElementById("downloadScript");
  const setupStatus = document.getElementById("setupStatus");
  const selectionCount = document.getElementById("selectionCount");
  const selectAllTools = document.getElementById("selectAllTools");

  const state = {
    tools: [],
    selected: new Set(),
    included: new Set(),
  };

  const primaryTools = () => state.tools.filter((tool) => tool.category !== "runtime");
  const runtimeTools = () => state.tools.filter((tool) => tool.category === "runtime");

  const setStatus = (message, danger = false) => {
    setupStatus.textContent = message;
    setupStatus.classList.toggle("danger", danger);
  };

  const selectedIds = () => Array.from(state.selected);

  const updateDownloadGate = () => {
    downloadScript.disabled = !approvePreview.checked || state.included.size === 0;
  };

  const renderTools = () => {
    toolList.textContent = "";
    const fragment = document.createDocumentFragment();
    for (const tool of primaryTools()) {
      fragment.appendChild(renderToolRow(tool, false));
    }
    for (const tool of runtimeTools()) {
      fragment.appendChild(renderToolRow(tool, true));
    }
    toolList.appendChild(fragment);
  };

  const renderToolRow = (tool, runtime) => {
    const label = document.createElement("label");
    label.className = `tool-item${runtime ? " tool-item-runtime" : ""}`;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tool.id;
    input.checked = runtime ? state.included.has(tool.id) : state.selected.has(tool.id);
    input.disabled = runtime;
    input.addEventListener("change", () => {
      if (input.checked) state.selected.add(tool.id);
      else state.selected.delete(tool.id);
      approvePreview.checked = false;
      void refreshPreview();
    });

    const copy = document.createElement("span");
    copy.className = "tool-copy";

    const title = document.createElement("strong");
    title.textContent = tool.name;
    const desc = document.createElement("small");
    desc.textContent = `${tool.description} · ${tool.method}: ${tool.packageId}`;
    const badge = document.createElement("em");
    badge.textContent = runtime ? "자동 포함" : tool.verified === "fallback" ? "npm fallback" : "확정";

    copy.append(title, desc, badge);
    label.append(input, copy);
    return label;
  };

  const refreshPreview = async () => {
    try {
      previewBox.textContent = "미리보기를 갱신하는 중입니다.";
      warningList.textContent = "";
      downloadScript.disabled = true;
      const response = await window.apiFetch("/api/dev-setup/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tools: selectedIds() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "미리보기 생성 실패");

      state.included = new Set((data.tools || []).map((tool) => tool.id));
      previewBox.textContent = (data.commands || []).map((command) => `> ${command}`).join("\n") || "설치할 도구가 없습니다.";
      selectionCount.textContent = `${state.included.size}개 포함`;
      warningList.textContent = "";
      for (const warning of data.warnings || []) {
        const li = document.createElement("li");
        li.textContent = warning;
        warningList.appendChild(li);
      }
      renderTools();
      updateDownloadGate();
      setStatus("");
    } catch (err) {
      previewBox.textContent = "미리보기 생성에 실패했습니다.";
      setStatus(err instanceof Error ? err.message : "미리보기 생성 실패", true);
    }
  };

  const downloadSetupScript = async () => {
    if (!approvePreview.checked) {
      setStatus("먼저 미리보기 확인 체크를 켜주세요.", true);
      return;
    }
    try {
      setStatus("스크립트를 생성하는 중입니다.");
      downloadScript.disabled = true;
      const response = await window.apiFetch("/api/dev-setup/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tools: selectedIds() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "스크립트 생성 실패");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dev-setup.ps1";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("dev-setup.ps1 다운로드를 시작했습니다.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "다운로드 실패", true);
    } finally {
      updateDownloadGate();
    }
  };

  const loadCatalog = async () => {
    try {
      const response = await window.apiFetch("/api/dev-setup/catalog");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "도구 목록 불러오기 실패");
      state.tools = data.tools || [];
      state.selected = new Set(state.tools.filter((tool) => tool.defaultSelected).map((tool) => tool.id));
      renderTools();
      await refreshPreview();
    } catch (err) {
      toolList.innerHTML = "";
      const p = document.createElement("p");
      p.className = "hint danger";
      p.textContent = err instanceof Error ? err.message : "도구 목록 불러오기 실패";
      toolList.appendChild(p);
    }
  };

  approvePreview.addEventListener("change", updateDownloadGate);
  downloadScript.addEventListener("click", () => void downloadSetupScript());
  selectAllTools.addEventListener("click", () => {
    state.selected = new Set(primaryTools().map((tool) => tool.id));
    approvePreview.checked = false;
    void refreshPreview();
  });

  void loadCatalog();
})();
