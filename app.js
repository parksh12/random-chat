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
$("btn-theme").addEventListener("click", toggleTheme);
$("btn-theme-chat").addEventListener("click", toggleTheme);

const screens = ["consent", "ready", "waiting", "chat"];
function show(name) {
  screens.forEach((s) => $("screen-" + s).classList.toggle("active", s === name));
}

const hasFirebase = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);

// ---- Firebase 초기화 ----
let db = null, auth = null, uid = null;
if (hasFirebase) {
  firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.database();
  auth = firebase.auth();
  auth.onAuthStateChanged((u) => { if (u) uid = u.uid; });
  auth.signInAnonymously().catch((e) => {
    console.error("익명 로그인 실패", e);
    alert("서버 연결에 실패했어요. 잠시 후 새로고침 해주세요.");
  });
}
const now = () => Date.now();
const ROOM_TTL = 30 * 60 * 1000;   // 30분

// ---- 상태 ----
const LOC_KEY = "rc_loc_choice";   // "on" | "off" | null(아직 선택 안 함)
const state = {
  region: "미정",
  nick: "미정0000",
  coords: null,
  locOn: false,
};

// 대화명: 지역 + 4자리 숫자
function makeNick(region) {
  const n = String(Math.floor(1000 + Math.random() * 9000));
  return (region || "미정") + n;
}
function refreshNick() {
  state.nick = makeNick(state.region);
  $("nick-preview").textContent = state.nick;
  $("my-name").textContent = state.nick;
}

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
      refreshNick();
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

// 위치 끄기: 미정으로 되돌림
function disableLocation() {
  state.locOn = false;
  state.coords = null;
  state.region = "미정";
  saveLocChoice("off");
  refreshNick();
  applyLocUI();
  if (hasFirebase) firebaseUpdateRegion(state.region);
}

// 위치 상태를 준비화면·채팅 버튼에 모두 반영
function applyLocUI() {
  const choice = savedLocChoice();
  // 입장 준비 화면: 아직 한 번도 선택 안 했으면 '동의' 버튼, 선택했으면 상태만 표시
  const firstTime = choice === null;
  $("loc-row").style.display = firstTime ? "flex" : "none";
  $("loc-after").style.display = firstTime ? "none" : "block";
  $("loc-status").textContent = "위치: " + (state.locOn ? state.region : "미정");
  $("loc-after").textContent = state.locOn
    ? "위치: " + state.region + " · 대화 중 📍 버튼으로 끌 수 있어요"
    : "위치: 미정 · 대화 중 📍 버튼으로 켤 수 있어요";
  // 채팅 헤더 토글 버튼
  const t = $("btn-loc-toggle");
  t.textContent = "📍 " + (state.locOn ? state.region : "위치정보");
  t.classList.toggle("on", state.locOn);
}

// ---- 1단계: 동의 ----
$("agree-check").addEventListener("change", (e) => {
  $("btn-agree").disabled = !e.target.checked;
});
$("btn-agree").addEventListener("click", () => {
  refreshNick();
  applyLocUI();
  show("ready");
});

// ---- 2단계: 위치 / 입장 준비 ----
$("btn-loc").addEventListener("click", enableLocation);
$("btn-loc-skip").addEventListener("click", () => {
  saveLocChoice("off");
  state.locOn = false;
  applyLocUI();
});
// 채팅 중 위치 토글
$("btn-loc-toggle").addEventListener("click", () => {
  if (state.locOn) disableLocation();
  else enableLocation();
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
      const peer = "상대방" + Math.floor(1000 + Math.random() * 9000);
      $("peer-name").textContent = peer;
      enterChat();
      addSystem(peer + "님과 연결되었습니다.");
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
  img.addEventListener("click", () => openViewer(url));  // 눌러서 전체화면
  el.appendChild(img);
  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
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

// 나가기 = 현재 대화 종료 후 바로 다음 상대 매칭
$("btn-leave").addEventListener("click", nextPartner);
function nextPartner() {
  if (hasFirebase) firebaseLeave();
  clearTimeout(state._demoTimer);
  closeReport();
  refreshNick();               // 새 상대에게는 새 대화명
  show("waiting");
  startMatching();
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
  waitForAuth(() => {
    cleanupOld();            // 오래된 방·대기 정리(30분)
    let claimed = null;
    const wref = db.ref("waiting");
    wref.transaction((cur) => {
      if (!cur || cur.uid === uid || now() - cur.ts > 30000) {
        claimed = null;
        return { uid: uid, nick: state.nick, region: state.region, ts: now() };
      }
      claimed = cur;
      return null;           // 상대를 데려가고 대기열 비움
    }, (err, committed) => {
      if (err || !committed) { setTimeout(firebaseStartMatching, 500); return; }
      if (claimed) startRoomAsHost(claimed);
      else waitForAssignment();
    });
  });
}

function startRoomAsHost(peer) {
  const roomId = db.ref("rooms").push().key;
  const room = {
    members: {
      [uid]: { nick: state.nick, region: state.region },
      [peer.uid]: { nick: peer.nick, region: peer.region || "미정" },
    },
    ts: now(), closed: false,
  };
  db.ref("rooms/" + roomId).set(room).then(() => {
    db.ref("assign/" + peer.uid).set({ roomId: roomId, ts: now() });
    joinRoom(roomId, peer.nick);
  });
}

function waitForAssignment() {
  // 대기 중 연결 끊기면 대기열에서 자동 제거
  const wref = db.ref("waiting");
  wref.onDisconnect().remove();
  state._waitRef = wref;
  const aref = db.ref("assign/" + uid);
  state._assignRef = aref;
  aref.on("value", (snap) => {
    const v = snap.val();
    if (v && v.roomId) {
      aref.off();
      aref.remove();
      wref.onDisconnect().cancel();
      db.ref("rooms/" + v.roomId + "/members").once("value", (ms) => {
        const m = ms.val() || {};
        const pk = Object.keys(m).find((k) => k !== uid);
        joinRoom(v.roomId, pk ? m[pk].nick : "상대방");
      });
    }
  });
}

function joinRoom(roomId, peerNick) {
  state.roomId = roomId;
  $("peer-name").textContent = peerNick || "상대방";
  enterChat();
  addSystem((peerNick || "상대방") + "님과 연결되었습니다.");

  // 메시지 수신
  const mref = db.ref("rooms/" + roomId + "/messages");
  state._msgRef = mref;
  mref.on("child_added", (snap) => {
    const msg = snap.val();
    if (!msg || msg.sender === uid) return;   // 내 메시지는 이미 표시됨
    if (msg.type === "photo") addImage("peer", msg.content);
    else addMsg("peer", msg.text || "");
  });

  // 상대가 나가면 알림
  const cref = db.ref("rooms/" + roomId + "/closed");
  state._closedRef = cref;
  cref.on("value", (snap) => {
    if (snap.val() === true) addSystem("상대가 대화를 종료했습니다. ‘다음 상대 ›’를 눌러 계속하세요.");
  });
}

function detachRoom() {
  if (state._msgRef) { state._msgRef.off(); state._msgRef = null; }
  if (state._closedRef) { state._closedRef.off(); state._closedRef = null; }
  if (state._assignRef) { state._assignRef.off(); db.ref("assign/" + uid).remove(); state._assignRef = null; }
}

function firebaseCancelMatching() {
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
  if (state.roomId) {
    db.ref("rooms/" + state.roomId + "/closed").set(true);
  }
  detachRoom();
  state.roomId = null;
}

function firebaseReport(reason) {
  const roomId = state.roomId;
  const report = { reason: reason, reporter: uid, reporterNick: state.nick,
                   peerNick: $("peer-name").textContent, roomId: roomId || null, ts: now() };
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

// 시작
show("consent");
if (!hasFirebase) console.info("데모 모드: Firebase 설정이 비어 있습니다. config.js를 채우면 실제로 동작합니다.");
