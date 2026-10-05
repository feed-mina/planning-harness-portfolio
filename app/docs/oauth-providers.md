# OAuth provider setup

The app supports the existing GitHub login plus Google and Kakao login routes.

## Redirect URIs

- GitHub: `<APP_BASE_URL>/api/auth/callback`
- Google: `<APP_BASE_URL>/api/auth/google/callback`
- Kakao: `<APP_BASE_URL>/api/auth/kakao/callback`

## Cloudflare secrets

```bash
wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put KAKAO_REST_API_KEY
wrangler secret put KAKAO_CLIENT_SECRET
```

`KAKAO_CLIENT_SECRET` is optional if the Kakao app does not use a client secret.
All providers issue the same `sid` session cookie. GitHub API features still require
a GitHub login because they depend on the stored GitHub OAuth token.
