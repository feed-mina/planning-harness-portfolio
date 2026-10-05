(function initHarnessAiSduiRuntime(global) {
  "use strict";

  const SCHEMA = "planning-harness.ai-sdui.v1";
  const VALIDATION_PATH = "/api/ai-sdui/validate";
  const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const PAYLOAD_HASH_PATTERN = /^[0-9a-f]{64}$/;
  const QUEUE_STATUSES = new Set(["pending", "running", "completed", "failed", "blocked"]);
  const SAFE_ACTIONS = new Set([
    "OPEN_REQUIREMENTS",
    "OPEN_EVIDENCE",
    "OPEN_JOB",
    "OPEN_ARTIFACT",
    "ENQUEUE_ANALYSIS",
    "ENQUEUE_RETRY",
  ]);
  const RISKY_OPERATIONS = new Set(["MODIFY_CODE", "PUSH_CHANGES", "DEPLOY", "DELETE_RESOURCE"]);

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function requiredString(value, maxLength) {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
      throw new Error("Validated AI SDUI response contains an invalid string.");
    }
    return value;
  }

  function identifier(value) {
    const result = requiredString(value, 128);
    if (!IDENTIFIER_PATTERN.test(result)) {
      throw new Error("Validated AI SDUI response contains an invalid identifier.");
    }
    return result;
  }

  function queueStatus(value) {
    const result = requiredString(value, 32);
    if (!QUEUE_STATUSES.has(result)) {
      throw new Error("Validated AI SDUI response contains an invalid status.");
    }
    return result;
  }

  function safeAction(value) {
    if (!isRecord(value) || !SAFE_ACTIONS.has(value.type)) {
      throw new Error("Validated AI SDUI response contains an unsafe action.");
    }
    return {
      id: identifier(value.id),
      type: value.type,
      label: requiredString(value.label, 120),
      ref_id: identifier(value.ref_id),
    };
  }

  function approvalAction(value, props) {
    if (!isRecord(value) || value.type !== "APPROVE_JOB") {
      throw new Error("Validated AI SDUI response contains an invalid approval action.");
    }
    const action = {
      id: identifier(value.id),
      type: "APPROVE_JOB",
      label: requiredString(value.label, 120),
      job_id: identifier(value.job_id),
      operation: requiredString(value.operation, 64),
      payload_hash: requiredString(value.payload_hash, 64),
    };
    if (
      !RISKY_OPERATIONS.has(action.operation)
      || !PAYLOAD_HASH_PATTERN.test(action.payload_hash)
      || action.job_id !== props.job_id
      || action.operation !== props.operation
      || action.payload_hash !== props.payload_hash
    ) {
      throw new Error("Validated AI SDUI approval metadata does not match.");
    }
    return action;
  }

  function normalizedComponent(value) {
    if (!isRecord(value) || !isRecord(value.props)) {
      throw new Error("Validated AI SDUI response contains an invalid component.");
    }
    const component = { id: identifier(value.id), type: value.type, props: {}, actions: [] };
    switch (value.type) {
      case "textBlock":
        component.props = { text: requiredString(value.props.text, 4000) };
        if (value.actions !== undefined) throw new Error("Text blocks cannot contain actions.");
        return component;
      case "metricCard":
        component.props = {
          label: requiredString(value.props.label, 120),
          value: requiredString(value.props.value, 200),
          unit: value.props.unit === undefined ? "" : requiredString(value.props.unit, 40),
        };
        if (value.actions !== undefined) throw new Error("Metric cards cannot contain actions.");
        return component;
      case "statusBadge":
        component.props = {
          status: queueStatus(value.props.status),
          label: value.props.label === undefined ? "" : requiredString(value.props.label, 120),
        };
        if (value.actions !== undefined) throw new Error("Status badges cannot contain actions.");
        return component;
      case "actionGroup":
        component.props = {
          label: value.props.label === undefined ? "" : requiredString(value.props.label, 120),
        };
        if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > 8) {
          throw new Error("Action groups must contain safe actions.");
        }
        component.actions = value.actions.map(safeAction);
        return component;
      case "approvalCard": {
        const props = {
          title: requiredString(value.props.title, 200),
          summary: requiredString(value.props.summary, 2000),
          job_id: identifier(value.props.job_id),
          operation: requiredString(value.props.operation, 64),
          payload_hash: requiredString(value.props.payload_hash, 64),
          dry_run: value.props.dry_run,
          server_check_required: value.props.server_check_required,
          expires_at: requiredString(value.props.expires_at, 64),
        };
        if (
          !RISKY_OPERATIONS.has(props.operation)
          || !PAYLOAD_HASH_PATTERN.test(props.payload_hash)
          || props.dry_run !== true
          || props.server_check_required !== true
          || !Number.isFinite(Date.parse(props.expires_at))
          || !Array.isArray(value.actions)
          || value.actions.length !== 1
        ) {
          throw new Error("Validated AI SDUI response contains invalid approval metadata.");
        }
        component.props = props;
        component.actions = [approvalAction(value.actions[0], props)];
        return component;
      }
      default:
        throw new Error("Validated AI SDUI response contains an unknown component.");
    }
  }

  function normalizedResult(response, data) {
    if (
      !response
      || response.ok !== true
      || response.headers?.get("x-ai-sdui-validated") !== SCHEMA
      || !isRecord(data)
      || data.ok !== true
      || data.schema !== SCHEMA
      || !isRecord(data.validation)
      || data.validation.validated !== true
      || !isRecord(data.result)
      || data.result.schema !== SCHEMA
    ) {
      throw new Error("AI SDUI server validation was not confirmed.");
    }

    const result = data.result;
    identifier(result.result_id);
    if (!isRecord(result.source)) throw new Error("Validated AI SDUI response contains an invalid source.");
    requiredString(result.source.provider, 32);
    if (result.source.model !== undefined) requiredString(result.source.model, 120);
    if (!Number.isFinite(Date.parse(requiredString(result.generated_at, 64)))) {
      throw new Error("Validated AI SDUI response contains an invalid timestamp.");
    }
    if (!isRecord(result.card) || result.card.type !== "aiResultCard" || !isRecord(result.card.props)) {
      throw new Error("Validated AI SDUI response does not contain an AI result card.");
    }
    if (!Array.isArray(result.card.children) || result.card.children.length > 32) {
      throw new Error("Validated AI SDUI response contains invalid card children.");
    }
    if (!Array.isArray(result.card.actions) || result.card.actions.length > 8) {
      throw new Error("Validated AI SDUI response contains invalid card actions.");
    }

    return {
      schema: SCHEMA,
      result_id: identifier(result.result_id),
      card: {
        id: identifier(result.card.id),
        props: {
          title: requiredString(result.card.props.title, 200),
          summary: requiredString(result.card.props.summary, 4000),
          status: queueStatus(result.card.props.status),
        },
        children: result.card.children.map(normalizedComponent),
        actions: result.card.actions.map(safeAction),
      },
    };
  }

  function hostRegistry(input) {
    const value = isRecord(input) ? input : {};
    return Object.freeze({
      onOpenRequirements: typeof value.onOpenRequirements === "function" ? value.onOpenRequirements : null,
      onOpenEvidence: typeof value.onOpenEvidence === "function" ? value.onOpenEvidence : null,
      onOpenJob: typeof value.onOpenJob === "function" ? value.onOpenJob : null,
      onOpenArtifact: typeof value.onOpenArtifact === "function" ? value.onOpenArtifact : null,
      onEnqueueAnalysis: typeof value.onEnqueueAnalysis === "function" ? value.onEnqueueAnalysis : null,
      onEnqueueRetry: typeof value.onEnqueueRetry === "function" ? value.onEnqueueRetry : null,
    });
  }

  function callbackFor(actionType, registry) {
    switch (actionType) {
      case "OPEN_REQUIREMENTS": return registry.onOpenRequirements;
      case "OPEN_EVIDENCE": return registry.onOpenEvidence;
      case "OPEN_JOB": return registry.onOpenJob;
      case "OPEN_ARTIFACT": return registry.onOpenArtifact;
      case "ENQUEUE_ANALYSIS": return registry.onEnqueueAnalysis;
      case "ENQUEUE_RETRY": return registry.onEnqueueRetry;
      default: return null;
    }
  }

  function renderStatus(props) {
    const badge = document.createElement("span");
    badge.className = "ai-sdui-status";
    badge.setAttribute("data-status", props.status);
    badge.textContent = props.label || props.status;
    return badge;
  }

  function renderSafeAction(action, resultId, registry, status) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-sdui-action";
    button.textContent = action.label;
    const callback = callbackFor(action.type, registry);
    button.disabled = callback === null;
    button.addEventListener("click", async () => {
      if (callback === null) return;
      button.disabled = true;
      status.textContent = "요청을 전달하는 중입니다.";
      try {
        await callback(Object.freeze({ refId: action.ref_id, resultId }));
        status.textContent = "요청을 전달했습니다.";
      } catch {
        status.textContent = "요청을 전달하지 못했습니다.";
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  async function parseJson(response) {
    try {
      return await response.json();
    } catch {
      throw new Error("AI SDUI endpoint returned invalid JSON.");
    }
  }

  function renderApproval(component) {
    const section = document.createElement("section");
    section.className = "ai-sdui-approval";

    const title = document.createElement("h3");
    title.textContent = component.props.title;
    const summary = document.createElement("p");
    summary.textContent = component.props.summary;
    const operation = document.createElement("p");
    operation.textContent = `작업: ${component.props.operation}`;
    const payloadHash = document.createElement("code");
    payloadHash.textContent = component.props.payload_hash;
    const expires = document.createElement("p");
    expires.textContent = `승인 만료: ${component.props.expires_at}`;
    const warning = document.createElement("p");
    warning.textContent = "승인은 서버에 기록될 뿐 위험 작업을 직접 실행하지 않습니다.";
    const status = document.createElement("p");
    status.className = "ai-sdui-action-status";
    status.setAttribute("aria-live", "polite");

    const action = component.actions[0];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-sdui-approve";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "승인을 서버에서 확인하는 중입니다.";
      try {
        const response = await global.apiFetch(
          `/api/ai-sdui/approval-jobs/${encodeURIComponent(action.job_id)}/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ operation: action.operation, payload_hash: action.payload_hash }),
          },
        );
        const data = await parseJson(response);
        if (
          !response.ok
          || !isRecord(data)
          || data.ok !== true
          || !isRecord(data.approval)
          || data.approval.status !== "approved"
          || data.approval.job_id !== action.job_id
          || data.approval.operation !== action.operation
          || data.approval.payload_hash !== action.payload_hash
          || !isRecord(data.execution)
          || data.execution.started !== false
          || data.execution.endpoint_available !== false
        ) {
          throw new Error("Approval was not confirmed by the server.");
        }
        status.textContent = "승인이 기록되었습니다. 위험 작업은 실행되지 않았습니다.";
      } catch {
        status.textContent = "승인을 기록하지 못했습니다.";
        button.disabled = false;
      }
    });

    section.append(title, summary, operation, payloadHash, expires, warning, button, status);
    return section;
  }

  function renderComponent(component, resultId, registry) {
    switch (component.type) {
      case "textBlock": {
        const paragraph = document.createElement("p");
        paragraph.className = "ai-sdui-text";
        paragraph.textContent = component.props.text;
        return paragraph;
      }
      case "metricCard": {
        const section = document.createElement("section");
        section.className = "ai-sdui-metric";
        const label = document.createElement("h3");
        label.textContent = component.props.label;
        const value = document.createElement("p");
        value.textContent = component.props.unit
          ? `${component.props.value} ${component.props.unit}`
          : component.props.value;
        section.append(label, value);
        return section;
      }
      case "statusBadge":
        return renderStatus(component.props);
      case "actionGroup": {
        const section = document.createElement("section");
        section.className = "ai-sdui-actions";
        if (component.props.label) {
          const label = document.createElement("h3");
          label.textContent = component.props.label;
          section.appendChild(label);
        }
        const status = document.createElement("p");
        status.className = "ai-sdui-action-status";
        status.setAttribute("aria-live", "polite");
        for (const action of component.actions) {
          section.appendChild(renderSafeAction(action, resultId, registry, status));
        }
        section.appendChild(status);
        return section;
      }
      case "approvalCard":
        return renderApproval(component);
      default:
        throw new Error("Unsupported validated AI SDUI component.");
    }
  }

  function renderResult(root, result, registry) {
    const article = document.createElement("article");
    article.className = "ai-sdui-result";
    const title = document.createElement("h2");
    title.textContent = result.card.props.title;
    const summary = document.createElement("p");
    summary.textContent = result.card.props.summary;
    article.append(title, renderStatus({ status: result.card.props.status, label: "" }), summary);

    for (const component of result.card.children) {
      article.appendChild(renderComponent(component, result.result_id, registry));
    }
    if (result.card.actions.length > 0) {
      const actions = document.createElement("section");
      actions.className = "ai-sdui-actions";
      const status = document.createElement("p");
      status.className = "ai-sdui-action-status";
      status.setAttribute("aria-live", "polite");
      for (const action of result.card.actions) {
        actions.appendChild(renderSafeAction(action, result.result_id, registry, status));
      }
      actions.appendChild(status);
      article.appendChild(actions);
    }

    root.textContent = "";
    root.appendChild(article);
    return article;
  }

  function renderFailure(root) {
    root.textContent = "";
    const message = document.createElement("p");
    message.className = "ai-sdui-error";
    message.setAttribute("role", "alert");
    message.textContent = "검증된 AI 결과를 표시하지 못했습니다.";
    root.appendChild(message);
  }

  async function validateAndRender(root, rawPayload, hostCallbacks) {
    if (!root || typeof root.appendChild !== "function") {
      throw new TypeError("AI SDUI render root is required.");
    }
    if (typeof global.apiFetch !== "function") {
      renderFailure(root);
      throw new Error("Harness API client is unavailable.");
    }

    root.textContent = "AI 결과를 검증하는 중입니다.";
    try {
      const response = await global.apiFetch(VALIDATION_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rawPayload),
      });
      const data = await parseJson(response);
      const result = normalizedResult(response, data);
      return renderResult(root, result, hostRegistry(hostCallbacks));
    } catch (error) {
      renderFailure(root);
      throw error;
    }
  }

  global.HarnessAiSduiRuntime = Object.freeze({
    schema: SCHEMA,
    validateAndRender,
  });
}(window));
