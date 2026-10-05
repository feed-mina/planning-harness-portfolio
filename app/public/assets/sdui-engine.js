(() => {
  "use strict";

  const safeClass = (value) => String(value || "").replace(/[^a-zA-Z0-9 _:-]/g, "").trim();
  const safeId = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const text = (value) => String(value ?? "");
  const pageRegistry = window.sduiPages || {};

  window.sduiPages = pageRegistry;

  window.registerSduiPage = (pageKey, plugin) => {
    if (!pageKey || !plugin) return;
    pageRegistry[String(pageKey)] = plugin;
  };

  function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function makeContext(pageKey, root, plugin) {
    return {
      pageKey,
      root,
      tree: null,
      refs: {},
      state: typeof plugin?.state === "function" ? plugin.state() : {},
      actions: asRecord(plugin?.actions),
      hydrators: asRecord(plugin?.hydrators),
      widgets: asRecord(plugin?.widgets),
      plugin,
    };
  }

  function applyCommonProps(ctx, el, node) {
    const props = node.props || {};
    const className = safeClass(props.className);
    const domId = safeId(props.domId);
    if (className) el.className = className;
    if (domId) {
      el.id = domId;
      ctx.refs[domId] = el;
    }
    if (props.hidden === true) el.hidden = true;
    if (props.title) el.title = text(props.title);
    if (props.ariaLabel) el.setAttribute("aria-label", text(props.ariaLabel));
    if (props.roleName) el.setAttribute("role", text(props.roleName));
    for (const [key, value] of Object.entries(asRecord(props.dataset))) {
      const safeKey = String(key || "").replace(/[^a-zA-Z0-9_:-]/g, "");
      if (safeKey) el.dataset[safeKey] = text(value);
    }
    el.dataset.sduiNode = node.id || "";
    return props;
  }

  function textTag(as) {
    const tag = String(as || "span").toLowerCase();
    return [
      "h1", "h2", "h3", "p", "div", "span", "small", "strong", "em",
      "pre", "code", "li", "th", "td",
    ].includes(tag) ? tag : "span";
  }

  function groupTag(as) {
    const tag = String(as || "div").toLowerCase();
    return [
      "div", "section", "article", "header", "footer", "nav", "ul", "ol",
      "li", "label", "table", "thead", "tbody", "tr",
    ].includes(tag) ? tag : "div";
  }

  function applyFormProps(el, props) {
    if (props.name) el.name = text(props.name);
    if (props.value !== undefined) el.value = text(props.value);
    if (props.placeholder) el.placeholder = text(props.placeholder);
    if (props.maxLength !== undefined) el.maxLength = Number(props.maxLength) || -1;
    if (props.min !== undefined) el.min = text(props.min);
    if (props.max !== undefined) el.max = text(props.max);
    if (props.step !== undefined) el.step = text(props.step);
    if (props.autocomplete) el.autocomplete = text(props.autocomplete);
    if (props.required === true) el.required = true;
    if (props.disabled === true) el.disabled = true;
  }

  function devSetupSelectedIds(ctx) {
    return Array.from(ctx.state.selected || []);
  }

  function devSetupSetStatus(ctx, message, danger = false) {
    const status = ctx.refs.setupStatus || document.getElementById("setupStatus");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("danger", danger);
  }

  function devSetupUpdateDownloadGate(ctx) {
    const button = ctx.refs.downloadScript || document.getElementById("downloadScript");
    if (button) button.disabled = !ctx.state.approved || (ctx.state.included || new Set()).size === 0;
  }

  function devSetupSyncToolCheckboxes(ctx) {
    document.querySelectorAll("[data-tool-checkbox]").forEach((label) => {
      const input = label.querySelector("input");
      if (!input) return;
      const id = label.dataset.toolId;
      input.checked = input.disabled ? ctx.state.included?.has(id) : ctx.state.selected?.has(id);
    });
  }

  async function devSetupRefreshPreview(ctx) {
    const previewBox = ctx.refs.previewBox || document.getElementById("previewBox");
    const warningList = ctx.refs.warningList || document.getElementById("warningList");
    const selectionCount = ctx.refs.selectionCount || document.getElementById("selectionCount");
    try {
      if (previewBox) previewBox.textContent = "미리보기를 갱신하는 중입니다.";
      if (warningList) warningList.textContent = "";
      const response = await window.apiFetch("/api/dev-setup/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tools: devSetupSelectedIds(ctx) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "미리보기 생성 실패");

      ctx.state.included = new Set((data.tools || []).map((tool) => tool.id));
      if (previewBox) {
        previewBox.textContent = (data.commands || []).map((command) => `> ${command}`).join("\n") || "설치할 도구가 없습니다.";
      }
      if (selectionCount) selectionCount.textContent = `${ctx.state.included.size}개 포함`;
      if (warningList) {
        warningList.textContent = "";
        for (const warning of data.warnings || []) {
          const li = document.createElement("li");
          li.textContent = warning;
          warningList.appendChild(li);
        }
      }
      devSetupSyncToolCheckboxes(ctx);
      devSetupUpdateDownloadGate(ctx);
      devSetupSetStatus(ctx, "");
    } catch (err) {
      if (previewBox) previewBox.textContent = "미리보기 생성에 실패했습니다.";
      devSetupSetStatus(ctx, err instanceof Error ? err.message : "미리보기 생성 실패", true);
    }
  }

  const builtInPages = {
    "dev-setup": {
      state: () => ({ selected: new Set(), included: new Set(), approved: false }),
      actions: {
        SELECT_ALL_TOOLS(ctx) {
          ctx.state.selected = new Set(
            Array.from(document.querySelectorAll("[data-tool-checkbox] input:not(:disabled)")).map((input) => input.value)
          );
          ctx.state.approved = false;
          const approval = ctx.refs.approvePreview || document.getElementById("approvePreview");
          if (approval) approval.checked = false;
          devSetupSyncToolCheckboxes(ctx);
          void devSetupRefreshPreview(ctx);
        },
        async DOWNLOAD_SETUP_SCRIPT(ctx, node, event) {
          const button = event?.currentTarget || ctx.refs.downloadScript || document.getElementById("downloadScript");
          if (!ctx.state.approved) {
            devSetupSetStatus(ctx, "먼저 미리보기 확인 체크를 켜주세요.", true);
            return;
          }
          try {
            devSetupSetStatus(ctx, "스크립트를 생성하는 중입니다.");
            if (button) button.disabled = true;
            const response = await window.apiFetch("/api/dev-setup/script", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tools: devSetupSelectedIds(ctx) }),
            });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(data.error || "스크립트 생성 실패");
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "dev-setup.ps1";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            devSetupSetStatus(ctx, "dev-setup.ps1 다운로드를 시작했습니다.");
          } catch (err) {
            devSetupSetStatus(ctx, err instanceof Error ? err.message : "다운로드 실패", true);
          } finally {
            devSetupUpdateDownloadGate(ctx);
          }
        },
      },
      hydrators: {
        async dev_setup_catalog(ctx) {
          try {
            const response = await window.apiFetch("/api/dev-setup/catalog");
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "catalog failed");
            const byId = new Map((data.tools || []).map((tool) => [tool.id, tool]));
            document.querySelectorAll("[data-tool-checkbox]").forEach((label) => {
              const tool = byId.get(label.dataset.toolId);
              if (!tool) return;
              const strong = label.querySelector("strong");
              const small = label.querySelector("small");
              const badge = label.querySelector("em");
              if (strong) strong.textContent = tool.name;
              if (small) small.textContent = `${tool.description} · ${tool.method}: ${tool.packageId}`;
              if (badge) badge.textContent = tool.category === "runtime" ? "자동 포함" : tool.verified === "fallback" ? "npm fallback" : "확정";
            });
          } catch {
            console.warn("SDUI catalog binding failed");
          }
        },
      },
      init: (ctx) => devSetupRefreshPreview(ctx),
    },
  };

  const componentMap = {
    TEXT(ctx, node) {
      const props = node.props || {};
      const el = document.createElement(textTag(props.as));
      applyCommonProps(ctx, el, node);
      el.textContent = text(props.text);
      return el;
    },
    GROUP(ctx, node, renderChildren) {
      const props = node.props || {};
      const el = document.createElement(groupTag(props.as));
      applyCommonProps(ctx, el, node);
      if (node.groupDirection) el.dataset.direction = node.groupDirection.toLowerCase();
      renderChildren(el, node);
      return el;
    },
    CHECKBOX(ctx, node) {
      const props = node.props || {};
      const label = document.createElement("label");
      applyCommonProps(ctx, label, node);

      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = text(props.value || node.id);
      input.checked = !!props.checked;
      input.disabled = !!props.disabled;
      if (props.name) input.name = text(props.name);

      if (props.role === "approval") {
        label.append(input, document.createElement("span"));
        label.lastChild.textContent = text(props.label);
        input.addEventListener("change", () => {
          ctx.state.approved = input.checked;
          devSetupUpdateDownloadGate(ctx);
        });
        return label;
      }

      if (props.variant === "plain") {
        const labelText = document.createElement("span");
        labelText.textContent = text(props.label);
        label.append(input, labelText);
        return label;
      }

      const copy = document.createElement("span");
      copy.className = "tool-copy";
      const strong = document.createElement("strong");
      strong.textContent = text(props.label);
      copy.appendChild(strong);
      if (props.description) {
        const small = document.createElement("small");
        small.textContent = text(props.description);
        copy.appendChild(small);
      }
      if (props.badge) {
        const badge = document.createElement("em");
        badge.textContent = text(props.badge);
        copy.appendChild(badge);
      }

      label.dataset.toolCheckbox = "true";
      label.dataset.toolId = input.value;
      if (input.checked) {
        if (!ctx.state.selected) ctx.state.selected = new Set();
        ctx.state.selected.add(input.value);
      }
      input.addEventListener("change", () => {
        if (!ctx.state.selected) ctx.state.selected = new Set();
        if (input.checked) ctx.state.selected.add(input.value);
        else ctx.state.selected.delete(input.value);
        ctx.state.approved = false;
        const approval = ctx.refs.approvePreview || document.getElementById("approvePreview");
        if (approval) approval.checked = false;
        void devSetupRefreshPreview(ctx);
      });
      label.append(input, copy);
      return label;
    },
    BUTTON(ctx, node) {
      const props = node.props || {};
      const button = document.createElement("button");
      applyCommonProps(ctx, button, node);
      button.type = "button";
      button.textContent = text(props.text || "확인");
      button.disabled = !!props.disabled;
      const handler = ctx.actions[node.action || ""];
      if (handler) {
        button.addEventListener("click", (event) => void handler(ctx, node, event));
      }
      return button;
    },
    INPUT(ctx, node) {
      const props = node.props || {};
      const input = document.createElement("input");
      applyCommonProps(ctx, input, node);
      input.type = text(props.inputType || "text");
      applyFormProps(input, props);
      return input;
    },
    FILE_INPUT(ctx, node) {
      const props = node.props || {};
      const input = document.createElement("input");
      applyCommonProps(ctx, input, node);
      input.type = "file";
      input.multiple = props.multiple !== false;
      if (props.accept) input.accept = text(props.accept);
      applyFormProps(input, props);
      return input;
    },
    TEXTAREA(ctx, node) {
      const props = node.props || {};
      const textarea = document.createElement("textarea");
      applyCommonProps(ctx, textarea, node);
      textarea.rows = Number(props.rows) || 4;
      applyFormProps(textarea, props);
      textarea.textContent = text(props.text);
      return textarea;
    },
    SELECT(ctx, node) {
      const props = node.props || {};
      const select = document.createElement("select");
      applyCommonProps(ctx, select, node);
      applyFormProps(select, props);
      const options = Array.isArray(props.options) ? props.options : [];
      for (const option of options) {
        const rec = option && typeof option === "object" ? option : { value: option, label: option };
        const opt = document.createElement("option");
        opt.value = text(rec.value);
        opt.textContent = text(rec.label ?? rec.value);
        if (props.value === rec.value) opt.selected = true;
        select.appendChild(opt);
      }
      return select;
    },
    WIDGET(ctx, node) {
      const props = node.props || {};
      const el = document.createElement(groupTag(props.as || "div"));
      applyCommonProps(ctx, el, node);
      const widget = ctx.widgets[node.refDataId || props.widget || node.id];
      if (widget) void widget(ctx, node, el);
      return el;
    },
  };

  window.componentMap = componentMap;
  window.renderNode = (node) => {
    const root = document.getElementById("root");
    const ctx = makeContext(document.body.dataset.page || "", root, builtInPages[document.body.dataset.page || ""] || pageRegistry[document.body.dataset.page || ""]);
    return renderNode(ctx, node);
  };

  function renderNode(ctx, node) {
    const renderer = componentMap[node.type];
    if (!renderer) {
      console.warn("Unknown SDUI component", node.type, node.id);
      return document.createComment(`unknown:${node.id}`);
    }
    return renderer(ctx, node, (parent, current) => {
      for (const child of current.children || []) parent.appendChild(renderNode(ctx, child));
    });
  }

  function walk(node, visitor) {
    visitor(node);
    for (const child of node.children || []) walk(child, visitor);
  }

  async function runHydrators(ctx) {
    const tasks = [];
    walk(ctx.tree, (node) => {
      if (!node.refDataId) return;
      const hydrator = ctx.hydrators[node.refDataId];
      if (hydrator) tasks.push(Promise.resolve(hydrator(ctx, node)));
    });
    await Promise.all(tasks);
  }

  function mergePlugin(pageKey) {
    const builtIn = builtInPages[pageKey] || {};
    const external = pageRegistry[pageKey] || {};
    return {
      ...builtIn,
      ...external,
      actions: { ...asRecord(builtIn.actions), ...asRecord(external.actions) },
      hydrators: { ...asRecord(builtIn.hydrators), ...asRecord(external.hydrators) },
      widgets: { ...asRecord(builtIn.widgets), ...asRecord(external.widgets) },
      state: external.state || builtIn.state,
    };
  }

  async function boot() {
    const root = document.getElementById("root");
    const pageKey = document.body.dataset.page || "";
    if (!root || !pageKey) return;
    const plugin = mergePlugin(pageKey);
    const ctx = makeContext(pageKey, root, plugin);
    window.sduiContext = ctx;
    try {
      root.textContent = "화면을 불러오는 중입니다.";
      const response = await window.apiFetch(`/api/ui/${encodeURIComponent(pageKey)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "UI metadata load failed");
      ctx.tree = data.tree;
      root.textContent = "";
      root.appendChild(renderNode(ctx, data.tree));
      if (typeof window.refreshUsage === "function") void window.refreshUsage();
      await runHydrators(ctx);
      if (typeof plugin.init === "function") await plugin.init(ctx);
    } catch (err) {
      root.innerHTML = "";
      const message = document.createElement("p");
      message.className = "hint danger";
      message.textContent = err instanceof Error ? err.message : "화면을 불러오지 못했습니다.";
      root.appendChild(message);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot());
  else void boot();
})();
