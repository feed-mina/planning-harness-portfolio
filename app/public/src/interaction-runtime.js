const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const primitive = (value) => typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
export const INTERACTION_ACTIONS = Object.freeze(["setState", "toggleState", "navigate"]);
export const TRANSITION_PROPERTIES = Object.freeze(["opacity", "transform"]);
export const TRANSITION_EASINGS = Object.freeze(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);

export function validatePageInteractions(page, pageIndex, routes) {
  const issues = [], base = `pages[${pageIndex}]`, state = record(page.state) ? page.state : {};
  if (page.state !== undefined && !record(page.state)) issues.push({ path: `${base}.state`, message: "must be an object" });
  for (const [key, value] of Object.entries(state)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) issues.push({ path: `${base}.state.${key}`, message: "must be a safe state key" });
    if (!primitive(value) || (typeof value === "string" && value.length > 256) || (typeof value === "number" && Math.abs(value) > 1_000_000)) issues.push({ path: `${base}.state.${key}`, message: "must be a boolean, short string, or limited number" });
  }
  const stateKeys = new Set(Object.keys(state));
  const visit = (nodes, path) => (nodes || []).forEach((node, index) => {
    const nodePath = `${path}[${index}]`;
    for (const field of ["visibleWhen", "enabledWhen"]) {
      const condition = node[field];
      if (condition === undefined) continue;
      if (!record(condition) || Object.keys(condition).some((key) => !["state", "equals"].includes(key)) || typeof condition.state !== "string" || !Object.hasOwn(condition, "equals") || !primitive(condition.equals)) issues.push({ path: `${nodePath}.${field}`, message: "must be { state, equals }" });
      else if (!stateKeys.has(condition.state)) issues.push({ path: `${nodePath}.${field}.state`, message: `unknown state key: ${condition.state}` });
      else if (typeof condition.equals !== typeof state[condition.state]) issues.push({ path: `${nodePath}.${field}.equals`, message: "must match the state value type" });
    }
    const action = node.events?.onClick;
    if (node.events !== undefined && (!record(node.events) || Object.keys(node.events).some((key) => key !== "onClick"))) issues.push({ path: `${nodePath}.events`, message: "only onClick is supported" });
    if (action !== undefined) {
      if (!record(action) || !INTERACTION_ACTIONS.includes(action.action)) issues.push({ path: `${nodePath}.events.onClick.action`, message: `must be one of: ${INTERACTION_ACTIONS.join(", ")}` });
      else if (["setState", "toggleState"].includes(action.action) && !stateKeys.has(action.target)) issues.push({ path: `${nodePath}.events.onClick.target`, message: `unknown state key: ${action.target}` });
      else if (action.action === "toggleState" && typeof state[action.target] !== "boolean") issues.push({ path: `${nodePath}.events.onClick.target`, message: "toggleState target must be boolean" });
      else if (action.action === "setState" && (!Object.hasOwn(action, "value") || !primitive(action.value) || typeof action.value !== typeof state[action.target])) issues.push({ path: `${nodePath}.events.onClick.value`, message: "must match the target state type" });
      else if (action.action === "navigate" && !routes.has(action.target)) issues.push({ path: `${nodePath}.events.onClick.target`, message: `unknown route: ${action.target}` });
    }
    if (node.transition !== undefined) {
      const transition = node.transition;
      if (!record(transition) || Object.keys(transition).some((key) => !["property", "durationMs", "easing"].includes(key))) issues.push({ path: `${nodePath}.transition`, message: "must contain only property, durationMs, and easing" });
      else {
        if (!TRANSITION_PROPERTIES.includes(transition.property)) issues.push({ path: `${nodePath}.transition.property`, message: `must be one of: ${TRANSITION_PROPERTIES.join(", ")}` });
        if (!Number.isInteger(transition.durationMs) || transition.durationMs < 0 || transition.durationMs > 1000) issues.push({ path: `${nodePath}.transition.durationMs`, message: "must be an integer from 0 to 1000" });
        if (!TRANSITION_EASINGS.includes(transition.easing)) issues.push({ path: `${nodePath}.transition.easing`, message: `must be one of: ${TRANSITION_EASINGS.join(", ")}` });
      }
    }
    visit(node.children, `${nodePath}.children`);
  });
  visit(page.nodes, `${base}.nodes`);
  return issues;
}

const attrValue = (value) => encodeURIComponent(JSON.stringify(value));
const escapeAttribute = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function interactionAttributes(node) {
  const attrs = [`data-sdui-node="${escapeAttribute(node.id)}"`];
  if (node.events?.onClick) attrs.push(`data-sdui-click="${attrValue(node.events.onClick)}"`);
  if (node.visibleWhen) attrs.push(`data-sdui-visible="${attrValue(node.visibleWhen)}"`);
  if (node.enabledWhen) attrs.push(`data-sdui-enabled="${attrValue(node.enabledWhen)}"`);
  if (node.transition) attrs.push(`data-sdui-transition="${attrValue(node.transition)}"`);
  if (node.props?.role === "dialog") attrs.push('role="dialog" aria-modal="true" tabindex="-1"');
  return attrs.join(" ");
}

export function interactionTransitionCss(node) {
  const transition = node.transition;
  if (!transition || !TRANSITION_PROPERTIES.includes(transition.property) || !TRANSITION_EASINGS.includes(transition.easing)) return "";
  return `transition: ${transition.property} ${transition.durationMs}ms ${transition.easing}`;
}

export function interactionRuntimeScript(initialState) {
  return `(()=>{const state=structuredClone(${JSON.stringify(initialState || {}).replaceAll("<", "\\u003c")});let trigger=null;const timers=new WeakMap();const read=(el,name)=>{try{return JSON.parse(decodeURIComponent(el.dataset[name]))}catch{return null}};const matches=c=>c&&state[c.state]===c.equals;const value=(el,t,on)=>{if(!t)return;if(t.property==='opacity')el.style.opacity=on?'1':'0';if(t.property==='transform')el.style.transform=on?'none':'translateX(-100%)'};const visibility=(el,on,animate,focus)=>{clearTimeout(timers.get(el));const t=read(el,'sduiTransition');const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;const duration=animate&&!reduce?t?.durationMs||0:0;const wasHidden=el.hidden;if(on){el.hidden=false;if(duration&&wasHidden){value(el,t,false);requestAnimationFrame(()=>value(el,t,true))}else value(el,t,true);if(focus&&wasHidden&&el.getAttribute('role')==='dialog')(el.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')||el).focus()}else if(duration&&!wasHidden){value(el,t,false);timers.set(el,setTimeout(()=>{el.hidden=true},duration))}else{el.hidden=true;value(el,t,false)}};const render=(animate=false,focus=false)=>document.querySelectorAll('[data-sdui-node]').forEach(el=>{const visible=read(el,'sduiVisible');if(visible)visibility(el,matches(visible),animate,focus);const enabled=read(el,'sduiEnabled');if(enabled){const disabled=!matches(enabled);if('disabled'in el)el.disabled=disabled;el.setAttribute('aria-disabled',String(disabled))}});document.addEventListener('click',event=>{const el=event.target.closest('[data-sdui-click]');if(!el)return;const action=read(el,'sduiClick');if(!action)return;trigger=el;if(action.action==='toggleState')state[action.target]=!state[action.target];else if(action.action==='setState')state[action.target]=action.value;else if(action.action==='navigate')location.assign(action.target);render(true,true)});document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const dialog=[...document.querySelectorAll('[role="dialog"][data-sdui-visible]')].find(el=>!el.hidden);if(!dialog)return;const condition=read(dialog,'sduiVisible');if(typeof condition?.equals!=='boolean')return;state[condition.state]=!condition.equals;render(true,false);trigger?.focus()});render()})();`;
}

export function installInteractionRuntime(root, initialState, options = {}) {
  const state = structuredClone(initialState || {});
  let trigger = null;
  const transitionTimers = new WeakMap();
  const read = (element, name) => { try { return JSON.parse(decodeURIComponent(element.dataset[name])); } catch { return null; } };
  const matches = (condition) => condition && state[condition.state] === condition.equals;
  const setTransitionValue = (element, transition, visible) => {
    if (transition?.property === "opacity") element.style.opacity = visible ? "1" : "0";
    if (transition?.property === "transform") element.style.transform = visible ? "none" : "translateX(-100%)";
  };
  const applyVisibility = (element, visible, animate, focus) => {
    clearTimeout(transitionTimers.get(element));
    const transition = read(element, "sduiTransition");
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = animate && !reducedMotion ? transition?.durationMs || 0 : 0;
    const wasHidden = element.hidden;
    if (visible) {
      element.hidden = false;
      if (duration && wasHidden) {
        setTransitionValue(element, transition, false);
        requestAnimationFrame(() => setTransitionValue(element, transition, true));
      } else setTransitionValue(element, transition, true);
      if (focus && wasHidden && element.getAttribute("role") === "dialog") (element.querySelector("button,[href],input,select,textarea,[tabindex]:not([tabindex='-1'])") || element).focus();
    } else if (duration && !wasHidden) {
      setTransitionValue(element, transition, false);
      transitionTimers.set(element, setTimeout(() => { element.hidden = true; }, duration));
    } else {
      element.hidden = true;
      setTransitionValue(element, transition, false);
    }
  };
  const render = (animate = false, focus = false) => root.querySelectorAll("[data-sdui-node]").forEach((element) => {
    const visible = read(element, "sduiVisible");
    if (visible) applyVisibility(element, matches(visible), animate, focus);
    const enabled = read(element, "sduiEnabled");
    if (enabled) {
      const disabled = !matches(enabled);
      if ("disabled" in element) element.disabled = disabled;
      element.setAttribute("aria-disabled", String(disabled));
    }
  });
  const click = (event) => {
    const element = event.target.closest("[data-sdui-click]");
    if (!element || !root.contains(element)) return;
    const action = read(element, "sduiClick");
    if (!action) return;
    trigger = element;
    if (action.action === "toggleState") state[action.target] = !state[action.target];
    else if (action.action === "setState") state[action.target] = action.value;
    else if (action.action === "navigate") (options.navigate || ((target) => { location.assign(target); }))(action.target);
    render(true, true);
  };
  const keydown = (event) => {
    if (event.key !== "Escape") return;
    const dialog = [...root.querySelectorAll("[role='dialog'][data-sdui-visible]")].find((element) => !element.hidden);
    if (!dialog) return;
    const condition = read(dialog, "sduiVisible");
    if (typeof condition?.equals !== "boolean") return;
    state[condition.state] = !condition.equals;
    render(true);
    trigger?.focus();
  };
  root.addEventListener("click", click);
  root.addEventListener("keydown", keydown);
  render();
  return () => { root.removeEventListener("click", click); root.removeEventListener("keydown", keydown); };
}
