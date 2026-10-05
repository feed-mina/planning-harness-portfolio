# SendGrid email delivery

Budget threshold emails use the SendGrid Mail Send API.

## Required SendGrid setup

1. Verify a sender in SendGrid.
   - Single Sender Verification is enough for a quick smoke test.
   - Domain Authentication is recommended for production deliverability.
2. Create a SendGrid API key with Mail Send permission.
3. Store the API key as a Cloudflare Worker secret.

## Cloudflare Worker variables

Set these values on the Worker.

| Name | Type | Example | Notes |
| --- | --- | --- | --- |
| `SENDGRID_API_KEY` | Secret | `SG...` | Never commit this value. |
| `ALERT_EMAIL_FROM` | Secret | `alerts@example.com` | Must be a verified SendGrid sender. |
| `ALERT_EMAIL_FROM_NAME` | Variable | `Planning Harness` | Display name for alert emails. |
| `SENDGRID_MAIL_SEND_ENDPOINT` | Variable | `https://api.sendgrid.com/v3/mail/send` | Defaults to this endpoint in code. |

## Wrangler CLI

Run from `app/`.

```bash
npx wrangler secret put SENDGRID_API_KEY
npx wrangler secret put ALERT_EMAIL_FROM
```

Then set non-secret variables in `wrangler.jsonc` or in the Cloudflare dashboard:

```jsonc
"vars": {
  "SENDGRID_MAIL_SEND_ENDPOINT": "https://api.sendgrid.com/v3/mail/send",
  "ALERT_EMAIL_FROM_NAME": "Planning Harness"
}
```

Deploy after the values are set:

```bash
npx wrangler deploy
```

## Dashboard path

Cloudflare dashboard:

1. Workers & Pages
2. Select `harness-meeting-app`
3. Settings
4. Variables and Secrets
5. Add `SENDGRID_API_KEY` and `ALERT_EMAIL_FROM` as Secrets
6. Add `ALERT_EMAIL_FROM_NAME` and optionally `SENDGRID_MAIL_SEND_ENDPOINT` as Variables

## Smoke test

Trigger a budget warning/limit with a logged-in email account. Check `usage_alerts.delivery_status`:

- `email_sent`: SendGrid accepted the message.
- `email_skipped`: missing recipient, sender, API key, or user opted out.
- `email_failed`: SendGrid returned an error.
