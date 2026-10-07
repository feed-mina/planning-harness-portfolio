// HTTP 라우터 — index.ts의 fetch 핸들러 조립 대상. 실제 요청 처리 로직은 여기에 있다.
// /api/* 및 로그인 보호 페이지는 Worker 가 먼저 처리(run_worker_first), 나머지는 Static Assets.
import { summarize, type MeetingMeta } from "./ai";
import writeXlsxFile, { type SheetData } from "write-excel-file/universal";
import { transcribeClova, SttError } from "./stt";
import { deployEnvironment, type Env } from "./env";
import { checkQuota, logUsage, getSeries, listUsageAlerts, saveUsageLimitSettings, getUsageLimitSettings, getUsageBreakdown, getUsageSubjects, getUsageRequests, getCostDashboard, getUsageExportCsv, getUsageBudgetOverview, resetUsageBudget } from "./domains/usage";
import { handleAgentSubscriptionsRequest } from "./domains/usage";
import { handleAgentUsageAdapterRequest } from "./domains/usage";
import { getEffectiveSettings, settingsForApi, saveSettings, isLoggedIn, gitDefaultsForApi, saveGitDefaults, normalizeAISettings, type AIStage } from "./settings";
import {
  handleGithubCallback,
  handleGoogleCallback,
  handleKakaoCallback,
  handleNaverCallback,
  confirmPasswordReset,
  loginEmail,
  logout,
  registerEmail,
  requestPasswordReset,
  resendVerificationEmail,
  startGithubLogin,
  startGithubAccountLink,
  startGoogleCalendarConnect,
  startGoogleAccountLink,
  startGoogleLogin,
  startKakaoMessageConnect,
  startKakaoAccountLink,
  startKakaoLogin,
  startNaverAccountLink,
  startNaverLogin,
  verifyEmail,
} from "./domains/auth";
import { verifyJWT, parseCookies } from "./core/auth";
import { getUserToken, listRepos, listAssignees, listProjects, createIssue, addToProject, parseActionItems } from "./git";
import { saveMeeting, listMeetings, getMeeting } from "./domains/meeting";
import { deleteHistoryItem, getHistoryDetail, listHistory, restoreHistoryItem, updateHistoryMark } from "./history";
import { logDagsHubRun, usageExperiment } from "./dagshub";
import {
  createAnalysisSession,
  analysisInputFromBody,
  listAnalysisSessions,
  getAnalysisSessionDetail,
  patchAnalysisSession,
  deleteAnalysisSession,
  saveAnalysisFilesFromRequest,
  deleteAnalysisFile,
  summarizeAnalysisFiles,
  generateAnalysisIdeas,
  generateAnalysisPlans,
  generateAnalysisManual,
  saveAnalysisPlanRuns,
  saveAnalysisExecutions,
  retrieverFieldCandidates,
  getAnalysisIndexStatus,
  ANALYSIS_PIPELINE_STAGES,
  createAnalysisPipelineStream,
  getAnalysisPipelineStatus,
  type AnalysisPipelineSettings,
} from "./domains/analysis";
import { createEvalCase, evalReportResponse, listEvalDashboard, runEvalCases } from "./evals";
import { buildDevSetupPreview, buildDevSetupScript, getDevSetupCatalog } from "./devSetup";
import { getUiPage } from "./sdui";
import {
  acceptOrganizationInvite,
  createOrganization,
  getOrganizationDetail,
  getOrganizationUsageExportCsv,
  getOrganizationUsage,
  getOrganizationAuditLogs,
  inviteOrganizationMember,
  linkGardenToOrganization,
  listGardenOrganizations,
  listOrganizationGardens,
  listOrganizations,
  removeOrganizationMember,
  saveOrganizationSettings,
  unlinkGardenFromOrganization,
  updateOrganizationMember,
} from "./domains/organization";
import {
  claimDeviceRegistrationCode,
  createDeviceRegistrationCode,
  createProxyDevice,
  listProxyDevices,
  revokeProxyDevice,
} from "./proxyKeys";
import { handleProxyGateway } from "./proxyGateway";
import {
  createScheduleSession,
  createTimeBlock,
  deleteKanbanCard,
  deleteTimeBlock,
  enterScheduleSession,
  getScheduleSession,
  getTimeSettings,
  leaveScheduleSession,
  listScheduleGithubItems,
  listScheduleSessions,
  listScheduleSources,
  listTimeBlockRules,
  listTimeBlocks,
  listTimeBlocksRange,
  replaceScheduleSources,
  saveTimeSettings,
  ScheduleSessionError,
  updateScheduleGithubItem,
  updateScheduleSession,
  upsertScheduleSessionReport,
} from "./domains/planning";
import {
  createGoogleCalendarEvent,
  disconnectIntegration,
  getIntegrationStatus,
  scheduleKakaoReminderJobs,
  sendKakaoScheduleMessage,
} from "./integrations";
import {
  createContentPost,
  deleteContentAsset,
  deleteContentPost,
  getContentAssetResponse,
  getContentPost,
  listContentAssets,
  listContentPosts,
  saveContentAssetsFromRequest,
  updateContentPost,
} from "./domains/content";
import {
  claimNextGardenBuild,
  createGardenBuild,
  gardenBuildArtifactResponse,
  gardenConfigResponse,
  gardenRunnerArtifactResponse,
  getGardenLogoResponse,
  getGarden,
  listGardenBuilds,
  listGardens,
  listPublicGardens,
  saveGarden,
  saveGardenLogoFromRequest,
  deleteGardenLogo,
  deleteGardenBuild,
  deleteGarden,
  updateGardenBuildFromRunner,
} from "./domains/content";
import {
  createKanbanCardsFromMeeting,
  KanbanError,
  listKanbanBoards,
  listKanbanCards,
  updateKanbanCard,
} from "./domains/planning";
import {
  createScheduleFeedback,
  getScheduleAsset,
  listScheduleAssets,
  listScheduleCards,
  uploadScheduleAssets,
} from "./domains/planning";
import {
  ClovaRecordingError,
  getClovaRecording,
  importClovaRecording,
  listClovaRecordings,
  meetingInputFromClovaRecording,
} from "./domains/meeting";
import {
  authenticateNBlogBearer,
  handleNBlogApi,
  handleNBlogHandoffSessionApi,
  handleNBlogUpload,
  nblogErrorResponse,
  withNBlogResponseHeaders,
} from "./domains/nblog";
import { handleAiSduiApprove, handleAiSduiValidate } from "./aiSdui";
import {
  assertMobileAuthEnabled,
  authenticateMobileBearer,
  cancelMobileAuthorizationCode,
  enforceMobileAuthRateLimits,
  handleMobileRevokeRequest,
  handleMobileTokenRequest,
  issueMobileAuthorizationCode,
  readMobileAuthJson,
  assertConnectedAppAuthEnabled,
  handleConnectedAppAuthorize,
  handleConnectedAppAuthorizeResume,
  handleConnectedAppTokenRequest,
} from "./domains/auth";
import {
  QuickLogError,
  createQuickLogButton,
  createQuickLogEntry,
  deleteQuickLogButton,
  deleteQuickLogEntry,
  restoreQuickLogEntry,
  getQuickLogButtons,
  getQuickLogHistory,
  getQuickLogOverview,
  getQuickLogPhoto,
  updateQuickLogButton,
  uploadQuickLogPhoto,
} from "./domains/planning";
import {
  QuickLogReminderError,
  getQuickLogReminder,
  upsertQuickLogReminder,
} from "./domains/planning";
import {
  IdentityUnlinkError,
  getIdentitySummary,
  unlinkIdentity,
} from "./domains/auth";

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // API responses can include provider- and user-scoped SDUI/auth data.
      // Never let a GitHub user's garden preview leak into another session
      // through a browser, proxy, or edge cache.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      ...(init?.headers || {}),
    },
  });

function analyticsConfig(env: Env) {
  const valid = {
    ga4MeasurementId: /^G-[A-Z0-9]+$/.test(env.GA4_MEASUREMENT_ID || "") ? env.GA4_MEASUREMENT_ID : null,
    gtmContainerId: /^GTM-[A-Z0-9]+$/.test(env.GTM_CONTAINER_ID || "") ? env.GTM_CONTAINER_ID : null,
    cloudflareWebAnalyticsToken: /^[A-Za-z0-9_-]{20,80}$/.test(env.CLOUDFLARE_WEB_ANALYTICS_TOKEN || "")
      ? env.CLOUDFLARE_WEB_ANALYTICS_TOKEN
      : null,
    clarityProjectId: /^[a-z0-9]+$/.test(env.CLARITY_PROJECT_ID || "") ? env.CLARITY_PROJECT_ID : null,
  };
  return {
    version: 1,
    enabled: env.ANALYTICS_ENABLED === "true" && Object.values(valid).some(Boolean),
    environment: deployEnvironment(env),
    ...valid,
  };
}

function isProtectedAnalysisPage(path: string): boolean {
  return path === "/analysis" || path.startsWith("/analysis/") ||
    path === "/analysis-edit2" || path.startsWith("/analysis-edit2/");
}

function isProtectedGardenPage(path: string): boolean {
  return path === "/garden" || path.startsWith("/garden/");
}

function isProtectedStudioPage(path: string): boolean {
  return path === "/studio" || path.startsWith("/studio/");
}

function isProtectedNBlogPage(path: string): boolean {
  return path === "/nblog-automation" || path.startsWith("/nblog-automation/");
}


function normalizeStudioPageSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

type StudioPagePayload = {
  title: string;
  bodyClass: string | null;
  bodyHtml: string;
};

type StudioPageRow = {
  title: string;
  body_class: string | null;
  fragment_order: number | null;
  fragment_html: string | null;
};

async function getStudioPagePayload(
  env: Env,
  rawSlug: string,
): Promise<StudioPagePayload | null> {
  const slug = normalizeStudioPageSlug(rawSlug);
  if (!slug) return null;

  const query = await env.DB.prepare(`
    SELECT
      p.title,
      p.body_class,
      f.fragment_order,
      f.fragment_html
    FROM studio_pages p
    LEFT JOIN studio_page_fragments f
      ON f.page_slug = p.slug
     AND f.is_active = 1
    WHERE p.slug = ?
      AND p.is_active = 1
    ORDER BY f.fragment_order ASC, f.id ASC
  `).bind(slug).all<StudioPageRow>();

  if (!query.results || query.results.length === 0) return null;

  const title = query.results[0].title;
  const bodyClass = query.results[0].body_class || null;
  const bodyHtml = query.results
    .map((row) => row.fragment_html || "")
    .filter((fragment) => fragment.length > 0)
    .join("");

  return { title, bodyClass, bodyHtml };
}
function isProtectedAnalysisFragment(path: string): boolean {
  return path === "/assets/sdui-fragments/analysis.html" ||
    path === "/assets/sdui-fragments/analysis-edit2.html";
}

function loginRedirect(request: Request, setCookie?: string): Response {
  const current = new URL(request.url);
  const loginUrl = new URL("/mypage/", current);
  loginUrl.searchParams.set("next", `${current.pathname}${current.search}`);
  const headers = new Headers({
    location: loginUrl.toString(),
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

function dashboardRedirect(request: Request, setCookie?: string): Response {
  const headers = new Headers({
    location: new URL("/", request.url).toString(),
    "cache-control": "no-store",
    "x-robots-tag": "noindex, nofollow",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

function authProviderFromUserId(userId: string): "github" | "google" | "kakao" | "naver" | "email" | null {
  if (userId.startsWith("gh:")) return "github";
  if (userId.startsWith("google:")) return "google";
  if (userId.startsWith("kakao:")) return "kakao";
  if (userId.startsWith("naver:")) return "naver";
  if (userId.startsWith("email:")) return "email";
  return null;
}

async function githubFeatureToken(env: Env, userId: string): Promise<string | null> {
  if (!isLoggedIn(userId)) return null;
  try {
    return await getUserToken(env, userId);
  } catch {
    return null;
  }
}

async function effectiveAuthProvider(env: Env, userId: string): Promise<"github" | "google" | "kakao" | "naver" | "email" | null> {
  if (!isLoggedIn(userId)) return authProviderFromUserId(userId);
  const github = await env.DB.prepare(
    "SELECT 1 AS linked FROM user_identities WHERE user_id=? AND provider='github' LIMIT 1"
  ).bind(userId).first<{ linked: number }>();
  return github ? "github" : authProviderFromUserId(userId);
}

async function cookieSessionIdentity(
  request: Request,
  env: Env,
): Promise<{ userId: string; login?: string } | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  if (!cookies.sid || !env.JWT_SECRET) return null;
  const payload = await verifyJWT(cookies.sid, env.JWT_SECRET);
  return payload?.sub ? { userId: String(payload.sub), login: payload.login } : null;
}

async function identify(
  request: Request,
  env: Env,
  options: { allowOtherAuthorization?: boolean } = {},
): Promise<{ userId: string; setCookie?: string; login?: string }> {
  const bearer = await authenticateMobileBearer(request, env, !!options.allowOtherAuthorization);
  if (bearer) return { userId: bearer.userId };
  const cookies = parseCookies(request.headers.get("cookie"));
  const session = await cookieSessionIdentity(request, env);
  if (session) return session;
  if (cookies.aid) return { userId: `anon:${cookies.aid}` };
  const aid = crypto.randomUUID();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return { userId: `anon:${aid}`, setCookie: `aid=${aid}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=31536000` };
}

const MOBILE_API_ORIGINS = new Set([
  "capacitor://localhost",
  "https://localhost",
]);
const MOBILE_API_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const MOBILE_API_HEADERS = "authorization, content-type";
const MOBILE_API_HEADER_SET = new Set(MOBILE_API_HEADERS.split(", "));

function mobileCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && MOBILE_API_ORIGINS.has(origin) ? origin : null;
}

function withMobileCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("vary", headers.get("vary") ? `${headers.get("vary")}, Origin` : "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function routeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (isProtectedGardenPage(path)) {
      const { userId, setCookie } = await identify(request, env);
      if (!isLoggedIn(userId)) return loginRedirect(request, setCookie);
      return env.ASSETS.fetch(request);
    }
    if (isProtectedStudioPage(path)) {
      const { userId, setCookie } = await identify(request, env);
      if (!isLoggedIn(userId)) return loginRedirect(request, setCookie);
      return env.ASSETS.fetch(request);
    }
    if (isProtectedNBlogPage(path)) {
      const { userId, setCookie } = await identify(request, env);
      if (!isLoggedIn(userId)) return loginRedirect(request, setCookie);
      return env.ASSETS.fetch(request);
    }
    if (isProtectedAnalysisPage(path)) {
      const { userId, setCookie } = await identify(request, env);
      if (!isLoggedIn(userId)) return loginRedirect(request, setCookie);
      return env.ASSETS.fetch(request);
    }
    if (isProtectedAnalysisFragment(path)) {
      const { userId, setCookie } = await identify(request, env);
      if (!isLoggedIn(userId)) {
        const response = new Response("login required", {
          status: 401,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex, nofollow",
          },
        });
        if (setCookie) response.headers.append("set-cookie", setCookie);
        return response;
      }
      return env.ASSETS.fetch(request);
    }
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (
      path === "/api/connected-apps/auto-media/readiness" &&
      request.method === "GET"
    ) {
      const ready =
        env.AUTO_MEDIA_NAV_ENABLED === "true" &&
        env.CONNECTED_APP_AUTH_ENABLED === "true";
      return json({
        ready,
        ...(ready
          ? { href: "https://auto-media.kibayerin.workers.dev/" }
          : {}),
      });
    }

    if (path === "/api/analytics/config" && request.method === "GET") {
      return json(analyticsConfig(env));
    }


    if (path.startsWith("/api/nblog/uploads/")) {
      try {
        const response = await handleNBlogUpload(request, env);
        if (response) return withNBlogResponseHeaders(response, request);
      } catch (error) {
        return nblogErrorResponse(error, request);
      }
    }

    if (path.startsWith("/api/nblog/handoff-sessions/")) {
      try {
        const response = await handleNBlogHandoffSessionApi(request, env);
        if (response) return withNBlogResponseHeaders(response, request);
      } catch (error) {
        return nblogErrorResponse(error, request);
      }
    }

    // 인증(리다이렉트 응답)
    if (path === "/api/auth/github") return startGithubLogin(request, env);
    if (path === "/api/auth/github/link") return await startGithubAccountLink(request, env);
    if (path === "/api/auth/callback") return handleGithubCallback(request, env);
    if (path === "/api/auth/google") return startGoogleLogin(request, env);
    if (path === "/api/auth/google/link") return await startGoogleAccountLink(request, env);
    if (path === "/api/auth/google/callback") return handleGoogleCallback(request, env);
    if (path === "/api/auth/kakao") return startKakaoLogin(request, env);
    if (path === "/api/auth/kakao/link") return await startKakaoAccountLink(request, env);
    if (path === "/api/auth/kakao/callback") return handleKakaoCallback(request, env);
    if (path === "/api/auth/naver") return startNaverLogin(request, env);
    if (path === "/api/auth/naver/link") return await startNaverAccountLink(request, env);
    if (path === "/api/auth/naver/callback") return handleNaverCallback(request, env);
    if (path === "/api/auth/email/register" && request.method === "POST") {
      try {
        return await registerEmail(request, env);
      } catch (err: any) {
        return json({ error: err?.message || "email register failed", retry_after_seconds: err?.retry_after_seconds }, { status: typeof err?.status === "number" ? err.status : 500 });
      }
    }
    if (path === "/api/auth/email/login" && request.method === "POST") {
      try {
        return await loginEmail(request, env);
      } catch (err: any) {
        return json({ error: err?.message || "email login failed", retry_after_seconds: err?.retry_after_seconds }, { status: typeof err?.status === "number" ? err.status : 500 });
      }
    }
    if (path === "/api/auth/email/verify" && request.method === "POST") {
      try {
        return await verifyEmail(request, env);
      } catch (err: any) {
        return json({ error: err?.message || "email verification failed", retry_after_seconds: err?.retry_after_seconds }, { status: typeof err?.status === "number" ? err.status : 500 });
      }
    }
    if (path === "/api/auth/email/resend-verification" && request.method === "POST") {
      try {
        return await resendVerificationEmail(request, env);
      } catch (err: any) {
        return json({ error: err?.message || "email verification resend failed", retry_after_seconds: err?.retry_after_seconds }, { status: typeof err?.status === "number" ? err.status : 500 });
      }
    }
    if (path === "/api/auth/email/reset/request" && request.method === "POST") {
      try {
        return await requestPasswordReset(request, env);
      } catch (err: any) {
        return json({ error: err?.message || "password reset request failed", retry_after_seconds: err?.retry_after_seconds }, { status: typeof err?.status === "number" ? err.status : 500 });
      }
    }
    if (path === "/api/auth/email/reset/confirm" && request.method === "POST") {
      try {
        return await confirmPasswordReset(request, env);
      } catch (err: any) {
        return json({ error: err?.message || "password reset failed", retry_after_seconds: err?.retry_after_seconds }, { status: typeof err?.status === "number" ? err.status : 500 });
      }
    }
    if (path === "/api/auth/logout") return logout();

    try {
      if (path.startsWith("/api/auth/connected-app/")) assertConnectedAppAuthEnabled(env);
      if (path === "/api/auth/connected-app/authorize") {
        if (request.method !== "GET") {
          return json({ error: "method not allowed", code: "method_not_allowed" }, {
            status: 405,
            headers: { allow: "GET" },
          });
        }
        const identity = await cookieSessionIdentity(request, env);
        return await handleConnectedAppAuthorize(
          request,
          env,
          identity && isLoggedIn(identity.userId) ? identity.userId : null,
        );
      }
      if (path === "/api/auth/connected-app/authorize/resume") {
        if (request.method !== "GET") {
          return json({ error: "method not allowed", code: "method_not_allowed" }, {
            status: 405,
            headers: { allow: "GET" },
          });
        }
        const identity = await cookieSessionIdentity(request, env);
        return await handleConnectedAppAuthorizeResume(
          request,
          env,
          identity && isLoggedIn(identity.userId) ? identity.userId : null,
        );
      }
      if (path === "/api/auth/connected-app/token") {
        if (request.method !== "POST") {
          return json({ error: "method not allowed", code: "method_not_allowed" }, {
            status: 405,
            headers: { allow: "POST" },
          });
        }
        return json(await handleConnectedAppTokenRequest(request, env));
      }
      if (path.startsWith("/api/auth/mobile/")) assertMobileAuthEnabled(env);
      if (path === "/api/health") return json({ ok: true, time: new Date().toISOString() });

      if (path === "/api/auth/mobile/token" && request.method === "POST") {
        return json(await handleMobileTokenRequest(request, env));
      }
      if (path === "/api/auth/mobile/revoke" && request.method === "POST") {
        return json(await handleMobileRevokeRequest(request, env));
      }
      if (path === "/api/auth/mobile/code" && request.method === "POST") {
        // Authorization-code issuance is an interactive browser-session step.
        // Never let a short-lived mobile access token mint a fresh refresh family.
        const identity = await cookieSessionIdentity(request, env);
        if (!identity || !isLoggedIn(identity.userId)) {
          return json({ error: "login required", code: "login_required" }, { status: 401 });
        }
        const body = await readMobileAuthJson(request);
        await enforceMobileAuthRateLimits(env, request, "code_issue", `user:${identity.userId}`);
        return json(await issueMobileAuthorizationCode(env, identity.userId, body));
      }
      if (path === "/api/auth/mobile/code/cancel" && request.method === "POST") {
        const identity = await cookieSessionIdentity(request, env);
        if (!identity || !isLoggedIn(identity.userId)) {
          return json({ error: "login required", code: "login_required" }, { status: 401 });
        }
        return json(await cancelMobileAuthorizationCode(env, identity.userId, await readMobileAuthJson(request)));
      }

      const allowOtherAuthorization = path === "/api/campaigns"
        || path.startsWith("/api/campaigns/")
        || path.startsWith("/api/nblog/")
        || path.startsWith("/api/proxy/")
        || path.startsWith("/api/garden-runner/")
        || /^\/api\/gardens\/[\w-]+\/builds\/[\w-]+\/callback$/.test(path);
      const { userId, setCookie, login } = await identify(request, env, { allowOtherAuthorization });
      const withCookie = (r: Response) => { if (setCookie) r.headers.append("set-cookie", setCookie); return r; };
      const requireLogin = () => isLoggedIn(userId) ? null : json({ error: "login required" }, { status: 401 });
      const studioPageMatch = path.match(/^\/api\/studio\/pages\/([\w-]+)$/);
      if (studioPageMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);

        const studioPayload = await getStudioPagePayload(env, studioPageMatch[1]);
        if (!studioPayload) return withCookie(json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 }));
        return withCookie(json(studioPayload));
      }
      const requireGithubFeature = async (): Promise<{ token: string } | { response: Response }> => {
        const token = await githubFeatureToken(env, userId);
        if (!token) return { response: json({ error: "not found" }, { status: 404 }) };
        return { token };
      };

      if (path === "/api/ai-sdui/validate") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        if (request.method !== "POST") {
          return withCookie(json({ error: "method not allowed" }, { status: 405, headers: { allow: "POST" } }));
        }
        return withCookie(await handleAiSduiValidate(request, env, userId));
      }

      const aiSduiApprovalMatch = path.match(/^\/api\/ai-sdui\/approval-jobs\/([^/]{1,384})\/approve$/);
      if (aiSduiApprovalMatch) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        if (request.method !== "POST") {
          return withCookie(json({ error: "method not allowed" }, { status: 405, headers: { allow: "POST" } }));
        }
        let jobId: string;
        try {
          jobId = decodeURIComponent(aiSduiApprovalMatch[1]);
        } catch {
          return withCookie(json({ ok: false, error: { code: "approval_job_not_found", stage: "approval", message: "Approval job was not found." } }, { status: 404 }));
        }
        return withCookie(await handleAiSduiApprove(request, env, userId, jobId));
      }

      if (path === "/api/campaigns" || path.startsWith("/api/campaigns/") || path.startsWith("/api/nblog/")) {
        try {
          const tokenActor = await authenticateNBlogBearer(request, env);
          if (!tokenActor && !isLoggedIn(userId)) {
            return withCookie(withNBlogResponseHeaders(json({
              contract_version: "1.0",
              error: { code: "login_required", message: "NBlog 운영 화면 로그인이 필요합니다.", retryable: false, resume_point: null },
            }, { status: 401 }), request));
          }
          const response = await handleNBlogApi(request, env, tokenActor || { userId, label: login || userId, viaToken: false });
          if (response) return withCookie(withNBlogResponseHeaders(response, request));
        } catch (error) {
          return withCookie(nblogErrorResponse(error, request));
        }
      }

      // credential/sync 하위 경로는 agentSubscriptions가 404로 종결시키기 전에 먼저 처리한다.
      const agentAdapterResponse = await handleAgentUsageAdapterRequest(request, env, userId);
      if (agentAdapterResponse) return withCookie(agentAdapterResponse);

      const agentSubscriptionsResponse = await handleAgentSubscriptionsRequest(request, env, userId);
      if (agentSubscriptionsResponse) return withCookie(agentSubscriptionsResponse);

      if (path === "/api/me" && request.method === "GET") {
        const provider = await effectiveAuthProvider(env, userId);
        const githubEnabled = !!(await githubFeatureToken(env, userId));
        const identitySummary = isLoggedIn(userId)
          ? await getIdentitySummary(env, userId)
          : { identities: [], email_login_available: false };
        const connectedProviders = identitySummary.identities.map((row) => row.provider);
        const githubLogin = identitySummary.identities.find((row) => row.provider === "github")?.display_name;
        const canonicalLogin = githubLogin || login || null;
        return withCookie(json({
          userId,
          login: canonicalLogin,
          provider,
          loggedIn: isLoggedIn(userId),
          github_enabled: githubEnabled,
          connected_providers: connectedProviders,
          identities: identitySummary.identities,
          email_login_available: identitySummary.email_login_available,
        }));
      }

      const identityUnlinkMatch = path.match(/^\/api\/auth\/identities\/([\w-]+)$/);
      if (identityUnlinkMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await unlinkIdentity(env, request, userId, identityUnlinkMatch[1])));
        } catch (err) {
          if (err instanceof IdentityUnlinkError) {
            return withCookie(json({ ok: false, error: err.message, message: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const studioMatch = path.match(/^\/api\/projects\/([^/]+)\/(manifest|versions|deployments)$/);
      if (studioMatch) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const projectId = decodeURIComponent(studioMatch[1]);
        const action = studioMatch[2];
        const actor = login || userId;
        const now = new Date().toISOString();
        const response = (data: unknown, init?: ResponseInit) => withCookie(json(data, init));
        const getProject = () => env.DB.prepare("SELECT current_version, manifest_json, updated_at, updated_by FROM studio_projects WHERE user_id = ?1 AND project_id = ?2").bind(userId, projectId).first<{ current_version: number; manifest_json: string; updated_at: string; updated_by: string }>();

        if (action === "manifest" && request.method === "GET") {
          const row = await getProject();
          return row ? response({ ok: true, projectId, version: row.current_version, manifest: JSON.parse(row.manifest_json), updatedAt: row.updated_at, updatedBy: row.updated_by }) : response({ ok: false, error: { message: "저장된 프로젝트가 없습니다." } }, { status: 404 });
        }
        if (action === "manifest" && request.method === "PUT") {
          const input = await request.json() as { manifest?: unknown; expectedVersion?: number; label?: string };
          if (!input.manifest || typeof input.manifest !== "object") return response({ ok: false, error: { message: "저장할 화면 데이터가 올바르지 않습니다." } }, { status: 400 });
          const existing = await getProject();
          const currentVersion = existing?.current_version || 0;
          if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== currentVersion) return response({ ok: false, error: { message: "다른 변경사항이 먼저 저장되었습니다. 최신 버전을 불러온 뒤 다시 시도하세요." } }, { status: 409 });
          const version = currentVersion + 1;
          const manifest = JSON.stringify(input.manifest);
          const label = String(input.label || `Version ${version}`).slice(0, 200);
          await env.DB.batch([
            env.DB.prepare("INSERT INTO studio_projects (user_id, project_id, current_version, manifest_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(user_id, project_id) DO UPDATE SET current_version = excluded.current_version, manifest_json = excluded.manifest_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(userId, projectId, version, manifest, now, actor),
            env.DB.prepare("INSERT INTO studio_project_versions (user_id, project_id, version, label, manifest_json, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(userId, projectId, version, label, manifest, now, actor),
          ]);
          return response({ ok: true, projectId, version, manifest: input.manifest, updatedAt: now, updatedBy: actor, label });
        }
        if (action === "versions" && request.method === "GET") {
          const rows = await env.DB.prepare("SELECT version, label, created_at, created_by FROM studio_project_versions WHERE user_id = ?1 AND project_id = ?2 ORDER BY version DESC").bind(userId, projectId).all<{ version: number; label: string; created_at: string; created_by: string }>();
          const versions = (rows.results || []).map((row) => ({ projectId, version: row.version, label: row.label, updatedAt: row.created_at, updatedBy: row.created_by }));
          return response({ ok: true, versions, total: versions.length, page: 1, pageSize: versions.length || 5 });
        }
        if (action === "deployments" && request.method === "POST") {
          const input = await request.json() as { pageId?: string; slug?: string; manifestVersion?: number };
          const pageId = String(input.pageId || "default");
          const slug = String(input.slug || pageId).trim();
          if (!/^[a-z0-9][a-z0-9-]{0,79}$/i.test(slug)) return response({ ok: false, error: { message: "URL 이름은 영문, 숫자, 하이픈만 사용할 수 있습니다." } }, { status: 400 });
          const version = await env.DB.prepare("SELECT manifest_json FROM studio_project_versions WHERE user_id = ?1 AND project_id = ?2 AND version = ?3").bind(userId, projectId, Number(input.manifestVersion)).first<{ manifest_json: string }>();
          if (!version) return response({ ok: false, error: { message: "배포할 저장 버전을 찾을 수 없습니다." } }, { status: 404 });
          const latest = await env.DB.prepare("SELECT MAX(release_version) AS release_version FROM studio_releases WHERE user_id = ?1 AND project_id = ?2 AND page_id = ?3 AND slug = ?4").bind(userId, projectId, pageId, slug).first<{ release_version: number | null }>();
          const releaseVersion = Number(latest?.release_version || 0) + 1;
          await env.DB.prepare("INSERT INTO studio_releases (user_id, project_id, page_id, slug, release_version, manifest_version, manifest_json, published_at, published_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(userId, projectId, pageId, slug, releaseVersion, Number(input.manifestVersion), version.manifest_json, now, actor).run();
          return response({ ok: true, projectId, pageId, slug, releaseVersion, manifestVersion: Number(input.manifestVersion), publishedAt: now, publishedBy: actor });
        }
      }

      if (path === "/api/integrations/status" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await getIntegrationStatus(env, userId)));
      }

      if (path === "/api/integrations/google/calendar/connect" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(startGoogleCalendarConnect(request, env));
      }

      if (path === "/api/integrations/kakao/message/connect" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(startKakaoMessageConnect(request, env));
      }

      if (path === "/api/integrations/google/calendar/events" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createGoogleCalendarEvent(env, userId, body)));
      }

      if (path === "/api/integrations/kakao/message/test" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await sendKakaoScheduleMessage(env, userId, body)));
      }

      if (path === "/api/integrations/kakao/message/reminders" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await scheduleKakaoReminderJobs(env, userId, body)));
      }

      if (path === "/api/integrations/google/calendar" && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await disconnectIntegration(env, userId, "google_calendar")));
      }

      if (path === "/api/integrations/kakao/message" && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await disconnectIntegration(env, userId, "kakao_message")));
      }

      const uiMatch = path.match(/^\/api\/ui\/([a-z0-9_-]+)$/i);
      if (uiMatch && request.method === "GET") {
        if ((uiMatch[1] === "analysis" || uiMatch[1] === "analysis-edit") && !isLoggedIn(userId))
          return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const result = await getUiPage(env, uiMatch[1], isLoggedIn(userId), await effectiveAuthProvider(env, userId));
        if ("error" in result) return withCookie(json({ error: result.error }, { status: result.status }));
        return withCookie(json(result));
      }

      if (path === "/api/dev-setup/catalog" && request.method === "GET")
        return withCookie(json({ tools: getDevSetupCatalog() }));

      if (path === "/api/dev-setup/preview" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return withCookie(json(buildDevSetupPreview((body as { tools?: unknown }).tools)));
      }

      if (path === "/api/dev-setup/script" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const script = buildDevSetupScript((body as { tools?: unknown }).tools);
        return withCookie(new Response(`\uFEFF${script}`, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="dev-setup.ps1"',
            "cache-control": "no-store",
          },
        }));
      }

      if (path === "/api/quick-log/overview" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await getQuickLogOverview(env, userId, url.searchParams.get("date"))));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/buttons" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await getQuickLogButtons(env, userId)));
      }

      if (path === "/api/quick-log/buttons" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await createQuickLogButton(env, userId, body)));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const quickLogButtonMatch = path.match(/^\/api\/quick-log\/buttons\/([\w-]+)$/);
      if (quickLogButtonMatch && request.method === "PATCH") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await updateQuickLogButton(env, userId, quickLogButtonMatch[1], body)));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }
      if (quickLogButtonMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await deleteQuickLogButton(env, userId, quickLogButtonMatch[1])));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/logs" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await createQuickLogEntry(env, userId, body)));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const quickLogRestoreMatch = path.match(/^\/api\/quick-log\/logs\/([\w-]+)\/restore$/);
      if (quickLogRestoreMatch && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await restoreQuickLogEntry(env, userId, quickLogRestoreMatch[1])));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const quickLogLogMatch = path.match(/^\/api\/quick-log\/logs\/([\w-]+)$/);
      if (quickLogLogMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await deleteQuickLogEntry(env, userId, quickLogLogMatch[1])));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/photos" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await uploadQuickLogPhoto(env, userId, request)));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/photos" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(await getQuickLogPhoto(env, userId, url.searchParams.get("key") || ""));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/history" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        try {
          return withCookie(json(await getQuickLogHistory(env, userId, from, to)));
        } catch (err) {
          if (err instanceof QuickLogError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/reminder" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await getQuickLogReminder(env, userId)));
        } catch (err) {
          if (err instanceof QuickLogReminderError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/quick-log/reminder" && request.method === "PUT") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await upsertQuickLogReminder(env, userId, body)));
        } catch (err) {
          if (err instanceof QuickLogReminderError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const gardenRunnerCallbackMatch = path.match(/^\/api\/gardens\/([\w-]+)\/builds\/([\w-]+)\/callback$/);
      if (gardenRunnerCallbackMatch && request.method === "POST") {
        return withCookie(json(await updateGardenBuildFromRunner(env, request, gardenRunnerCallbackMatch[1], gardenRunnerCallbackMatch[2])));
      }

      if (path === "/api/garden-runner/builds/next" && request.method === "POST") {
        return withCookie(json(await claimNextGardenBuild(env, request)));
      }

      const gardenRunnerArtifactMatch = path.match(/^\/api\/garden-runner\/gardens\/([\w-]+)\/builds\/([\w-]+)\/artifact$/);
      if (gardenRunnerArtifactMatch && request.method === "GET") {
        return withCookie(await gardenRunnerArtifactResponse(env, request, gardenRunnerArtifactMatch[1], gardenRunnerArtifactMatch[2], url.searchParams.get("file")));
      }

      const gardenOrganizationsMatch = path.match(/^\/api\/gardens\/([\w-]+)\/organizations(?:\/([\w-]+))?$/);
      if (gardenOrganizationsMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await listGardenOrganizations(env, userId, gardenOrganizationsMatch[1])));
      }
      if (gardenOrganizationsMatch && request.method === "POST" && !gardenOrganizationsMatch[2]) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        const orgId = typeof body === "object" && body && !Array.isArray(body) ? String((body as Record<string, unknown>).org_id || "").trim() : "";
        if (!orgId) return withCookie(json({ error: "org_id가 필요합니다.", code: "org_id_required" }, { status: 400 }));
        return withCookie(json(await linkGardenToOrganization(env, userId, orgId, gardenOrganizationsMatch[1])));
      }
      if (gardenOrganizationsMatch && request.method === "DELETE" && gardenOrganizationsMatch[2]) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await unlinkGardenFromOrganization(env, userId, gardenOrganizationsMatch[2], gardenOrganizationsMatch[1])));
      }

      // 공개 쇼케이스: 로그인 없이 읽는다. 아래 /api/gardens/:id 보다 먼저 와야 "public" 이 id 로 잡히지 않는다.
      if (path === "/api/gardens/public" && request.method === "GET") {
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
        return withCookie(json(await listPublicGardens(env, limit), { headers: { "cache-control": "public, max-age=30" } }));
      }

      if (path === "/api/gardens" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        return withCookie(json(await listGardens(env, userId, limit)));
      }

      if (path === "/api/gardens" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await saveGarden(env, userId, body)));
      }

      const gardenLogoMatch = path.match(/^\/api\/gardens\/([\w-]+)\/logo$/);
      if (gardenLogoMatch && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await saveGardenLogoFromRequest(env, userId, gardenLogoMatch[1], request)));
      }
      if (gardenLogoMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(await getGardenLogoResponse(env, userId, gardenLogoMatch[1]));
      }
      if (gardenLogoMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await deleteGardenLogo(env, userId, gardenLogoMatch[1])));
      }

      const gardenConfigMatch = path.match(/^\/api\/gardens\/([\w-]+)\/config\.ya?ml$/);
      if (gardenConfigMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(await gardenConfigResponse(env, userId, gardenConfigMatch[1]));
      }

      const gardenBuildsMatch = path.match(/^\/api\/gardens\/([\w-]+)\/builds$/);
      if (gardenBuildsMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
        return withCookie(json(await listGardenBuilds(env, userId, gardenBuildsMatch[1], limit)));
      }

      const gardenBuildArtifactMatch = path.match(/^\/api\/gardens\/([\w-]+)\/builds\/([\w-]+)\/artifact$/);
      if (gardenBuildArtifactMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(await gardenBuildArtifactResponse(env, userId, gardenBuildArtifactMatch[1], gardenBuildArtifactMatch[2], url.searchParams.get("file")));
      }

      const gardenBuildMatch = path.match(/^\/api\/gardens\/([\w-]+)\/build$/);
      if (gardenBuildMatch && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await createGardenBuild(env, userId, gardenBuildMatch[1], url.searchParams.get("force") === "true")));
      }

      const gardenMatch = path.match(/^\/api\/gardens\/([\w-]+)$/);
      if (gardenMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await getGarden(env, userId, gardenMatch[1])));
      }

      if (gardenMatch && (request.method === "PUT" || request.method === "PATCH")) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await saveGarden(env, userId, body, gardenMatch[1])));
      }

      const gardenBuildDeleteMatch = path.match(/^\/api\/gardens\/([\w-]+)\/builds\/([\w-]+)$/);
      if (gardenBuildDeleteMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await deleteGardenBuild(env, userId, gardenBuildDeleteMatch[1], gardenBuildDeleteMatch[2])));
      }
      if (gardenMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await deleteGarden(env, userId, gardenMatch[1])));
      }

      if (path === "/api/stt/clova" && request.method === "POST") {
        try {
          return withCookie(json(await transcribeClova(env, request)));
        } catch (err) {
          if (err instanceof SttError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/me/clova/recordings" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const limit = Number(url.searchParams.get("limit")) || 20;
        return withCookie(json(await listClovaRecordings(env, userId, limit)));
      }

      if (path === "/api/me/clova/recordings/import" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await importClovaRecording(env, userId, request)));
        } catch (err) {
          if (err instanceof SttError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          if (err instanceof ClovaRecordingError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const clovaRecordingMatch = path.match(/^\/api\/me\/clova\/recordings\/([\w-]+)$/);
      if (clovaRecordingMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json({ recording: await getClovaRecording(env, userId, clovaRecordingMatch[1]) }));
        } catch (err) {
          if (err instanceof ClovaRecordingError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/kanban/boards" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const limit = Number(url.searchParams.get("limit")) || 50;
        return withCookie(json(await listKanbanBoards(env, userId, limit)));
      }

      if (path === "/api/schedule/sources" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await listScheduleSources(env, userId)));
      }

      if (path === "/api/schedule/sources" && request.method === "PUT") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await replaceScheduleSources(env, userId, await request.json().catch(() => ({})))));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/schedule/sessions" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await listScheduleSessions(env, userId, url)));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/schedule/sessions" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(
            await createScheduleSession(env, userId, await request.json().catch(() => ({}))),
            { status: 201 },
          ));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const scheduleSessionReportMatch = path.match(/^\/api\/schedule\/sessions\/([^/]+)\/report$/);
      if (scheduleSessionReportMatch && request.method === "PUT") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await upsertScheduleSessionReport(
            env,
            userId,
            scheduleSessionReportMatch[1],
            await request.json().catch(() => ({})),
          )));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const scheduleSessionEntriesMatch = path.match(/^\/api\/schedule\/sessions\/([^/]+)\/entries$/);
      if (scheduleSessionEntriesMatch && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          const result = await enterScheduleSession(env, userId, scheduleSessionEntriesMatch[1]);
          return withCookie(json(result, { status: result.created ? 201 : 200 }));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const scheduleSessionEntryMatch = path.match(
        /^\/api\/schedule\/sessions\/([^/]+)\/entries\/([^/]+)$/,
      );
      if (scheduleSessionEntryMatch && request.method === "PATCH") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await leaveScheduleSession(
            env,
            userId,
            scheduleSessionEntryMatch[1],
            scheduleSessionEntryMatch[2],
          )));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const scheduleSessionMatch = path.match(/^\/api\/schedule\/sessions\/([^/]+)$/);
      if (scheduleSessionMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await getScheduleSession(env, userId, scheduleSessionMatch[1])));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (scheduleSessionMatch && request.method === "PATCH") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await updateScheduleSession(
            env,
            userId,
            scheduleSessionMatch[1],
            await request.json().catch(() => ({})),
          )));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (scheduleSessionMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await updateScheduleSession(
            env,
            userId,
            scheduleSessionMatch[1],
            { status: "canceled" },
          )));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/schedule/github-items" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await listScheduleGithubItems(env, userId)));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/schedule/github-items" && request.method === "PATCH") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await updateScheduleGithubItem(env, userId, await request.json().catch(() => ({})))));
        } catch (err) {
          if (err instanceof ScheduleSessionError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/kanban/cards" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await listKanbanCards(env, userId, url)));
      }

      if (path === "/api/kanban/cards/from-meeting" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await createKanbanCardsFromMeeting(env, userId, body)));
        } catch (err) {
          if (err instanceof KanbanError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      const kanbanCardMatch = path.match(/^\/api\/kanban\/cards\/([\w-]+)$/);
      if (kanbanCardMatch && request.method === "PATCH") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await updateKanbanCard(env, userId, kanbanCardMatch[1], body)));
        } catch (err) {
          if (err instanceof KanbanError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (kanbanCardMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        try {
          return withCookie(json(await deleteKanbanCard(env, userId, kanbanCardMatch[1])));
        } catch (err) {
          if (err instanceof KanbanError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/usage" && request.method === "GET") {
        const [overview, alerts] = await Promise.all([
          getUsageBudgetOverview(env, userId),
          listUsageAlerts(env, userId, 7),
        ]);
        return withCookie(json({ ...overview, alerts }));
      }

      if (path === "/api/usage/reset" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const overview = await resetUsageBudget(env, userId);
        return withCookie(json({ ...overview, alerts: await listUsageAlerts(env, userId, 7) }));
      }

      if (path === "/api/usage/series" && request.method === "GET") {
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));
        return withCookie(json(await getSeries(env, userId, days)));
      }

      if (path === "/api/usage/breakdown" && request.method === "GET") {
        const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || 30));
        return withCookie(json(await getUsageBreakdown(env, userId, days)));
      }

      if (path === "/api/usage/cost-dashboard" && request.method === "GET") {
        return withCookie(json(await getCostDashboard(env, userId, url.searchParams.get("period"))));
      }

      if (path === "/api/usage/subjects" && request.method === "GET") {
        const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || 30));
        return withCookie(json(await getUsageSubjects(env, userId, days)));
      }

      if (path === "/api/usage/requests" && request.method === "GET") {
        const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || 30));
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        return withCookie(json(await getUsageRequests(env, userId, days, limit)));
      }

      if (path === "/api/usage/export" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "login required" }, { status: 401 }));
        const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 30));
        const out = await getUsageExportCsv(env, userId, days);
        return withCookie(new Response(`\uFEFF${out.csv}`, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${out.filename}"`,
            "cache-control": "no-store",
          },
        }));
      }

      if (path === "/api/usage/limits" && request.method === "GET") {
        const settings = await getUsageLimitSettings(env, userId);
        const q = await checkQuota(env, userId);
        return withCookie(json({ ...settings, used_krw: q.used, remaining_krw: q.remaining, warning: q.warning }));
      }

      if (path === "/api/usage/limits" && request.method === "PUT") {
        const body = await request.json().catch(() => ({}));
        const settings = await saveUsageLimitSettings(env, userId, body);
        const q = await checkQuota(env, userId);
        return withCookie(json({ ...settings, used_krw: q.used, remaining_krw: q.remaining, warning: q.warning }));
      }

      if (path === "/api/usage/alerts" && request.method === "GET") {
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));
        return withCookie(json({ alerts: await listUsageAlerts(env, userId, days) }));
      }

      if (path === "/api/orgs" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await listOrganizations(env, userId)));
      }

      if (path === "/api/orgs" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createOrganization(env, userId, body)));
      }

      const orgGardensMatch = path.match(/^\/api\/orgs\/([\w-]+)\/gardens$/);
      if (orgGardensMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await listOrganizationGardens(env, userId, orgGardensMatch[1])));
      }

      const orgInviteAcceptMatch = path.match(/^\/api\/org-invites\/([\w-]+)\/accept$/);
      if (orgInviteAcceptMatch && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await acceptOrganizationInvite(env, userId, orgInviteAcceptMatch[1])));
      }

      const orgUsageMatch = path.match(/^\/api\/orgs\/([\w-]+)\/usage$/);
      if (orgUsageMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await getOrganizationUsage(env, userId, orgUsageMatch[1], url.searchParams.get("period"))));
      }

      const orgUsageExportMatch = path.match(/^\/api\/orgs\/([\w-]+)\/usage\/export$/);
      if (orgUsageExportMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "login required" }, { status: 401 }));
        const out = await getOrganizationUsageExportCsv(env, userId, orgUsageExportMatch[1], url.searchParams.get("period"), url.searchParams.get("raw") === "1");
        const sheetData: SheetData = [
          out.header.map((value) => ({ value, fontWeight: "bold", color: "#FFFFFF", backgroundColor: "#3655E9" })),
          ...out.rows,
        ];
        const columns = out.header.map((_, index) => ({
          width: Math.min(42, Math.max(12, ...[out.header[index], ...out.rows.slice(0, 500).map((row) => row[index])]
            .map((value) => String(value ?? "").length + 2))),
        }));
        const xlsx = await writeXlsxFile(sheetData, {
          sheet: "조직 사용량",
          stickyRowsCount: 1,
          columns,
        }).toBlob();
        return withCookie(new Response(xlsx, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${out.filename}"`,
            "cache-control": "no-store",
          },
        }));
      }

      const orgSettingsMatch = path.match(/^\/api\/orgs\/([\w-]+)\/settings$/);
      if (orgSettingsMatch && request.method === "PUT") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "login required" }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await saveOrganizationSettings(env, userId, orgSettingsMatch[1], body)));
      }

      const orgAuditMatch = path.match(/^\/api\/orgs\/([\w-]+)\/audit-logs$/);
      if (orgAuditMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "login required" }, { status: 401 }));
        return withCookie(json(await getOrganizationAuditLogs(env, userId, orgAuditMatch[1])));
      }

      const orgInvitesMatch = path.match(/^\/api\/orgs\/([\w-]+)\/invites$/);
      if (orgInvitesMatch && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await inviteOrganizationMember(env, userId, orgInvitesMatch[1], body)));
      }

      const orgMemberMatch = path.match(/^\/api\/orgs\/([\w-]+)\/members\/([^/]+)$/);
      if (orgMemberMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const memberUserId = decodeURIComponent(orgMemberMatch[2]);
        if (request.method === "DELETE")
          return withCookie(json(await removeOrganizationMember(env, userId, orgMemberMatch[1], memberUserId)));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await updateOrganizationMember(env, userId, orgMemberMatch[1], memberUserId, body)));
      }

      const orgMatch = path.match(/^\/api\/orgs\/([\w-]+)$/);
      if (orgMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await getOrganizationDetail(env, userId, orgMatch[1])));
      }

      const anthropicProxyMatch = path.match(/^\/api\/proxy\/anthropic\/(.+)$/);
      if (anthropicProxyMatch) return withCookie(await handleProxyGateway(env, request, "anthropic", anthropicProxyMatch[1], ctx));

      const openaiProxyMatch = path.match(/^\/api\/proxy\/openai\/(.+)$/);
      if (openaiProxyMatch) return withCookie(await handleProxyGateway(env, request, "openai", openaiProxyMatch[1], ctx));

      const geminiProxyMatch = path.match(/^\/api\/proxy\/gemini\/(.+)$/);
      if (geminiProxyMatch) return withCookie(await handleProxyGateway(env, request, "gemini", geminiProxyMatch[1], ctx));

      if (path === "/api/proxy/devices" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await listProxyDevices(env, userId)));
      }

      if (path === "/api/proxy/devices" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createProxyDevice(env, userId, body)));
      }

      const proxyDeviceMatch = path.match(/^\/api\/proxy\/devices\/([\w-]+)$/);
      if (proxyDeviceMatch && request.method === "DELETE") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await revokeProxyDevice(env, userId, proxyDeviceMatch[1])));
      }

      if (path === "/api/proxy/device-codes" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createDeviceRegistrationCode(env, userId, body)));
      }

      const proxyCodeMatch = path.match(/^\/api\/proxy\/device-codes\/([\w-]+)\/claim$/);
      if (proxyCodeMatch && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await claimDeviceRegistrationCode(env, proxyCodeMatch[1], body)));
      }

      if (path === "/api/time-settings" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await getTimeSettings(env, userId)));
      }

      if (path === "/api/time-settings" && request.method === "PUT") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await saveTimeSettings(env, userId, body)));
      }

      if (path === "/api/time-blocks" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (from || to) {
          if (!from || !to) {
            return withCookie(json({ error: "from and to are both required." }, { status: 400 }));
          }
          return withCookie(json(await listTimeBlocksRange(env, userId, from, to)));
        }
        return withCookie(json(await listTimeBlocks(env, userId, url.searchParams.get("date") || "")));
      }

      if (path === "/api/time-blocks" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createTimeBlock(env, userId, body)));
      }

      if (path === "/api/time-block-rules" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await listTimeBlockRules(env, userId)));
      }

      const timeBlockMatch = path.match(/^\/api\/time-blocks\/([\w-]+)$/);
      if (timeBlockMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        // 반복 블록은 ?date= 가 오면 그 날짜만 건너뛰고, 없으면 규칙 전체를 지운다.
        return withCookie(json(await deleteTimeBlock(env, userId, timeBlockMatch[1], url.searchParams.get("date") || undefined)));
      }

      if (path === "/api/content/posts" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        return withCookie(json(await listContentPosts(env, userId, limit, offset)));
      }

      if (path === "/api/content/posts" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createContentPost(env, userId, body)));
      }

      const contentAssetsMatch = path.match(/^\/api\/content\/posts\/([\w-]+)\/assets$/);
      if (contentAssetsMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await listContentAssets(env, userId, contentAssetsMatch[1])));
      }

      if (contentAssetsMatch && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await saveContentAssetsFromRequest(env, userId, contentAssetsMatch[1], request)));
      }

      const contentAssetMatch = path.match(/^\/api\/content\/posts\/([\w-]+)\/assets\/([\w-]+)$/);
      if (contentAssetMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(await getContentAssetResponse(env, userId, contentAssetMatch[1], contentAssetMatch[2]));
      }

      if (contentAssetMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await deleteContentAsset(env, userId, contentAssetMatch[1], contentAssetMatch[2])));
      }

      const contentPostMatch = path.match(/^\/api\/content\/posts\/([\w-]+)$/);
      if (contentPostMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await getContentPost(env, userId, contentPostMatch[1])));
      }

      if (contentPostMatch && (request.method === "PATCH" || request.method === "PUT")) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await updateContentPost(env, userId, contentPostMatch[1], body)));
      }

      if (contentPostMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await deleteContentPost(env, userId, contentPostMatch[1])));
      }

      // 마이페이지 통계: 회의록 + 분석설계 통합 히스토리
      if (path === "/api/ai/evals" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(json(await listEvalDashboard(env, userId)));
      }
      if (path === "/api/ai/evals/cases" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createEvalCase(env, userId, body)));
      }
      if (path === "/api/ai/evals/runs" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        const result = await runEvalCases(env, userId, body);
        if ("error" in result) return withCookie(json(result, { status: result.status || 400 }));
        return withCookie(json(result));
      }
      if (path === "/api/ai/evals/report" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        return withCookie(await evalReportResponse(env, userId, url.searchParams.get("format") || "html"));
      }

      if (path === "/api/history" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const limit = Number(url.searchParams.get("limit")) || 100;
        return withCookie(json(await listHistory(env, userId, limit)));
      }

      const historyMarkMatch = path.match(/^\/api\/history\/(meeting|analysis)\/([\w-]+)$/);
      if (historyMarkMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const result = await getHistoryDetail(env, userId, historyMarkMatch[1], historyMarkMatch[2]);
        if ("error" in result) return withCookie(json({ error: result.error }, { status: result.status || 400 }));
        return withCookie(json(result));
      }
      if (historyMarkMatch && request.method === "PATCH") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        const result = await updateHistoryMark(env, userId, historyMarkMatch[1], historyMarkMatch[2], body);
        if ("error" in result) return withCookie(json({ error: result.error }, { status: result.status || 400 }));
        return withCookie(json(result));
      }
      if (historyMarkMatch && request.method === "DELETE") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const result = await deleteHistoryItem(env, userId, historyMarkMatch[1], historyMarkMatch[2]);
        if ("error" in result) return withCookie(json({ error: result.error }, { status: result.status || 400 }));
        return withCookie(json(result));
      }

      const historyRestoreMatch = path.match(/^\/api\/history\/(meeting|analysis)\/([\w-]+)\/restore$/);
      if (historyRestoreMatch && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const result = await restoreHistoryItem(env, userId, historyRestoreMatch[1], historyRestoreMatch[2]);
        if ("error" in result) return withCookie(json({ error: result.error }, { status: result.status || 400 }));
        return withCookie(json(result));
      }

      // 설정(provider/model/커스텀 프롬프트)
      if (path === "/api/settings" && request.method === "GET")
        return withCookie(json(await settingsForApi(env, userId)));
      if (path === "/api/settings" && request.method === "PUT") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const body = (await request.json()) as any;
        await saveSettings(env, userId, body);
        return withCookie(json(await settingsForApi(env, userId)));
      }

      // 마이페이지 스케줄 카드 피드백 + 자료 등록.
      if (path === "/api/schedule/cards" && request.method === "GET") {
        const github = await requireGithubFeature();
        if ("response" in github) return withCookie(github.response);
        return withCookie(json(await listScheduleCards(env, userId)));
      }
      if (path === "/api/schedule/assets" && request.method === "GET") {
        const github = await requireGithubFeature();
        if ("response" in github) return withCookie(github.response);
        return withCookie(json(await listScheduleAssets(env, userId, url)));
      }
      if (path === "/api/schedule/assets" && request.method === "POST") {
        const github = await requireGithubFeature();
        if ("response" in github) return withCookie(github.response);
        return withCookie(json(await uploadScheduleAssets(env, userId, request)));
      }
      const scheduleAssetMatch = path.match(/^\/api\/schedule\/assets\/([\w-]+)$/);
      if (scheduleAssetMatch && request.method === "GET") {
        const github = await requireGithubFeature();
        if ("response" in github) return withCookie(github.response);
        return withCookie(await getScheduleAsset(env, userId, scheduleAssetMatch[1]));
      }
      if (path === "/api/schedule/feedback" && request.method === "POST") {
        const github = await requireGithubFeature();
        if ("response" in github) return withCookie(github.response);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createScheduleFeedback(env, userId, github.token, body, login)));
      }

      // AI 요약 — provider/model/프롬프트는 서버(사용자 설정)에서 결정. 기본 gemini.
      if (path === "/api/ai/summarize" && request.method === "POST") {
        const body = (await request.json()) as Partial<MeetingMeta>;
        if (!body.transcript?.trim()) return withCookie(json({ error: "전사 텍스트가 비어 있습니다." }, { status: 400 }));
        if (!body.date) return withCookie(json({ error: "회의 날짜는 필수입니다." }, { status: 400 }));

        const q = await checkQuota(env, userId);
        if (!q.allowed)
          return withCookie(json({ error: `오늘 사용 한도(${q.limit}원)를 초과했습니다.`, used_krw: q.used, limit_krw: q.limit, warning: q.warning }, { status: 429 }));

        const savedSettings = await getEffectiveSettings(env, userId, "meeting_summary");
        const settings = savedSettings;
        const meta: MeetingMeta = {
          transcript: body.transcript, date: body.date, time: body.time, attendees: body.attendees, subject: body.subject,
        };
        const summarizeStarted = Date.now();
        const result = await summarize(env, meta, settings);
        const summarizeLatency = Date.now() - summarizeStarted;
        const cost = await logUsage(env, userId, result.provider, result.model, result.inputTokens, result.outputTokens);
        // 실사용(회의록 요약) 1건을 환경별 usage experiment 에 기록. 실패는 요약을 막지 않음.
        // 반환된 run URL 은 회의록 이력에 저장해 마이페이지 상세에서 하이퍼링크로 노출한다.
        let dagshubRunUrl: string | null = null;
        try {
          const dag = await logDagsHubRun(env, {
            experiment: usageExperiment(env),
            source: "usage",
            runName: `${result.provider}/${result.model} · meeting_summary`,
            status: "FINISHED",
            tags: {
              stage: "meeting_summary",
              provider: result.provider,
              model: result.model,
              user_id: userId,
              fallback_from: result.fallbackFrom ?? null,
            },
            params: { stage: "meeting_summary", provider: result.provider, model: result.model },
            metrics: {
              latency_ms: summarizeLatency,
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
              cost_krw: cost,
            },
          });
          dagshubRunUrl = dag.url;
        } catch { /* DagsHub 기록 실패는 무시 */ }

        // 로그인 사용자는 생성 회의록을 R2/D1 에 자동 저장(이력). 저장 실패는 요약을 막지 않음.
        let meetingId: string | undefined;
        if (isLoggedIn(userId)) {
          try {
            const title = body.subject?.trim() ? body.subject.trim() : `${body.date} 회의`;
            const saved = await saveMeeting(env, userId, { title, date: body.date, markdown: result.markdown, dagshubRunUrl });
            meetingId = saved.id;
          } catch { /* 이력 저장 실패는 무시 */ }
        }
        return withCookie(json({
          markdown: result.markdown, provider: result.provider, model: result.model,
          usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
          cost_krw: cost, day_used_krw: q.used + cost, limit_krw: q.limit,
          warn_threshold_krw: q.warnThreshold,
          warning: q.used + cost >= q.limit
            ? { kind: "limit", message: q.blockOnExceed ? "오늘 AI 사용 한도를 초과해 다음 요청부터 차단됩니다." : "오늘 AI 사용 한도를 초과했습니다." }
            : q.used + cost >= q.warnThreshold
              ? { kind: "warning", message: "오늘 AI 사용액이 예산 알림 임계치를 넘었습니다." }
              : q.warning,
          dagshub_run_url: dagshubRunUrl,
          fallback_from: result.fallbackFrom ?? null,
          meeting_id: meetingId ?? null, saved: !!meetingId,
        }));
      }

      // ── 분석설계 Phase 2: R2 파일 업로드 + 분석 AI 엔드포인트 ───────────────
      if (path === "/api/analysis/sessions" && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const limit = Number(url.searchParams.get("limit")) || 20;
        return withCookie(json(await listAnalysisSessions(env, userId, limit)));
      }

      if (path === "/api/analysis/sessions" && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await createAnalysisSession(env, userId, analysisInputFromBody(body))));
      }

      const analysisPipelineMatch = path.match(/^\/api\/analysis\/([\w-]+)\/(stream|status)$/);
      if (analysisPipelineMatch && request.method === "GET") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const sessionId = analysisPipelineMatch[1];
        if (analysisPipelineMatch[2] === "status") {
          return withCookie(json(await getAnalysisPipelineStatus(env, userId, sessionId)));
        }
        const requestedProvider = url.searchParams.get("provider") || undefined;
        const requestedModel = url.searchParams.get("model") || undefined;
        const aiStageByPipelineStage: Record<typeof ANALYSIS_PIPELINE_STAGES[number], AIStage> = {
          summary: "analysis_summaries",
          questions: "analysis_ideas",
          plans: "analysis_plans",
          manual: "analysis_manual",
        };
        const stageSettings = await Promise.all(ANALYSIS_PIPELINE_STAGES.map(async (stage) => {
          const saved = await getEffectiveSettings(env, userId, aiStageByPipelineStage[stage]);
          return [stage, normalizeAISettings(requestedProvider, requestedModel, saved)] as const;
        }));
        const settings = Object.fromEntries(stageSettings) as AnalysisPipelineSettings;
        const docType = url.searchParams.get("doc_type") === "memo" ? "memo" : "manual";
        return withCookie(await createAnalysisPipelineStream(env, userId, sessionId, settings, { docType }, ctx));
      }

      const analysisSessionMatch = path.match(/^\/api\/analysis\/sessions\/([\w-]+)$/);
      if (analysisSessionMatch) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const sessionId = analysisSessionMatch[1];
        if (request.method === "GET")
          return withCookie(json(await getAnalysisSessionDetail(env, userId, sessionId)));
        if (request.method === "PATCH" || request.method === "PUT") {
          const body = await request.json().catch(() => ({}));
          return withCookie(json(await patchAnalysisSession(env, userId, sessionId, body)));
        }
        if (request.method === "DELETE")
          return withCookie(json(await deleteAnalysisSession(env, userId, sessionId)));
      }

      const analysisMatch = path.match(/^\/api\/analysis\/sessions\/([\w-]+)\/(files|summaries|ideas|plans|manual|plan-runs|executions|status)$/);
      if (analysisMatch) {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const sessionId = analysisMatch[1];
        const action = analysisMatch[2];

        if (action === "status" && request.method === "GET")
          return withCookie(json(await getAnalysisIndexStatus(env, userId, sessionId)));

        if (action === "files" && request.method === "POST")
          return withCookie(json(await saveAnalysisFilesFromRequest(env, userId, sessionId, request)));

        if (action === "plan-runs" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          return withCookie(json(await saveAnalysisPlanRuns(env, userId, sessionId, body)));
        }

        if (action === "executions" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          return withCookie(json(await saveAnalysisExecutions(env, userId, sessionId, body)));
        }

        if ((action === "summaries" || action === "ideas" || action === "plans" || action === "manual") && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const bodyObj = body && typeof body === "object" ? body as { provider?: unknown; model?: unknown } : {};
          const stageByAction: Record<string, AIStage> = {
            summaries: "analysis_summaries",
            ideas: "analysis_ideas",
            plans: "analysis_plans",
            manual: "analysis_manual",
          };
          const savedSettings = await getEffectiveSettings(env, userId, stageByAction[action]);
          const settings = normalizeAISettings(
            typeof bodyObj.provider === "string" ? bodyObj.provider : undefined,
            typeof bodyObj.model === "string" ? bodyObj.model : undefined,
            savedSettings
          );

          if (action === "summaries")
            return withCookie(json(await summarizeAnalysisFiles(env, userId, sessionId, body, settings)));
          if (action === "ideas")
            return withCookie(json(await generateAnalysisIdeas(env, userId, sessionId, body, settings)));
          if (action === "manual")
            return withCookie(json(await generateAnalysisManual(env, userId, sessionId, body, settings)));
          return withCookie(json(await generateAnalysisPlans(env, userId, sessionId, body, settings)));
        }
      }

      const fieldCandidatesMatch = path.match(/^\/api\/analysis\/sessions\/([\w-]+)\/field-candidates$/);
      if (fieldCandidatesMatch && request.method === "POST") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        const body = await request.json().catch(() => ({}));
        return withCookie(json(await retrieverFieldCandidates(env, userId, fieldCandidatesMatch[1], body)));
      }

      const analysisFileMatch = path.match(/^\/api\/analysis\/sessions\/([\w-]+)\/files\/([\w-]+)$/);
      if (analysisFileMatch && request.method === "DELETE") {
        const denied = requireLogin();
        if (denied) return withCookie(denied);
        return withCookie(json(await deleteAnalysisFile(env, userId, analysisFileMatch[1], analysisFileMatch[2])));
      }

      // ── M3 회의록 이력 (로그인 필요) ──────────────────────────────────────
      if (path === "/api/meetings/from-recording" && request.method === "POST") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "login required" }, { status: 401 }));
        const body = await request.json().catch(() => ({}));
        try {
          return withCookie(json(await meetingInputFromClovaRecording(env, userId, body)));
        } catch (err) {
          if (err instanceof ClovaRecordingError) {
            return withCookie(json({ error: err.message, code: err.code }, { status: err.status }));
          }
          throw err;
        }
      }

      if (path === "/api/meetings" && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const limit = Number(url.searchParams.get("limit")) || 20;
        return withCookie(json({ meetings: await listMeetings(env, userId, limit) }));
      }
      const meetingMatch = path.match(/^\/api\/meetings\/([\w-]+)$/);
      if (meetingMatch && request.method === "GET") {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));
        const m = await getMeeting(env, userId, meetingMatch[1]);
        if (!m) return withCookie(json({ error: "회의록을 찾을 수 없습니다." }, { status: 404 }));
        return withCookie(json(m));
      }

      // ── M5 git 연동 (모두 로그인 필요, 저장된 OAuth 토큰 사용) ─────────────
      if (path.startsWith("/api/git/")) {
        if (!isLoggedIn(userId)) return withCookie(json({ error: "로그인이 필요합니다." }, { status: 401 }));

        // git 기본 대상(repo/project) 조회·저장 — 토큰 불필요
        if (path === "/api/git/defaults" && request.method === "GET")
          return withCookie(json(await gitDefaultsForApi(env, userId)));
        if (path === "/api/git/defaults" && request.method === "PUT") {
          const body = (await request.json()) as any;
          await saveGitDefaults(env, userId, body);
          return withCookie(json(await gitDefaultsForApi(env, userId)));
        }

        const token = await getUserToken(env, userId);
        if (!token) return withCookie(json({ error: "GitHub 권한이 없습니다. 로그아웃 후 다시 로그인하세요.", relogin: true }, { status: 403 }));

        if (path === "/api/git/repos" && request.method === "GET")
          return withCookie(json({ repos: await listRepos(token) }));

        if (path === "/api/git/assignees" && request.method === "GET") {
          const repo = url.searchParams.get("repo") || "";
          const [owner, name] = repo.split("/");
          if (!owner || !name) return withCookie(json({ error: "repo=owner/name 형식이 필요합니다." }, { status: 400 }));
          return withCookie(json({ assignees: await listAssignees(token, owner, name) }));
        }

        if (path === "/api/git/projects" && request.method === "GET")
          return withCookie(json({ projects: await listProjects(token) }));

        // 회의록 → 이슈 생성(할 일 항목별) + 선택 시 Project 반영
        if (path === "/api/git/issues" && request.method === "POST") {
          const body = (await request.json()) as {
            repo?: string; assignee?: string; projectId?: string; markdown?: string; meetingTitle?: string;
          };
          const [owner, name] = (body.repo || "").split("/");
          if (!owner || !name) return withCookie(json({ error: "대상 repo(owner/name)를 선택하세요." }, { status: 400 }));
          if (!body.markdown?.trim()) return withCookie(json({ error: "회의록 내용이 비어 있습니다." }, { status: 400 }));

          const assignees = body.assignee ? [body.assignee] : undefined;
          const items = parseActionItems(body.markdown);
          const meetingTitle = (body.meetingTitle || "회의록").slice(0, 120);
          const created: { title: string; number: number; url: string }[] = [];

          // 할 일이 없으면 회의록 요약 1건을 이슈로.
          const tasks = items.length
            ? items.map((it) => ({
                title: it.title.slice(0, 200),
                body: `${meetingTitle} 에서 생성된 할 일.\n\n원문: \`${it.raw}\`` +
                  (it.assignee ? `\n담당(회의록): ${it.assignee}` : "") +
                  (it.due ? `\n마감: ${it.due}` : "") +
                  (it.priority ? `\n우선순위: ${it.priority}` : "") +
                  `\n\n---\n_기획 하네스 루프에서 생성_`,
              }))
            : [{ title: meetingTitle.slice(0, 200), body: body.markdown.slice(0, 60000) }];

          for (const t of tasks) {
            const issue = await createIssue(token, owner, name, t.title, t.body, assignees);
            if (body.projectId) {
              try { await addToProject(token, body.projectId, issue.node_id); } catch { /* Project 반영 실패는 이슈 생성을 막지 않음 */ }
            }
            created.push({ title: t.title, number: issue.number, url: issue.url });
          }
          return withCookie(json({ created, count: created.length, from_action_items: items.length > 0 }));
        }

        return json({ error: "not found" }, { status: 404 });
      }

      return json({ error: "not found" }, { status: 404 });
    } catch (err: any) {
      const status = typeof err?.status === "number" ? err.status : 500;
      const details = err?.details && typeof err.details === "object" && !Array.isArray(err.details) ? err.details : {};
      const response = json({
        error: err?.message || "server error",
        ...(err?.code ? { code: err.code } : {}),
        ...details,
      }, { status });
      if (status === 429 && Number(details.retry_after_seconds) > 0) {
        response.headers.set("retry-after", String(Math.ceil(Number(details.retry_after_seconds))));
      }
      return response;
    }
}

export async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  const origin = mobileCorsOrigin(request);
  const isConnectedAppAuth = path.startsWith("/api/auth/connected-app/");
  if (path.startsWith("/api/") && request.method === "OPTIONS") {
    if (isConnectedAppAuth) {
      return json({ error: "browser preflight is not allowed", code: "browser_request_not_allowed" }, {
        status: 403,
      });
    }
    if (!origin) return json({ error: "origin not allowed", code: "origin_not_allowed" }, { status: 403 });
    const requestedMethod = request.headers.get("access-control-request-method")?.toUpperCase() || "";
    const allowedMethods = new Set(MOBILE_API_METHODS.split(", "));
    if (!allowedMethods.has(requestedMethod)) {
      return withMobileCors(json({ error: "method not allowed", code: "method_not_allowed" }, { status: 405 }), origin);
    }
    const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((header) => !MOBILE_API_HEADER_SET.has(header))) {
      return withMobileCors(json({ error: "header not allowed", code: "header_not_allowed" }, { status: 403 }), origin);
    }
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": MOBILE_API_METHODS,
        "access-control-allow-headers": MOBILE_API_HEADERS,
        "access-control-max-age": "86400",
        "vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      },
    });
  }
  const response = await routeRequest(request, env, ctx);
  return path.startsWith("/api/") && origin && !isConnectedAppAuth
    ? withMobileCors(response, origin)
    : response;
}
