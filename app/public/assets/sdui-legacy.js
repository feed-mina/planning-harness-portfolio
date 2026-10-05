(() => {
  "use strict";

  const bootRegistry = {};
  const legacyPages = [
    "dashboard",
    "feature",
    "analysis",
    "analysis-edit",
    "mypage",
    "stats",
    "ask-todo-hub",
  ];

  window.sduiPages = window.sduiPages || {};
  window.__sduiRegisterBoot = (pageKey, boot) => {
    if (!pageKey || typeof boot !== "function") return;
    bootRegistry[String(pageKey)] = boot;
  };

  const loadedScripts = new Map();

  function loadScriptOnce(src) {
    const url = String(src || "");
    if (!url) return Promise.resolve(false);
    const existing = Array.from(document.scripts).find((script) => script.src === new URL(url, location.href).href);
    if (existing) return Promise.resolve(true);
    if (loadedScripts.has(url)) return loadedScripts.get(url);

    const task = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.charset = "UTF-8";
      script.onload = () => resolve(true);
      script.onerror = () => {
        console.warn("SDUI legacy dependency failed", url);
        resolve(false);
      };
      document.head.appendChild(script);
    });
    loadedScripts.set(url, task);
    return task;
  }

  async function loadLegacyFragment(ctx, node) {
    const props = node.props || {};
    const targetId = props.domId || "legacyPage";
    const target = ctx.refs[targetId] || document.getElementById(targetId);
    const fragmentUrl = String(props.fragmentUrl || "");
    if (!target || !fragmentUrl) return;

    const response = await fetch(fragmentUrl, {
      cache: "no-store",
      headers: { accept: "text/html" },
    });
    if (!response.ok) throw new Error(`fragment load failed: ${response.status}`);
    target.innerHTML = await response.text();
    if (typeof window.refreshUsage === "function") void window.refreshUsage();
    for (const script of Array.isArray(props.scripts) ? props.scripts : []) {
      await loadScriptOnce(script);
    }
  }

  function bootLegacyPage(ctx) {
    const boot = bootRegistry[ctx.pageKey];
    if (boot) boot();
  }

  for (const pageKey of legacyPages) {
    window.sduiPages[pageKey] = {
      hydrators: { legacy_fragment: loadLegacyFragment },
      init: bootLegacyPage,
    };
  }
})();
