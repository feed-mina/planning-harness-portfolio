function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values) {
  return Array.from(new Set(asArray(values).filter((value) => typeof value === "string" && value.trim())));
}

function messageLocales(messages) {
  return isRecord(messages) ? Object.keys(messages).sort() : [];
}

export function hasI18n(manifest) {
  return Boolean(manifest?.defaultLocale || manifest?.locales || manifest?.messages);
}

export function countMessages(messages) {
  if (!isRecord(messages)) return 0;

  let count = 0;
  for (const locale of Object.keys(messages)) {
    if (!isRecord(messages[locale])) continue;
    count += Object.values(messages[locale]).filter((value) => typeof value === "string").length;
  }
  return count;
}

export function getManifestI18n(manifest, requestedLocale = null) {
  const explicitLocales = uniqueStrings(manifest?.locales);
  const declaredMessageLocales = messageLocales(manifest?.messages);
  const defaultLocale = asTrimmedString(manifest?.defaultLocale)
    || explicitLocales[0]
    || declaredMessageLocales[0]
    || null;
  const locales = explicitLocales.length
    ? explicitLocales
    : uniqueStrings([defaultLocale, ...declaredMessageLocales]);
  const requested = asTrimmedString(requestedLocale);
  const selectedLocale = requested && locales.includes(requested)
    ? requested
    : defaultLocale;

  return {
    configured: hasI18n(manifest),
    defaultLocale,
    locales,
    selectedLocale,
    messageCount: countMessages(manifest?.messages),
  };
}

function messageValue(manifest, locale, key) {
  const value = manifest?.messages?.[locale]?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function warning(path, message) {
  return { path, message };
}

export function resolveMessage(manifest, key, options = {}) {
  const i18n = getManifestI18n(manifest, options.locale);
  const locale = options.locale || i18n.selectedLocale;
  const defaultLocale = i18n.defaultLocale;
  const fallback = options.fallback;
  const path = options.path || key;

  if (locale) {
    const localized = messageValue(manifest, locale, key);
    if (localized) {
      return { key, value: localized, locale, source: "locale", warning: null };
    }
  }

  if (defaultLocale && defaultLocale !== locale) {
    const defaultValue = messageValue(manifest, defaultLocale, key);
    if (defaultValue) {
      return {
        key,
        value: defaultValue,
        locale: defaultLocale,
        source: "defaultLocale",
        warning: warning(path, `missing ${locale || "requested"} translation for ${key}; used ${defaultLocale}`),
      };
    }
  }

  if (typeof fallback === "string" && fallback.trim()) {
    return {
      key,
      value: fallback,
      locale: null,
      source: "literal",
      warning: i18n.configured
        ? warning(path, `missing translation for ${key}; used literal fallback`)
        : null,
    };
  }

  return {
    key,
    value: key,
    locale: null,
    source: "key",
    warning: warning(path, `missing translation and fallback for ${key}`),
  };
}

export function pushI18nWarning(warnings, result) {
  if (result?.warning) warnings.push(result.warning);
  return result.value;
}

export function pageTitleKey(pageId) {
  return `pages.${pageId}.title`;
}

export function resolvePageTitle(manifest, page, options = {}) {
  return resolveMessage(manifest, pageTitleKey(page.id), {
    locale: options.locale,
    fallback: page.title,
    path: `pages.${page.id}.title`,
  });
}

export function resolveStudioLabel(manifest, key, fallback, options = {}) {
  return resolveMessage(manifest, `studio.labels.${key}`, {
    locale: options.locale,
    fallback,
    path: `studio.labels.${key}`,
  });
}

export function setLocaleMessage(manifest, locale, key, value) {
  return {
    ...manifest,
    messages: {
      ...(manifest.messages || {}),
      [locale]: {
        ...(manifest.messages?.[locale] || {}),
        [key]: value,
      },
    },
  };
}
