"use strict";
/* 랜덤채팅 프론트엔드.
   - Firebase 설정이 채워지면 실제 매칭/메시지로 동작 (연결 코드는 추후 추가).
   - 비어 있으면 '데모 모드': 혼자서 화면 흐름과 UI만 확인. */

const $ = (id) => document.getElementById(id);

// ---- 테마 (다크/화이트 수동 전환) ----
const THEME_KEY = "rc_theme";   // "dark" | "light" | null(시스템 따름)
function systemDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function currentDark() {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : systemDark();
}
function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
  // 버튼에는 '눌렀을 때 바뀔 모드' 이름을 표시
  const label = currentDark() ? "라이트" : "다크";
  ["btn-theme", "btn-theme-chat"].forEach((id) => {
    const b = $(id); if (b) b.textContent = label;
  });
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(saved);
})();
function toggleTheme() {
  const next = currentDark() ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  applyTheme(next);
}
["btn-theme", "btn-theme-chat"].forEach((id) => {
  const b = $(id); if (b) b.addEventListener("click", toggleTheme);
});

const screens = ["gate", "consent", "ready", "waiting", "chat"];
let currentScreen = "gate";
function show(name) {
  currentScreen = name;
  document.body.dataset.screen = name;   // 공지 카드 위치(채팅 중엔 헤더 아래)
  screens.forEach((s) => $("screen-" + s).classList.toggle("active", s === name));
  setPresence();
}

// 접속 카운터 + 앱 종료/백그라운드 시 정리
let _counted = false;
function presenceOn() {
  if (!hasFirebase || !uid) return;
  setPresence();
  const cref = db.ref("stats/online");
  const inc = firebase.database.ServerValue.increment;
  cref.onDisconnect().set(inc(-1));        // 끊기면 -1 (재무장)
  if (!_counted) { cref.set(inc(1)); _counted = true; }
}
function presenceOff() {
  if (!hasFirebase || !uid) return;
  try { db.ref("presence/" + uid).remove(); } catch (e) {}
  const cref = db.ref("stats/online");
  const inc = firebase.database.ServerValue.increment;
  cref.onDisconnect().cancel();             // 중복 감소 방지
  if (_counted) { cref.set(inc(-1)); _counted = false; }
  // 대화 중이었으면 상대에게 종료 전달
  if (state.roomId) { try { db.ref("rooms/" + state.roomId + "/closed").set(true); } catch (e) {} }
}
// 탭/앱을 완전히 닫을 때만 접속 종료 처리 (백그라운드는 유지)
window.addEventListener("pagehide", (e) => { if (!e.persisted) presenceOff(); });
window.addEventListener("beforeunload", presenceOff);
// 백그라운드에서 돌아오면 상태만 갱신 (종료하지 않음)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") presenceOn();
});

// 접속 상태(익명 집계용): 화면 기준 idle/waiting/chatting + 연령·성별
function setPresence() {
  if (!hasFirebase || !uid) return;
  const st = currentScreen === "chat" ? "chatting"
           : currentScreen === "waiting" ? "waiting" : "idle";
  db.ref("presence/" + uid).set({
    state: st, ts: now(),
    age: (state && state.age) || "미정",
    gender: (state && state.gender) || "미정",
    region: (state && state.region) || "미정",
  });
}

const hasFirebase = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);

// ---- Firebase 초기화 ----
let db = null, auth = null, uid = null;
if (hasFirebase) {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.database();
  auth = firebase.auth();
  auth.onAuthStateChanged((u) => {
    if (u) {
      uid = u.uid;
      attachAssignListener();
      db.ref("presence/" + uid).onDisconnect().remove();  // 접속 끊기면 자동 제거
      presenceOn();
    }
  });
  auth.signInAnonymously().catch((e) => {
    console.error("익명 로그인 실패", e);
    alert("서버 연결에 실패했어요. 잠시 후 새로고침 해주세요.");
  });
  setInterval(setPresence, 30000);   // 접속 상태 주기적 갱신(집계 정확도)
  // 운영자 공지 배너
  // 닫은 공지는 같은 공지(ts)가 유지되는 동안 다시 띄우지 않음
  const NOTICE_KEY = "rc_notice_closed";
  let _noticeTs = null;
  db.ref("config/notice").on("value", (s) => {
    const n = s.val();
    const bar = document.getElementById("notice-bar");
    if (!bar) return;
    // 채팅 화면: 상단 안내줄 자리에 공지 표시 (공지 없으면 기본 안내)
    const sb = document.getElementById("safety-bar");
    if (sb) {
      sb.textContent = n && n.text ? "📢 " + n.text : "욕설·비방은 삼가주세요.";
      sb.classList.toggle("is-notice", !!(n && n.text));
    }
    let closed = null;
    try { closed = localStorage.getItem(NOTICE_KEY); } catch (e) {}
    if (n && n.text && String(n.ts) !== closed) {
      _noticeTs = n.ts;
      document.getElementById("nt-text").textContent = n.text;
      bar.classList.add("show");
    } else {
      bar.classList.remove("show");
    }
  });
  document.getElementById("nt-close").addEventListener("click", () => {
    document.getElementById("notice-bar").classList.remove("show");
    try { localStorage.setItem(NOTICE_KEY, String(_noticeTs)); } catch (e) {}
  });
}
const now = () => Date.now();
const ROOM_TTL = 30 * 60 * 1000;   // 30분

// ---- 상태 ----
const LOC_KEY = "rc_loc_choice";   // "on" | "off" | null(아직 선택 안 함)
const AGE_KEY = "rc_age", GENDER_KEY = "rc_gender";
const state = {
  region: "익명",
  nick: "익명0000",
  coords: null,
  locOn: false,
  age: "미정",
  gender: "미정",
};
try {
  state.age = localStorage.getItem(AGE_KEY) || "미정";
  state.gender = localStorage.getItem(GENDER_KEY) || "미정";
} catch (e) {}

// 상대 프로필 문구 (연령·성별)
function profileText(age, gender) {
  const parts = [];
  if (age && age !== "미정") parts.push(age);
  if (gender && gender !== "미정") parts.push(gender);
  return parts.length ? "(" + parts.join("·") + ")" : "";
}

// 대화명: 지역 + 4자리 숫자. 숫자는 '한 번 정하면 고정', 지역만 바뀜.
function makeNum() { return String(Math.floor(1000 + Math.random() * 9000)); }
function makeNick(region) { return (region || "미정") + makeNum(); }

// 새 상대/첫 입장: 숫자까지 새로 발급
function newIdentity() {
  state.nickNum = makeNum();
  applyNick(true);   // 새 신원이라 변경 안내는 생략
}
// 지역 변경 등: 숫자는 그대로 두고 대화명만 다시 조립
function applyNick(silent) {
  if (!state.nickNum) state.nickNum = makeNum();
  const old = state.nick;
  state.nick = (state.region || "미정") + state.nickNum;
  $("nick-preview").textContent = state.nick;
  $("my-name").textContent = state.nick;
  if (hasFirebase && state.roomId && uid) {
    db.ref("rooms/" + state.roomId + "/members/" + uid).update({
      nick: state.nick, region: state.region,
    });
    if (!silent && old && old !== "익명0000" && old !== state.nick) {
      addSystem("내 닉네임이 " + old + " → " + state.nick + " 로 변경되었습니다.");
    }
  }
}
// 하위 호환: 기존 호출부가 쓰던 이름
function refreshNick() { newIdentity(); }

function savedLocChoice() {
  try { return localStorage.getItem(LOC_KEY); } catch (e) { return null; }
}
function saveLocChoice(v) {
  try { localStorage.setItem(LOC_KEY, v); } catch (e) {}
}

// 위치 켜기: 권한 요청 → 성공 시 지역 반영
function enableLocation() {
  if (!navigator.geolocation) {
    $("loc-status").textContent = "위치: 지원 안 함";
    return;
  }
  $("loc-status").textContent = "위치: 확인 중…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.region = await regionFromCoords(state.coords);
      state.locOn = true;
      saveLocChoice("on");
      applyNick(false);      // 숫자 유지, 지역만 변경 (양쪽에 안내)
      applyLocUI();
      if (hasFirebase) firebaseUpdateRegion(state.region);
    },
    () => {
      state.locOn = false;
      saveLocChoice("off");
      $("loc-status").textContent = "위치: 거부됨 (미정)";
      applyLocUI();
    },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

// 위치 끄기: 미정으로 되돌림 (숫자는 유지)
function disableLocation() {
  state.locOn = false;
  state.coords = null;
  state.region = "미정";
  saveLocChoice("off");
  applyNick(false);      // 숫자 유지, 지역만 미정으로
  applyLocUI();
  if (hasFirebase) firebaseUpdateRegion(state.region);
}

// 위치 상태를 준비화면·채팅 버튼에 모두 반영
function applyLocUI() {
  // 브레인스토밍 모드: 위치 기능 사용 안 함 (UI 숨김)
}

// ---- 0단계: 베타 비밀번호 게이트 (매번 입력) ----
const BETA_PW = "1234";
function tryGate() {
  if ($("gate-pw").value === BETA_PW) {
    $("gate-pw").value = "";
    show("consent");
  } else {
    $("gate-msg").textContent = "비밀번호가 올바르지 않습니다.";
    $("gate-pw").value = "";
  }
}
$("btn-gate").addEventListener("click", tryGate);
$("gate-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") tryGate(); });

// ---- 1단계: 동의 ----
$("agree-check").addEventListener("change", (e) => {
  $("btn-agree").disabled = !e.target.checked;
});
$("btn-agree").addEventListener("click", () => {
  if ($("loc-agree").checked && !state.locOn) { _locConsented = true; requestLoc(true); }   // 선택 동의 시 위치 미리 받기
  refreshNick();
  applyLocUI();
  show("ready");
});

// ---- 연령·성별 선택 칩 ----
function setupChips(containerId, attr, key, cur) {
  document.querySelectorAll("#" + containerId + " .chip").forEach((c) => {
    c.classList.toggle("on", c.dataset[attr] === cur);
    c.addEventListener("click", () => {
      const val = c.dataset[attr];
      state[attr] = val;
      try { localStorage.setItem(key, val); } catch (e) {}
      document.querySelectorAll("#" + containerId + " .chip").forEach((x) =>
        x.classList.toggle("on", x === c));
      setPresence();   // 집계에 반영
    });
  });
}
setupChips("age-chips", "age", AGE_KEY, state.age);
setupChips("gender-chips", "gender", GENDER_KEY, state.gender);

// ---- 2단계: 위치 / 입장 준비 ----
$("btn-loc").addEventListener("click", enableLocation);
$("btn-loc-skip").addEventListener("click", () => {
  saveLocChoice("off");
  state.locOn = false;
  applyLocUI();
});
// 채팅 중 📍 거리 표시 토글
$("btn-loc-toggle").addEventListener("click", toggleLocShare);

// 좌표 → 8개 권역 (대략 추정). 서울/경기/인천/강원/충청/전라/경상/제주
async function regionFromCoords(c) {
  const la = c.lat, ln = c.lng;
  if (la < 33.75 && ln < 127.3) return "제주";
  // 수도권(위도 37.15 이상)
  if (la >= 37.15) {
    if (ln >= 127.6) return "강원";                                   // 수도권 위도라도 동쪽이면 강원
    if (la >= 37.42 && la <= 37.72 && ln >= 126.76 && ln <= 127.20) return "서울";
    if (ln < 126.78 && la >= 37.30 && la <= 37.65) return "인천";
    return "경기";
  }
  // 남부(위도 36.05 미만)
  if (la < 36.05) return ln >= 127.5 ? "경상" : "전라";
  // 중부(36.05~37.15)
  if (ln >= 127.9) return la >= 36.6 ? "강원" : "경상";
  return "충청";
}

$("btn-start").addEventListener("click", () => {
  initAudio();        // 사용자 제스처로 알림음 잠금 해제
  show("waiting");
  startMatching();
});
$("btn-cancel").addEventListener("click", () => {
  cancelMatching();
  show("ready");
});

// ---- 3·4단계: 매칭 & 채팅 ----
function startMatching() {
  // 혼자 오래 기다리면 안내 문구 노출
  const hint = $("wait-hint");
  if (hint) hint.style.display = "none";
  clearTimeout(state._waitHintTimer);
  state._waitHintTimer = setTimeout(() => {
    if (!state.roomId && hint) hint.style.display = "block";
  }, 10000);
  if (hasFirebase) {
    firebaseStartMatching();  // 추후 구현
  } else {
    // 데모: 2초 뒤 가짜 상대와 연결
    state._demoTimer = setTimeout(() => {
      const peer = "상대방" + Math.floor(1000 + Math.random() * 9000);
      $("peer-name").textContent = peer;
      enterChat();
      addSystem(peer + "님과 연결되었습니다.");
    }, 2000);
  }
}
function cancelMatching() {
  clearTimeout(state._demoTimer);
  clearTimeout(state._waitHintTimer);
  if (hasFirebase) firebaseCancelMatching();
}
function enterChat() {
  clearTimeout(state._waitHintTimer);
  // 이전 대화의 사진 blob URL 정리 (메모리)
  (state._blobUrls || []).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
  state._blobUrls = [];
  $("messages").innerHTML = '<div class="msg-spacer"></div>';  // 아래부터 쌓이도록
  show("chat");
  fitViewport();
}

// 메시지 그리기 (말풍선 + 시간). 반환: 말풍선 요소
function timeLabel(ts) {
  const d = new Date(ts || now());
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
}
function addBubble(kind, content, ts) {
  const row = document.createElement("div");
  row.className = "msg-row " + kind;
  const bubble = document.createElement("div");
  bubble.className = "msg " + kind;
  if (typeof content === "string") bubble.textContent = content;
  else bubble.appendChild(content);
  const t = document.createElement("span");
  t.className = "time"; t.textContent = timeLabel(ts);
  if (kind === "mine") { row.appendChild(t); row.appendChild(bubble); }
  else { row.appendChild(bubble); row.appendChild(t); }
  const box = $("messages");
  const typing = document.getElementById("typing-row");
  if (typing) box.insertBefore(row, typing); else box.appendChild(row);  // 입력중 표시 위에
  box.scrollTop = box.scrollHeight;
  return bubble;
}
function addMsg(kind, text, ts) {
  if (kind === "sys") {
    const el = document.createElement("div");
    el.className = "msg sys"; el.textContent = text;
    $("messages").appendChild(el);
    $("messages").scrollTop = $("messages").scrollHeight;
    return el;
  }
  return addBubble(kind, text, ts);
}
function addImage(kind, url, ts) {
  const img = document.createElement("img");
  img.src = url;
  img.addEventListener("click", () => openViewer(url));  // 눌러서 전체화면
  return addBubble(kind, img, ts);
}

// 사진 전체화면 뷰어
function openViewer(url) {
  $("viewer-img").src = url;
  $("photo-viewer").dataset.url = url;
  $("photo-viewer").classList.add("open");
}
function closeViewer() {
  $("photo-viewer").classList.remove("open");
  $("viewer-img").src = "";
}
$("btn-photo-close").addEventListener("click", closeViewer);
$("btn-photo-save").addEventListener("click", savePhoto);
async function savePhoto() {
  const url = $("photo-viewer").dataset.url;
  if (!url) return;
  let blob;
  try {
    blob = await (await fetch(url)).blob();
  } catch (e) {
    // 이미지를 못 읽으면 새 탭으로 열어 길게 눌러 저장
    window.open(url, "_blank");
    alert("열린 사진을 길게 눌러 저장하세요.");
    return;
  }
  const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const name = "random-chat-" + Date.now() + "." + ext;
  const file = new File([blob], name, { type: blob.type || "image/jpeg" });

  // 모바일: 공유 시트로 '사진/갤러리에 저장' 선택 가능
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;  // 사용자가 취소
      // 공유 실패 시 아래 다운로드로 진행
    }
  }
  // 데스크톱 등: 파일 다운로드 (안드로이드 크롬은 보통 갤러리에 표시됨)
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function addSystem(text) { addMsg("sys", text); }

// 상대가 나갔을 때: 눈에 띄는 안내 + '다음 상대 찾기' 버튼
function addLeaveNotice() {
  if (document.getElementById("leave-notice")) return;  // 중복 방지
  const wrap = document.createElement("div");
  wrap.id = "leave-notice"; wrap.className = "leave-notice";
  wrap.innerHTML = '<div>상대방이 나갔어요</div>';
  const btn = document.createElement("button");
  btn.className = "primary"; btn.textContent = "다음 상대 찾기";
  btn.addEventListener("click", nextPartner);
  wrap.appendChild(btn);
  const box = $("messages");
  const typing = document.getElementById("typing-row");
  if (typing) box.insertBefore(wrap, typing); else box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

// ---- 알림음/진동 ----
let _audioCtx = null;
function initAudio() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx && _audioCtx.state === "suspended") _audioCtx.resume();
  } catch (e) {}
}
function notifyPing() {
  try { if (navigator.vibrate) navigator.vibrate(document.hidden ? [50, 40, 50] : 25); } catch (e) {}
  if (!_audioCtx) return;
  try {
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.type = "sine"; o.frequency.value = 680;
    const t = _audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(_audioCtx.destination);
    o.start(t); o.stop(t + 0.3);
  } catch (e) {}
}

// ---- 입력 중 표시 ----
function showTyping(on) {
  let el = document.getElementById("typing-row");
  if (on) {
    if (!el) {
      el = document.createElement("div");
      el.id = "typing-row"; el.className = "msg-row peer";
      el.innerHTML = '<div class="msg peer typing"><span></span><span></span><span></span></div>';
      $("messages").appendChild(el);
      $("messages").scrollTop = $("messages").scrollHeight;
    }
  } else if (el) { el.remove(); }
}
function clearMyTyping() {
  if (hasFirebase && state.roomId && uid) db.ref("rooms/" + state.roomId + "/typing/" + uid).remove();
}
let _lastTyping = 0;
$("msg-input").addEventListener("input", () => {
  if (!hasFirebase || !state.roomId) return;
  const t = now();
  if (t - _lastTyping > 1200) {
    _lastTyping = t;
    const ref = db.ref("rooms/" + state.roomId + "/typing/" + uid);
    ref.set(t); ref.onDisconnect().remove();
  }
});

// ---- 링크·전화번호 필터 ----
function filterText(s) {
  // URL(http/https/www 또는 도메인.tld)
  s = s.replace(
    /((https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|kr|co|me|gg|xyz|tv|ly|link|site|shop|app|biz|info|cc)\b(\/[^\s]*)?)/gi,
    "[링크 차단]");
  // 한국 휴대폰 번호
  s = s.replace(/01[016789][\s.\-]?\d{3,4}[\s.\-]?\d{4}/g, "[번호 차단]");
  // 연락처로 보이는 9자리 이상 숫자 나열(구분자 포함)
  s = s.replace(/(?:\d[\s.\-]?){9,}/g, (m) =>
    (m.replace(/\D/g, "").length >= 9 ? "[번호 차단]" : m));
  return s;
}

// ---- 도배 방지 (최근 5초 가중치 합 제한 + 사진 최소 간격) ----
let _sendStamps = [];
let _lastPhotoAt = 0;
function floodBlocked(weight) {
  const t = now();
  _sendStamps = _sendStamps.filter((x) => t - x < 5000);
  if (_sendStamps.length + weight > 8) return true;
  for (let i = 0; i < weight; i++) _sendStamps.push(t);
  return false;
}
// 도배 경고는 3초에 한 번만 표시
let _lastFloodWarn = 0;
function floodWarn(msg) {
  if (now() - _lastFloodWarn > 3000) { _lastFloodWarn = now(); addSystem(msg); }
}

// 텍스트 전송
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  initAudio();
  let text = $("msg-input").value.trim();
  if (!text) return;
  if (floodBlocked(1)) { floodWarn("너무 빠르게 보내고 있어요. 잠시 후 다시 보내주세요."); return; }
  text = filterText(text);
  $("msg-input").value = "";
  _lastTyping = 0; clearMyTyping();
  addMsg("mine", text, now());
  $("msg-input").focus();        // 전송 후 입력창 포커스 유지(키보드 안 닫힘)
  if (hasFirebase) firebaseSendText(text);
  else setTimeout(() => addMsg("peer", "(데모) 받았어요: " + text, now()), 600);
});
// 전송 버튼이 입력창 포커스를 빼앗지 않도록 (모바일 키보드 유지)
document.querySelectorAll(".send-btn").forEach((el) => {
  el.addEventListener("mousedown", (e) => e.preventDefault());
});

// 사진 전송
$("photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (now() - _lastPhotoAt < 2000 || floodBlocked(3)) {
    floodWarn("사진을 너무 빠르게 보내고 있어요. 잠시 후 다시 시도하세요.");
    return;
  }
  _lastPhotoAt = now();
  const url = URL.createObjectURL(file);
  (state._blobUrls = state._blobUrls || []).push(url);  // 메모리 정리용 추적
  const bubble = addImage("mine", url, now());
  if (hasFirebase) {
    if (bubble) bubble.classList.add("sending");
    // 상대에게도 '입력 중…'과 동일한 표시 (사진 준비·전송 중)
    if (state.roomId) {
      const tref = db.ref("rooms/" + state.roomId + "/typing/" + uid);
      tref.set(now()); tref.onDisconnect().remove();
    }
    firebaseSendPhoto(file).finally(() => {
      if (bubble) bubble.classList.remove("sending");
      clearMyTyping();
    });
  }
});

// 나가기 = 현재 대화 종료 후 바로 다음 상대 매칭
$("btn-leave").addEventListener("click", nextPartner);
function nextPartner() {
  if (hasFirebase) firebaseLeave();
  clearTimeout(state._demoTimer);
  closeReport();
  applyNick(true);             // 내 번호는 유지 (지역 기준으로 대화명 재조립)
  show("waiting");
  // 동시에 나가면 매칭이 충돌하므로 짧은 랜덤 지연 후 재매칭 (시간차)
  const delay = hasFirebase ? 150 + Math.floor(Math.random() * 700) : 0;
  clearTimeout(state._rematchTimer);
  state._rematchTimer = setTimeout(startMatching, delay);
}

// ---- 신고 사유 선택 ----
function openReport() { $("report-modal").classList.add("open"); }
function closeReport() { $("report-modal").classList.remove("open"); }
$("btn-report").addEventListener("click", openReport);
$("btn-report-cancel").addEventListener("click", closeReport);
$("report-modal").addEventListener("click", (e) => {
  if (e.target === $("report-modal")) closeReport();  // 바깥 누르면 닫기
});
document.querySelectorAll(".reason").forEach((b) => {
  b.addEventListener("click", () => {
    const reason = b.dataset.reason;
    closeReport();
    if (hasFirebase) firebaseReport(reason);
    addSystem("신고가 접수되었습니다.");
  });
});

// ================= Firebase 연동 =================
// 방 구조: rooms/{roomId} = { members:{uid:{nick,region}}, ts, closed }
//          rooms/{roomId}/messages/{key} = { sender, type, text|content, ts }
// 매칭: waiting(한 명 대기) + assign/{uid}(대기자에게 방 배정 통지)

function waitForAuth(cb, tries) {
  tries = tries || 0;
  if (uid) return cb();
  if (tries > 100) { alert("서버 연결이 지연되고 있어요. 새로고침 해주세요."); show("ready"); return; }
  setTimeout(() => waitForAuth(cb, tries + 1), 100);
}

function firebaseStartMatching() {
  // 동시에 눌러도 충돌하지 않도록 매 시도에 약간의 시간차(지터)
  const jitter = Math.floor(Math.random() * 500);
  setTimeout(() => waitForAuth(doMatch), jitter);
}

function doMatch() {
  if (state.roomId) return;              // 이미 매칭됨
  // 차단된 사용자는 매칭 거부
  db.ref("banned/" + uid).once("value", (bs) => {
    if (bs.val() === true) {
      show("ready");
      alert("이용이 제한된 계정입니다.");
      return;
    }
    doMatchInner();
  });
}

function doMatchInner() {
  let claimed = null;
  const wref = db.ref("waiting");
  wref.transaction((cur) => {
    // 살아있는 대기자는 하트비트로 ts를 갱신하므로, 20초 넘게 오래된 것만 '유령'으로 간주
    if (!cur || cur.uid === uid || now() - cur.ts > 20000) {
      claimed = null;
      return { uid: uid, nick: state.nick, region: state.region,
               age: state.age, gender: state.gender, ts: now() };
    }
    claimed = cur;
    return null;             // 상대를 데려가고 대기열 비움
  }, (err, committed) => {
    if (err || !committed) { setTimeout(firebaseStartMatching, 400); return; }
    if (claimed) {
      if (claimed.uid === uid) { setTimeout(firebaseStartMatching, 300); return; }  // 자기 자신 방지
      // 잡은 상대가 차단된 사용자면 무시하고 다시 시도
      db.ref("banned/" + claimed.uid).once("value", (bs) => {
        if (bs.val() === true) { setTimeout(firebaseStartMatching, 300); return; }
        startRoomAsHost(claimed);
      });
    } else {
      waitForAssignment();
    }
  });
}

function startRoomAsHost(peer) {
  const roomId = db.ref("rooms").push().key;
  const room = {
    members: {
      [uid]: { nick: state.nick, region: state.region, age: state.age, gender: state.gender },
      [peer.uid]: { nick: peer.nick, region: peer.region || "미정",
                    age: peer.age || "미정", gender: peer.gender || "미정" },
    },
    ts: now(), closed: false,
  };
  db.ref("rooms/" + roomId).set(room).then(() => {
    db.ref("assign/" + peer.uid).set({ roomId: roomId, ts: now() });
    joinRoom(roomId, peer.nick, peer.uid, profileText(peer.age, peer.gender));  // 호스트 바로 입장
  });
}

function waitForAssignment() {
  // 대기 중 연결이 끊기면 대기열에서 자동 제거. 방 배정은 전역 리스너가 처리.
  const wref = db.ref("waiting");
  wref.onDisconnect().remove();
  // 하트비트: 내가 대기자인 동안 ts를 갱신(유령 오인 방지)
  clearInterval(state._waitBeat);
  state._waitBeat = setInterval(() => {
    wref.transaction((cur) => (cur && cur.uid === uid ? { ...cur, ts: now() } : cur));
  }, 5000);
  // 일정 시간 안에 매칭이 안 되면 재시도. 단, 놓친 배정이 있으면 그걸 먼저 처리(멈춤 복구)
  clearTimeout(state._waitRetry);
  state._waitRetry = setTimeout(function retry() {
    if (state.roomId) return;
    db.ref("assign/" + uid).once("value", (s) => {
      if (state.roomId) return;
      const v = s.val();
      if (v && v.roomId) { consumeAssign(v); }       // 리스너가 놓친 배정 복구
      else { stopWaitBeat(); firebaseStartMatching(); }
    });
  }, 6000);
}

function stopWaitBeat() {
  clearInterval(state._waitBeat);
  state._waitBeat = null;
  clearTimeout(state._waitRetry);
  state._waitRetry = null;
}

// 전역 배정 리스너: 일반 매칭과 관리자의 '특정인 지정'을 모두 처리.
// 대화 중이어도 새 방이 배정되면(관리자 강제 연결) 현재 대화를 종료하고 이동.
let _assignAttached = false;
function attachAssignListener() {
  if (_assignAttached || !uid) return;
  _assignAttached = true;
  db.ref("assign/" + uid).on("value", (snap) => consumeAssign(snap.val()));
}

// 배정된 방으로 입장 (리스너·재시도 양쪽에서 사용 → 놓쳐도 복구됨)
function consumeAssign(v) {
  if (!v || !v.roomId || v.roomId === state.roomId) return;
  db.ref("assign/" + uid).remove();
  db.ref("rooms/" + v.roomId).once("value", (rs) => {
    const room = rs.val();
    if (!room || room.closed) return;      // 이미 사라진/닫힌 방이면 무시
    const m = room.members || {};
    const pk = Object.keys(m).find((k) => k !== uid);
    if (!pk) {                             // 상대가 없는(자기 자신/빈) 방 → 무시하고 재매칭
      db.ref("rooms/" + v.roomId).remove();
      if (!state.roomId) setTimeout(firebaseStartMatching, 300);
      return;
    }
    if (state.roomId) {                    // 대화 중이면 현재 방 종료(상대에게 알림, 로그는 보존)
      const old = state.roomId;
      detachRoom();
      state.roomId = null;
      db.ref("rooms/" + old + "/closed").set(true);
    }
    stopWaitBeat();
    db.ref("waiting").onDisconnect().cancel();
    const pm = m[pk];
    joinRoom(v.roomId, pm ? pm.nick : "상대방", pk,
             pm ? profileText(pm.age, pm.gender) : "");
  });
}

function joinRoom(roomId, peerNick, peerUid, peerProfile) {
  stopWaitBeat();          // 매칭됐으니 대기 하트비트 중지
  state.roomId = roomId;
  db.ref("rooms/" + roomId + "/ready/" + uid).set(true);  // 내가 실제로 들어왔음을 알림
  // 상대 uid 기억 (신고 대상 식별용) — 넘겨받은 값 우선, 없으면 방에서 조회
  if (peerUid) {
    state.peerUid = peerUid;
  } else {
    db.ref("rooms/" + roomId + "/members").once("value", (ms) => {
      const m = ms.val() || {};
      state.peerUid = Object.keys(m).find((k) => k !== uid) || null;
    });
  }
  if (state.nick && state.nick !== "익명0000") $("my-name").textContent = state.nick;
  else refreshNick();      // 내 닉네임이 비어있으면 생성
  $("peer-name").textContent = peerNick || "상대방";
  $("peer-profile").textContent = "";   // 상대 연령·성별은 화면에 표시하지 않음(집계는 유지)
  enterChat();
  addSystem((peerNick || "상대방") + "님과 연결되었습니다.");
  addSystem("💡 자유롭게 대화를 나눠보세요.");
  watchLoc(roomId);
  if (state.locOn) shareMyLoc();   // 이번 접속에서 이미 켰으면 새 방에도 공유
  setLocBtn();

  // 내가 접속을 끊으면 상대에게 종료 신호 (삭제가 아니라 표시 → 상대가 읽을 수 있음)
  db.ref("rooms/" + roomId + "/closed").onDisconnect().set(true);

  // 메시지 수신
  const mref = db.ref("rooms/" + roomId + "/messages");
  state._msgRef = mref;
  mref.on("child_added", (snap) => {
    const msg = snap.val();
    if (!msg || msg.sender === uid) return;   // 내 메시지는 이미 표시됨
    showTyping(false);                        // 메시지 왔으니 입력중 표시 제거
    if (msg.type === "photo") addImage("peer", msg.content, msg.ts);
    else addMsg("peer", filterText(msg.text || ""), msg.ts);  // 받는 쪽도 필터
    notifyPing();                             // 알림음·진동
  });

  // 상대 입력 중 표시
  if (peerUid) {
    const tref = db.ref("rooms/" + roomId + "/typing/" + peerUid);
    state._typingRef = tref;
    tref.on("value", (snap) => {
      const ts = snap.val();
      const active = ts && (now() - ts < 4500) && state.roomId === roomId;
      showTyping(active);
      clearTimeout(state._typingHide);
      if (active) state._typingHide = setTimeout(() => showTyping(false), 4500);
    });
  }

  // 상대가 나가면 알림 (closed 표시로 감지 — 방 삭제 전에 신호가 전달됨)
  const cref = db.ref("rooms/" + roomId + "/closed");
  state._closedRef = cref;
  cref.on("value", (snap) => {
    if (snap.val() === true && state.roomId === roomId) {
      addLeaveNotice();   // "연결 끊김" + 다음 상대 찾기 버튼
    }
  });

  // 상대 닉네임 변경 시: 이름 갱신 + 대화창에 "이전 → 새이름" 안내 (최초 값은 생략)
  if (peerUid) {
    const nref = db.ref("rooms/" + roomId + "/members/" + peerUid + "/nick");
    state._peerNickRef = nref;
    let prevNick = null;
    nref.on("value", (snap) => {
      const v = snap.val();
      if (!v || state.roomId !== roomId) return;
      $("peer-name").textContent = v;
      if (prevNick && prevNick !== v) {
        addSystem("상대방 닉네임이 " + prevNick + " → " + v + " 로 변경되었습니다.");
      }
      prevNick = v;
    });
  }
}

function detachRoom() {
  if (state._msgRef) { state._msgRef.off(); state._msgRef = null; }
  if (state._closedRef) { state._closedRef.off(); state._closedRef = null; }
  if (state._peerNickRef) { state._peerNickRef.off(); state._peerNickRef = null; }
  if (state._typingRef) { state._typingRef.off(); state._typingRef = null; }
  if (state._locRef) { state._locRef.off(); state._locRef = null; }
  if (state.roomId && state.locOn) removeMyLoc();   // 대화 끝나면 내 위치 삭제
  clearTimeout(state._typingHide);
  showTyping(false);
  clearMyTyping();
  if (state.roomId) { db.ref("rooms/" + state.roomId + "/closed").onDisconnect().cancel(); }
}

// ---- 📍 상대방과의 거리 (실험) ----
// 정확한 좌표는 저장하지 않음: 약 5km 격자로 뭉갠 값만 방에 공유하고, 대화가 끝나면 삭제
const LOC_GRID = 0.05;   // 위도 0.05° ≈ 5.5km
const coarse = (v) => Math.round(v / LOC_GRID) * LOC_GRID;
let _locConsented = false;

function distKm(a, b) {   // 하버사인 거리
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function setLocBtn() {
  const b = $("btn-loc-toggle");
  b.textContent = state.locOn ? "📍 켜짐" : "📍 거리";
  b.classList.toggle("on", state.locOn);
}
function toggleLocShare() {
  if (state.locOn) {
    removeMyLoc();
    state.locOn = false; state.coords = null;
    setLocBtn();
    addSystem("📍 위치를 껐어요.");
    return;
  }
  if (!_locConsented &&
      !confirm("대략적인 위치(약 5km 단위)를 상대방과의 거리 계산에만 사용합니다.\n위치를 켤까요?")) return;
  _locConsented = true;
  requestLoc(false);
}
// quiet: 입장 동의 화면에서 미리 요청할 때(채팅 전이라 안내 생략)
function requestLoc(quiet) {
  if (!navigator.geolocation) { if (!quiet) addSystem("이 브라우저는 위치 기능을 지원하지 않아요."); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    state.coords = { lat: coarse(pos.coords.latitude), lng: coarse(pos.coords.longitude) };
    state.locOn = true;
    setLocBtn();
    shareMyLoc();
  }, () => {
    if (!quiet) addSystem("📍 위치 권한이 거부됐어요. 브라우저 설정에서 위치를 허용해 주세요.");
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}
function shareMyLoc() {
  if (!state.roomId || !state.coords) return;
  const ref = db.ref("rooms/" + state.roomId + "/loc/" + uid);
  ref.set(state.coords);
  ref.onDisconnect().remove();
}
function removeMyLoc() {
  if (!state.roomId) return;
  const ref = db.ref("rooms/" + state.roomId + "/loc/" + uid);
  ref.onDisconnect().cancel();
  ref.remove();
}
function watchLoc(roomId) {
  const ref = db.ref("rooms/" + roomId + "/loc");
  state._locRef = ref;
  let shown = null, peerHint = false, mineHint = false;
  ref.on("value", (snap) => {
    if (state.roomId !== roomId) return;
    const v = snap.val() || {};
    const mine = v[uid];
    const peerKey = Object.keys(v).find((k) => k !== uid);
    const peer = peerKey ? v[peerKey] : null;
    if (mine && peer) {
      const d = distKm(mine, peer);
      const text = d < 5 ? "📍 당신과 상대방의 거리는 5km 이내예요! 가까워요"
                         : "📍 당신과 상대방의 거리는 약 " + Math.round(d) + "km입니다!";
      if (text !== shown) { shown = text; addSystem(text); }
    } else if (peer && !peerHint) {
      peerHint = true;
      addSystem("📍 상대방이 위치를 켰어요. 위쪽 📍 버튼을 누르면 서로의 거리를 볼 수 있어요.");
    } else if (mine && !peer && !mineHint) {
      mineHint = true;
      addSystem("📍 위치를 켰어요. 상대방도 켜면 거리가 표시돼요.");
    }
    if (!mine || !peer) shown = null;
  });
}

function firebaseCancelMatching() {
  stopWaitBeat();
  // 대기열에서 나를 제거
  const wref = db.ref("waiting");
  wref.transaction((cur) => (cur && cur.uid === uid ? null : cur));
  wref.onDisconnect().cancel();
  detachRoom();
}

function firebaseSendText(text) {
  if (!state.roomId) return;
  db.ref("rooms/" + state.roomId + "/messages").push({
    sender: uid, type: "text", text: text, ts: now(),
  });
}

async function firebaseSendPhoto(file) {
  if (!state.roomId) return;
  try {
    const dataUrl = await compressImage(file);
    db.ref("rooms/" + state.roomId + "/messages").push({
      sender: uid, type: "photo", content: dataUrl, ts: now(),
    });
  } catch (e) {
    console.error("사진 전송 실패", e);
    addSystem("사진 전송에 실패했어요.");
  }
}

function firebaseLeave() {
  const rid = state.roomId;
  detachRoom();            // 내 리스너 먼저 해제 (자기 알림 방지)
  state.roomId = null;
  if (rid) db.ref("rooms/" + rid + "/closed").set(true);   // 상대에게 종료 전달 (로그는 보존)
}

function firebaseReport(reason) {
  const roomId = state.roomId;
  const report = { reason: reason, reporter: uid, reporterNick: state.nick,
                   peerNick: $("peer-name").textContent, peerUid: state.peerUid || null,
                   roomId: roomId || null, ts: now() };
  if (roomId) {
    // 신고 시점의 대화 로그를 함께 저장 (운영자 확인용)
    db.ref("rooms/" + roomId + "/messages").once("value", (snap) => {
      report.log = snap.val() || null;
      db.ref("reports").push(report);
    });
  } else {
    db.ref("reports").push(report);
  }
}

function firebaseUpdateRegion(region) {
  if (state.roomId && uid) {
    db.ref("rooms/" + state.roomId + "/members/" + uid + "/region").set(region);
  }
}

// 이미지 압축 → data URL (긴 변 1024px, JPEG 품질 0.6)
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      let { width: w, height: h } = img;
      if (w > max || h > max) {
        if (w >= h) { h = Math.round(h * max / w); w = max; }
        else { w = Math.round(w * max / h); h = max; }
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.6));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// 30분 지난 방·배정 정리 (서버 없이 접속자가 조금씩 청소)
function cleanupOld() {
  const cutoff = now() - ROOM_TTL;
  db.ref("rooms").orderByChild("ts").endAt(cutoff).once("value", (snap) => {
    snap.forEach((ch) => { ch.ref.remove(); });
  });
}

// 모바일 키보드 대응: 보이는 영역 높이를 채팅 화면에 반영
function fitViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const chat = $("screen-chat");
  if (chat.classList.contains("active")) {
    chat.style.height = h + "px";
    $("messages").scrollTop = $("messages").scrollHeight;
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitViewport);
  window.visualViewport.addEventListener("scroll", fitViewport);
}
window.addEventListener("resize", fitViewport);
// 입력창을 누르면(키보드 등장) 잠시 뒤 맨 아래로 스크롤
$("msg-input").addEventListener("focus", () => setTimeout(fitViewport, 300));

// 로고 탭 → 가리기(투명) 토글 — 랜덤채팅 특성상 화면을 가리고 싶을 때
const BRAND_HIDE_KEY = "rc_brand_hidden";
function applyBrandHidden() {
  let hidden = false;
  try { hidden = localStorage.getItem(BRAND_HIDE_KEY) === "1"; } catch (e) {}
  document.body.classList.toggle("brand-hidden", hidden);
}
function toggleBrand() {
  const hidden = !document.body.classList.contains("brand-hidden");
  document.body.classList.toggle("brand-hidden", hidden);
  try { localStorage.setItem(BRAND_HIDE_KEY, hidden ? "1" : "0"); } catch (e) {}
}
document.querySelectorAll(".hero-logo, .topbrand").forEach((el) =>
  el.addEventListener("click", toggleBrand));
applyBrandHidden();

// 시작: 항상 베타 비번 게이트부터
show("gate");
if (!hasFirebase) console.info("데모 모드: Firebase 설정이 비어 있습니다. config.js를 채우면 실제로 동작합니다.");
