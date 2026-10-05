const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const analyticsSource = readFileSync(join(__dirname, "..", "public", "assets", "analytics.js"), "utf8");
const publicPageConfig = JSON.parse(readFileSync(join(__dirname, "..", "public", "assets", "public-pages.json"), "utf8"));

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.id = "";
    this.className = "";
    this.async = false;
    this._src = "";
    this._innerHTML = "";
  }

  set src(value) {
    this._src = String(value);
    this.attributes.set("src", this._src);
  }

  get src() { return this._src; }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    for (const className of ["analytics-reject", "analytics-accept"]) {
      if (!this._innerHTML.includes(className)) continue;
      const button = new FakeElement("button", this.ownerDocument);
      button.className = className;
      this.appendChild(button);
    }
  }

  get innerHTML() { return this._innerHTML; }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) { children.forEach((child) => this.appendChild(child)); }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({ target: this }); }
  focus() { this.ownerDocument.activeElement = this; }

  querySelector(selector) {
    return findElement(this.children, selector);
  }
}

function matches(element, selector) {
  if (selector.startsWith(".")) return element.className.split(/\s+/).includes(selector.slice(1));
  if (selector === "[data-analytics-preferences]") return element.dataset.analyticsPreferences === "true";
  const script = selector.match(/^script\[src="(.+)"\]$/);
  return Boolean(script && element.tagName === "SCRIPT" && element.src === script[1]);
}

function findElement(elements, selector) {
  for (const element of elements) {
    if (matches(element, selector)) return element;
    const nested = findElement(element.children, selector);
    if (nested) return nested;
  }
  return null;
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.title = "Stock install";
    this.activeElement = null;
    this.listeners = new Map();
  }

  createElement(tagName) { return new FakeElement(tagName, this); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  querySelector(selector) { return findElement([this.head, this.body], selector); }
  getElementById(id) {
    const visit = (elements) => {
      for (const element of elements) {
        if (element.id === id) return element;
        const nested = visit(element.children);
        if (nested) return nested;
      }
      return null;
    };
    return visit([this.head, this.body]);
  }
}

function externalScripts(document) {
  return document.head.children.filter((element) => element.tagName === "SCRIPT").map((element) => element.src);
}

async function loadAnalytics() {
  const document = new FakeDocument();
  const location = {
    href: "https://example.test/stock/",
    origin: "https://example.test",
    pathname: "/stock/",
    reloadCount: 0,
    reload() { this.reloadCount += 1; },
  };
  const history = { state: null, replaceState() {} };
  let configRequests = 0;
  const window = {
    document,
    location,
    history,
    localStorage: new FakeStorage(),
    sessionStorage: new FakeStorage(),
    HarnessPublicPageConfig: publicPageConfig,
    apiFetch: async (path) => {
      configRequests += 1;
      assert.equal(path, "/api/analytics/config");
      return {
        ok: true,
        json: async () => ({
          version: 1,
          enabled: true,
          environment: "production",
          ga4MeasurementId: "G-TEST123",
          gtmContainerId: "GTM-TEST123",
          cloudflareWebAnalyticsToken: "abcdef1234567890abcdef1234567890",
          clarityProjectId: "clarity123",
        }),
      };
    },
  };
  window.window = window;
  vm.runInContext(analyticsSource, vm.createContext({
    window,
    document,
    location,
    history,
    Element: FakeElement,
    URL,
    console,
    encodeURIComponent,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  return { document, location, window, configRequests: () => configRequests };
}

test("analytics makes no vendor request before consent, survives rejection, and initializes once", async () => {
  const harness = await loadAnalytics();
  assert.equal(harness.configRequests(), 1, "only the same-origin config is requested");
  assert.deepEqual(externalScripts(harness.document), []);
  assert.equal(harness.window.HarnessAnalytics.track("cta_click", { cta_id: "before-consent" }), false);

  harness.document.getElementById("analyticsConsentDialog").querySelector(".analytics-reject").click();
  assert.deepEqual(externalScripts(harness.document), []);
  assert.equal(harness.window.localStorage.getItem("harness.analytics-consent.v1"), "rejected");

  harness.window.HarnessAnalytics.openPreferences();
  harness.document.getElementById("analyticsConsentDialog").querySelector(".analytics-accept").click();
  assert.deepEqual(externalScripts(harness.document), [
    "https://www.googletagmanager.com/gtag/js?id=G-TEST123",
    "https://www.googletagmanager.com/gtm.js?id=GTM-TEST123",
    "https://static.cloudflareinsights.com/beacon.min.js",
  ]);

  harness.window.HarnessAnalytics.openPreferences();
  harness.document.getElementById("analyticsConsentDialog").querySelector(".analytics-accept").click();
  assert.equal(externalScripts(harness.document).length, 3, "duplicate consent must not initialize vendors twice");
});

test("analytics strips PII-like parameters and stops tracking after consent withdrawal", async () => {
  const harness = await loadAnalytics();
  harness.document.getElementById("analyticsConsentDialog").querySelector(".analytics-accept").click();

  assert.equal(harness.window.HarnessAnalytics.track("cta_click", {
    page_type: "stock",
    cta_id: "Download Now",
    email: "private@example.test",
    transcript: "private meeting text",
  }), true);
  const tracked = harness.window.dataLayer.find((event) => event?.event === "harness_cta_click");
  assert.deepEqual(JSON.parse(JSON.stringify(tracked)), {
    event: "harness_cta_click",
    page_type: "stock",
    cta_id: "download_now",
    environment: "production",
  });
  assert.doesNotMatch(JSON.stringify(harness.window.dataLayer), /private@example|private meeting/);
  assert.equal(harness.window.HarnessAnalytics.track("arbitrary_event", { email: "private@example.test" }), false);

  harness.window.HarnessAnalytics.openPreferences();
  harness.document.getElementById("analyticsConsentDialog").querySelector(".analytics-reject").click();
  assert.equal(harness.location.reloadCount, 1, "withdrawal reloads to remove already-loaded vendor code");
  assert.equal(harness.window.HarnessAnalytics.track("cta_click", { cta_id: "after-withdrawal" }), false);
});
