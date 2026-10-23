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
      (err.code || err.message) + ')<br><span class="mono">로그인 UID: ' +
      escapeHtml((auth.currentUser || {}).uid || "없음") + "</span></div>";
  });

  db.ref("banned").on("value", (snap) => {
    bannedSet = snap.val() || {};
    renderSummary(); renderUsers(); renderRecent(); renderBanned();
  });

  // 브레인스토밍 대화 로그 (운영자 취합용 — 참가자에게 기록됨을 고지)
  db.ref("rooms").on("value", (snap) => {
    const rooms = [];
    snap.forEach((ch) => { rooms.push({ id: ch.key, ...(ch.val() || {}) }); });
    renderLogs(rooms);
  }, (err) => {
    $("panel-logs").innerHTML = '<div class="empty">로그 읽기 권한 없음 (' + (err.code || "") + ")</div>";
  });

  // 실시간 접속 현황(익명 집계 — 숫자만)
  db.ref("presence").on("value", (snap) => {
    let online = 0, chatting = 0, waiting = 0, idle = 0;
    const fresh = now() - 70000;   // 70초 내 갱신된 것만(끊긴 유령 제외)
    snap.forEach((ch) => {
      const v = ch.val() || {};
      if ((v.ts || 0) < fresh) return;
      online++;
      if (v.state === "chatting") chatting++;
      else if (v.state === "waiting") waiting++;
      else idle++;
    });
    $("c-online").textContent = online;
    $("c-chatting").textContent = chatting;
    $("c-waiting").textContent = waiting;
    if ($("c-idle")) $("c-idle").textContent = idle;
    if ($("c-rooms")) $("c-rooms").textContent = Math.floor(chatting / 2);  // 진행 중 대화(추정)
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

// ---- 브레인스토밍 대화 로그 ----
// 실시간 갱신으로 다시 그려져도 선택·펼침 상태 유지
const selectedRooms = new Set();
const openRooms = new Set();
let lastRooms = [];
let sortMode = "new";

const msgCount = (r) => (r.messages ? Object.keys(r.messages).length : 0);
function duration(r) {   // 첫 메시지 ~ 마지막 메시지 시간
  const ts = r.messages ? Object.values(r.messages).map((m) => m.ts || 0) : [];
  return ts.length ? Math.max(...ts) - Math.min(...ts) : 0;
}
const photoCount = (r) => (r.messages ? Object.values(r.messages).filter((m) => m.type === "photo").length : 0);
const _sizeCache = new WeakMap();
function roomSize(r) {   // DB 저장 용량(바이트, 근사치)
  if (!_sizeCache.has(r)) _sizeCache.set(r, new Blob([JSON.stringify(r)]).size);
  return _sizeCache.get(r);
}
const SORTS = {
  new:    { label: "최신순",         fn: (a, b) => (b.ts || 0) - (a.ts || 0) },
  old:    { label: "오래된순",       fn: (a, b) => (a.ts || 0) - (b.ts || 0) },
  msgs:   { label: "메시지 많은순",  fn: (a, b) => msgCount(b) - msgCount(a) || (b.ts || 0) - (a.ts || 0) },
  dur:    { label: "대화 시간 긴순", fn: (a, b) => duration(b) - duration(a) || (b.ts || 0) - (a.ts || 0) },
  photos: { label: "사진 많은순",    fn: (a, b) => photoCount(b) - photoCount(a) || (b.ts || 0) - (a.ts || 0) },
  size:   { label: "용량 큰순",      fn: (a, b) => roomSize(b) - roomSize(a) },
};

function renderLogs(rooms) {
  rooms = rooms.slice().sort(SORTS[sortMode].fn);
  lastRooms = rooms;
  const box = $("panel-logs");
  const ids = new Set(rooms.map((r) => r.id));
  [...selectedRooms].forEach((id) => { if (!ids.has(id)) selectedRooms.delete(id); });
  if (!rooms.length) { box.innerHTML = '<div class="empty">아직 대화가 없어요.</div>'; return; }
  const totalMsgs = rooms.reduce((a, r) => a + (r.messages ? Object.keys(r.messages).length : 0), 0);
  box.innerHTML = "";

  // 선택 삭제 바
  const bar = document.createElement("div"); bar.className = "selbar";
  const allLbl = document.createElement("label"); allLbl.className = "chk";
  const allChk = document.createElement("input"); allChk.type = "checkbox";
  allChk.checked = selectedRooms.size === rooms.length;
  allChk.indeterminate = selectedRooms.size > 0 && selectedRooms.size < rooms.length;
  allLbl.appendChild(allChk);
  allLbl.appendChild(document.createTextNode(" 전체 선택"));
  const info = document.createElement("span"); info.className = "muted";
  info.textContent = "총 " + rooms.length + "개 대화 · 메시지 " + totalMsgs + "개 · " +
    sizeStr(rooms.reduce((a, r) => a + roomSize(r), 0));
  const sel = document.createElement("select");
  Object.entries(SORTS).forEach(([k, s]) => {
    const o = document.createElement("option"); o.value = k; o.textContent = s.label;
    o.selected = k === sortMode; sel.appendChild(o);
  });
  sel.addEventListener("change", () => { sortMode = sel.value; renderLogs(lastRooms); });
  const btnOpen = document.createElement("button"); btnOpen.className = "ghost";
  btnOpen.textContent = "모두 열기";
  btnOpen.addEventListener("click", () => { rooms.forEach((r) => openRooms.add(r.id)); renderLogs(lastRooms); });
  const btnClose = document.createElement("button"); btnClose.className = "ghost";
  btnClose.textContent = "모두 닫기";
  btnClose.addEventListener("click", () => { openRooms.clear(); renderLogs(lastRooms); });
  const btnDel = document.createElement("button"); btnDel.className = "danger";
  btnDel.textContent = "선택 삭제 (" + selectedRooms.size + ")";
  btnDel.disabled = selectedRooms.size === 0;
  [allLbl, info, sel, btnOpen, btnClose, btnDel].forEach((el) => bar.appendChild(el));
  box.appendChild(bar);
  allChk.addEventListener("change", () => {
    if (allChk.checked) rooms.forEach((r) => selectedRooms.add(r.id));
    else selectedRooms.clear();
    renderLogs(lastRooms);
  });
  btnDel.addEventListener("click", deleteSelectedRooms);

  rooms.forEach((r) => {
    const members = r.members || {};
    const nicks = Object.values(members).map((m) => m.nick || "익명");
    const msgs = r.messages ? Object.values(r.messages) : [];
    const item = document.createElement("div");
    item.className = "item" + (selectedRooms.has(r.id) ? " selected" : "");
    const row = document.createElement("div"); row.className = "row";
    const left = document.createElement("label"); left.className = "chk";
    const chk = document.createElement("input"); chk.type = "checkbox";
    chk.checked = selectedRooms.has(r.id);
    const meta = document.createElement("div");
    meta.innerHTML = "<b>" + nicks.map(escapeHtml).join(" ↔ ") + "</b>" +
      '<div class="muted" style="margin-top:4px">' + timeStr(r.ts) + " · 메시지 " + msgs.length +
      "개 · 사진 " + photoCount(r) + "장 · " + durStr(duration(r)) + " · " + sizeStr(roomSize(r)) +
      " · " + (r.closed ? "종료됨" : "진행 중") + "</div>";
    left.appendChild(chk); left.appendChild(meta);
    const btn = document.createElement("button"); btn.className = "ghost"; btn.textContent = "대화 보기";
    row.appendChild(left); row.appendChild(btn); item.appendChild(row);
    const log = document.createElement("div");
    log.className = "log" + (openRooms.has(r.id) ? " open" : "");
    log.appendChild(renderRoomMsgs(members, msgs));
    item.appendChild(log);
    chk.addEventListener("change", () => {
      if (chk.checked) selectedRooms.add(r.id); else selectedRooms.delete(r.id);
      renderLogs(lastRooms);
    });
    btn.addEventListener("click", () => {
      if (log.classList.toggle("open")) openRooms.add(r.id); else openRooms.delete(r.id);
    });
    box.appendChild(item);
  });
}

function deleteSelectedRooms() {
  const ids = [...selectedRooms];
  if (!ids.length) return;
  const live = lastRooms.filter((r) => selectedRooms.has(r.id) && !r.closed).length;
  let msg = "선택한 대화 " + ids.length + "개를 삭제할까요?\n삭제하면 되돌릴 수 없습니다.";
  if (live) msg += "\n\n⚠ 이 중 " + live + "개는 아직 진행 중인 대화입니다.";
  if (!confirm(msg)) return;
  const upd = {};
  ids.forEach((id) => { upd[id] = null; });
  db.ref("rooms").update(upd).then(() => {
    ids.forEach((id) => { selectedRooms.delete(id); openRooms.delete(id); });
  }).catch((e) => {
    alert("삭제 실패: " + (e.code || e.message) + "\n보안 규칙에 관리자 삭제 권한이 있는지 확인하세요.");
  });
}
function renderRoomMsgs(members, msgs) {
  const wrap = document.createElement("div"); wrap.className = "msgs";
  if (!msgs.length) {
    const p = document.createElement("div"); p.className = "muted"; p.textContent = "메시지 없음"; return p;
  }
  msgs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const firstUid = Object.keys(members)[0];
  msgs.forEach((m) => {
    const b = document.createElement("div");
    b.className = "bubble " + (m.sender === firstUid ? "rep" : "oth");
    const nick = (members[m.sender] || {}).nick || "익명";
    if (m.type === "photo") {
      const cap = document.createElement("div"); cap.className = "mono"; cap.textContent = nick;
      const img = document.createElement("img"); img.src = m.content;
      b.appendChild(cap); b.appendChild(img);
    } else {
      b.innerHTML = '<div class="mono" style="margin-bottom:2px">' + escapeHtml(nick) + "</div>" +
        escapeHtml(m.text || "");
    }
    wrap.appendChild(b);
  });
  return wrap;
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

function durStr(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "1분 미만" : m < 60 ? m + "분" : Math.floor(m / 60) + "시간 " + (m % 60) + "분";
}
function sizeStr(b) {
  return b < 1024 ? b + "B" : b < 1048576 ? (b / 1024).toFixed(1) + "KB" : (b / 1048576).toFixed(2) + "MB";
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
