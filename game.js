"use strict";
/* 대기 중 미니게임: 블록 쌓기
   - 좌우로 움직이는 블록을 탭해서 멈춤 → 아래 블록과 겹친 부분만 남음
   - 거의 딱 맞으면 PERFECT, 3연속부터 블록이 조금씩 다시 넓어짐
   - 점수 = 쌓은 층수. 오늘의 순위표: scores/{YYYYMMDD}/{uid} = { nick, score, ts }
   - 매칭되면 app.js가 StackGame.close()를 호출 → 진행 중 기록은 저장 */
(function () {
  const $ = (id) => document.getElementById(id);
  const BEST_KEY = "rc_stack_best";
  const BH = 24;                 // 블록 높이(px)
  let ctx = null;                // { db, uid, nick } — app.js가 open 때 넘겨줌
  let cv, g, W = 0, H = 0, dpr = 1;
  let stack, cur, pieces, score, combo, camY, over, playing, raf = 0, lastT = 0, baseW, flash;

  const dayKey = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, "");
  const hue = (i) => (229 + i * 7) % 360;
  const best = () => { try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; } };
  const setBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {} };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- 크기 (고해상도 대응) ----
  function resize() {
    const stage = $("game-stage");
    W = stage.clientWidth; H = stage.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---- 게임 진행 ----
  function reset() {
    baseW = Math.round(W * 0.55);
    stack = [{ x: (W - baseW) / 2, w: baseW, h: hue(0) }];
    pieces = []; score = 0; combo = 0; camY = 0; over = false; flash = 0;
    spawn();
    setScore(0);
  }
  function spawn() {
    const top = stack[stack.length - 1];
    const fromLeft = stack.length % 2 === 1;
    cur = { x: fromLeft ? -top.w * 0.5 : W - top.w * 0.5, w: top.w, dir: fromLeft ? 1 : -1, h: hue(stack.length) };
  }
  const speed = () => Math.min(2.1 + score * 0.09, 6.4) * (W / 360);

  function place() {
    if (!playing || over) return;
    const prev = stack[stack.length - 1];
    const dx = cur.x - prev.x;
    const tol = Math.max(3, W * 0.012);
    let nb;
    if (Math.abs(dx) <= tol) {                       // PERFECT
      combo++;
      nb = { x: prev.x, w: prev.w, h: cur.h };
      if (combo >= 3 && nb.w < baseW) {              // 3연속부터 조금씩 다시 넓어짐
        const grow = Math.min(baseW - nb.w, Math.max(4, nb.w * 0.08));
        nb.w += grow; nb.x -= grow / 2;
      }
      pop(combo >= 2 ? "PERFECT ×" + combo : "PERFECT!");
      flash = 1;
      buzz(12);
    } else {
      combo = 0;
      const overlap = prev.w - Math.abs(dx);
      if (overlap <= 0) {                            // 완전히 빗나감 → 끝
        pieces.push({ x: cur.x, y: layerY(stack.length), w: cur.w, h: cur.h, vy: 0, a: 1 });
        return gameOver();
      }
      nb = { x: dx > 0 ? cur.x : prev.x, w: overlap, h: cur.h };
      pieces.push({ x: dx > 0 ? cur.x + overlap : cur.x, y: layerY(stack.length),
                    w: Math.abs(dx), h: cur.h, vy: 0, a: 1 });
      buzz(6);
    }
    stack.push(nb);
    setScore(++score);
    spawn();
  }

  // 층 i의 화면상 y (카메라 반영 전)
  const layerY = (i) => H - 36 - (i + 1) * BH;

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((t - (lastT || t)) / 16.67, 3); lastT = t;
    if (playing && !over) {
      cur.x += cur.dir * speed() * dt;
      const lo = -cur.w * 0.5, hi = W - cur.w * 0.5;
      if (cur.x < lo) { cur.x = lo; cur.dir = 1; }
      if (cur.x > hi) { cur.x = hi; cur.dir = -1; }
    }
    const target = Math.max(0, (stack.length + 1) * BH - H * 0.55);
    camY += (target - camY) * Math.min(1, 0.12 * dt);
    pieces.forEach((p) => { p.vy += 0.45 * dt; p.y += p.vy * dt; p.a -= 0.02 * dt; });
    pieces = pieces.filter((p) => p.a > 0 && p.y - camY < H + 40);
    flash = Math.max(0, flash - 0.06 * dt);
    draw();
  }

  function block(x, y, w, h, a) {
    const r = Math.min(6, w / 2);
    g.globalAlpha = a == null ? 1 : Math.max(0, a);
    g.fillStyle = `hsl(${h} 78% 64%)`;
    g.beginPath(); g.roundRect(x, y, w, BH - 2, r); g.fill();
    g.fillStyle = `hsl(${h} 90% 76%)`;              // 윗면 하이라이트(입체감)
    g.beginPath(); g.roundRect(x + 2, y + 2, Math.max(0, w - 4), 5, 3); g.fill();
    g.globalAlpha = 1;
  }

  function draw() {
    g.clearRect(0, 0, W, H);
    // 높이 올라갈수록 배경이 아주 살짝 바뀜
    const tint = Math.min(score / 60, 1);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `hsla(${250 + tint * 40} 80% 65% / ${0.10 + tint * 0.12})`);
    sky.addColorStop(1, "hsla(229 80% 65% / 0.02)");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 0.18})`; g.fillRect(0, 0, W, H); }

    stack.forEach((b, i) => {
      const y = layerY(i) + camY;
      if (y < H + BH && y > -BH) block(b.x, y, b.w, b.h);
    });
    pieces.forEach((p) => block(p.x, p.y + camY, p.w, p.h, p.a));
    if (playing && !over) block(cur.x, layerY(stack.length) + camY, cur.w, cur.h);
  }

  // ---- 화면 요소 ----
  function setScore(n) { $("game-score").textContent = n; }
  function pop(text) {
    const el = $("game-pop");
    el.textContent = text;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  function overlay(html) {
    const o = $("game-overlay");
    o.innerHTML = html;
    o.classList.toggle("show", !!html);
  }

  function readyView() {
    overlay(
      '<div class="go-title">블록 쌓기</div>' +
      '<div class="go-sub">화면을 탭해서 블록을 멈추세요.<br>아래 블록과 겹친 만큼만 남아요.</div>' +
      (best() ? '<div class="go-best">내 최고 기록 <b>' + best() + '층</b></div>' : "") +
      '<button class="primary go-btn" data-act="start">시작하기</button>' +
      '<div class="go-board" id="go-board"></div>'
    );
    loadBoard(null);
  }

  function gameOver() {
    over = true; playing = false;
    buzz(40);
    const prevBest = best();
    const isNew = score > prevBest;
    if (isNew) setBest(score);
    submit(score);
    overlay(
      '<div class="go-title">' + score + '층</div>' +
      (isNew && score > 0 ? '<div class="go-new">🎉 최고 기록 갱신!</div>'
                          : '<div class="go-best">내 최고 기록 <b>' + Math.max(prevBest, score) + '층</b></div>') +
      '<button class="primary go-btn" data-act="start">다시 하기</button>' +
      '<div class="go-board" id="go-board"><div class="go-muted">순위 불러오는 중…</div></div>'
    );
  }

  function start() {
    overlay("");
    reset();
    playing = true;
  }

  // ---- 순위표 (오늘, KST 기준) ----
  function submit(s) {
    if (!ctx || !ctx.db || !ctx.uid || s <= 0) { loadBoard(s); return; }
    const ref = ctx.db.ref("scores/" + dayKey() + "/" + ctx.uid);
    ref.transaction((c) => (!c || s > (c.score || 0))
      ? { nick: ctx.nick, score: s, ts: firebase.database.ServerValue.TIMESTAMP } : undefined,
      () => loadBoard(s));
  }
  function loadBoard(myScore) {
    const box = () => $("go-board");
    if (!ctx || !ctx.db) { if (box()) box().innerHTML = ""; return; }
    const day = ctx.db.ref("scores/" + dayKey());
    day.orderByChild("score").limitToLast(10).once("value", (snap) => {
      const rows = [];
      snap.forEach((ch) => { rows.push({ uid: ch.key, ...(ch.val() || {}) }); });
      rows.reverse();
      const mine = rows.findIndex((r) => r.uid === ctx.uid);
      let html = '<div class="go-board-title">오늘의 TOP 10</div>';
      if (!rows.length) html += '<div class="go-muted">아직 기록이 없어요. 첫 기록의 주인공이 되어보세요!</div>';
      html += rows.map((r, i) =>
        '<div class="go-row' + (r.uid === ctx.uid ? " me" : "") + '"><span class="rk">' + (i + 1) +
        '</span><span class="nm">' + esc(r.nick || "익명") + '</span><span class="sc">' + (r.score || 0) + "층</span></div>"
      ).join("");
      const b = box(); if (b) b.innerHTML = html;
      // TOP 10 밖이면 내 순위 따로 표시
      if (mine < 0 && myScore) {
        ctx.db.ref("scores/" + dayKey() + "/" + ctx.uid).once("value", (ms) => {
          const my = (ms.val() || {}).score || myScore;
          day.orderByChild("score").startAt(my + 1).limitToFirst(500).once("value", (hs) => {
            const b2 = box();
            if (b2) b2.insertAdjacentHTML("beforeend",
              '<div class="go-row me"><span class="rk">' + (hs.numChildren() + 1) +
              '</span><span class="nm">나 (' + esc(ctx.nick) + ')</span><span class="sc">' + my + "층</span></div>");
          }).catch(() => {});
        }).catch(() => {});
      }
    }, () => { const b = box(); if (b) b.innerHTML = '<div class="go-muted">순위표를 불러오지 못했어요.</div>'; })
      .catch(() => {});
  }

  // ---- 열기 / 닫기 ----
  function open(c) {
    ctx = c;
    $("game-modal").classList.add("open");
    resize();
    reset();
    playing = false;
    readyView();
    lastT = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  // reason === "matched": 매칭돼서 닫힘 → 진행 중이던 기록 저장
  function close(reason) {
    if (!$("game-modal").classList.contains("open")) return;
    if (reason === "matched" && playing && !over && score > 0) {
      if (score > best()) setBest(score);
      submit(score);
    }
    playing = false;
    cancelAnimationFrame(raf);
    $("game-modal").classList.remove("open");
  }

  // ---- 입력 ----
  function init() {
    cv = $("game-canvas"); g = cv.getContext("2d");
    if (!g.roundRect) g.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };   // 구형 브라우저
    $("game-stage").addEventListener("pointerdown", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) { e.preventDefault(); if (act.dataset.act === "start") start(); return; }
      if (e.target.closest("#game-overlay.show")) return;   // 순위표 위 탭은 무시
      e.preventDefault();
      place();
    });
    $("game-close").addEventListener("click", () => close("user"));
    window.addEventListener("keydown", (e) => {
      if (!$("game-modal").classList.contains("open")) return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        if (playing) place(); else start();
      }
      if (e.key === "Escape") close("user");
    });
    window.addEventListener("resize", () => { if ($("game-modal").classList.contains("open")) { resize(); } });
  }

  window.StackGame = { open, close, init, isOpen: () => $("game-modal").classList.contains("open") };
})();
