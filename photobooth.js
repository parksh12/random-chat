"use strict";
/* 사진 꾸미기(포토부스 프레임) — P2-40
   - 사진 선택 → 꾸미기 시트(프레임 없이 + 4종, 미리보기, 끌어서 위치 조정) → 보내기
   - 프레임은 전부 캔버스로 그림(외부 이미지·글꼴 파일 없음)
   - 결과: JPEG Blob + blob.pbDataUrl(data:image/jpeg, 1.4MB 이하) → app.js 기존 사진 전송 경로로 넘김
   - '프레임 없이'는 원본 파일을 그대로 넘김(기존 동작과 동일)
   사용: PhotoBooth.open(file, onSend, { filter })  — filter는 메모 글에 적용할 채팅 필터 */
(function () {
  const MAX_URL = 1400000;          // DB 규칙 1,500,000자보다 여유 있게

  // ---------- 5x7 픽셀 글꼴 ----------
  const F = {
    "0": ["01110","10001","10011","10101","11001","10001","01110"],
    "1": ["00100","01100","00100","00100","00100","00100","01110"],
    "2": ["01110","10001","00001","00010","00100","01000","11111"],
    "3": ["11110","00001","00001","01110","00001","00001","11110"],
    "4": ["00010","00110","01010","10010","11111","00010","00010"],
    "5": ["11111","10000","11110","00001","00001","10001","01110"],
    "6": ["00110","01000","10000","11110","10001","10001","01110"],
    "7": ["11111","00001","00010","00100","01000","01000","01000"],
    "8": ["01110","10001","10001","01110","10001","10001","01110"],
    "9": ["01110","10001","10001","01111","00001","00010","01100"],
    ".": ["00000","00000","00000","00000","00000","01100","01100"],
    ":": ["00000","01100","01100","00000","01100","01100","00000"],
    "-": ["00000","00000","00000","11111","00000","00000","00000"],
    " ": ["00000","00000","00000","00000","00000","00000","00000"],
    "A": ["01110","10001","10001","11111","10001","10001","10001"],
    "B": ["11110","10001","10001","11110","10001","10001","11110"],
    "C": ["01110","10001","10000","10000","10000","10001","01110"],
    "D": ["11100","10010","10001","10001","10001","10010","11100"],
    "E": ["11111","10000","10000","11110","10000","10000","11111"],
    "F": ["11111","10000","10000","11110","10000","10000","10000"],
    "G": ["01110","10001","10000","10111","10001","10001","01111"],
    "I": ["01110","00100","00100","00100","00100","00100","01110"],
    "J": ["00111","00010","00010","00010","00010","10010","01100"],
    "K": ["10001","10010","10100","11000","10100","10010","10001"],
    "L": ["10000","10000","10000","10000","10000","10000","11111"],
    "M": ["10001","11011","10101","10101","10001","10001","10001"],
    "N": ["10001","11001","10101","10011","10001","10001","10001"],
    "O": ["01110","10001","10001","10001","10001","10001","01110"],
    "P": ["11110","10001","10001","11110","10000","10000","10000"],
    "R": ["11110","10001","10001","11110","10100","10010","10001"],
    "S": ["01111","10000","10000","01110","00001","00001","11110"],
    "T": ["11111","00100","00100","00100","00100","00100","00100"],
    "U": ["10001","10001","10001","10001","10001","10001","01110"],
    "V": ["10001","10001","10001","10001","10001","01010","00100"],
    "Y": ["10001","10001","01010","00100","00100","00100","00100"],
  };
  const pixW = (s, px) => s.length * 6 * px - px;
  function pixText(g, s, x, y, px, color, shadow, align) {
    s = String(s).toUpperCase();
    if (align === "right") x -= pixW(s, px);
    else if (align === "center") x -= pixW(s, px) / 2;
    const pass = (ox, oy, col) => {
      g.fillStyle = col;
      for (let i = 0; i < s.length; i++) {
        const gl = F[s[i]] || F[" "];
        for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++)
          if (gl[r][c] === "1") g.fillRect(x + ox + (i * 6 + c) * px, y + oy + r * px, px, px);
      }
    };
    if (shadow) pass(px, px, shadow);
    pass(0, 0, color);
  }

  // ---------- 픽셀 스티커 ----------
  const SPR = {
    star: ["....o....","...oyo...","oooyyyooo","oyyyyyyyo",".oyyyyyo.","..oyyyo..",".oyyoyyo.",".oyo.oyo.",".oo...oo."],
    heart: [".oo...oo.","oppo.oppo","owppppppo","opppppppo",".opppppo.","..opppo..","...opo...","....o...."],
    bunny: ["..oo...oo..",".owwo.owwo.",".owpo.owpo.",".owwo.owwo.",".owwwowwwo.","owwwwwwwwwo","owkwwwwwkwo","owpwwkwwpwo","owwwwwwwwwo",".owwwwwwwo.","..ooooooo.."],
    cam: ["..ooo....","ooooooooo","oo.....oo","o..ooo..o","o..o.o..o","o..ooo..o","ooooooooo"],
  };
  const SCOL = { o: "#4a3a80", y: "#ffd86b", p: "#f7a3c7", w: "#ffffff", k: "#4a3a80" };
  function sprite(g, rows, x, y, px, cols, cut) {
    cols = cols || SCOL;
    if (cut) {                          // 스티커 흰 칼선(1칸 바깥)
      g.fillStyle = cut;
      rows.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch !== ".") g.fillRect(x + (c - 1) * px, y + (r - 1) * px, px * 3, px * 3);
      }));
    }
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === ".") return;
      g.fillStyle = cols[ch]; g.fillRect(x + c * px, y + r * px, px, px);
    }));
  }

  // ---------- 공통 그리기 ----------
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else { g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
           g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  }
  let pan = { x: 0.5, y: 0.5 }, lastOver = { x: 0, y: 0 };
  // 가운데 자르기(cover) + 끌어서 옮긴 위치(pan) 반영
  function cover(g, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    lastOver = { x: dw - w, y: dh - h };
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(img, x - (dw - w) * pan.x, y - (dh - h) * pan.y, dw, dh);
    g.restore();
  }
  function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const p2 = (n) => String(n).padStart(2, "0");
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const ymd = (d) => d.getFullYear() + "." + p2(d.getMonth() + 1) + "." + p2(d.getDate());

  // ---------- 프레임 1: 2005 디카 ----------
  function drawDika(g, img, d) {
    const W = 1080, H = 810;
    // 하늘: 계단식 파스텔 띠(픽셀 느낌)
    const sky = ["#b7a1ef", "#bea9f1", "#c5b2f3", "#ccbbf5", "#d3c4f7", "#dacdf9", "#e1d6fa"];
    sky.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * (H / sky.length), W, H / sky.length + 1); });
    // 디더 점
    const rnd = seeded(2005);
    g.fillStyle = "rgba(255,255,255,.18)";
    for (let i = 0; i < 900; i++) g.fillRect(Math.floor(rnd() * 270) * 4, Math.floor(rnd() * 203) * 4, 4, 4);
    // 구름
    const cloud = (cx, cy, s) => {
      g.fillStyle = "#f3e2f8";
      [[0, 2, 10, 3], [2, 1, 6, 1], [3, 0, 3, 1], [-2, 3, 14, 2]].forEach(([a, b, w, h]) =>
        g.fillRect(cx + a * s, cy + b * s, w * s, h * s));
      g.fillStyle = "#e6c9f0"; g.fillRect(cx - 2 * s, cy + 5 * s, 14 * s, s);
    };
    cloud(60, 30, 10); cloud(820, 24, 8); cloud(30, 520, 7); cloud(940, 600, 6);
    // 반짝이
    const spark = (x, y, s, c) => {
      g.fillStyle = c;
      g.fillRect(x - s / 2, y - s * 2.5, s, s * 5); g.fillRect(x - s * 2.5, y - s / 2, s * 5, s);
      g.fillRect(x - s * 1.5, y - s * 1.5, s * 3, s * 3);
    };
    spark(470, 50, 5, "#ffe7a0"); spark(1010, 70, 4, "#ffe7a0"); spark(40, 300, 4, "#ffe7a0"); spark(770, 40, 3, "#fff");
    // 도시 실루엣
    const bl = [[0, 60, 90], [70, 100, 60], [150, 40, 110], [250, 80, 70], [340, 50, 90], [440, 70, 80],
                [540, 30, 120], [640, 90, 60], [720, 55, 100], [830, 75, 70], [920, 45, 90], [1010, 85, 70]];
    bl.forEach(([x, h, w]) => {
      g.fillStyle = "#9b85dc"; g.fillRect(x, H - h, w, h);
      g.fillStyle = "#c2b2f2";
      for (let wy = H - h + 12; wy < H - 10; wy += 20) for (let wx = x + 10; wx < x + w - 12; wx += 22) g.fillRect(wx, wy, 8, 8);
    });
    // 몸체
    const ol = "#4a3a80";
    g.fillStyle = ol; rr(g, 820, 74, 150, 52, 14); g.fill();               // 다이얼
    g.fillStyle = "#c8b8f1"; rr(g, 826, 80, 138, 44, 10); g.fill();
    g.fillStyle = "#b09ce6"; for (let i = 0; i < 12; i++) g.fillRect(836 + i * 10, 86, 4, 30);
    g.fillStyle = ol; rr(g, 84, 104, 912, 612, 52); g.fill();
    g.fillStyle = "#cfc0f5"; rr(g, 92, 112, 896, 596, 46); g.fill();
    g.fillStyle = "#e3d9fc"; rr(g, 108, 122, 864, 22, 11); g.fill();       // 윗면 하이라이트
    g.fillStyle = "#bba8ee"; rr(g, 108, 676, 864, 20, 10); g.fill();       // 아랫면 그늘
    // (로고 자리: 왼쪽 위 비워 둠 — 대표님 지시)
    // 화면 베젤 + 사진
    g.fillStyle = ol; rr(g, 128, 186, 622, 486, 22); g.fill();
    g.fillStyle = "#5c4c9c"; rr(g, 140, 198, 598, 462, 14); g.fill();
    const PX = 156, PY = 214, PW = 566, PH = 430;
    cover(g, img, PX, PY, PW, PH);
    g.fillStyle = "rgba(160,130,240,.10)"; g.fillRect(PX, PY, PW, PH);    // 살짝 LCD 색감
    // 화면 표시(HUD)
    const sh = "rgba(50,35,100,.85)";
    sprite(g, SPR.cam, PX + 22, PY + 20, 4, { o: "#fff" });
    pixText(g, "640", PX + PW - 120, PY + 22, 4, "#fff", sh, "right");
    g.fillStyle = sh; g.fillRect(PX + PW - 98, PY + 24, 64, 30);
    g.fillStyle = "#fff"; g.fillRect(PX + PW - 102, PY + 20, 64, 30); g.fillRect(PX + PW - 38, PY + 28, 6, 14);
    g.fillStyle = "#6a58b0"; g.fillRect(PX + PW - 98, PY + 24, 56, 22);
    g.fillStyle = "#fff"; for (let i = 0; i < 3; i++) g.fillRect(PX + PW - 95 + i * 18, PY + 27, 14, 16);
    const fc = (x, y, sx, sy) => { g.fillStyle = "#fff"; g.fillRect(x, y, 30 * sx, 5 * sy); g.fillRect(x, y, 5 * sx, 30 * sy); };
    fc(PX + 40, PY + 84, 1, 1); fc(PX + PW - 40, PY + 84, -1, 1); fc(PX + 40, PY + PH - 84, 1, -1); fc(PX + PW - 40, PY + PH - 84, -1, -1);
    pixText(g, ymd(d), PX + PW - 22, PY + PH - 46, 4, "#fff", sh, "right");
    // 오른쪽 버튼들
    const pill = (x, y, w, h) => { g.fillStyle = ol; rr(g, x, y, w, h, h / 2); g.fill();
      g.fillStyle = "#b9a6ec"; rr(g, x + 4, y + 4, w - 8, h - 8, (h - 8) / 2); g.fill();
      g.fillStyle = "#d6cafa"; rr(g, x + 12, y + 8, w - 24, 6, 3); g.fill(); };
    g.fillStyle = ol; rr(g, 790, 150, 160, 70, 22); g.fill();               // 모드 스위치
    g.fillStyle = "#9d88dc"; rr(g, 798, 158, 144, 54, 16); g.fill();
    g.fillStyle = "#e4dafc"; rr(g, 806, 166, 84, 38, 12); g.fill();
    pill(786, 258, 120, 50);
    pixText(g, "MENU", 846, 326, 4, ol, null, "center");
    pill(786, 368, 110, 46);
    const cx = 868, cy = 530;
    g.fillStyle = ol; g.beginPath(); g.arc(cx, cy, 84, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#c3b1f2"; g.beginPath(); g.arc(cx, cy, 78, 0, Math.PI * 2); g.fill();
    g.fillStyle = ol;
    const tri = (x1, y1, x2, y2, x3, y3) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fill(); };
    tri(cx, cy - 70, cx - 13, cy - 50, cx + 13, cy - 50); tri(cx, cy + 70, cx - 13, cy + 50, cx + 13, cy + 50);
    tri(cx - 70, cy, cx - 50, cy - 13, cx - 50, cy + 13); tri(cx + 70, cy, cx + 50, cy - 13, cx + 50, cy + 13);
    g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#d9cdfa"; g.beginPath(); g.arc(cx, cy, 29, 0, Math.PI * 2); g.fill();
    pixText(g, "OK", cx, cy - 10, 3, ol, null, "center");
    // 전원 표시
    g.strokeStyle = ol; g.lineWidth = 6; g.lineCap = "round";
    g.beginPath(); g.arc(768, 532, 15, -Math.PI * 0.3, Math.PI * 1.3); g.stroke();
    g.beginPath(); g.moveTo(768, 512); g.lineTo(768, 530); g.stroke();
    pill(786, 628, 110, 46);
    // 휴지통
    g.fillStyle = ol; g.fillRect(918, 634, 34, 6); g.fillRect(928, 628, 14, 6);
    g.fillRect(922, 642, 26, 32);
    g.fillStyle = "#cfc0f5"; g.fillRect(927, 646, 4, 24); g.fillRect(933, 646, 4, 24); g.fillRect(939, 646, 4, 24);
    // 스티커
    sprite(g, SPR.star, 700, 120, 9, null, "#fff");
    sprite(g, SPR.heart, 40, 470, 10, null, "#fff");
    sprite(g, SPR.bunny, 916, 250, 7, null, "#fff");
    return { W, H };
  }

  // ---------- 프레임 2: 네컷 필름 ----------
  function drawFilm(g, img, d) {
    const W = 388, H = 1080, cw = 288, ch = 216, top = 40, gap = 14, side = 50;
    g.fillStyle = "#141414"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#e9e6dc";
    for (let y = 14; y < H - 20; y += 52) { rr(g, 16, y, 20, 28, 4); g.fill(); rr(g, W - 36, y, 20, 28, 4); g.fill(); }
    for (let i = 0; i < 4; i++) {
      const y = top + i * (ch + gap);
      cover(g, img, side, y, cw, ch);
      pixText(g, String(i + 1) + "A", side - 4, y + ch + 2, 1.5, "#ff8a3d", null, "left");
    }
    const by = top + 4 * ch + 3 * gap;
    pixText(g, ymd(d), W / 2, by + 30, 4, "#ffc21a", null, "center");
    pixText(g, "FILM", W / 2, by + 78, 2, "#8a8780", null, "center");
    return { W, H };
  }

  // ---------- 프레임 3: 폴라로이드 ----------
  function drawPolaroid(g, img, d, memo) {
    const W = 888, H = 1080, m = 54, ps = 780;
    g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, W, H);
    cover(g, img, m, m, ps, ps);
    g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = 2; g.strokeRect(m + 1, m + 1, ps - 2, ps - 2);
    g.textBaseline = "middle"; g.textAlign = "center";
    if (memo) {
      g.fillStyle = "#262626";
      g.font = '700 46px "Pretendard","Pretendard Variable","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
      g.fillText(memo, W / 2, m + ps + 82, W - 2 * m);
    }
    g.fillStyle = "#8a8780"; g.textAlign = "right";
    g.font = '600 26px "Pretendard","Pretendard Variable","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    g.fillText(ymd(d), W - m, H - 44);
    g.textAlign = "left";
    return { W, H };
  }

  // ---------- 프레임 4: 캠코더 REC ----------
  function drawRec(g, img, d) {
    const W = 1080, H = 810;
    cover(g, img, 0, 0, W, H);
    g.fillStyle = "rgba(255,236,210,.06)"; g.fillRect(0, 0, W, H);          // 테이프 색감(약하게)
    g.fillStyle = "rgba(0,0,0,.13)"; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);   // 주사선
    const rnd = seeded(1987);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.10)";
      g.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
    g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(0, H * 0.72, W, 6);   // 트래킹 줄
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.38)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const sh = "rgba(0,0,0,.75)", px = 6;
    g.fillStyle = sh; g.beginPath(); g.arc(82, 82, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#ff2b2b"; g.beginPath(); g.arc(78, 78, 18, 0, Math.PI * 2); g.fill();
    pixText(g, "REC", 110, 58, px, "#fff", sh);
    pixText(g, "SP", 60, 124, 4, "#fff", sh);
    // 배터리
    g.fillStyle = sh; g.fillRect(W - 150, 66, 96, 44);
    g.fillStyle = "#fff"; g.fillRect(W - 156, 60, 96, 44); g.fillRect(W - 60, 72, 8, 20);
    g.fillStyle = "#222"; g.fillRect(W - 150, 66, 84, 32);
    g.fillStyle = "#fff"; for (let i = 0; i < 3; i++) g.fillRect(W - 146 + i * 27, 70, 22, 24);
    // 타임코드·날짜
    pixText(g, "0:00:07:12", 60, H - 102, 5, "#fff", sh);
    pixText(g, MON[d.getMonth()] + "." + p2(d.getDate()) + " " + d.getFullYear(), W - 60, H - 102, px, "#fff", sh, "right");
    // 가운데 초점 괄호
    g.fillStyle = "rgba(255,255,255,.85)";
    const b = (x, y, sx, sy) => { g.fillRect(x, y, 34 * sx, 4 * sy); g.fillRect(x, y, 4 * sx, 34 * sy); };
    b(W / 2 - 90, H / 2 - 70, 1, 1); b(W / 2 + 90, H / 2 - 70, -1, 1); b(W / 2 - 90, H / 2 + 70, 1, -1); b(W / 2 + 90, H / 2 + 70, -1, -1);
    return { W, H };
  }

  const FRAMES = [
    { id: "none", name: "프레임 없이" },
    { id: "dika", name: "2005 디카", draw: drawDika, size: [1080, 810] },
    { id: "film", name: "네컷 필름", draw: drawFilm, size: [388, 1080] },
    { id: "polaroid", name: "폴라로이드", draw: drawPolaroid, size: [888, 1080] },
    { id: "rec", name: "캠코더 REC", draw: drawRec, size: [1080, 810] },
  ];

  // 합성 → 지정 캔버스
  function render(cv, frameId, img, memo, date) {
    const f = FRAMES.find((x) => x.id === frameId);
    const g = cv.getContext("2d");
    if (!f.draw) {                       // 프레임 없이: 원본 비율 그대로 미리보기
      const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.min(1, 1080 / Math.max(iw, ih));
      cv.width = Math.round(iw * s); cv.height = Math.round(ih * s);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      return;
    }
    cv.width = f.size[0]; cv.height = f.size[1];
    g.imageSmoothingEnabled = true;
    f.draw(g, img, date || new Date(), memo);
  }
  // JPEG 품질을 낮춰 가며 MAX_URL 이하로
  function encode(cv) {
    let q = 0.92, url = cv.toDataURL("image/jpeg", q);
    while (url.length > MAX_URL && q > 0.35) { q -= 0.08; url = cv.toDataURL("image/jpeg", q); }
    return { url, q };
  }
  function dataUrlToBlob(url) {
    const bin = atob(url.split(",")[1]), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: "image/jpeg" });
  }

  // ---------- 시트 UI ----------
  let el = null, state = null;
  function build() {
    el = document.createElement("div");
    el.id = "pb-modal"; el.className = "modal";
    el.innerHTML =
      '<div class="sheet pb-sheet" role="dialog" aria-modal="true" aria-labelledby="pb-title">' +
        '<div class="pb-head"><h2 id="pb-title">사진 꾸미기</h2>' +
          '<button type="button" class="game-x" id="pb-close" aria-label="닫기">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<div class="pb-stage" id="pb-stage"><canvas id="pb-canvas"></canvas></div>' +
        '<p class="pb-hint" id="pb-hint">사진을 끌어서 위치를 옮길 수 있어요</p>' +
        '<div class="pb-frames" id="pb-frames" role="radiogroup" aria-label="프레임">' +
          FRAMES.map((f) => '<button type="button" class="pb-frame" role="radio" data-f="' + f.id + '">' + f.name + "</button>").join("") +
        "</div>" +
        '<input type="text" id="pb-memo" class="pb-memo" maxlength="20" placeholder="메모 한 줄 (선택, 20자)" autocomplete="off">' +
        '<div class="pb-acts"><button type="button" class="secondary" id="pb-cancel">취소</button>' +
          '<button type="button" class="primary" id="pb-send">보내기</button></div>' +
      "</div>";
    document.body.appendChild(el);
    const $ = (id) => document.getElementById(id);
    $("pb-close").addEventListener("click", close);
    $("pb-cancel").addEventListener("click", close);
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    $("pb-frames").addEventListener("click", (e) => {
      const b = e.target.closest(".pb-frame"); if (!b) return;
      state.frame = b.dataset.f; pan = { x: 0.5, y: 0.5 }; refresh();
    });
    $("pb-memo").addEventListener("input", () => { state.memo = $("pb-memo").value; draw(); });
    $("pb-send").addEventListener("click", send);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el.classList.contains("open")) close(); });
    // 끌어서 위치 옮기기
    const stage = $("pb-stage"); let drag = null;
    stage.addEventListener("pointerdown", (e) => {
      if (state.frame === "none") return;
      drag = { x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const cv = $("pb-canvas"), k = cv.width / cv.getBoundingClientRect().width;
      const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      if (lastOver.x > 1) pan.x = Math.min(1, Math.max(0, pan.x - dx / lastOver.x));
      if (lastOver.y > 1) pan.y = Math.min(1, Math.max(0, pan.y - dy / lastOver.y));
      draw();
    });
    const end = () => { drag = null; };
    stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  }
  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(document.getElementById("pb-canvas"), state.frame, state.img, cleanMemo(), new Date()));
  }
  function refresh() {
    el.querySelectorAll(".pb-frame").forEach((b) => {
      const on = b.dataset.f === state.frame;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", on ? "true" : "false");
    });
    document.getElementById("pb-memo").style.display = state.frame === "polaroid" ? "" : "none";
    document.getElementById("pb-hint").style.visibility = state.frame === "none" ? "hidden" : "visible";
    draw();
  }
  function cleanMemo() {
    const m = (state.memo || "").trim().slice(0, 20);
    return m && state.filter ? state.filter(m) : m;
  }
  function close() {
    if (!el || !el.classList.contains("open")) return;
    el.classList.remove("open");
    if (state && state.url) URL.revokeObjectURL(state.url);
    state = null;
  }
  function send() {
    const s = state; if (!s) return;
    let out = s.file;
    if (s.frame !== "none") {
      const cv = document.createElement("canvas");
      render(cv, s.frame, s.img, cleanMemo(), new Date());   // 보내는 시각으로 다시 그림
      const { url } = encode(cv);
      out = dataUrlToBlob(url);
      out.pbDataUrl = url;              // app.js 전송 경로가 이 값을 그대로 씀(재압축 없음)
    }
    const cb = s.onSend;
    close();
    cb(out);
  }

  function open(file, onSend, opts) {
    if (!el) build();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state = { file, onSend, url, img, frame: "none", memo: "", filter: opts && opts.filter };
      pan = { x: 0.5, y: 0.5 };
      document.getElementById("pb-memo").value = "";
      el.classList.add("open");
      refresh();
    };
    img.onerror = () => { URL.revokeObjectURL(url); onSend(file); };   // 못 읽는 형식은 기존처럼 그대로 전송
    img.src = url;
  }

  window.PhotoBooth = { open, close, isOpen: () => !!(el && el.classList.contains("open")),
                        _render: render, _encode: encode, FRAMES };
})();
