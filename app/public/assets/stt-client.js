(() => {
  "use strict";

  const AUDIO_EXT = /\.(aac|amr|flac|m4a|mp3|mp4|ogg|opus|wav|webm)$/i;

  function isLikelyAudioFile(file) {
    if (!file) return false;
    return (file.type || "").startsWith("audio/") || AUDIO_EXT.test(file.name || "");
  }

  function defaultStatus(message, isError) {
    const target = document.getElementById("genStatus") || document.getElementById("speechSupport");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("danger", !!isError);
  }

  async function safeJson(response) {
    try { return await response.json(); }
    catch { return {}; }
  }

  function textFromResponse(data) {
    if (typeof data.text === "string" && data.text.trim()) return data.text.trim();
    if (Array.isArray(data.segments)) {
      return data.segments.map((segment) => segment && segment.text).filter(Boolean).join("\n").trim();
    }
    return "";
  }

  async function transcribeClovaAudio(file, options = {}) {
    const status = typeof options.status === "function" ? options.status : defaultStatus;
    const transcript = options.transcript || document.getElementById("transcript");
    if (!transcript) {
      status("전사 텍스트를 채울 입력칸을 찾지 못했습니다.", true);
      return false;
    }
    if (!isLikelyAudioFile(file)) {
      status("지원하지 않는 파일입니다. 자막(.vtt/.srt/.txt) 또는 오디오 파일을 선택해주세요.", true);
      return false;
    }

    status(`🎧 '${file.name || "audio"}' 오디오를 Clova Speech로 전사 중입니다...`);
    try {
      const form = new FormData();
      form.append("media", file, file.name || "audio");
      const response = await window.apiFetch("/api/stt/clova", { method: "POST", body: form });
      const data = await safeJson(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      const text = textFromResponse(data);
      if (!text) throw new Error("전사 결과가 비어 있습니다.");

      transcript.value = text;
      transcript.dispatchEvent(new Event("input", { bubbles: true }));
      status("✅ 오디오 전사 완료. 내용을 확인한 뒤 AI 요약을 실행하세요.");
      return true;
    } catch (err) {
      status(`❌ STT 실패: ${err.message} 자막(.vtt/.srt/.txt) 업로드나 실시간 녹음을 대신 사용할 수 있습니다.`, true);
      return false;
    }
  }

  window.isClovaAudioFile = isLikelyAudioFile;
  window.transcribeClovaAudio = transcribeClovaAudio;
})();
