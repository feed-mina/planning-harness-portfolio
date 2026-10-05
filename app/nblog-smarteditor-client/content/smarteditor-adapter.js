(function initNBlogSmartEditorAdapter(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NBlogSmartEditorAdapter = api;
})(typeof globalThis === "object" ? globalThis : self, function createNBlogSmartEditorAdapter() {
  "use strict";

  const TITLE_SELECTORS = Object.freeze([
    '.se-section-documentTitle .se-text-paragraph[contenteditable="true"]',
    '.se-documentTitle .se-text-paragraph[contenteditable="true"]',
    '.se-title-text[contenteditable="true"]',
    '[data-placeholder="제목"][contenteditable="true"]',
    '[aria-label="제목"][contenteditable="true"]',
    'textarea[placeholder="제목"]',
    'input[placeholder="제목"]',
  ]);
  const BODY_SELECTORS = Object.freeze([
    '.se-main-container .se-text-paragraph[contenteditable="true"]',
    '.se-content .se-text-paragraph[contenteditable="true"]',
    '.se-text-paragraph[contenteditable="true"]',
    '[aria-label="본문"][contenteditable="true"]',
    '[data-placeholder*="본문"][contenteditable="true"]',
  ]);
  const TAG_SELECTORS = Object.freeze([
    'input[placeholder*="태그"]',
    'textarea[placeholder*="태그"]',
    '[aria-label*="태그"][contenteditable="true"]',
    '[data-placeholder*="태그"][contenteditable="true"]',
  ]);

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function normalizeTagText(value) {
    return [...new Set(
      String(value || "")
        .split(/[\s,#]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean),
    )].join(" ");
  }

  function isElementVisible(element) {
    if (!element || element.hidden || element.disabled) return false;
    if (typeof element.getAttribute === "function" && element.getAttribute("aria-hidden") === "true") return false;
    const view = element.ownerDocument?.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const style = view.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }

  function uniqueCandidates(documentLike, selectors) {
    const seen = new Set();
    const matches = [];
    for (const selector of selectors) {
      let candidates = [];
      try {
        candidates = documentLike.querySelectorAll(selector) || [];
      } catch {
        candidates = [];
      }
      for (const candidate of candidates) {
        if (!seen.has(candidate) && isElementVisible(candidate)) {
          seen.add(candidate);
          matches.push(candidate);
        }
      }
    }
    return matches;
  }

  function belongsToDocumentTitle(element) {
    if (!element || typeof element.closest !== "function") return false;
    return !!element.closest(".se-section-documentTitle, .se-documentTitle");
  }

  function isPlaceholderOnly(element, value) {
    const actual = normalizeText(value);
    if (!actual) return false;
    const declared = ["placeholder", "data-placeholder"]
      .map((name) => typeof element.getAttribute === "function" ? element.getAttribute(name) : null)
      .filter((item) => typeof item === "string")
      .map(normalizeText);
    if (declared.includes(actual)) return true;
    let placeholderNodes = [];
    try {
      placeholderNodes = element.querySelectorAll?.(".se-placeholder, .__se_placeholder") || [];
    } catch {
      placeholderNodes = [];
    }
    const placeholderText = normalizeText(
      [...placeholderNodes].map((node) => node.innerText || node.textContent || "").join(" "),
    );
    return !!placeholderText && placeholderText === actual;
  }

  function readElementText(element) {
    if (!element) return "";
    let value = "";
    if (typeof element.value === "string") value = element.value;
    else if (typeof element.innerText === "string") value = element.innerText;
    else value = element.textContent || "";
    return isPlaceholderOnly(element, value) ? "" : value;
  }

  function dispatchEditableEvent(element, type, text) {
    if (typeof element.dispatchEvent !== "function") return true;
    const view = element.ownerDocument?.defaultView || globalThis;
    let event;
    try {
      if ((type === "beforeinput" || type === "input") && typeof view.InputEvent === "function") {
        event = new view.InputEvent(type, {
          bubbles: true,
          cancelable: type === "beforeinput",
          composed: true,
          inputType: "insertText",
          data: text,
        });
      } else if (typeof view.Event === "function") {
        event = new view.Event(type, { bubbles: true, cancelable: type === "beforeinput" });
      } else {
        event = { type };
      }
      return element.dispatchEvent(event) !== false;
    } catch {
      return true;
    }
  }

  function setNativeValue(element, text) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, text);
    else element.value = text;
  }

  function setContentEditableValue(element, text) {
    const documentLike = element.ownerDocument;
    if (typeof element.focus === "function") element.focus();
    if (!dispatchEditableEvent(element, "beforeinput", text)) return false;

    let inserted = false;
    try {
      const selection = typeof documentLike?.getSelection === "function" ? documentLike.getSelection() : null;
      if (selection && typeof documentLike.createRange === "function") {
        const range = documentLike.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof documentLike?.execCommand === "function") {
        inserted = documentLike.execCommand("insertText", false, text) === true;
      }
    } catch {
      inserted = false;
    }
    if (!inserted) element.textContent = text;
    dispatchEditableEvent(element, "input", text);
    dispatchEditableEvent(element, "change", text);
    return true;
  }

  function writeElementText(element, text) {
    const nativeInput = typeof element.value === "string" && !element.isContentEditable;
    if (typeof element.focus === "function") element.focus();
    if (nativeInput) {
      if (!dispatchEditableEvent(element, "beforeinput", text)) return false;
      setNativeValue(element, text);
      dispatchEditableEvent(element, "input", text);
      dispatchEditableEvent(element, "change", text);
      return true;
    }
    return setContentEditableValue(element, text);
  }

  function validateDraft(draft) {
    if (!isRecord(draft) || draft.version !== 1) return null;
    const title = String(draft.title || "").trim();
    const body = String(draft.body || "").replace(/\r\n?/g, "\n");
    const tags = Array.isArray(draft.tags)
      ? draft.tags.map((tag) => String(tag).trim().replace(/^#+/, "")).filter(Boolean).slice(0, 40)
      : [];
    if (!title || title.length > 300 || !body.trim() || body.length > 200_000) return null;
    if (tags.some((tag) => tag.length > 40 || !/^[\p{L}\p{N}_-]+$/u.test(tag))) return null;
    return { title, body, tags };
  }

  function inspectEditor(documentLike, draft) {
    if (!documentLike || typeof documentLike.querySelectorAll !== "function") {
      return { ok: false, code: "not_editor_frame" };
    }
    const titleCandidates = uniqueCandidates(documentLike, TITLE_SELECTORS);
    const bodyCandidates = uniqueCandidates(documentLike, BODY_SELECTORS)
      .filter((element) => !belongsToDocumentTitle(element));
    const tagCandidates = draft.tags.length ? uniqueCandidates(documentLike, TAG_SELECTORS) : [];

    if (!titleCandidates.length && !bodyCandidates.length) {
      return { ok: false, code: "not_editor_frame" };
    }
    if (titleCandidates.length !== 1 || bodyCandidates.length !== 1 || tagCandidates.length > 1) {
      return {
        ok: false,
        code: "selector_mismatch",
        diagnostics: {
          title_candidates: titleCandidates.length,
          body_candidates: bodyCandidates.length,
          tag_candidates: tagCandidates.length,
        },
      };
    }
    return {
      ok: true,
      title: titleCandidates[0],
      body: bodyCandidates[0],
      tags: tagCandidates[0] || null,
    };
  }

  // "empty": 아직 안 씀(써야 함). "match": draft와 이미 같음(건너뜀 — 이전 시도의 성공한 필드).
  // "conflict": draft와 다른 내용이 이미 있음(사용자 원본일 수 있어 절대 덮어쓰지 않음).
  function fieldState(current, expected) {
    if (!current) return "empty";
    return current === expected ? "match" : "conflict";
  }

  function applyDraft(documentLike, unsafeDraft) {
    const draft = validateDraft(unsafeDraft);
    if (!draft) return { ok: false, code: "invalid_draft" };
    const editor = inspectEditor(documentLike, draft);
    if (!editor.ok) return editor;

    const expectedTitle = normalizeText(draft.title);
    const expectedBody = normalizeText(draft.body);
    const expectedTags = normalizeTagText(draft.tags.join(" "));

    const titleState = fieldState(normalizeText(readElementText(editor.title)), expectedTitle);
    const bodyState = fieldState(normalizeText(readElementText(editor.body)), expectedBody);
    const tagsState = editor.tags
      ? fieldState(normalizeTagText(readElementText(editor.tags)), expectedTags)
      : null;

    // 필드 중 하나라도 draft와 다른 내용이 있으면, 아무 것도 쓰지 않고 전체를 안전하게 중단한다
    // (부분적으로 이미 성공한 필드까지 잃지 않도록 쓰기 전에 먼저 전부 검사한다).
    const conflictingFields = [
      titleState === "conflict" ? "title" : null,
      bodyState === "conflict" ? "body" : null,
      tagsState === "conflict" ? "tags" : null,
    ].filter(Boolean);
    if (conflictingFields.length) {
      return { ok: false, code: "editor_not_empty", diagnostics: { conflicting_fields: conflictingFields } };
    }

    const allMatch = titleState === "match" && bodyState === "match"
      && (tagsState === null || tagsState === "match");
    if (allMatch) {
      return {
        ok: true,
        code: "already_applied",
        fields: { title: "unchanged", body: "unchanged", tags: editor.tags ? "unchanged" : "manual" },
        manual_steps: ["login", "captcha", ...(editor.tags ? [] : ["tags"]), "media", "place", "preview", "publish"],
      };
    }

    // 이전 시도에서 이미 성공한(match) 필드는 다시 쓰지 않고, 비어 있는 필드만 이어서 채운다.
    if (titleState === "empty") {
      if (!writeElementText(editor.title, draft.title)
        || normalizeText(readElementText(editor.title)) !== expectedTitle) {
        return { ok: false, code: "title_input_failed" };
      }
    }
    if (bodyState === "empty") {
      if (!writeElementText(editor.body, draft.body)
        || normalizeText(readElementText(editor.body)) !== expectedBody) {
        return { ok: false, code: "body_input_failed", partial: true };
      }
    }
    let tagStatus = "manual";
    if (draft.tags.length && editor.tags) {
      if (tagsState === "empty") {
        const tagText = draft.tags.map((tag) => `#${tag}`).join(" ");
        if (!writeElementText(editor.tags, tagText)
          || normalizeTagText(readElementText(editor.tags)) !== expectedTags) {
          return { ok: false, code: "tag_input_failed", partial: true };
        }
      }
      tagStatus = "inserted";
    } else if (!draft.tags.length) {
      tagStatus = "not_requested";
    }

    return {
      ok: true,
      code: "applied",
      fields: {
        title: titleState === "match" ? "unchanged" : "inserted",
        body: bodyState === "match" ? "unchanged" : "inserted",
        tags: tagStatus,
      },
      manual_steps: ["login", "captcha", ...(tagStatus === "manual" ? ["tags"] : []), "media", "place", "preview", "publish"],
    };
  }

  return Object.freeze({
    TITLE_SELECTORS,
    BODY_SELECTORS,
    TAG_SELECTORS,
    normalizeText,
    normalizeTagText,
    inspectEditor,
    applyDraft,
  });
});
