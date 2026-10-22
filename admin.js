"use strict";
/* 신고 관리 페이지.
   - 관리자 이메일/비밀번호로 로그인 (Firebase Authentication)
   - 신고 목록·사유·대화·사진 열람 (신고된 건만)
   - 신고된 이용자에게 '바로 연결'해서 안내·경고
   보안: 신고(reports) 읽기는 보안 규칙에서 관리자 UID만 허용. */

const $ = (id) => document.getElementById(id);
firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.database();
const now = () => Date.now();
let adminUid = null;
const REASON_OF = (r) => r || "기타";

// ---- 로그인 ----
$("btn-login").addEventListener("click", login);
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
function login() {
  const email = $("email").value.trim();
  const pw = $("pw").value;
  $("login-msg").textContent = "";
  auth.signInWithEmailAndPassword(email, pw).catch((e) => {
    $("login-msg").textContent = "로그인 실패: " + (e.code || e.message);
  });
}
$("btn-logout").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged((u) => {
  if (u) {
    adminUid = u.uid;
    $("login").style.display = "none";
    $("main").style.display = "block";
    watchReports();
  } else {
    adminUid = null;
    $("main").style.display = "none";
    $("login").style.display = "block";
    $("reports").innerHTML = "";
  }
});

// ---- 신고 목록 ----
function watchReports() {
  db.ref("reports").orderByChild("ts").on("value", (snap) => {
    const list = [];
    snap.forEach((ch) => { list.push({ key: ch.key, ...ch.val() }); });
    list.reverse();                 // 최신순
    renderReports(list);
  }, (err) => {
    $("reports").innerHTML =
      '<div class="empty">신고를 읽을 권한이 없어요.<br>이 계정이 관리자 UID로 등록됐는지 확인하세요.<br>(' +
      (err.code || err.message) + ")</div>";
  });
}

function timeStr(ts) {
  const d = new Date(ts || 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderReports(list) {
  const box = $("reports");
  if (!list.length) { box.innerHTML = '<div class="empty">아직 신고가 없어요.</div>'; return; }
  box.innerHTML = "";
  list.forEach((r) => {
    const item = document.createElement("div");
    item.className = "item";

    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    left.innerHTML = `<span class="tag">${escapeHtml(REASON_OF(r.reason))}</span>
      <div class="muted" style="margin-top:6px">
        신고자 <b>${escapeHtml(r.reporterNick || "?")}</b> → 대상 <b>${escapeHtml(r.peerNick || "?")}</b><br>
        ${timeStr(r.ts)}</div>`;
    const acts = document.createElement("div");
    acts.className = "acts";
    const btnLog = document.createElement("button");
    btnLog.className = "ghost"; btnLog.textContent = "대화 보기";
    const btnBan = document.createElement("button");
    btnBan.className = "primary"; btnBan.textContent = "차단";
    btnBan.disabled = !r.peerUid;
    acts.appendChild(btnLog); acts.appendChild(btnBan);
    row.appendChild(left); row.appendChild(acts);
    item.appendChild(row);

    const log = document.createElement("div");
    log.className = "log";
    log.appendChild(renderLog(r));
    item.appendChild(log);

    btnLog.addEventListener("click", () => log.classList.toggle("open"));
    // 현재 차단 상태 반영
    if (r.peerUid) {
      db.ref("banned/" + r.peerUid).on("value", (bs) => {
        const banned = bs.val() === true;
        btnBan.textContent = banned ? "차단 해제" : "차단";
        btnBan.className = banned ? "ghost" : "primary";
      });
      btnBan.addEventListener("click", () => {
        db.ref("banned/" + r.peerUid).once("value", (bs) => {
          const banned = bs.val() === true;
          if (banned) {
            db.ref("banned/" + r.peerUid).remove();
          } else if (confirm("이 이용자를 차단할까요?\n차단하면 더 이상 매칭되지 않습니다.")) {
            db.ref("banned/" + r.peerUid).set(true);
          }
        });
      });
    }
    box.appendChild(item);
  });
}

function renderLog(r) {
  const wrap = document.createElement("div");
  wrap.className = "msgs";
  const msgs = r.log ? Object.values(r.log) : [];
  if (!msgs.length) {
    const p = document.createElement("div");
    p.className = "muted"; p.textContent = "저장된 대화 내용이 없어요.";
    return p;
  }
  msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  msgs.forEach((m) => {
    const b = document.createElement("div");
    b.className = "bubble " + (m.sender === r.reporter ? "rep" : "oth");
    if (m.type === "photo") {
      const img = document.createElement("img");
      img.src = m.content; b.appendChild(img);
    } else {
      b.textContent = m.text || "";
    }
    wrap.appendChild(b);
  });
  return wrap;
}

// ---- 신고된 이용자에게 연결 (안내·경고) ----
let respRoom = null, respMsgRef = null;
function connectUser(peerUid, peerNick) {
  if (!peerUid) {
    alert("이 신고에는 대상 이용자 정보가 없어 바로 연결할 수 없어요.\n(옛 버전 신고이거나 상대 정보 누락)");
    return;
  }
  const roomId = db.ref("rooms").push().key;
  db.ref("rooms/" + roomId).set({
    members: {
      [adminUid]: { nick: "운영자", region: "관리자" },
      [peerUid]: { nick: peerNick || "이용자", region: "" },
    },
    ts: now(), closed: false,
  }).then(() => {
    db.ref("assign/" + peerUid).set({ roomId: roomId, forced: true, ts: now() });
    openResp(roomId, peerNick);
    // 상대가 실제로 들어왔는지 확인해서 표시
    const readyRef = db.ref("rooms/" + roomId + "/ready/" + peerUid);
    let joined = false;
    readyRef.on("value", (s) => {
      if (s.val() === true) { joined = true; readyRef.off(); $("resp-peer").textContent = (peerNick || "이용자") + " · 연결됨"; }
    });
    setTimeout(() => {
      if (!joined) { readyRef.off(); $("resp-peer").textContent = (peerNick || "이용자") + " · 접속 중이 아닐 수 있음"; }
    }, 8000);
  });
}

function openResp(roomId, peerNick) {
  respRoom = roomId;
  $("resp-peer").textContent = (peerNick || "이용자") + " 님에게 안내";
  $("resp-msgs").innerHTML = "";
  $("resp").classList.add("open");
  respMsgRef = db.ref("rooms/" + roomId + "/messages");
  respMsgRef.on("child_added", (snap) => {
    const m = snap.val(); if (!m) return;
    const b = document.createElement("div");
    b.className = "bubble " + (m.sender === adminUid ? "me" : "oth");
    if (m.type === "photo") {
      const img = document.createElement("img"); img.src = m.content; b.appendChild(img);
    } else { b.textContent = m.text || ""; }
    $("resp-msgs").appendChild(b);
    $("resp-msgs").parentElement.scrollTop = $("resp-msgs").parentElement.scrollHeight;
  });
}
function closeResp() {
  if (respMsgRef) { respMsgRef.off(); respMsgRef = null; }
  if (respRoom) { db.ref("rooms/" + respRoom + "/closed").set(true); respRoom = null; }
  $("resp").classList.remove("open");
}
$("resp-close").addEventListener("click", closeResp);
$("resp-send").addEventListener("click", sendResp);
$("resp-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendResp(); });
function sendResp() {
  const t = $("resp-input").value.trim();
  if (!t || !respRoom) return;
  db.ref("rooms/" + respRoom + "/messages").push({
    sender: adminUid, type: "text", text: t, ts: now(),
  });
  $("resp-input").value = "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
