(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let posts = [];
  let selectedPostId = "";

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
    return data;
  }

  function status(text, danger = false) {
    const el = $("postStatus");
    el.textContent = text || "";
    el.classList.toggle("danger", danger);
  }

  function tagText(tags) {
    return (Array.isArray(tags) ? tags : []).join(", ");
  }

  function parseTags(value) {
    return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  function resetForm() {
    selectedPostId = "";
    $("formTitle").textContent = "새 콘텐츠";
    $("postTitle").value = "";
    $("postVisibility").value = "private";
    $("postTags").value = "";
    $("postBody").value = "";
    $("postAssets").value = "";
    $("btnDeletePost").disabled = true;
    $("assetPanel").hidden = true;
    $("assetList").innerHTML = "";
    status("");
    renderPosts();
  }

  async function loadPosts() {
    const data = await api("/api/content/posts?limit=50");
    posts = data.posts || [];
    renderPosts();
    if (selectedPostId && !posts.some((post) => post.id === selectedPostId)) resetForm();
  }

  function renderPosts() {
    const list = $("postList");
    if (!posts.length) {
      list.innerHTML = `<p class="hint">아직 저장된 콘텐츠가 없습니다.</p>`;
      return;
    }
    list.innerHTML = posts.map((post) => `
      <button class="post-list-item ${post.id === selectedPostId ? "active" : ""}" type="button" data-post-id="${esc(post.id)}">
        <strong>${esc(post.title)}</strong>
        <span>${esc(post.visibility)} · 첨부 ${Number(post.asset_count) || 0}개 · ${esc((post.updated_at || "").slice(0, 10))}</span>
      </button>`).join("");
  }

  async function selectPost(id) {
    status("불러오는 중...");
    try {
      const data = await api(`/api/content/posts/${encodeURIComponent(id)}`);
      const post = data.post || {};
      selectedPostId = post.id;
      $("formTitle").textContent = "콘텐츠 수정";
      $("postTitle").value = post.title || "";
      $("postVisibility").value = post.visibility || "private";
      $("postTags").value = tagText(post.tags);
      $("postBody").value = post.body || "";
      $("postAssets").value = "";
      $("btnDeletePost").disabled = false;
      renderAssets(data.assets || []);
      renderPosts();
      status("");
    } catch (err) {
      status(err.message, true);
    }
  }

  function renderAssets(assets) {
    $("assetPanel").hidden = false;
    const list = $("assetList");
    if (!assets.length) {
      list.innerHTML = `<p class="hint">첨부 파일이 없습니다.</p>`;
      return;
    }
    list.innerHTML = assets.map((asset) => `
      <div class="asset-row">
        <a href="/api/content/posts/${encodeURIComponent(asset.post_id)}/assets/${encodeURIComponent(asset.id)}">${esc(asset.name)}</a>
        <span>${Math.max(1, Math.round((Number(asset.size) || 0) / 1024)).toLocaleString("ko-KR")} KB</span>
        <button class="btn btn-ghost btn-small" type="button" data-asset-delete="${esc(asset.id)}">삭제</button>
      </div>`).join("");
  }

  async function uploadAssets(postId) {
    const input = $("postAssets");
    if (!input.files || !input.files.length) return;
    const form = new FormData();
    Array.from(input.files).forEach((file) => form.append("assets", file));
    await window.apiFetch(`/api/content/posts/${encodeURIComponent(postId)}/assets`, { method: "POST", body: form }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "첨부 업로드에 실패했습니다.");
      return data;
    });
  }

  async function savePost() {
    status("저장 중...");
    try {
      const payload = {
        title: $("postTitle").value,
        visibility: $("postVisibility").value,
        tags: parseTags($("postTags").value),
        body: $("postBody").value,
      };
      const path = selectedPostId ? `/api/content/posts/${encodeURIComponent(selectedPostId)}` : "/api/content/posts";
      const data = await api(path, {
        method: selectedPostId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const postId = data.post?.id || selectedPostId;
      await uploadAssets(postId);
      selectedPostId = postId;
      status("저장했습니다.");
      await loadPosts();
      await selectPost(postId);
    } catch (err) {
      status(err.message, true);
    }
  }

  async function deletePost() {
    if (!selectedPostId) return;
    status("삭제 중...");
    try {
      await api(`/api/content/posts/${encodeURIComponent(selectedPostId)}`, { method: "DELETE" });
      resetForm();
      await loadPosts();
      status("삭제했습니다.");
    } catch (err) {
      status(err.message, true);
    }
  }

  async function deleteAsset(assetId) {
    if (!selectedPostId) return;
    status("첨부 삭제 중...");
    try {
      await api(`/api/content/posts/${encodeURIComponent(selectedPostId)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      await selectPost(selectedPostId);
      await loadPosts();
      status("첨부를 삭제했습니다.");
    } catch (err) {
      status(err.message, true);
    }
  }

  async function init() {
    $("btnNewPost").addEventListener("click", resetForm);
    $("btnSavePost").addEventListener("click", savePost);
    $("btnDeletePost").addEventListener("click", deletePost);
    $("btnReloadPosts").addEventListener("click", loadPosts);
    $("postList").addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("[data-post-id]");
      if (button) selectPost(button.dataset.postId);
    });
    $("assetList").addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("[data-asset-delete]");
      if (button) deleteAsset(button.dataset.assetDelete);
    });

    try {
      const me = await api("/api/me");
      if (!me.loggedIn) {
        $("guest").hidden = false;
        $("guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
        return;
      }
      $("member").hidden = false;
      await loadPosts();
    } catch {
      $("guest").hidden = false;
      $("guestLogin").innerHTML = window.oauthLoginButtonsHtml ? window.oauthLoginButtonsHtml() : "";
    }
  }

  init();
})();
