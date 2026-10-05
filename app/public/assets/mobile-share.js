(() => {
  "use strict";

  const CACHE_DIRECTORY = "CACHE";
  const UTF8_ENCODING = "utf8";
  const SHARE_ROOT = "shared-markdown";
  const CANCELLED_PATTERN = /(?:share\s+cancel(?:ed|led)?|cancel(?:ed|led)?|action_canceled|abort)/i;
  const MISSING_FILE_CODES = new Set(["OS-PLUG-FILE-0008"]);
  const nativePlugins = new Map();
  let nativeOperationQueue = Promise.resolve();

  class MarkdownShareError extends Error {
    constructor(message, code, cause) {
      super(message);
      this.name = "MarkdownShareError";
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }

  function safeMarkdownFileName(value) {
    const raw = String(value || "meeting").normalize("NFKC").replace(/\.md$/i, "");
    let stem = raw
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
      .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[. -]+|[. -]+$/g, "");
    stem = Array.from(stem).slice(0, 80).join("");
    if (!stem) stem = "meeting";
    const deviceBaseName = stem.split(".", 1)[0];
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(deviceBaseName)) stem = `_${stem}`;
    return `${stem}.md`;
  }

  function isNativePlatform() {
    return globalThis.Capacitor?.isNativePlatform?.() === true;
  }

  function nativePlugin(name) {
    if (nativePlugins.has(name)) return nativePlugins.get(name);
    const capacitor = globalThis.Capacitor;
    const plugin = capacitor?.Plugins?.[name]
      || (typeof capacitor?.registerPlugin === "function" ? capacitor.registerPlugin(name) : null);
    if (!plugin) {
      throw new MarkdownShareError(`${name} native plugin is unavailable`, "native_plugin_unavailable");
    }
    nativePlugins.set(name, plugin);
    return plugin;
  }

  function webDownload(markdown, fileName) {
    const blob = new Blob(["\uFEFF", markdown], { type: "text/markdown;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body?.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }

  function randomShareId() {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto?.getRandomValues?.(bytes);
    const fallback = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return fallback || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isCancelled(error) {
    return error?.name === "AbortError"
      || CANCELLED_PATTERN.test(String(error?.code || ""))
      || CANCELLED_PATTERN.test(String(error?.message || error || ""));
  }

  function isMissingFile(error) {
    return MISSING_FILE_CODES.has(String(error?.code || ""))
      || /(?:does not exist|not found|no such file)/i.test(String(error?.message || ""));
  }

  function runSerialNative(operation) {
    const pending = nativeOperationQueue.then(operation, operation);
    nativeOperationQueue = pending.catch(() => {});
    return pending;
  }

  async function removeShareDirectory(filesystem, path) {
    try {
      await filesystem.rmdir({ path, directory: CACHE_DIRECTORY, recursive: true });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  async function cleanupShareRoot(filesystem) {
    try {
      await removeShareDirectory(filesystem, SHARE_ROOT);
    } catch (error) {
      throw new MarkdownShareError("이전에 남은 회의록 임시 파일을 정리하지 못했습니다.", "stale_cleanup_failed", error);
    }
  }

  function cleanupStaleShares() {
    if (!isNativePlatform()) {
      return Promise.resolve({ mode: "web", status: "skipped" });
    }
    return runSerialNative(async () => {
      await cleanupShareRoot(nativePlugin("Filesystem"));
      return { mode: "native", status: "completed" };
    });
  }

  async function shareNativeMarkdown({ markdown, safeFileName, title }) {
    const filesystem = nativePlugin("Filesystem");
    const share = nativePlugin("Share");
    await cleanupShareRoot(filesystem);
    const shareDirectory = `${SHARE_ROOT}/${randomShareId()}`;
    const path = `${shareDirectory}/${safeFileName}`;
    let result;
    let operationError;
    let cleanupError;

    try {
      const capability = typeof share.canShare === "function" ? await share.canShare() : { value: true };
      if (capability?.value === false) {
        throw new MarkdownShareError("이 기기에서는 OS 공유를 사용할 수 없습니다.", "share_unavailable");
      }
      const written = await filesystem.writeFile({
        path,
        data: markdown,
        directory: CACHE_DIRECTORY,
        encoding: UTF8_ENCODING,
        recursive: true,
      });
      if (!written?.uri || !String(written.uri).startsWith("file:")) {
        throw new MarkdownShareError("공유 파일 URI를 만들지 못했습니다.", "invalid_file_uri");
      }
      const shared = await share.share({
        title,
        text: `${safeFileName} 파일`,
        files: [written.uri],
        dialogTitle: "회의록 공유",
      });
      result = {
        mode: "native",
        status: "completed",
        fileName: safeFileName,
        activityType: shared?.activityType || "",
      };
    } catch (error) {
      if (isCancelled(error)) {
        result = { mode: "native", status: "cancelled", fileName: safeFileName, activityType: "" };
      } else {
        operationError = error;
      }
    } finally {
      try {
        await filesystem.deleteFile({ path, directory: CACHE_DIRECTORY });
      } catch (error) {
        if (!isMissingFile(error)) cleanupError = error;
      }
      try {
        await removeShareDirectory(filesystem, shareDirectory);
        cleanupError = null;
      } catch (error) {
        if (!cleanupError) cleanupError = error;
      }
    }

    if (cleanupError) {
      throw new MarkdownShareError("공유용 임시 파일을 정리하지 못했습니다.", "cleanup_failed", cleanupError);
    }
    if (operationError) {
      throw operationError instanceof MarkdownShareError
        ? operationError
        : new MarkdownShareError("Markdown 파일 공유에 실패했습니다.", "share_failed", operationError);
    }
    return result;
  }

  async function shareMarkdown({ markdown, fileName, title = "회의록 Markdown" } = {}) {
    if (typeof markdown !== "string" || !markdown.trim()) {
      throw new MarkdownShareError("공유할 Markdown 내용이 없습니다.", "empty_markdown");
    }
    const safeFileName = safeMarkdownFileName(fileName);
    if (!isNativePlatform()) {
      webDownload(markdown, safeFileName);
      return { mode: "download", status: "completed", fileName: safeFileName };
    }
    return runSerialNative(() => shareNativeMarkdown({ markdown, safeFileName, title }));
  }

  globalThis.HarnessMobileShare = Object.freeze({
    MarkdownShareError,
    cleanupStaleShares,
    isNativePlatform,
    safeMarkdownFileName,
    shareMarkdown,
  });
})();
