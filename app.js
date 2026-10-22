"use strict";
/* 랜덤채팅 프론트엔드.
   - Firebase 설정이 채워지면 실제 매칭/메시지로 동작 (연결 코드는 추후 추가).
   - 비어 있으면 '데모 모드': 혼자서 화면 흐름과 UI만 확인. */

const $ = (id) => document.getElementById(id);
const screens = ["consent", "ready", "waiting", "chat"];
function show(name) {
  screens.forEach((s) => $("screen-" + s).classList.toggle("active", s === name));
}

const hasFirebase = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);

// ---- 상태 ----
const state = {
  region: "미정",
  nick: "미정0000",
  coords: null,
};

// 대화명: 지역 + 4자리 숫자
function makeNick(region) {
  const n = String(Math.floor(1000 + Math.random() * 9000));
  return (region || "미정") + n;
}

// ---- 1단계: 동의 ----
$("agree-check").addEventListener("change", (e) => {
  $("btn-agree").disabled = !e.target.checked;
});
$("btn-agree").addEventListener("click", () => {
  state.nick = makeNick(state.region);
  $("nick-preview").textContent = state.nick;
  show("ready");
});

// ---- 2단계: 위치 / 입장 준비 ----
$("btn-loc").addEventListener("click", () => {
  if (!navigator.geolocation) {
    $("loc-status").textContent = "위치: 지원 안 함";
    return;
  }
  $("loc-status").textContent = "위치: 확인 중…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.region = await regionFromCoords(state.coords);
      state.nick = makeNick(state.region);
      $("nick-preview").textContent = state.nick;
      $("loc-status").textContent = "위치: " + state.region;
    },
    () => { $("loc-status").textContent = "위치: 거부됨 (미정)"; },
    { enableHighAccuracy: false, timeout: 8000 }
  );
});

// 좌표 → 지역명. 지금은 간단 변환(데모). 추후 정식 역지오코딩으로 교체.
async function regionFromCoords(c) {
  // 대략적인 한국 광역권 추정 (데모용 placeholder)
  if (c.lat > 37.4 && c.lat < 37.7 && c.lng > 126.8 && c.lng < 127.2) return "서울";
  if (c.lat > 36.4 && c.lat < 36.6 && c.lng > 127.2 && c.lng < 127.4) return "세종";
  if (c.lat > 35.0 && c.lat < 35.3 && c.lng > 128.9 && c.lng < 129.3) return "부산";
  return "기타지역";
}

$("btn-start").addEventListener("click", () => {
  show("waiting");
  startMatching();
});
$("btn-cancel").addEventListener("click", () => {
  cancelMatching();
  show("ready");
});

// ---- 3·4단계: 매칭 & 채팅 ----
function startMatching() {
  if (hasFirebase) {
    firebaseStartMatching();  // 추후 구현
  } else {
    // 데모: 2초 뒤 가짜 상대와 연결
    state._demoTimer = setTimeout(() => {
      $("peer-name").textContent = "상대방" + Math.floor(1000 + Math.random() * 9000);
      enterChat();
      addSystem("상대와 연결되었습니다. (데모 모드)");
    }, 2000);
  }
}
function cancelMatching() {
  clearTimeout(state._demoTimer);
  if (hasFirebase) firebaseCancelMatching();
}
function enterChat() {
  $("messages").innerHTML = "";
  show("chat");
  fitViewport();
}

// 메시지 그리기
function addMsg(kind, text) {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  el.textContent = text;
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function addImage(kind, url) {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  const img = document.createElement("img");
  img.src = url;
  el.appendChild(img);
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function addSystem(text) { addMsg("sys", text); }

// 텍스트 전송
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("msg-input").value.trim();
  if (!text) return;
  addMsg("mine", text);
  $("msg-input").value = "";
  if (hasFirebase) firebaseSendText(text);
  else setTimeout(() => addMsg("peer", "(데모) 받았어요: " + text), 600);
});

// 사진 전송
$("photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const url = URL.createObjectURL(file);
  addImage("mine", url);
  if (hasFirebase) firebaseSendPhoto(file);
});

// 나가기
$("btn-leave").addEventListener("click", () => {
  if (hasFirebase) firebaseLeave();
  clearTimeout(state._demoTimer);
  show("ready");
});

// 신고 (신고된 대화/사진만 운영자에게 전달)
$("btn-report").addEventListener("click", () => {
  if (!confirm("이 대화를 운영자에게 신고할까요?\n신고된 대화와 사진이 운영자에게 전달됩니다.")) return;
  if (hasFirebase) firebaseReport();
  addSystem("신고가 접수되었습니다. 운영자가 확인합니다.");
});

// ---- Firebase 연동 (프로젝트 생성 후 구현 예정) ----
function firebaseStartMatching() { console.warn("Firebase 매칭 미구현"); }
function firebaseCancelMatching() {}
function firebaseSendText(t) {}
function firebaseSendPhoto(f) {}
function firebaseLeave() {}
function firebaseReport() {}

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

// 시작
show("consent");
if (!hasFirebase) console.info("데모 모드: Firebase 설정이 비어 있습니다. config.js를 채우면 실제로 동작합니다.");
