import { applyBrandingToDocument, normalizeBrandingConfig } from "/src/branding-config.js";

const appName = document.querySelector("#app-name");
const primary = document.querySelector("#primary");
const domain = document.querySelector("#domain");
const render = () => {
  try {
    const branding = normalizeBrandingConfig({ appName: appName.value, domain: domain.value, theme: { primary: primary.value }, preinstalledTemplates: ["garden-knowledge-base", "kride-ai-chat"] });
    applyBrandingToDocument(document, branding);
    document.querySelector("header h1").textContent = branding.appName;
    document.querySelector(".app nav strong").textContent = branding.appName.replace(" Studio", "");
    document.querySelector(".app nav i").textContent = branding.domain;
  } catch {}
};
[appName, primary, domain].forEach((input) => input.addEventListener("input", render));
render();
