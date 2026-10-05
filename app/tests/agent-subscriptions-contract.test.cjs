const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(appRoot, relativePath), "utf8");

test("issue #151 has a separate D1 domain with explicit observation states and sources", () => {
  const migration = read("migrations/0079_agent_subscriptions.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_usage_windows/);
  assert.match(migration, /UNIQUE \(user_id, provider\)/);
  assert.match(migration, /UNIQUE \(user_id, provider, window_kind\)/);
  for (const source of ["manual", "provider_api", "local_bridge"]) assert.match(migration, new RegExp(`'${source}'`));
  for (const status of ["fresh", "stale", "unsupported", "unconfigured", "error"]) assert.match(migration, new RegExp(`'${status}'`));
  assert.match(migration, /status = 'fresh' AND remaining_value IS NOT NULL AND resets_at IS NOT NULL/);
  assert.match(migration, /status <> 'fresh' AND remaining_value IS NULL/);
  assert.match(migration, /provider IN \('claude', 'codex'\) AND window_kind IN \('rolling_5h', 'weekly'\)/);
  assert.match(migration, /provider = 'copilot' AND window_kind = 'monthly'/);
});

test("agent subscription observations cannot overwrite newer verified or observed values", () => {
  const source = read("src/domains/usage/agentSubscriptions.ts");
  assert.match(source, /excluded\.verified_at > agent_subscriptions\.verified_at/);
  assert.match(source, /excluded\.observed_at > agent_usage_windows\.observed_at/);
  assert.match(source, /reset_policy: "observation_required"/);
  assert.match(source, /MAX_JSON_BODY_BYTES = 32 \* 1024/);
  assert.match(source, /invalid_path_encoding/);
  assert.match(source, /untrusted_source/);
  assert.match(source, /manualHttpInput/);
  assert.match(source, /status === "fresh" \? row\.remaining_value : null/);
  assert.match(source, /sensitive_credentials_collected: false/);
  assert.doesNotMatch(source, /from ["']\.\/usage["']/);
});

test("Worker exposes authenticated CRUD outside the internal cost usage routes", () => {
  const source = read("src/router.ts");
  const domain = read("src/domains/usage/agentSubscriptions.ts");
  assert.match(source, /handleAgentSubscriptionsRequest/);
  assert.match(domain, /\/api\/agent-subscriptions/);
  assert.match(domain, /login_required/);
  assert.match(domain, /request\.method === "GET"/);
  assert.match(domain, /request\.method === "PUT"/);
  assert.match(domain, /request\.method === "DELETE"/);
  assert.match(domain, /"cache-control": "no-store"/);
});

test("issue #165 renders a compact three-row accordion without removing detailed controls", () => {
  const fragment = read("public/assets/sdui-fragments/mypage.html");
  const script = read("public/assets/mypage.js");
  const styles = read("public/assets/styles.css");
  const domain = read("src/domains/usage/agentSubscriptions.ts");

  assert.match(fragment, /<details class="panel settings-accordion agent-subscriptions-accordion" id="agentSubscriptionsPanel">/);
  assert.match(fragment, /id="agentSubscriptionsSummary"/);
  assert.doesNotMatch(fragment, /<summary[^>]+aria-(?:controls|expanded)=/);
  assert.match(fragment, /id="agentSubscriptionOverview"/);
  assert.match(fragment, /data-accordion-label/);
  assert.match(fragment, /id="agentSubscriptionCards"/);
  assert.match(fragment, /Claude, Codex, GitHub Copilot을 3줄로 확인하세요/);
  assert.match(fragment, /쿠키·인증 토큰·브라우저 세션을 자동 수집하지 않습니다/);
  assert.match(fragment, /node app\/scripts\/usage-bridge\.mjs claude --paste/);
  assert.match(fragment, /node app\/scripts\/usage-bridge\.mjs codex/);
  assert.match(fragment, /node app\/scripts\/usage-bridge\.mjs codex --paste/);
  assert.match(fragment, /blob\/main\/app\/docs\/usage-bridge\.md/);
  assert.match(fragment, /AI Credits·조직·Enterprise 결제에는 아직 맞지 않습니다/);
  assert.match(script, /initAgentSubscriptions\(\)/);
  assert.match(script, /agentProviderUsageSummary/);
  assert.match(script, /providerOrder = \{ claude: 0, codex: 1, copilot: 2 \}/);
  assert.match(script, /<details class="agent-subscription-card agent-provider-row"/);
  assert.match(script, /openProviders\.has\(providerData\.provider\)/);
  assert.doesNotMatch(script, /setAttribute\("aria-expanded"/);
  assert.match(script, /data-agent-action="save-subscription"/);
  assert.match(script, /data-agent-action="save-window"/);
  assert.match(script, /data-agent-action="sync-credential"/);
  assert.match(script, /data-agent-subscription-field="next_renewal_on"/);
  assert.match(script, /data-agent-window-field="resets_at"/);
  assert.match(script, /target="_blank" rel="noopener noreferrer"/);
  assert.match(styles, /\.agent-subscription-grid \{ display: grid; grid-template-columns: 1fr/);
  assert.match(styles, /\.agent-provider-summary/);
  assert.match(styles, /\.settings-accordion\[open\]\s*>\s*summary/);
  assert.doesNotMatch(styles, /\.settings-accordion\[open\]\s+summary/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(styles, /\.agent-subscription-grid[^\n]+auto-fit/);
  for (const provider of ["claude", "codex", "copilot"]) {
    assert.match(domain, new RegExp(`provider: "${provider}"`));
  }
  assert.match(domain, /support\.claude\.com/);
  assert.match(domain, /help\.openai\.com/);
  assert.match(domain, /11369540-using-codex-with-your-chatgpt-plan/);
  assert.match(domain, /github\.com\/settings\/billing/);
  assert.match(domain, /required_usage_slots: \["daily", "weekly"\]/);
  assert.match(domain, /input_supported: false/);
  assert.match(script, /제공자 미지원/);
});
