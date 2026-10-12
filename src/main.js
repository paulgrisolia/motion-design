'use strict';
/*
 * COFFEE AT 8:30 — deterministic motion piece.
 * Every pixel is a pure function of time t (seconds): window.seek(t) always draws the same frame.
 * No timers, no Math.random, no CSS animation. Springs are evaluated analytically.
 */

const W = 1920, H = 1080, FPS = 60, DURATION = 15;
const C = {
  paper: '#F1EADF', espresso: '#1B1410', signal: '#FF4B1F', crema: '#C89B6D', foam: '#FBF7F0',
};
const F = { black: 'IDBlack', bold: 'IDBold', serif: 'ISerif', serifI: 'ISerifItalic', mono: 'JBMono' };
const MARGIN = 64;

// Scene boundaries. Motion-blur sub-samples never cross these, so hard cuts stay hard.
const SEGMENTS = [0, 2.0, 4.5, 10.0, DURATION];

let CUE = null;

/* ------------------------------------------------------------------ math */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const E = {
  inCubic: t => t * t * t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

// Damped harmonic oscillator, 0 -> 1, closed form. t in seconds since start.
function spring(t, { k, c, m = 1 }) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k / m);
  const z = c / (2 * Math.sqrt(k * m));
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
  }
  if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = Math.sqrt(z * z - 1);
  const r1 = -w0 * (z - s), r2 = -w0 * (z + s);
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}
// Motion weights (see docs/style_guide.md)
const WT = {
  ui:    { k: 420, c: 34 },
  card:  { k: 260, c: 18 },
  hero:  { k: 180, c: 16 },
  punch: { k: 520, c: 26 },
  cam:   { k: 110, c: 21 },
  heavy: { k: 90,  c: 9 },
};
const sp = (t, t0, w) => spring(t - t0, w);
// Decaying wobble after an impulse at t0
const wobble = (t, t0, freq = 40, decay = 10) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay) * Math.sin((t - t0) * freq));
const decay = (t, t0, rate = 9) => (t < t0 ? 0 : Math.exp(-(t - t0) * rate));

function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/* ------------------------------------------------------------------ text */
function setFont(ctx, fam, size, ls = 0) {
  ctx.font = `${size}px "${fam}"`;
  ctx.letterSpacing = `${ls}px`;
}
function measure(ctx, str, fam, size, ls = 0) {
  setFont(ctx, fam, size, ls);
  return ctx.measureText(str).width;
}
// Draw a run of [text, family] segments left-to-right; returns width.
function runs(ctx, segs, x, y, size, color, ls = 0, align = 'left') {
  let total = 0;
  for (const [s, fam] of segs) total += measure(ctx, s, fam, size, ls);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const [s, fam] of segs) {
    setFont(ctx, fam, size, ls);
    ctx.fillText(s, cx, y);
    cx += ctx.measureText(s).width;
  }
  return total;
}
// Line revealed through a mask: p=0 hidden below its baseline box, p=1 in place. exit pushes it up and out.
function maskedRuns(ctx, segs, x, y, size, color, p, { ls = 0, align = 'left', exit = 0, padX = 120 } = {}) {
  if (p <= 0.0005 || exit >= 0.9995) return;
  let total = 0;
  for (const [s, fam] of segs) total += measure(ctx, s, fam, size, ls);
  const left = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const top = y - size * 1.0, h = size * 1.32;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - padX, top, total + padX * 2, h);
  ctx.clip();
  const dy = (1 - p) * h - exit * h;
  runs(ctx, segs, x, y + dy, size, color, ls, align);
  ctx.restore();
}

/* ------------------------------------------------------------------ grain */
let grainCanvas = null;
function buildGrain() {
  grainCanvas = document.createElement('canvas');
  grainCanvas.width = W; grainCanvas.height = H;
  const g = grainCanvas.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  // integer hash (xorshift-ish) -> deterministic and fast
  for (let i = 0, n = W * H; i < n; i++) {
    let h = (i * 2654435761) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
    const v = 128 + ((h & 255) - 128) * 0.55;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ shared pieces */
function header(ctx, t, left, right, color, alpha = 1) {
  const p = sp(t, 0.02, WT.ui);
  ctx.save();
  ctx.globalAlpha = alpha;
  maskedRuns(ctx, [[left, F.mono]], MARGIN, 84, 24, color, p, { ls: 3, padX: 4 });
  maskedRuns(ctx, [[right, F.mono]], W - MARGIN, 84, 24, color, p, { ls: 3, padX: 4, align: 'right' });
  ctx.restore();
}

// Big numerals layout helper, returns glyph boxes with own colon.
function layoutTime(ctx, chars, size, x) {
  const track = -0.035 * size;
  const out = [];
  let cx = x;
  for (const ch of chars) {
    const w = ch === ':' ? 0.27 * size : measure(ctx, ch, F.black, size);
    out.push({ ch, x: cx, w });
    cx += w + track;
  }
  out.width = cx - track - x;
  return out;
}
function drawColonDot(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}
const COLON = { r: 0.078, up: 0.565, low: 0.165 }; // relative to size

/* ------------------------------------------------------------------ the cat */
/*
 * Head-centred, unit = w (head width).
 * st: droop 0..1, sad 0..1, happy 0..1, look [x,y], blink 0..1, tear {form, along, fall}
 */
function drawCat(ctx, x, y, w, st = {}) {
  const { droop = 0, sad = 0, happy = 0, look = [0, 0], blink = 0, tilt = 0, tear = null, earWiggle = 0 } = st;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  const u = w;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // ears (drawn first; bases tuck under the head)
  for (const side of [-1, 1]) {
    ctx.save();
    const bx = side * 0.40 * u, by = -0.16 * u;
    ctx.translate(bx, by);
    ctx.rotate(side * (droop * 0.62 + earWiggle));
    ctx.translate(-bx, -by);
    ctx.fillStyle = C.espresso; ctx.strokeStyle = C.espresso; ctx.lineWidth = 0.05 * u;
    ctx.beginPath();
    ctx.moveTo(side * 0.47 * u, -0.10 * u);
    ctx.lineTo(side * 0.43 * u, -0.66 * u);
    ctx.lineTo(side * 0.10 * u, -0.37 * u);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.crema;
    ctx.beginPath();
    ctx.moveTo(side * 0.40 * u, -0.25 * u);
    ctx.lineTo(side * 0.405 * u, -0.54 * u);
    ctx.lineTo(side * 0.21 * u, -0.37 * u);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // head
  const headPath = new Path2D();
  headPath.moveTo(-0.5 * u, 0.02 * u);
  headPath.bezierCurveTo(-0.52 * u, -0.30 * u, -0.30 * u, -0.43 * u, 0, -0.43 * u);
  headPath.bezierCurveTo(0.30 * u, -0.43 * u, 0.52 * u, -0.30 * u, 0.5 * u, 0.02 * u);
  headPath.bezierCurveTo(0.49 * u, 0.30 * u, 0.28 * u, 0.42 * u, 0, 0.42 * u);
  headPath.bezierCurveTo(-0.28 * u, 0.42 * u, -0.49 * u, 0.30 * u, -0.5 * u, 0.02 * u);
  ctx.fillStyle = C.espresso;
  ctx.fill(headPath);

  // eyes
  const er = 0.118 * u, ey = -0.04 * u;
  for (const side of [-1, 1]) {
    const ex = side * 0.205 * u;
    if (happy > 0.5) {
      // ^ ^
      const open = 1 - blink;
      ctx.strokeStyle = C.foam; ctx.lineWidth = 0.042 * u;
      ctx.beginPath();
      ctx.moveTo(ex - 0.085 * u, ey + 0.03 * u);
      ctx.quadraticCurveTo(ex, ey - 0.09 * u * open - 0.005 * u, ex + 0.085 * u, ey + 0.03 * u);
      ctx.stroke();
      continue;
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = C.foam; ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    const pr = lerp(0.066, 0.098, sad) * u;
    const lx = clamp(look[0], -1, 1) * (er - pr) * 0.9, ly = clamp(look[1], -1, 1) * (er - pr) * 0.9;
    ctx.fillStyle = C.espresso;
    ctx.beginPath(); ctx.arc(ex + lx, ey + ly, pr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.foam;
    ctx.beginPath(); ctx.arc(ex + lx - pr * 0.36, ey + ly - pr * 0.38, pr * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.25 + 0.75 * sad;
    ctx.beginPath(); ctx.arc(ex + lx + pr * 0.38, ey + ly + pr * 0.34, pr * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // lids: sad = outer corner droops; blink closes
    const outer = ex - side * er * 1.2, inner = ex + side * er * 1.2;
    const base = ey - er - 0.01 * u;
    const yOuter = lerp(base + sad * 0.115 * u, ey + er + 0.01 * u, blink);
    const yInner = lerp(base + sad * 0.02 * u, ey + er + 0.01 * u, blink);
    ctx.fillStyle = C.espresso;
    ctx.beginPath();
    ctx.moveTo(outer, ey - er * 2); ctx.lineTo(inner, ey - er * 2);
    ctx.lineTo(inner, yInner); ctx.lineTo(outer, yOuter); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // whiskers: ink where they cross the paper, foam over the fur
  const whiskers = () => {
    for (const side of [-1, 1]) {
      for (const [y0, y1] of [[0.13, 0.07], [0.18, 0.21]]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.24 * u, y0 * u);
        ctx.lineTo(side * 0.64 * u, y1 * u + sad * 0.07 * u);
        ctx.stroke();
      }
    }
  };
  ctx.lineWidth = 0.012 * u;
  ctx.strokeStyle = C.espresso; whiskers();
  ctx.save(); ctx.clip(headPath); ctx.strokeStyle = C.foam; ctx.globalAlpha = 0.6; whiskers(); ctx.restore();

  // nose + mouth
  ctx.fillStyle = C.crema;
  ctx.beginPath();
  ctx.moveTo(-0.04 * u, 0.085 * u); ctx.lineTo(0.04 * u, 0.085 * u); ctx.lineTo(0, 0.13 * u); ctx.closePath();
  ctx.lineWidth = 0.02 * u; ctx.strokeStyle = C.crema; ctx.stroke(); ctx.fill();
  ctx.strokeStyle = C.foam; ctx.lineWidth = 0.02 * u;
  const mood = happy > 0.5 ? 1 : 1 - 2 * sad; // 1 smile, -1 frown
  ctx.beginPath();
  if (mood > 0) {
    // little "w"
    const d = 0.05 * u * mood;
    ctx.moveTo(-0.09 * u, 0.17 * u);
    ctx.quadraticCurveTo(-0.045 * u, 0.17 * u + d, 0, 0.15 * u);
    ctx.quadraticCurveTo(0.045 * u, 0.17 * u + d, 0.09 * u, 0.17 * u);
  } else {
    const d = 0.06 * u * -mood;
    ctx.moveTo(-0.08 * u, 0.23 * u);
    ctx.quadraticCurveTo(0, 0.23 * u - d * 1.6, 0.08 * u, 0.23 * u);
  }
  ctx.stroke();

  // tear (viewer-left eye, outer corner)
  if (tear && tear.form > 0.001) {
    const sx = -0.205 * u - 0.06 * u, sy = ey + er + 0.035 * u;
    const ex2 = -0.32 * u, ey2 = 0.36 * u;
    const a = tear.along;
    const tx = lerp(sx, ex2, a), ty = lerp(sy, ey2, E.inQuad(a)) + tear.fall * u;
    const r = 0.046 * u * tear.form * (1 + 0.15 * a);
    if (a > 0.02 && tear.fall < 0.4) {
      ctx.strokeStyle = C.foam; ctx.globalAlpha = 0.35 * (1 - tear.fall / 0.4); ctx.lineWidth = r * 0.55;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const aa = (a * i) / steps;
        ctx.lineTo(lerp(sx, ex2, aa), lerp(sy, ey2, E.inQuad(aa)));
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = C.foam;
    ctx.beginPath();
    ctx.moveTo(tx, ty - r * 2.3);
    ctx.bezierCurveTo(tx + r * 0.35, ty - r * 1.3, tx + r, ty - r * 0.6, tx + r, ty);
    ctx.arc(tx, ty, r, 0, Math.PI);
    ctx.bezierCurveTo(tx - r, ty - r * 0.6, tx - r * 0.35, ty - r * 1.3, tx, ty - r * 2.3);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ cups */
const TABLE_Y = 800;
function cupPath(ctx, cx) {
  const top = 638, bot = 786, tw = 76, bw = 60, r = 18;
  ctx.beginPath();
  ctx.moveTo(cx - tw, top);
  ctx.lineTo(cx + tw, top);
  ctx.lineTo(cx + bw, bot - r);
  ctx.quadraticCurveTo(cx + bw - 2, bot, cx + bw - r, bot);
  ctx.lineTo(cx - bw + r, bot);
  ctx.quadraticCurveTo(cx - bw + 2, bot, cx - bw, bot - r);
  ctx.closePath();
}
function drawCup(ctx, cx, t, { level = 1, tilt = 0, sy = 1, steam = 1, dashed = false, alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, TABLE_Y);
  ctx.scale(1 / Math.sqrt(sy), sy);
  ctx.translate(tilt < 0 ? -60 : 60, -12); ctx.rotate(tilt); ctx.translate(tilt < 0 ? 60 : -60, 12);
  ctx.translate(-cx, -TABLE_Y);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (dashed) {
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = C.espresso; ctx.globalAlpha = 0.35 * alpha; ctx.lineWidth = 4;
    cupPath(ctx, cx); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 78, 708, 32, -1.15, 1.15); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  // handle
  ctx.strokeStyle = C.espresso; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(cx + 78, 708, 32, -1.15, 1.15); ctx.stroke();
  // body
  ctx.fillStyle = C.foam; cupPath(ctx, cx); ctx.fill();
  // coffee (surface stays level when the cup tilts)
  if (level > 0.003) {
    ctx.save();
    cupPath(ctx, cx); ctx.clip();
    const ly = lerp(786, 662, level);
    ctx.translate(cx, ly); ctx.rotate(-tilt); ctx.translate(-cx, -ly);
    ctx.fillStyle = C.espresso; ctx.fillRect(cx - 200, ly, 400, 300);
    ctx.fillStyle = C.crema; ctx.fillRect(cx - 200, ly, 400, 9);
    ctx.restore();
  } else {
    // dregs ring
    ctx.save(); cupPath(ctx, cx); ctx.clip();
    ctx.fillStyle = C.crema; ctx.globalAlpha = 0.55 * alpha; ctx.fillRect(cx - 200, 776, 400, 20);
    ctx.restore();
  }
  ctx.strokeStyle = C.espresso; ctx.lineWidth = 7;
  cupPath(ctx, cx); ctx.stroke();
  ctx.restore();
  // saucer (does not tilt)
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, TABLE_Y); ctx.scale(1 / Math.sqrt(sy), sy); ctx.translate(-cx, -TABLE_Y);
  ctx.fillStyle = C.espresso;
  ctx.beginPath(); ctx.roundRect(cx - 104, 788, 208, 11, 5.5); ctx.fill();
  ctx.restore();

  // steam (world-space, untilted)
  if (steam > 0.01) {
    ctx.save();
    ctx.strokeStyle = C.espresso; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      const ox = cx + (k ? 20 : -20);
      const ph = k * 2.1 + cx * 0.013;
      const len = 90 * steam;
      for (let seg = 0; seg < 3; seg++) {
        ctx.globalAlpha = alpha * 0.32 * steam * (1 - seg / 3);
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
          const yy = 618 - (seg * len) / 3 - (i / 10) * (len / 3);
          const xx = ox + 9 * Math.sin(yy * 0.055 + t * 3.2 + ph) * (0.4 + (618 - yy) / 120);
          i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ layouts (computed once fonts are in) */
const L = {};
function computeLayouts(ctx) {
  // Shot 1
  L.s1 = { size: 640, base: 790 };
  L.s1.glyphs = layoutTime(ctx, ['8', ':', '1', '5'], L.s1.size, 150);
  // Shot 5/6
  L.end = { size: 520, base: 778 };
  const g = layoutTime(ctx, ['8', ':', '3', '0'], L.end.size, 0);
  const off = (W - g.width) / 2 - 70;
  for (const q of g) q.x += off;
  L.end.glyphs = g;
  L.p = { s1: 270, s2: 600, base1: 430, base2: 940, x: 128 };
  L.p.wJUST = measure(ctx, 'JUST', F.black, L.p.s1, -0.03 * L.p.s1);
  L.p.w1 = measure(ctx, '1', F.black, L.p.s2);
  L.p.w5 = measure(ctx, '5', F.black, L.p.s2);
}

/* ------------------------------------------------------------------ SHOT 1: hook */
function shot1(ctx, t) {
  const Q = CUE;
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  const { size, base, glyphs } = L.s1;

  const cs = 1 + 0.035 * E.inOutSine(inv(0, 2, t));
  const d = t - Q.slash;
  const shk = d > 0 ? 9 * Math.exp(-d * 13) * Math.sin(d * 70) : 0;
  ctx.save();
  ctx.translate(W / 2 + shk, H / 2 + shk * 0.5);
  ctx.scale(cs, cs);
  ctx.translate(-W / 2, -H / 2);

  // recoil of the whole word when the slash hits
  const recoil = -0.022 * wobble(t, Q.slash, 26, 8);
  const pivotX = 150 + glyphs.width / 2, pivotY = base;
  ctx.translate(pivotX, pivotY); ctx.rotate(recoil); ctx.translate(-pivotX, -pivotY);

  const cap = 0.727 * size;
  const fallOrder = { 0: 0, 2: 1, 3: 2 };
  glyphs.forEach((g, i) => {
    const s = sp(t, -0.12 + i * 0.055, WT.hero);
    let x = g.x, y = base + (1 - s) * cap * 1.15, rot = 0;
    const df = t - (Q.drop + (fallOrder[i] ?? 0) * 0.05);
    const dir = i === 0 ? -1 : 1;
    if (i !== 1 && df > 0) {
      y += -380 * df + 0.5 * 9800 * df * df;
      x += dir * (90 + i * 30) * df;
      rot = dir * (1.4 * df + 3 * df * df);
    }
    ctx.save();
    if (t < 0.9) { ctx.beginPath(); ctx.rect(g.x - 80, base - size * 1.05, g.w + 160, size * 1.05 + 30); ctx.clip(); }
    if (g.ch === ':') {
      const r = COLON.r * size, cx = g.x + g.w / 2;
      const up = 1 - E.inCubic(inv(Q.drop, Q.drop + 0.16, t));
      if (up > 0) drawColonDot(ctx, cx, y - COLON.up * size, r * up, C.espresso);
      if (t < Q.iris) drawColonDot(ctx, cx, y - COLON.low * size, r, C.espresso);
    } else {
      const cx = x + g.w / 2, cy = y - cap / 2;
      ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy);
      setFont(ctx, F.black, size);
      ctx.fillStyle = C.espresso; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText(g.ch, x, y);
    }
    ctx.restore();
  });

  // red pen slash
  const sw = E.outCubic(inv(Q.slash, Q.slash + 0.16, t));
  if (sw > 0) {
    const x0 = 95, y0 = base - 120, x1 = 150 + glyphs.width + 70, y1 = base - cap + 30;
    const df = t - (Q.drop + 0.03);
    ctx.save();
    if (df > 0) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      ctx.translate(mx + 60 * df, my - 500 * df + 0.5 * 7600 * df * df);
      ctx.rotate(0.9 * df + 1.6 * df * df);
      ctx.translate(-mx, -my);
    }
    const ang = Math.atan2(y1 - y0, x1 - x0), th = 54;
    const ex = lerp(x0, x1, sw), ey = lerp(y0, y1, sw);
    const nx = -Math.sin(ang) * th / 2, ny = Math.cos(ang) * th / 2;
    ctx.fillStyle = C.signal;
    ctx.beginPath();
    ctx.moveTo(x0 + nx - 10, y0 + ny); ctx.lineTo(ex + nx, ey + ny);
    ctx.lineTo(ex - nx + 8, ey - ny); ctx.lineTo(x0 - nx, y0 - ny);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // support label
  const lp = sp(t, Q.hookLabel, WT.ui);
  const lx = sp(t, Q.drop - 0.05, WT.ui);
  maskedRuns(ctx, [['CURRENT COFFEE TIME', F.mono]], 158, base + 92, 26, C.espresso, lp, { ls: 3.5, exit: lx, padX: 6 });
  maskedRuns(ctx, [['— FOR NOW', F.mono]], 158 + measure(ctx, 'CURRENT COFFEE TIME ', F.mono, 26, 3.5), base + 92, 26, C.signal,
    sp(t, Q.slash + 0.08, WT.ui), { ls: 3.5, exit: lx, padX: 6 });

  // iris: the colon's lower dot swallows the frame
  if (t >= Q.iris) {
    const g = glyphs[1];
    const dotX = g.x + g.w / 2, dotY = base - COLON.low * size;
    const q = inv(Q.iris, 2.0, t);
    const e = E.inCubic(q);
    const cx = lerp(dotX, 620, E.inOutCubic(q)), cy = lerp(dotY, 560, E.inOutCubic(q));
    drawColonDot(ctx, cx, cy, COLON.r * size + e * 2300, C.espresso);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ SHOT 2: clock */
const CLK = { x: 620, y: 560, R: 300 };
function clockAngle(min) { return (min / 60) * Math.PI * 2; } // 0 = 12 o'clock, clockwise
function polar(a, r) { return [CLK.x + Math.sin(a) * r, CLK.y - Math.cos(a) * r]; }

function shot2(ctx, t) {
  const Q = CUE;
  ctx.fillStyle = C.espresso; ctx.fillRect(0, 0, W, H);

  // camera: slow drift, then dive into an empty patch of the clock face
  const q = inv(Q.dive, 4.5, t);
  const zoom = Math.pow(24, E.inCubic(q));
  const [fx, fy] = polar(clockAngle(58), CLK.R * 0.6);
  const drift = -14 * (t - 2);
  ctx.save();
  ctx.translate(drift, 0);
  ctx.translate(fx, fy); ctx.scale(zoom, zoom); ctx.translate(-fx, -fy);

  const R = CLK.R * sp(t, Q.clockIn - 0.04, WT.card);
  ctx.fillStyle = C.paper;
  ctx.beginPath(); ctx.arc(CLK.x, CLK.y, Math.max(R, COLON.r * 640 * (1 - inv(2, 2.1, t))), 0, Math.PI * 2); ctx.fill();

  // 15 -> 30 wedge
  const wp = sp(t, Q.wedge, { k: 200, c: 24 });
  if (wp > 0.001) {
    const a0 = clockAngle(15) - Math.PI / 2, a1 = a0 + (Math.PI / 2) * wp;
    ctx.fillStyle = C.signal;
    ctx.beginPath(); ctx.moveTo(CLK.x, CLK.y); ctx.arc(CLK.x, CLK.y, CLK.R * 0.8, a0, a1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.signal; ctx.lineWidth = 7; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(CLK.x, CLK.y, CLK.R + 34, a0, a1); ctx.stroke();
  }

  // ticks
  ctx.lineCap = 'butt';
  for (let i = 0; i < 60; i++) {
    const p = sp(t, Q.clockIn + 0.04 + i * 0.005, WT.ui);
    if (p <= 0) continue;
    const major = i % 5 === 0;
    const len = (major ? 36 : 14) * p;
    const a = clockAngle(i);
    const [x0, y0] = polar(a, CLK.R - 22);
    const [x1, y1] = polar(a, CLK.R - 22 - len);
    ctx.strokeStyle = C.espresso; ctx.lineWidth = major ? 9 : 3;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  // hands at 8:15
  ctx.lineCap = 'round'; ctx.strokeStyle = C.espresso;
  const hp = sp(t, Q.clockIn + 0.1, WT.card), mp = sp(t, Q.clockIn + 0.16, WT.card);
  const ha = clockAngle((8 + 15 / 60) * 5) - 0.35 * (1 - hp), ma = clockAngle(15) - 0.5 * (1 - mp);
  let [hx, hy] = polar(ha, CLK.R * 0.5 * hp);
  ctx.lineWidth = 20; ctx.beginPath(); ctx.moveTo(CLK.x, CLK.y); ctx.lineTo(hx, hy); ctx.stroke();
  let [mx, my] = polar(ma, CLK.R * 0.78 * mp);
  ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(CLK.x, CLK.y); ctx.lineTo(mx, my); ctx.stroke();
  // ghost minute hand riding the wedge to :30
  if (wp > 0.01) {
    const [gx, gy] = polar(clockAngle(15 + 15 * wp), CLK.R * 0.78);
    ctx.strokeStyle = C.signal; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(CLK.x, CLK.y); ctx.lineTo(gx, gy); ctx.stroke();
  }
  drawColonDot(ctx, CLK.x, CLK.y, 18, C.signal);

  // callout on the arc
  const cp = sp(t, Q.wedge + 0.22, WT.ui);
  const [cx, cy] = polar(clockAngle(22.5), CLK.R + 92);
  maskedRuns(ctx, [['+15 MIN', F.mono]], cx - 6, cy + 30, 30, C.signal, cp, { ls: 3, padX: 6 });

  // type column
  const X = 1060;
  maskedRuns(ctx, [['08:15 IS', F.mono]], X + 8, 300, 26, C.paper, sp(t, Q.tooEarly - 0.1, WT.ui), { ls: 3.5, padX: 6 });
  maskedRuns(ctx, [['too', F.serifI]], X, 530, 260, C.foam, sp(t, Q.tooEarly, WT.hero), { padX: 60 });
  maskedRuns(ctx, [['early.', F.serifI]], X, 760, 260, C.foam, sp(t, Q.tooEarly + 0.12, WT.hero), { padX: 60 });
  maskedRuns(ctx, [['for those who ', F.serif], ['sleep in.', F.serifI]], X + 8, 880, 60, C.crema, sp(t, Q.sleepIn, WT.ui), { padX: 20 });
  ctx.restore();
}

/* ------------------------------------------------------------------ SHOTS 3+4: the table (one continuous world) */
const SLOTS = [260, 530, 800, 1070, 1340, 1610];
const CUP_SCALE = 1.12;
function catState3(t) {
  const Q = CUE;
  const s1 = sp(t, Q.earsPop, WT.card), s2 = sp(t, Q.catPeek, WT.card);
  const y = 975 - 105 * s1 - 135 * s2;
  const lookL = sp(t, Q.catPeek + 0.1, WT.ui) * (1 - sp(t, Q.earsDroop, WT.ui));
  const droop = sp(t, Q.earsDroop, WT.heavy);
  const sad = sp(t, Q.sadEyes, WT.card);
  const tearForm = sp(t, Q.littleCats, WT.card);
  const along = E.inOutSine(inv(Q.tearRoll, Q.tearDrop, t));
  const df = Math.max(0, t - Q.tearDrop);
  const fall = 0.5 * 9 * df * df + 0.3 * df;
  const wig = 0.08 * wobble(t, Q.earsPop + 0.05, 30, 7);
  const breathe = 0.004 * Math.sin(t * 2.4) * sad;
  return {
    y: y + breathe * 200,
    st: {
      droop, sad, look: [-0.95 * lookL + 0.12 * sad, 0.1 * lookL - 0.35 * sad], earWiggle: wig,
      tear: { form: tearForm, along, fall },
      tilt: 0.06 * sad,
    },
  };
}
function shotTable(ctx, t) {
  const Q = CUE;
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);

  // camera
  const p = sp(t, Q.pushIn, WT.cam);
  const S = Math.exp(lerp(0, Math.log(3.2), p)) * (1 + 0.035 * E.inOutSine(inv(7.6, 10, t)));
  const fx = lerp(960, 1610, p), fy = lerp(540, 712, p);
  const ax = lerp(960, 1340, p), ay = lerp(540, 600, p);
  ctx.save();
  ctx.translate(ax, ay); ctx.scale(S, S); ctx.translate(-fx, -fy);

  // cat (behind the table)
  const cat = catState3(t);
  if (t > Q.earsPop - 0.05) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, -2000, 4000, 2000 + TABLE_Y - 2); ctx.clip();
    drawCat(ctx, 1610, cat.y, 200, cat.st);
    ctx.restore();
  }

  // cups
  for (let i = 0; i < 5; i++) {
    const s = sp(t, Q.cupsIn + i * 0.075, WT.card);
    if (s <= 0) continue;
    const dq = inv(Q.drainStart + i * 0.22, Q.drainStart + i * 0.22 + 0.55, t);
    const level = 1 - E.inOutCubic(dq);
    const tilt = -0.12 * Math.sin(Math.PI * dq);
    const exit = E.inCubic(inv(Q.pushIn - 0.05 + (4 - i) * 0.03, Q.pushIn + 0.35 + (4 - i) * 0.03, t));
    const cx = SLOTS[i] - exit * 420;
    ctx.save();
    ctx.translate(0, -(1 - s) * 980);
    const squash = clamp((s - 1) * 1.6, -0.14, 0.14);
    ctx.translate(cx, TABLE_Y); ctx.scale(CUP_SCALE, CUP_SCALE); ctx.translate(-cx, -TABLE_Y);
    drawCup(ctx, cx, t, { level, tilt, sy: 1 - squash, steam: level * clamp(s * 2 - 1) });
    ctx.restore();
  }
  // the empty seat
  const seatIn = sp(t, Q.cupsIn + 0.45, WT.ui);
  const seatOut = E.inCubic(inv(Q.earsPop - 0.15, Q.earsPop + 0.05, t));
  if (seatIn > 0 && seatOut < 1) {
    ctx.save();
    ctx.translate(1610, TABLE_Y); ctx.scale(CUP_SCALE, CUP_SCALE); ctx.translate(-1610, -TABLE_Y);
    drawCup(ctx, 1610, t, { dashed: true, alpha: seatIn * (1 - seatOut), steam: 0 });
    ctx.restore();
  }

  // table
  const tw = E.outExpo(inv(Q.tableIn, Q.tableIn + 0.45, t));
  ctx.fillStyle = C.espresso;
  ctx.fillRect(MARGIN - 400, TABLE_Y - 2.5, (W - 2 * MARGIN + 800) * tw, 5);
  // place card
  maskedRuns(ctx, [['RESERVED · 8:30', F.mono]], 1610, TABLE_Y + 46, 20, C.signal, sp(t, Q.cupsIn + 0.5, WT.ui), { ls: 3, align: 'center', padX: 6 });
  ctx.restore();

  // headlines (screen space)
  const X = 128;
  const outA = sp(t, Q.headlineSwap, WT.ui);
  maskedRuns(ctx, [['The team sips at ', F.serif], ['8:15.', F.serifI]], X, 300, 128, C.espresso,
    sp(t, 4.7, WT.hero), { exit: outA, padX: 30 });
  const outB = sp(t, Q.pushIn - 0.1, WT.ui);
  maskedRuns(ctx, [['By 8:30, it’s ', F.serif], ['all gone.', F.serifI]], X, 300, 128, C.espresso,
    sp(t, Q.headlineSwap + 0.08, WT.hero), { exit: outB, padX: 30 });

  // big live clock: 08:15 -> 08:30
  {
    const m = 15 + Math.floor(15 * inv(4.75, 6.3, t));
    const late = m >= 30;
    const tickT = 4.75 + ((m - 15) / 15) * (6.3 - 4.75);
    const kickY = m > 15 ? -10 * decay(t, tickT, 18) : 0;
    const pin = sp(t, 4.8, WT.ui), pout = sp(t, Q.pushIn - 0.1, WT.ui);
    maskedRuns(ctx, [['NOW', F.mono]], W - 128, 190, 24, C.espresso, pin, { ls: 4, align: 'right', exit: pout, padX: 6 });
    maskedRuns(ctx, [[`08:${String(m).padStart(2, '0')}`, F.mono]], W - 128, 300 + kickY, 120, late ? C.signal : C.espresso,
      pin, { ls: -2, align: 'right', exit: pout, padX: 10 });
  }

  // shot 4 type
  maskedRuns(ctx, [['LATE BIRDS', F.mono]], X + 6, 420, 28, C.espresso, sp(t, Q.lateBirds, WT.ui), { ls: 4, padX: 6 });
  maskedRuns(ctx, [['become sad', F.serif]], X, 590, 140, C.espresso, sp(t, Q.becomeSad, WT.hero), { padX: 30 });
  maskedRuns(ctx, [['little cats.', F.serifI]], X - 4, 800, 196, C.espresso, sp(t, Q.littleCats, WT.hero), { padX: 30 });
}

/* ------------------------------------------------------------------ SHOTS 5+6: punch + lockup */
function shotEnd(ctx, t) {
  const Q = CUE;
  const P = Q.punch;
  const wipe = E.inOutCubic(inv(Q.roll, Q.roll + 0.42, t));
  ctx.fillStyle = C.signal; ctx.fillRect(0, 0, W, H);
  if (wipe > 0) { ctx.fillStyle = C.paper; ctx.fillRect(0, H * (1 - wipe), W, H * wipe + 1); }

  // camera kicks on beats, then settle for the lockup
  let kick = 0;
  for (const b of P) kick += decay(t, b, 9);
  const settle = 1 + 0.03 * (1 - sp(t, Q.lockup, WT.cam));
  const hold = 1 + 0.018 * E.inOutSine(inv(Q.footer, DURATION, t));
  const S = (1 + 0.02 * kick) * (t > Q.roll ? settle * hold : 1);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(S, S); ctx.translate(-W / 2, -H / 2);

  // impulses: each new word shoves the block
  const dirs = [[0, -1], [1, 0], [0, 1], [1, 0]];
  let nx = 0, ny = 0;
  P.forEach((b, j) => { const w = wobble(t, b, 34, 11) * 22; nx += dirs[j][0] * w; ny += dirs[j][1] * w; });

  const pp = L.p;
  const ink = C.espresso;
  const throwUp = E.inCubic(inv(Q.roll - 0.1, Q.roll + 0.16, t));
  const throwUp2 = E.inCubic(inv(Q.roll - 0.07, Q.roll + 0.19, t));
  const throwD = E.inCubic(inv(Q.roll - 0.1, Q.roll + 0.14, t));

  // JUST / WAIT
  const wordIn = (j, from, dist) => {
    // horizontal entries are damped harder so they never overshoot into their neighbour
    const s = sp(t, P[j] - 0.075, from[0] ? { k: 520, c: 40 } : WT.punch);
    return [from[0] * dist * (1 - s), from[1] * dist * (1 - s), s];
  };
  ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  {
    const [dx, dy, s] = wordIn(0, [0, -1], 760);
    if (s > 0) {
      setFont(ctx, F.black, pp.s1, -0.03 * pp.s1);
      ctx.fillText('JUST', pp.x + dx + nx, pp.base1 + dy + ny - throwUp * 1300);
    }
  }
  {
    const [dx, dy, s] = wordIn(1, [1, 0], 1500);
    if (s > 0) {
      setFont(ctx, F.black, pp.s1, -0.03 * pp.s1);
      ctx.fillText('WAIT', pp.x + pp.wJUST + 70 + dx + nx, pp.base1 + dy + ny - throwUp2 * 1300);
    }
  }
  // MIN.
  {
    const [dx, dy, s] = wordIn(3, [1, 0], 1300);
    if (s > 0) {
      setFont(ctx, F.black, pp.s1, -0.03 * pp.s1);
      const x15 = pp.x + pp.w1 + pp.w5 - 0.035 * pp.s2;
      ctx.fillText('MIN.', x15 + 60 + dx + nx, pp.base2 + dy + ny + throwD * 900);
    }
  }

  // 15 -> 30, gliding into the lockup
  const g = L.end.glyphs;
  const glide = sp(t, Q.roll + 0.04, { k: 150, c: 24 });
  const [dx15, dy15, s15] = wordIn(2, [0, 1], 900);
  const scaleIn = lerp(1.5, 1, clamp(s15 + 0.0));
  if (s15 > 0) {
    const size = lerp(pp.s2, L.end.size, glide) * (t < Q.roll ? scaleIn : 1);
    const base = lerp(pp.base2, L.end.base, glide) + (1 - glide) * (dy15 + ny);
    const x0 = lerp(pp.x, g[2].x, glide) + (1 - glide) * nx;
    const cap = 0.727 * size;
    const pairs = [['1', '3', Q.roll + 0.02], ['5', '0', Q.roll + 0.08]];
    let x = x0;
    const k = size / L.end.size;
    pairs.forEach(([a, b, tr], i) => {
      const r = sp(t, tr, WT.ui);
      const wa = measure(ctx, a, F.black, size), wb = measure(ctx, b, F.black, size);
      const ww = lerp(wa, wb, r);
      ctx.save();
      ctx.beginPath(); ctx.rect(x - 40 * k, base - cap * 1.02 - 4 * k, Math.max(wa, wb) + 80 * k, cap * 1.04 + 10 * k); ctx.clip();
      setFont(ctx, F.black, size);
      ctx.fillStyle = ink;
      if (r < 0.999) ctx.fillText(a, x, base - r * (cap + 120 * k));
      if (r > 0.001) ctx.fillText(b, x, base + (1 - r) * (cap + 120 * k));
      ctx.restore();
      x += ww - 0.035 * size;
    });
  }

  // lockup: "8" and colon slide in to meet "30"
  const E8 = sp(t, Q.lockup - 0.32, { k: 210, c: 27 }); // no overshoot: the 8 must never touch the 3
  if (E8 > 0) {
    const size = L.end.size, base = L.end.base;
    setFont(ctx, F.black, size);
    ctx.fillStyle = ink;
    ctx.fillText('8', g[0].x - (1 - E8) * 900, base);
    const cxp = g[1].x + g[1].w / 2 - (1 - E8) * 900;
    const d1 = sp(t, Q.lockup - 0.1, WT.card), d2 = sp(t, Q.lockup - 0.04, WT.card);
    drawColonDot(ctx, cxp, base - COLON.up * size, COLON.r * size * d1, C.signal);
    drawColonDot(ctx, cxp, base - COLON.low * size, COLON.r * size * d2, C.signal);
  }

  // happy cat peeking out from behind the "0"
  const cs = sp(t, Q.happyCat, WT.card);
  if (cs > 0.001) {
    const g0 = g[3];
    const right = g0.x + g0.w;
    const top = L.end.base - 0.727 * L.end.size;
    const bl = Math.max(0, 1 - Math.abs(t - Q.blink - 0.06) / 0.06);
    ctx.save();
    ctx.beginPath(); ctx.rect(right - 70, 0, 900, H); ctx.clip();
    drawCat(ctx, lerp(right - 120, right + 38, cs), top + 150 + 5 * Math.sin((t - Q.happyCat) * 3.1), 230, {
      happy: 1, tilt: 0.32 + 0.04 * wobble(t, Q.happyCat, 20, 6), blink: bl,
      earWiggle: 0.12 * wobble(t, Q.happyCat + 0.1, 28, 6),
    });
    ctx.restore();
    // redraw the "0" on top so the cat really sits behind it
    setFont(ctx, F.black, L.end.size);
    ctx.fillStyle = ink;
    ctx.save();
    ctx.beginPath(); ctx.rect(right - 300, top - 50, 300, 0.727 * L.end.size + 100); ctx.clip();
    ctx.fillText('0', g0.x, L.end.base);
    ctx.restore();
  }

  maskedRuns(ctx, [['Coffee at', F.serifI]], W / 2 - 70, 300, 150, ink, sp(t, Q.coffeeAt, WT.hero), { align: 'center', padX: 40 });
  ctx.restore();

  // footer (screen space)
  const fp = sp(t, Q.footer, WT.ui);
  const rule = E.outExpo(inv(Q.footer - 0.1, Q.footer + 0.5, t));
  if (rule > 0) { ctx.fillStyle = ink; ctx.fillRect(MARGIN, 958, (W - 2 * MARGIN) * rule, 2); }
  maskedRuns(ctx, [['EVERYONE SLEEPS. EVERYONE SIPS.', F.mono]], MARGIN, 1012, 24, ink, fp, { ls: 3.5, padX: 6 });
  maskedRuns(ctx, [['STARTING MONDAY', F.mono]], W - MARGIN, 1012, 24, C.signal, sp(t, Q.footer + 0.1, WT.ui), { ls: 3.5, padX: 6, align: 'right' });
}

/* ------------------------------------------------------------------ frame assembly */
function segmentOf(t) {
  for (let i = SEGMENTS.length - 2; i >= 0; i--) if (t >= SEGMENTS[i]) return i;
  return 0;
}
function drawScene(ctx, t) {
  ctx.save();
  const seg = segmentOf(t);
  if (seg === 0) shot1(ctx, t);
  else if (seg === 1) shot2(ctx, t);
  else if (seg === 2) shotTable(ctx, t);
  else shotEnd(ctx, t);
  ctx.restore();

  // running header
  const onDark = t >= 2.0 && t < 4.5 && !(t > 4.32);
  const col = onDark ? C.paper : C.espresso;
  let right = 'MEMO Nº 830';
  if (seg === 3 && t < CUE.roll + 0.2) right = 'PROPOSAL';
  header(ctx, t, 'TEAM COFFEE — DAILY', right, col, 0.85);
}

let canvas, ctx, buf, bctx, acc, actx;
const BLUR = { samples: 6, shutter: 0.5 }; // 180° shutter

function renderFrame(t) {
  t = clamp(t, 0, DURATION - 1e-6);
  const seg = segmentOf(t);
  const lo = SEGMENTS[seg], hi = SEGMENTS[seg + 1] - 1e-4;
  const n = BLUR.samples;
  actx.globalAlpha = 1;
  for (let i = 0; i < n; i++) {
    const ts = clamp(t + ((i + 0.5) / n - 0.5) * (BLUR.shutter / FPS), lo, hi);
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, W, H);
    drawScene(bctx, ts);
    actx.globalAlpha = 1 / (i + 1);
    actx.drawImage(buf, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(acc, 0, 0);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.10;
  ctx.drawImage(grainCanvas, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

async function loadFonts() {
  const base = '../assets/fonts/';
  const list = [
    [F.black, 'InterDisplay-Black.otf'], [F.bold, 'InterDisplay-Bold.otf'],
    [F.serif, 'InstrumentSerif-Regular.woff2'], [F.serifI, 'InstrumentSerif-Italic.woff2'],
    [F.mono, 'JetBrainsMono-Medium.woff2'],
  ];
  await Promise.all(list.map(async ([fam, file]) => {
    const ff = new FontFace(fam, `url(${base}${file})`);
    await ff.load();
    document.fonts.add(ff);
  }));
}

window.ready = (async () => {
  CUE = (await (await fetch('timeline.json')).json()).cues;
  await loadFonts();
  canvas = document.getElementById('c');
  ctx = canvas.getContext('2d');
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  buf = mk(); bctx = buf.getContext('2d');
  acc = mk(); actx = acc.getContext('2d');
  buildGrain();
  computeLayouts(ctx);
  window.seek = t => { renderFrame(t); return t; };
  window.frameDataURL = (t, type = 'image/png') => { renderFrame(t); return canvas.toDataURL(type); };
  const params = new URLSearchParams(location.search);
  if (params.has('render')) document.body.classList.add('render');
  const scrub = document.getElementById('scrub');
  scrub.addEventListener('input', () => window.seek(parseFloat(scrub.value)));
  window.seek(parseFloat(params.get('t') || '0'));
  return true;
})();
