import type { Env } from "./env";

async function limitedResponseText(response: Response, maxLength = 1000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < maxLength) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= maxLength) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    text += decoder.decode();
  } catch {
    return text.slice(0, maxLength);
  }
  return text.slice(0, maxLength);
}

export async function sendTransactionalEmail(
  env: Env,
  to: string,
  subject: string,
  text: string,
  html: string,
  categories: string[] = ["planning-harness"]
): Promise<void> {
  const apiKey = env.SENDGRID_API_KEY;
  const from = env.ALERT_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("sendgrid_api_key_or_sender_missing");

  const response = await fetch(env.SENDGRID_MAIL_SEND_ENDPOINT || "https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: env.ALERT_EMAIL_FROM_NAME || "Planning Harness" },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
      categories,
    }),
  });
  if (!response.ok) {
    const detail = await limitedResponseText(response);
    throw new Error(`sendgrid_${response.status}${detail ? `: ${detail}` : ""}`);
  }
}
