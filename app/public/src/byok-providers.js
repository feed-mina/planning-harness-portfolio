const PROVIDERS = new Set(["openai", "anthropic", "google"]);

export function readByok(request) {
  const provider = (request.headers.get("x-ai-provider") || "").trim().toLowerCase();
  const apiKey = (request.headers.get("x-ai-provider-key") || "").trim();
  if (!provider && !apiKey) return null;
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error("Unsupported AI provider"), { code: "unsupported_ai_provider", status: 400 });
  if (!apiKey) throw Object.assign(new Error("AI provider API key is required"), { code: "missing_provider_key", status: 401 });
  return { provider, apiKey };
}

function inputParts(input) {
  if (typeof input === "string") return { text: input, images: [] };
  const content = input?.[0]?.content || [];
  return {
    text: content.filter((item) => item.type === "input_text").map((item) => item.text || "").join("\n"),
    images: content.filter((item) => item.type === "input_image").map((item) => item.image_url).filter(Boolean),
  };
}

function dataImage(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

async function jsonOrError(response, provider) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`${provider} API authentication or request failed`), { code: "provider_request_failed", status: response.status });
  return payload;
}

export function createByokTransport({ provider, apiKey, fetchImpl = fetch }) {
  return {
    async create(request) {
      const { text, images } = inputParts(request.input);
      if (provider === "anthropic") {
        const imageData = images.map(dataImage).filter(Boolean);
        const content = [
          ...imageData.map((item) => ({ type: "image", source: { type: "base64", media_type: item.mediaType, data: item.data } })),
          { type: "text", text },
        ];
        const payload = await jsonOrError(await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 4096, system: request.instructions, messages: [{ role: "user", content }] }),
        }), "Anthropic");
        return { id: payload.id, output_text: (payload.content || []).filter((item) => item.type === "text").map((item) => item.text).join(""), usage: { input_tokens: payload.usage?.input_tokens, output_tokens: payload.usage?.output_tokens, total_tokens: (payload.usage?.input_tokens || 0) + (payload.usage?.output_tokens || 0) } };
      }
      if (provider === "google") {
        const imageData = images.map(dataImage).filter(Boolean);
        const parts = [{ text: `${request.instructions || ""}\n${text}` }, ...imageData.map((item) => ({ inline_data: { mime_type: item.mediaType, data: item.data } }))];
        const payload = await jsonOrError(await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json" } }),
        }), "Gemini");
        return { output_text: payload.candidates?.[0]?.content?.parts?.map((item) => item.text || "").join("") || "", usage: { input_tokens: payload.usageMetadata?.promptTokenCount, output_tokens: payload.usageMetadata?.candidatesTokenCount, total_tokens: payload.usageMetadata?.totalTokenCount } };
      }
      throw Object.assign(new Error("Unsupported BYOK transport"), { code: "unsupported_ai_provider" });
    },
    async *stream() { throw Object.assign(new Error("BYOK streaming is not enabled"), { code: "unsupported_stream" }); },
  };
}
