(function initNBlogDraftBookmarklet(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NBlogDraftBookmarkletV1 = api;
  if (typeof window === "object" && window.document && !root.__NBLOG_BOOKMARKLET_TEST__) {
    api.run(window);
  }
})(typeof globalThis === "object" ? globalThis : self, function createNBlogDraftBookmarklet() {
  "use strict";

  const PREFIX = "NBLOG_DRAFT_V1.";
  const MAX_CODE_LENGTH = 300_000;
  const DRAFT_KEYS = Object.freeze([
    "body",
    "category",
    "place_name",
    "tags",
    "target_blog",
    "title",
    "version",
  ]);
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

  function decode(segment) {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("invalid_code");
    const padding = "=".repeat((4 - (segment.length % 4)) % 4);
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") + padding;
    let bytes;
    if (typeof atob === "function") {
      const binary = atob(base64);
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } else if (typeof Buffer !== "undefined") {
      bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    } else {
      throw new Error("decoder_unavailable");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function parseDraftCode(rawCode) {
    if (typeof rawCode !== "string") throw new Error("invalid_code");
    const code = rawCode.trim();
    if (!code.startsWith(PREFIX) || code.length > MAX_CODE_LENGTH) throw new Error("invalid_code");
    let payload;
    try {
      payload = JSON.parse(decode(code.slice(PREFIX.length)));
    } catch {
      throw new Error("invalid_code");
    }
    if (!isRecord(payload)) throw new Error("invalid_draft");
    const actualKeys = Object.keys(payload).sort();
    const expectedKeys = [...DRAFT_KEYS].sort();
    if (actualKeys.length !== expectedKeys.length
      || !actualKeys.every((key, index) => key === expectedKeys[index])) {
      throw new Error("invalid_draft");
    }
    if (payload.version !== 1) throw new Error("invalid_draft");
    const title = String(payload.title || "").trim();
    const body = String(payload.body || "").replace(/\r\n?/g, "\n");
    if (!title || title.length > 300 || !body.trim() || body.length > 200_000) {
      throw new Error("invalid_draft");
    }
    const tagValues = Array.isArray(payload.tags)
      ? payload.tags
      : (typeof payload.tags === "string" ? (payload.tags.match(/#[^\s#]+/g) || payload.tags.split(/[\s,]+/)) : null);
    if (!tagValues || tagValues.length > 40) throw new Error("invalid_draft");
    const tags = [...new Set(tagValues.map((value) => String(value).trim().replace(/^#+/, "")).filter(Boolean))];
    if (tags.some((tag) => !tag || tag.length > 40 || !/^[\p{L}\p{N}_-]+$/u.test(tag))) {
      throw new Error("invalid_draft");
    }
    if (typeof payload.place_name !== "string" || payload.place_name.length > 300
      || typeof payload.target_blog !== "string" || payload.target_blog.length > 2_000
      || typeof payload.category !== "string" || payload.category.length > 120) {
      throw new Error("invalid_draft");
    }
    if (payload.target_blog) {
      let target;
      try {
        target = new URL(payload.target_blog);
      } catch {
        throw new Error("invalid_draft");
      }
      if (target.origin !== "https://blog.naver.com" || target.username || target.password) {
        throw new Error("invalid_draft");
      }
    }
    return Object.freeze({
      version: 1,
      title,
      body,
      tags: Object.freeze(tags),
      place_name: payload.place_name.trim(),
      target_blog: payload.target_blog,
      category: payload.category.trim(),
    });
  }

  function extractNaverBlogId(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    if (url.origin !== "https://blog.naver.com" || url.username || url.password) return null;
    const queryId = url.searchParams.get("blogId");
    const firstPathSegment = url.pathname.split("/").filter(Boolean)[0] || "";
    let pathId = "";
    try {
      pathId = firstPathSegment && !firstPathSegment.toLowerCase().endsWith(".naver")
        ? decodeURIComponent(firstPathSegment)
        : "";
    } catch {
      return null;
    }
    const candidates = [queryId, pathId].filter((value) => value !== null && value !== "");
    if (candidates.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(value))) return null;
    const normalized = [...new Set(candidates.map((value) => value.toLowerCase()))];
    return normalized.length === 1 ? normalized[0] : null;
  }

  function visible(element) {
    if (!element || element.hidden || element.disabled) return false;
    if (element.getAttribute?.("aria-hidden") === "true") return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function candidates(documentLike, selectors) {
    const seen = new Set();
    const output = [];
    for (const selector of selectors) {
      let found = [];
      try {
        found = documentLike.querySelectorAll(selector) || [];
      } catch {
        found = [];
      }
      for (const element of found) {
        if (!seen.has(element) && visible(element)) {
          seen.add(element);
          output.push(element);
        }
      }
    }
    return output;
  }

  function belongsToDocumentTitle(element) {
    return !!element?.closest?.(".se-section-documentTitle, .se-documentTitle");
  }

  function placeholderOnly(element, value) {
    const actual = normalized(value);
    if (!actual) return false;
    const declared = ["placeholder", "data-placeholder"]
      .map((name) => element.getAttribute?.(name))
      .filter((item) => typeof item === "string")
      .map(normalized);
    if (declared.includes(actual)) return true;
    let placeholderNodes = [];
    try {
      placeholderNodes = element.querySelectorAll?.(".se-placeholder, .__se_placeholder") || [];
    } catch {
      placeholderNodes = [];
    }
    const placeholderText = normalized(
      [...placeholderNodes].map((node) => node.innerText || node.textContent || "").join(" "),
    );
    return !!placeholderText && placeholderText === actual;
  }

  function read(element) {
    let value = "";
    if (typeof element.value === "string") value = element.value;
    else if (typeof element.innerText === "string") value = element.innerText;
    else value = element.textContent || "";
    return placeholderOnly(element, value) ? "" : value;
  }

  function normalized(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  }

  function tagText(value) {
    return [...new Set(String(value || "").split(/[\s,#]+/).map((tag) => tag.trim()).filter(Boolean))].join(" ");
  }

  function emit(element, type, text) {
    if (typeof element.dispatchEvent !== "function") return true;
    const view = element.ownerDocument?.defaultView || globalThis;
    try {
      const event = (type === "beforeinput" || type === "input") && typeof view.InputEvent === "function"
        ? new view.InputEvent(type, {
          bubbles: true,
          cancelable: type === "beforeinput",
          composed: true,
          inputType: "insertText",
          data: text,
        })
        : new view.Event(type, { bubbles: true, cancelable: type === "beforeinput" });
      return element.dispatchEvent(event) !== false;
    } catch {
      return true;
    }
  }

  function write(element, text) {
    element.focus?.();
    if (!emit(element, "beforeinput", text)) return false;
    if (typeof element.value === "string" && !element.isContentEditable) {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
      if (descriptor?.set) descriptor.set.call(element, text);
      else element.value = text;
    } else {
      let inserted = false;
      const documentLike = element.ownerDocument;
      try {
        const selection = documentLike.getSelection?.();
        if (selection && documentLike.createRange) {
          const range = documentLike.createRange();
          range.selectNodeContents(element);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        inserted = documentLike.execCommand?.("insertText", false, text) === true;
      } catch {
        inserted = false;
      }
      if (!inserted) element.textContent = text;
    }
    emit(element, "input", text);
    emit(element, "change", text);
    return true;
  }

  function applyDraft(documentLike, draft) {
    const titles = candidates(documentLike, TITLE_SELECTORS);
    const bodies = candidates(documentLike, BODY_SELECTORS)
      .filter((element) => !belongsToDocumentTitle(element));
    const tagFields = draft.tags.length ? candidates(documentLike, TAG_SELECTORS) : [];
    if (!titles.length && !bodies.length) return { ok: false, code: "editor_not_found" };
    if (titles.length !== 1 || bodies.length !== 1 || tagFields.length > 1) {
      return { ok: false, code: "selector_mismatch" };
    }
    const title = titles[0];
    const body = bodies[0];
    const tags = tagFields[0] || null;
    const expectedTags = tagText(draft.tags.join(" "));
    const exact = normalized(read(title)) === normalized(draft.title)
      && normalized(read(body)) === normalized(draft.body)
      && (!tags || tagText(read(tags)) === expectedTags);
    if (exact) return { ok: true, code: "already_applied", tags: tags ? "unchanged" : "manual" };
    if (normalized(read(title)) || normalized(read(body)) || (tags && tagText(read(tags)))) {
      return { ok: false, code: "editor_not_empty" };
    }
    if (!write(title, draft.title) || normalized(read(title)) !== normalized(draft.title)) {
      return { ok: false, code: "title_input_failed" };
    }
    if (!write(body, draft.body) || normalized(read(body)) !== normalized(draft.body)) {
      return { ok: false, code: "body_input_failed", partial: true };
    }
    let tagStatus = "manual";
    if (draft.tags.length && tags) {
      const value = draft.tags.map((tag) => `#${tag}`).join(" ");
      if (!write(tags, value) || tagText(read(tags)) !== expectedTags) {
        return { ok: false, code: "tag_input_failed", partial: true };
      }
      tagStatus = "inserted";
    } else if (!draft.tags.length) {
      tagStatus = "not_requested";
    }
    return { ok: true, code: "applied", tags: tagStatus };
  }

  function messageFor(result) {
    if (result.ok && result.code === "already_applied") return "이미 같은 초안이 입력되어 있습니다. 사진·장소를 확인하고 직접 발행하세요.";
    if (result.ok && result.tags === "manual") return "제목과 본문을 넣었습니다. 태그·사진·장소를 직접 추가하고 직접 발행하세요.";
    if (result.ok) return "제목·본문·태그를 넣었습니다. 사진·장소를 직접 추가하고 직접 발행하세요.";
    const messages = {
      target_blog_unverified: "현재 글쓰기 화면의 블로그 계정을 확인할 수 없어 중단했습니다. 대상 블로그에서 열린 글쓰기 화면으로 이동한 뒤 다시 실행하세요.",
      target_blog_mismatch: "현재 글쓰기 화면이 지정한 대상 블로그와 달라 중단했습니다. 올바른 블로그에서 다시 실행하세요.",
      editor_not_found: "SmartEditor 입력 칸을 찾지 못했습니다. 로그인 후 빈 글쓰기 화면에서 다시 실행하세요.",
      selector_mismatch: "네이버 편집기 구조가 달라 안전하게 중단했습니다.",
      editor_not_empty: "기존 내용을 보호하기 위해 빈 초안에서만 실행합니다.",
    };
    return messages[result.code] || "입력하지 못했습니다. 빈 글쓰기 화면인지 확인하세요.";
  }

  function run(windowLike) {
    if (windowLike.location?.protocol !== "https:" || windowLike.location?.hostname !== "blog.naver.com") {
      windowLike.alert?.("네이버 블로그 글쓰기 화면에서 실행하세요.");
      return { ok: false, code: "not_naver_blog" };
    }
    const rawCode = windowLike.prompt?.("NBlog 화면에서 복사한 NBLOG_DRAFT_V1 초안 코드를 붙여넣으세요.");
    if (!rawCode) return { ok: false, code: "cancelled" };
    let result;
    try {
      const draft = parseDraftCode(rawCode);
      const expectedBlogId = extractNaverBlogId(draft.target_blog);
      const observedBlogId = extractNaverBlogId(windowLike.location?.href || "");
      if (expectedBlogId && observedBlogId !== expectedBlogId) {
        result = {
          ok: false,
          code: observedBlogId ? "target_blog_mismatch" : "target_blog_unverified",
        };
      } else {
        result = applyDraft(windowLike.document, draft);
      }
    } catch {
      result = { ok: false, code: "invalid_code" };
    }
    windowLike.alert?.(messageFor(result));
    return result;
  }

  return Object.freeze({ PREFIX, parseDraftCode, extractNaverBlogId, applyDraft, run });
});
