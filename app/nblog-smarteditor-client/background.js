"use strict";

importScripts("shared/protocol.js");

const JOB_KEY = "nblogHandoffJobV1";
const protocol = globalThis.NBlogHandoffProtocol;

function publicError(error) {
  if (error instanceof protocol.ProtocolError) return error.code;
  if (typeof error?.code === "string" && /^[a-z0-9_]{3,80}$/.test(error.code)) return error.code;
  return "browser_helper_failed";
}

function helperError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requestHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-nblog-contract-version": protocol.CONTRACT_VERSION,
    "x-request-id": crypto.randomUUID(),
  };
}

async function jsonResponse(response, errorPrefix) {
  if (!response.ok) throw helperError(`${errorPrefix}_${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw helperError(`${errorPrefix}_invalid_response`);
  try {
    return await response.json();
  } catch {
    throw helperError(`${errorPrefix}_invalid_json`);
  }
}

async function claimConnection(connection) {
  const response = await fetch(`${connection.api_origin}${connection.claim_path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.claim_token}`,
      "x-nblog-contract-version": connection.contract_version,
      "x-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  const payload = await jsonResponse(response, "claim_failed");
  return protocol.validateClaimResponse(payload, connection);
}

async function saveCheckpoint(job, status, resumePoint, completedSteps, remainingSteps) {
  const path = `/api/nblog/handoff-sessions/${job.session_id}/checkpoints`;
  const response = await fetch(`${job.api_origin}${path}`, {
    method: "POST",
    headers: requestHeaders(job.session_token),
    body: JSON.stringify({
      status,
      resume_stage: "smart-editor",
      resume_point: resumePoint,
      completed_steps: completedSteps,
      remaining_steps: remainingSteps,
      expected_version: job.campaign_version,
    }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  const payload = await jsonResponse(response, "checkpoint_failed");
  const nextVersion = Number(payload?.checkpoint?.campaign?.version);
  if (!Number.isInteger(nextVersion) || nextVersion < 0) throw helperError("checkpoint_version_missing");
  job.campaign_version = nextVersion;
  job.status = status;
  await chrome.storage.session.set({ [JOB_KEY]: job });
  return job;
}

async function activeNaverTab(tabId) {
  if (!Number.isInteger(tabId)) throw helperError("active_tab_required");
  const tab = await chrome.tabs.get(tabId);
  let url;
  try {
    url = new URL(tab.url || "");
  } catch {
    throw helperError("naver_editor_tab_required");
  }
  if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") {
    throw helperError("naver_editor_tab_required");
  }
  return tab;
}

async function injectAndApply(tabId, draft) {
  await activeNaverTab(tabId);
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: [
      "content/smarteditor-adapter.js",
      "content/smarteditor-runner.js",
    ],
  });
  const frameIds = [...new Set(injected.map((result) => result.frameId))]
    .filter((frameId) => Number.isInteger(frameId))
    .sort((left, right) => left - right);

  let selectorMismatch = null;
  for (const frameId of frameIds) {
    let result;
    try {
      result = await chrome.tabs.sendMessage(
        tabId,
        { type: "NBLOG_EDITOR_APPLY_V1", draft },
        { frameId },
      );
    } catch {
      continue;
    }
    if (!result || result.code === "not_editor_frame" || result.code === "not_naver_blog") continue;
    if (result.code === "selector_mismatch") selectorMismatch = result;
    else return { ...result, frame_id: frameId };
  }
  return selectorMismatch || { ok: false, code: "editor_not_found" };
}

async function readJob() {
  const stored = await chrome.storage.session.get(JOB_KEY);
  const job = stored?.[JOB_KEY];
  if (!job) return null;
  if (Date.parse(job.expires_at) <= Date.now()) {
    await chrome.storage.session.remove(JOB_KEY);
    return null;
  }
  return job;
}

function publicJob(job) {
  if (!job) return { status: "idle" };
  return {
    status: job.status,
    session_id: job.session_id,
    expires_at: job.expires_at,
    title: job.draft?.title || job.title || "",
    tag_count: Array.isArray(job.draft?.tags) ? job.draft.tags.length : Number(job.tag_count || 0),
    last_result: job.last_result || null,
    manual_steps: job.manual_steps || ["login", "captcha", "media", "place", "preview", "publish"],
  };
}

async function applyClaimedJob(job, tabId) {
  const tab = await activeNaverTab(tabId);
  const observedBlogId = protocol.extractNaverBlogId(tab.url || "");
  const expectedBlogId = job.draft?.target_blog_id || null;
  if (expectedBlogId && observedBlogId !== expectedBlogId) {
    const targetError = observedBlogId ? "target_blog_mismatch" : "target_blog_unverified";
    job.last_result = targetError;
    await saveCheckpoint(
      job,
      "user_action_required",
      "Open the intended Naver blog SmartEditor and retry",
      ["browser_connected"],
      ["confirm_target_blog", "insert_title", "insert_body", "insert_tags_if_visible", "user_review", "user_publish"],
    );
    return {
      ok: false,
      code: targetError,
      job: publicJob(job),
      result: { ok: false, code: targetError },
    };
  }

  const started = job.status === "input_in_progress"
    ? job
    : await saveCheckpoint(
      job,
      "input_in_progress",
      "Insert approved title and body",
      ["browser_connected"],
      ["insert_title", "insert_body", "insert_tags_if_visible", "user_review", "user_publish"],
    );

  const result = await injectAndApply(tabId, started.draft);
  started.last_result = result.code;
  if (!result.ok) {
    await saveCheckpoint(
      started,
      "user_action_required",
      "Open an empty SmartEditor draft and retry",
      ["browser_connected"],
      ["insert_title", "insert_body", "insert_tags_if_visible", "user_review", "user_publish"],
    );
    return { ok: false, code: result.code, job: publicJob(started), result };
  }

  const tagWasManual = result.fields?.tags === "manual";
  await saveCheckpoint(
    started,
    "review_required",
    "Review the inserted draft and finish manually",
    ["browser_connected", "title_inserted", "body_inserted", ...(tagWasManual ? [] : ["tags_inserted"])],
    [...(tagWasManual ? ["insert_tags_manually"] : []), "insert_media_manually", "insert_place_manually", "review", "publish_manually"],
  );
  const completedJob = {
    session_id: started.session_id,
    expires_at: started.expires_at,
    status: "review_required",
    title: started.draft.title,
    tag_count: started.draft.tags.length,
    last_result: result.code,
    manual_steps: result.manual_steps,
  };
  await chrome.storage.session.set({ [JOB_KEY]: completedJob });
  return { ok: true, code: result.code, job: publicJob(completedJob), result };
}

async function connectAndApply(rawCode, tabId) {
  const connection = protocol.parseConnectionCode(rawCode);
  await activeNaverTab(tabId);
  const claimed = await claimConnection(connection);
  const job = {
    api_origin: connection.api_origin,
    session_id: connection.session_id,
    session_token: claimed.session_token,
    expires_at: claimed.expires_at,
    campaign_version: claimed.campaign_version,
    status: "browser_connected",
    draft: claimed.draft,
    last_result: null,
    manual_steps: claimed.draft.manual_steps,
  };
  await chrome.storage.session.set({ [JOB_KEY]: job });
  return applyClaimedJob(job, tabId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") return false;
  (async () => {
    if (message.type === "NBLOG_HELPER_CONNECT_V1") {
      return connectAndApply(message.code, message.tab_id);
    }
    if (message.type === "NBLOG_HELPER_RETRY_V1") {
      const job = await readJob();
      if (!job?.session_token || !job?.draft) throw helperError("retry_session_unavailable");
      return applyClaimedJob(job, message.tab_id);
    }
    if (message.type === "NBLOG_HELPER_STATUS_V1") {
      return { ok: true, job: publicJob(await readJob()) };
    }
    throw helperError("unsupported_helper_message");
  })().then(
    (result) => sendResponse(result),
    (error) => sendResponse({ ok: false, code: publicError(error) }),
  );
  return true;
});
