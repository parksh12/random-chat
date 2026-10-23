"use strict";
/* 관리자 대시보드.
   - 관리자 이메일/비밀번호 로그인
   - 요약(총 신고/신고된 이용자/차단/대기), 신고된 이용자별 묶음, 최근 신고, 차단 목록
   - 신고된 이용자 차단/해제
   보안: 신고(reports) 읽기는 관리자 UID만. 남의 대화방·전체 이용자 목록은 보지 않음(사생활 보호). */

const $ = (id) => document.getElementById(id);
firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.database();
const now = () => Date.now();

let allReports = [];     // {key, ...report}
let bannedSet = {};      // uid -> true

// ---- 로그인 ----
$("btn-login").addEventListener("click", login);
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
function login() {
  initAudio();
  $("login-msg").textContent = "";
  auth.signInWithEmailAndPassword($("email").value.trim(), $("pw").value)
    .catch((e) => { $("login-msg").textContent = "로그인 실패: " + (e.code || e.message); });
}

// ---- 새 신고 알림 (소리·진동·탭 제목) ----
let _audioCtx = null, _prevCount = null, _titleTimer = null;
function initAudio() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx && _audioCtx.state === "suspended") _audioCtx.resume();
  } catch (e) {}
}
function alertNewReport() {
  try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]); } catch (e) {}
  if (_audioCtx) try {
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.type = "triangle"; o.frequency.value = 760;
    const t = _audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(_audioCtx.destination); o.start(t); o.stop(t + 0.37);
  } catch (e) {}
  // 탭 제목 깜빡임
  clearInterval(_titleTimer);
  let on = true, n = 0;
  _titleTimer = setInterval(() => {
    document.title = on ? "🔴 새 신고!" : "랜덤7942 · 관리자";
    on = !on;
    if (++n > 8) { clearInterval(_titleTimer); document.title = "랜덤7942 · 관리자"; }
  }, 600);
}
$("btn-logout").addEventListener("click", () => auth.signOut());
$("btn-refresh").addEventListener("click", () => location.reload());

auth.onAuthStateChanged((u) => {
  if (u) {
    $("login").style.display = "none";
    $("main").style.display = "block";
    watchAll();
  } else {
    $("main").style.display = "none";
    $("login").style.display = "block";
  }
});

// ---- 탭 ----
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("panel-" + t.dataset.tab).classList.add("active");
  });
});

// ---- 데이터 구독 ----
function watchAll() {
  db.ref("reports").orderByChild("ts").on("value", (snap) => {
    allReports = [];
    snap.forEach((ch) => { allReports.push({ key: ch.key, ...ch.val() }); });
    allReports.reverse();
    if (_prevCount !== null && allReports.length > _prevCount) alertNewReport();  // 새 신고 알림
    _prevCount = allReports.length;
    renderSummary(); renderUsers(); renderRecent();
  }, (err) => {
    $("panel-users").innerHTML =
      '<div class="empty">신고를 읽을 권한이 없어요. 관리자 계정인지 확인하세요.<br>(' +
      (err.code || err.message) + ")</div>";
  });

  db.ref("banned").on("value", (snap) => {
    bannedSet = snap.val() || {};
    renderSummary(); renderUsers(); renderRecent(); renderBanned();
  });

  // 실시간 접속 현황(익명 집계 — 숫자만)
  db.ref("presence").on("value", (snap) => {
    let online = 0, chatting = 0, waiting = 0;
    const byAge = {}, byGender = {};
    const fresh = now() - 70000;   // 70초 내 갱신된 것만(끊긴 유령 제외)
    snap.forEach((ch) => {
      const v = ch.val() || {};
      if ((v.ts || 0) < fresh) return;
      online++;
      if (v.state === "chatting") chatting++;
      else if (v.state === "waiting") waiting++;
      const a = v.age || "미정", g = v.gender || "미정";
      byAge[a] = (byAge[a] || 0) + 1;
      byGender[g] = (byGender[g] || 0) + 1;
    });
    $("c-online").textContent = online;
    $("c-chatting").textContent = chatting;
    $("c-waiting").textContent = waiting;
    renderBreakdown("bd-age", byAge, ["10대", "20대", "30대", "40대", "50대+", "미정"]);
    renderBreakdown("bd-gender", byGender, ["남성", "여성", "미정"]);
  });

  // 전체 공지
  db.ref("config/notice").on("value", (snap) => {
    const n = snap.val();
    $("notice-text").value = n && n.text ? n.text : "";
  });
  $("btn-notice-save").addEventListener("click", () => {
    const text = $("notice-text").value.trim();
    db.ref("config/notice").set({ text: text, ts: now() })
      .then(() => { $("notice-status").textContent = text ? "게시됨" : "삭제됨"; });
  });
  $("btn-notice-clear").addEventListener("click", () => {
    $("notice-text").value = "";
    db.ref("config/notice").remove().then(() => { $("notice-status").textContent = "삭제됨"; });
  });
}

// ---- 요약 ----
function renderSummary() {
  const users = new Set(allReports.filter((r) => r.peerUid).map((r) => r.peerUid));
  const dayAgo = now() - 24 * 60 * 60 * 1000;
  $("c-reports").textContent = allReports.length;
  $("c-today").textContent = allReports.filter((r) => (r.ts || 0) >= dayAgo).length;
  $("c-users").textContent = users.size;
  $("c-banned").textContent = Object.keys(bannedSet).filter((k) => bannedSet[k]).length;
  const un = $("c-unresolved");
  if (un) un.textContent = allReports.filter((r) => !r.resolved).length;
  renderStats();
}

// 신고 사유별 통계 (막대)
function renderStats() {
  const box = $("panel-stats");
  if (!box) return;
  if (!allReports.length) { box.innerHTML = '<div class="empty">집계할 신고가 없어요.</div>'; return; }
  const counts = {};
  allReports.forEach((r) => { counts[r.reason || "기타"] = (counts[r.reason || "기타"] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = entries[0][1];
  box.innerHTML = "";
  entries.forEach(([reason, n]) => {
    const row = document.createElement("div");
    row.className = "statrow";
    row.innerHTML = `<div class="lbl">${escapeHtml(reason)}</div>` +
      `<div class="bar" style="width:${Math.round((n / max) * 220)}px"></div>` +
      `<div class="val">${n}건</div>`;
    box.appendChild(row);
  });
}

// ---- 신고된 이용자별 묶음 ----
function renderUsers() {
  const box = $("panel-users");
  const groups = {};   // peerUid -> {nick, reports:[]}
  allReports.forEach((r) => {
    if (!r.peerUid) return;
    (groups[r.peerUid] = groups[r.peerUid] || { nick: r.peerNick, reports: [] }).reports.push(r);
  });
  const list = Object.entries(groups).sort((a, b) => b[1].reports.length - a[1].reports.length);
  if (!list.length) { box.innerHTML = '<div class="empty">신고된 이용자가 없어요.</div>'; return; }
  box.innerHTML = "";
  list.forEach(([puid, g]) => {
    const banned = bannedSet[puid] === true;
    const reasons = {};
    g.reports.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    const item = document.createElement("div");
    item.className = "item";
    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    left.innerHTML =
      `<div><b>${escapeHtml(g.nick || "이용자")}</b> ` +
      `<span class="tag cnt">신고 ${g.reports.length}회</span>` +
      (banned ? ' <span class="tag">차단됨</span>' : "") + `</div>` +
      `<div class="mono">${escapeHtml(puid)}</div>` +
      `<div style="margin-top:6px">` +
      Object.entries(reasons).map(([k, v]) => `<span class="tag">${escapeHtml(k)} ×${v}</span>`).join("") +
      `</div>`;
    const acts = document.createElement("div");
    acts.className = "acts";
    const btnLog = document.createElement("button");
    btnLog.className = "ghost"; btnLog.textContent = "신고 내역";
    const btnBan = document.createElement("button");
    btnBan.className = banned ? "ghost" : "danger";
    btnBan.textContent = banned ? "차단 해제" : "차단";
    acts.appendChild(btnLog); acts.appendChild(btnBan);
    row.appendChild(left); row.appendChild(acts);
    item.appendChild(row);

    const log = document.createElement("div");
    log.className = "log";
    g.reports.forEach((r) => {
      const sub = document.createElement("div");
      sub.className = "sub-report";
      sub.innerHTML = `<div class="muted">${timeStr(r.ts)} · 신고자 ${escapeHtml(r.reporterNick || "?")} · ${escapeHtml(r.reason || "")}</div>`;
      sub.appendChild(renderLog(r));
      log.appendChild(sub);
    });
    item.appendChild(log);

    btnLog.addEventListener("click", () => log.classList.toggle("open"));
    btnBan.addEventListener("click", () => toggleBan(puid, banned));
    box.appendChild(item);
  });
}

// ---- 최근 신고(평면) ----
function renderRecent() {
  const box = $("panel-recent");
  if (!allReports.length) { box.innerHTML = '<div class="empty">아직 신고가 없어요.</div>'; return; }
  box.innerHTML = "";
  allReports.forEach((r) => {
    const item = document.createElement("div");
    item.className = "item" + (r.resolved ? " resolved" : "");
    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    left.innerHTML = `<span class="tag">${escapeHtml(r.reason || "기타")}</span>` +
      (r.resolved ? ' <span class="tag ok">처리완료</span>' : "") +
      `<div class="muted" style="margin-top:6px">신고자 <b>${escapeHtml(r.reporterNick || "?")}</b> → 대상 <b>${escapeHtml(r.peerNick || "?")}</b><br>${timeStr(r.ts)}</div>`;
    const acts = document.createElement("div"); acts.className = "acts";
    const btnLog = document.createElement("button");
    btnLog.className = "ghost"; btnLog.textContent = "대화 보기";
    const btnDone = document.createElement("button");
    btnDone.className = r.resolved ? "ghost" : "primary";
    btnDone.textContent = r.resolved ? "처리취소" : "처리완료";
    btnDone.addEventListener("click", () =>
      db.ref("reports/" + r.key + "/resolved").set(!r.resolved));
    acts.appendChild(btnLog); acts.appendChild(btnDone);
    row.appendChild(left); row.appendChild(acts);
    item.appendChild(row);
    const log = document.createElement("div");
    log.className = "log"; log.appendChild(renderLog(r));
    item.appendChild(log);
    btnLog.addEventListener("click", () => log.classList.toggle("open"));
    box.appendChild(item);
  });
}

// ---- 차단 목록 ----
function renderBanned() {
  const box = $("panel-banned");
  const uids = Object.keys(bannedSet).filter((k) => bannedSet[k]);
  if (!uids.length) { box.innerHTML = '<div class="empty">차단된 이용자가 없어요.</div>'; return; }
  box.innerHTML = "";
  uids.forEach((puid) => {
    // 이 uid의 최근 닉네임(신고 기록에서)
    const rep = allReports.find((r) => r.peerUid === puid);
    const item = document.createElement("div");
    item.className = "item";
    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    left.innerHTML = `<div><b>${escapeHtml(rep ? rep.peerNick : "이용자")}</b> <span class="tag">차단됨</span></div><div class="mono">${escapeHtml(puid)}</div>`;
    const btn = document.createElement("button");
    btn.className = "ghost"; btn.textContent = "차단 해제";
    btn.addEventListener("click", () => toggleBan(puid, true));
    row.appendChild(left); row.appendChild(btn);
    item.appendChild(row);
    box.appendChild(item);
  });
}

function toggleBan(uid, currentlyBanned) {
  if (currentlyBanned) {
    db.ref("banned/" + uid).remove();
  } else if (confirm("이 이용자를 차단할까요?\n차단하면 더 이상 매칭되지 않습니다.")) {
    db.ref("banned/" + uid).set(true);
  }
}

// ---- 공통 ----
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
      const img = document.createElement("img"); img.src = m.content; b.appendChild(img);
    } else { b.textContent = m.text || ""; }
    wrap.appendChild(b);
  });
  return wrap;
}

// 연령·성별 집계 표시
function renderBreakdown(elId, counts, order) {
  const el = document.getElementById(elId);
  if (!el) return;
  const keys = order.filter((k) => counts[k]);
  if (!keys.length) { el.innerHTML = '<span class="muted">접속 중인 이용자 없음</span>'; return; }
  el.innerHTML = keys.map((k) =>
    `<span class="bd-chip">${escapeHtml(k)} <b>${counts[k]}</b></span>`).join("");
}

function timeStr(ts) {
  const d = new Date(ts || 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
