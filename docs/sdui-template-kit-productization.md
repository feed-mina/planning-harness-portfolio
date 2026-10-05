# SDUI Template Kit Productization

Status: decision ready for issue #79
Date: 2026-07-09

## Decision

planning-harness can be productized, but the first product should not be a generic consumer-app SDUI builder.

Recommended positioning:

> Cloudflare-native SDUI template kit for AI business apps and operator tools.

Recommended first template:

> Garden/Knowledge Base Template.

This is the safest first SKU because it already has a concrete workflow, a D1 schema, an SDUI page, a page plugin, GitHub repo selection, config preview, and an artifact handoff model. The AI Analysis Workspace can stay the flagship demo and become the second paid template after the legacy fragment boundary is smaller.

## Productization Inventory

| Area | Current asset | Productization value | Decision |
|---|---|---|---|
| Server SDUI API | `app/src/sdui.ts`, `GET /api/ui/:pageKey` | Loads a D1-backed UI tree and filters by role/provider | Public core |
| Metadata schema | `app/migrations/0013_ui_metadata.sql` | Defines `page_key`, `node_id`, `component_type`, `props_json`, action, ref data, role gates | Public core |
| Client renderer | `app/public/assets/sdui-engine.js` | Provides component rendering, page registry, actions, hydrators, widgets | Public core after built-in extraction |
| Page plugin pattern | `sdui-content.js`, `sdui-time-settings.js`, `sdui-garden.js` | Keeps template-specific behavior outside metadata rows | Public template API |
| Garden workflow | `app/src/gardens.ts`, `0030_gardens_sdui.sql`, `sdui-garden.js` | A complete repo-to-config-to-build-artifact workflow | First template |
| Analysis workspace | `analysis.ts`, `evals.ts`, analysis-edit SDUI migrations | Strong demo for paid AI workspace patterns | Second template / flagship demo |
| Usage and quota | `usage.ts`, org usage files, proxy gateway files | Metering, limits, dashboards, SaaS gating | Paid app logic / hosted feature |
| Auth/OAuth | GitHub, Google, Kakao, email auth paths | Login and role segmentation for templates | Mixed: core contracts public, provider secrets private |
| Static shell | `app/public/*/index.html`, fragment files | Deployable Worker static asset shell | Template package asset |

## Public Core vs App Logic Boundary

### Public core

The open-core package can include:

- `GET /api/ui/:pageKey` handler contract and the pure tree builder.
- `ui_metadata` base schema and seed conventions.
- Basic component types: `TEXT`, `INPUT`, `TEXTAREA`, `FILE_INPUT`, `SELECT`, `CHECKBOX`, `BUTTON`, `GROUP`, `WIDGET`.
- Role/provider filtering semantics.
- `registerSduiPage(pageKey, plugin)` registry shape.
- Renderer safety rules: safe ids, safe classes, dataset allowlist, no raw HTML in metadata props by default.
- Template packaging spec: metadata, plugin, API contract, static assets, migrations.

### Paid or private app logic

Keep these private or gated:

- Hosted Worker/D1/R2 provisioning automation.
- Garden build runner automation beyond artifact handoff.
- AI Analysis Workspace template.
- Usage/org dashboards, AI cost reports, team seats, export, alerts.
- Proxy gateway/device registration and provider secret management.
- Planning-harness-specific business flows, labels, prompts, and internal defaults.

### Refactor note

`sdui-engine.js` currently contains `dev-setup` built-in page logic. That logic should be extracted before publishing the core package. For issue #79, this is a documented Phase 1 technical debt item, not a blocker to product-positioning closure.

## First Template Choice

Chosen first product:

> Garden/Knowledge Base Template.

Why this is first:

- It has a clear buyer: small teams that want a repo-backed knowledge base/admin surface without building a custom control panel.
- It has low AI dependency and therefore lower support cost.
- It demonstrates the SDUI runtime, D1 metadata, page plugin, GitHub integration, R2 artifact handoff, and Cloudflare deployment story.
- It can have a useful free version with paid deployment automation later.

Not chosen first:

- AI Analysis Workspace: higher perceived value, but still mixed with legacy fragment migration and AI/usage cost complexity.
- Content/Time Settings Admin: good starter examples, but less distinctive as a paid SKU.
- Generic SDUI builder: too broad for the current codebase and would require a query builder, admin preview, marketplace rules, and stronger schema validation first.

## Template Package Format

The package format is:

```text
template/
  template.manifest.json
  migrations/
    ui_metadata.sql
    domain.sql
  public/
    index.html
    plugin.js
    assets/
  api-contract.md
  README.md
```

Minimum manifest fields:

| Field | Description |
|---|---|
| `schema` | Versioned manifest id, for example `planning-harness.sdui-template.v1` |
| `id` | Stable template id, for example `garden-knowledge-base` |
| `name` | Human-readable template name |
| `recommendedTier` | `free`, `pro`, or `hosted` |
| `pages` | SDUI page keys exported by the template |
| `migrations` | Required D1 migrations or SQL seeds |
| `plugins` | Static plugin bundles registered through `window.sduiPages` |
| `api` | Required endpoint contract and auth requirements |
| `assets` | Static files needed by the shell |
| `env` | Required Worker vars/secrets/bindings |
| `gating` | Feature gates and paid extension points |

The draft manifest for the first template lives at `templates/sdui-template-kit/template.manifest.json`.

Address-block pilot artifacts for reusable feature packaging now live at:

- `docs/sdui-address-select-block.md`
- `app/public/examples/address-select-block/template.manifest.json`

## API Contract Rules

Recommended contract rules for all templates:

- Metadata may call only allowlisted actions through `action_type`.
- Dynamic data must use explicit `ref_data_id` hydrators or widget ids.
- Template plugins own browser-side behavior; the core renderer only renders primitives and dispatches action names.
- API endpoints must document auth, request body, response body, and failure codes.
- D1 migrations must not include customer secrets.
- R2 objects must be addressed through template-owned API endpoints, not raw bucket paths.
- Role gates should use `public`, `anon`, `logged_in`, `provider:github`, `provider:google`, `provider:kakao`, or `provider:email`.

## Open-Core and Paid Gating

Recommended default:

| Tier | Includes | Gate |
|---|---|---|
| Free | SDUI core, metadata schema, one starter page, manual deploy docs | Public repo/package |
| Pro template pack | Garden template, Content/Time admin examples, import/export contracts | Private package or license key |
| Hosted | Managed Worker/D1/R2 deployment, build runner, updates, support | Hosted account/API |
| AI Ops | AI Analysis Workspace, org usage, cost dashboard, provider proxy | Hosted API plus Worker secrets |

License-key-only gating should not be the first line of defense for AI/usage features. Hosted API checks and secret-backed Workers are a better fit because AI cost and provider credentials are operational risks, not just feature flags.

## Pricing Model Draft

Recommended initial pricing shape:

| Plan | Buyer | Price anchor | Limits |
|---|---|---|---|
| Free | Developer evaluating the kit | $0 | 1 local project, core renderer/schema, manual deploy |
| Pro Templates | Solo operator or small team | One-time or monthly template pack | Garden template plus admin examples, self-hosted |
| Hosted Team | Team that wants managed ops | Monthly subscription | Projects, seats, hosted Worker/D1/R2, support |
| AI Ops Add-on | Teams running AI workflows | Base fee plus usage | AI calls, token cost, R2 storage, org dashboards |

The first commercial offer should sell the Garden/Knowledge Base template and managed deployment support. AI usage billing can come later because it requires stronger metering, model-price updates, and customer-facing cost controls.

## Phase Closure

Issue #79 phase decisions:

- Phase 0 inventory: closed by the inventory table above.
- Phase 1 package boundary: closed by public core/private app logic and package format above.
- Phase 2 first product: closed as Garden/Knowledge Base Template.
- Phase 3 gating: closed as open-core plus hosted/API gate for operational features.
- Phase 4 pricing: closed as Free, Pro Templates, Hosted Team, AI Ops Add-on.
- Phase 5 demo/docs: planning-harness remains the flagship demo; `/garden/` becomes the first template example page.

## Follow-up Implementation Issues

Recommended follow-up issues after #79 closes:

1. Extract `dev-setup` built-in logic from `sdui-engine.js` into `sdui-dev-setup.js`.
2. Add a template export command that emits `ui_metadata.sql`, `plugin.js`, `api-contract.md`, and `template.manifest.json`.
3. Create a Garden Template demo README with local D1 migration and `wrangler deploy` steps.
4. Add manifest validation for `planning-harness.sdui-template.v1`.
5. Decide whether Pro Templates ship as a private npm package, private GitHub template repo, or hosted import URL.

## Close Criteria Mapping

| Issue #79 criterion | Status |
|---|---|
| Productization possible/impossible elements are listed | Done |
| Public core and private/paid app logic boundary is decided | Done |
| First sales/distribution template is narrowed to one candidate | Done: Garden/Knowledge Base Template |
| Template package format is drafted | Done: metadata, plugin, API contract, manifest |
| planning-harness gating/pricing model is written | Done |
