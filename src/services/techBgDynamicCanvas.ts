export interface DynamicCanvasPalette {
  base: string;
  primary: string;
  secondary: string;
  accent: string;
  highlight: string;
  isLight: boolean;
}

export interface DynamicCanvasInput {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  seedFloat: number;
  rng: () => number;
  density: number;       // 0.1..1.0
  scale: number;         // 0.4..2.2
  rotationDeg: number;   // 0..360
  rotationRad: number;   // 0..2*PI
  offsetX: number;       // -0.5..+0.5
  offsetY: number;       // -0.5..+0.5
  warp: number;          // 0..1.5
  grain: number;         // 0..1.0
  lineWeight: number;    // 0.4..2.2
  glow: number;          // 0..1
  depth: number;         // 0..1
  transparent: boolean;
  palette: DynamicCanvasPalette;
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, min = 0, max = 1): number {
  const loVal = toNum(min, 0);
  const hiVal = toNum(max, 1);
  const lo = Math.min(loVal, hiVal);
  const hi = Math.max(loVal, hiVal);
  return Math.max(lo, Math.min(hi, toNum(v, lo)));
}

function hslToRgbTuple(h: number, sPct: number, lPct: number): [number, number, number] {
  const hue = (((toNum(h, 0) % 360) + 360) % 360) / 360;
  const s = clamp(sPct, 0, 100) / 100;
  const l = clamp(lPct, 0, 100) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hue + 1 / 3) * 255),
    Math.round(hue2rgb(hue) * 255),
    Math.round(hue2rgb(hue - 1 / 3) * 255),
  ];
}

function hexToRgbTuple(colorInput: string): [number, number, number] {
  if (typeof colorInput !== 'string') return [20, 40, 80];
  const raw = colorInput.trim();
  if (!raw) return [20, 40, 80];

  const rgbMatch = raw.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i);
  if (rgbMatch) {
    return [
      Math.round(clamp(Number(rgbMatch[1]), 0, 255)),
      Math.round(clamp(Number(rgbMatch[2]), 0, 255)),
      Math.round(clamp(Number(rgbMatch[3]), 0, 255)),
    ];
  }

  const hslMatch = raw.match(/^hsla?\(\s*([-\d.]+)\s*[,\s]\s*([\d.]+)%?\s*[,\s]\s*([\d.]+)%?/i);
  if (hslMatch) {
    return hslToRgbTuple(Number(hslMatch[1]), Number(hslMatch[2]), Number(hslMatch[3]));
  }

  const clean = raw.replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [20, 40, 80];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha = 1): string {
  const [r, g, b] = hexToRgbTuple(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function mixHex(hexA: string, hexB: string, t: number, alpha = 1): string {
  const u = clamp(t, 0, 1);
  const a = hexToRgbTuple(hexA);
  const b = hexToRgbTuple(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgba(${r},${g},${bl},${clamp(alpha, 0, 1)})`;
}

function hashScalar2D(x: number, y: number, seedOffset: number): number {
  const n = Math.sin(toNum(x, 0) * 127.1 + toNum(y, 0) * 311.7 + toNum(seedOffset, 0) * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function createSeededRng(seedVal: number): () => number {
  let x = (Math.imul(Math.floor(toNum(seedVal, 1) * 1000003) ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
  x ^= x >>> 13;
  x = (Math.imul(x, 0xc2b2ae35) >>> 0) || 1;
  let a = x >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2D(x: number, y: number, seedOffset: number): number {
  const nx = toNum(x, 0);
  const ny = toNum(y, 0);
  const ns = toNum(seedOffset, 0);
  const xi = Math.floor(nx);
  const yi = Math.floor(ny);
  const xf = nx - xi;
  const yf = ny - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (
    hashScalar2D(xi, yi, ns) * (1 - u) * (1 - v) +
    hashScalar2D(xi + 1, yi, ns) * u * (1 - v) +
    hashScalar2D(xi, yi + 1, ns) * (1 - u) * v +
    hashScalar2D(xi + 1, yi + 1, ns) * u * v
  );
}

function fbm2D(x: number, y: number, seedOffset: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  const count = clamp(Math.round(toNum(octaves, 4)), 1, 8);
  for (let i = 0; i < count; i++) {
    val += amp * noise2D(toNum(x, 0) * freq, toNum(y, 0) * freq, seedOffset + i * 19.3);
    freq *= 2.03;
    amp *= 0.5;
  }
  return val;
}

export function sanitizeAiCanvasCode(rawCode: string): string {
  let code = rawCode.trim();
  code = code.replace(/^```(?:javascript|js)?\s*/i, '').replace(/```\s*$/i, '').trim();

  // If the AI accidentally wrapped the body in `(ctx, w, h, api) => { ... }` or `function(ctx, w, h, api) { ... }`,
  // unwrap to the inner function body so `new Function('ctx','w','h','api', body)` actually executes it.
  const wrapperMatch = code.match(
    /^(?:(?:export\s+default|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)\s*)?(?:async\s+)?(?:function(?:\s+\w+)?\s*\([^)]*\)|(?:\([^)]*\)|ctx)\s*=>)\s*\{([\s\S]*)\}\s*;?\s*$/
  );
  if (wrapperMatch && typeof wrapperMatch[1] === 'string') {
    code = wrapperMatch[1].trim();
  }

  return code;
}

export function executeDynamicCanvasCode(
  rawCode: string,
  input: DynamicCanvasInput
): { ok: true } | { ok: false; errorMsg: string } {
  const {
    ctx,
    w,
    h,
    seedFloat,
    rng,
    density,
    scale,
    rotationDeg,
    rotationRad,
    offsetX,
    offsetY,
    warp,
    grain,
    lineWeight,
    glow,
    depth,
    transparent,
    palette,
  } = input;

  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  const s = minDim / 1000;

  const randFn = (min?: number, max?: number): number => {
    if (min === undefined) return rng();
    if (max === undefined) return rng() * toNum(min, 1);
    const a = toNum(min, 0);
    const b = toNum(max, 1);
    return a + rng() * (b - a);
  };

  // Deterministic seeded helper: supports BOTH `api.srand(s)` as numeric [0, 1) value
  // and `const r = api.srand(s); r()` / `r(min, max)` as a seeded PRNG function.
  const srandFn = (seedInput?: number, max?: number) => {
    const combined = seedFloat * 13.37 + toNum(seedInput, 1);
    const subRng = createSeededRng(combined);
    const firstSample = createSeededRng(combined)();
    const firstVal = max !== undefined ? firstSample * toNum(max, 1) : firstSample;

    const callable = (a?: number, b?: number): number => {
      if (a === undefined) return subRng();
      if (b === undefined) return subRng() * toNum(a, 1);
      const lo = toNum(a, 0);
      const hi = toNum(b, 1);
      return lo + subRng() * (hi - lo);
    };
    Object.defineProperty(callable, Symbol.toPrimitive, {
      value: (hint: string) => (hint === 'string' ? String(firstVal) : firstVal),
    });
    callable.valueOf = () => firstVal;
    callable.toString = () => String(firstVal);
    return callable as unknown as ((min?: number, max?: number) => number) & number;
  };

  const api = {
    ctx,
    w,
    h,
    cx: w * (0.5 + offsetX * 0.45),
    cy: h * (0.5 + offsetY * 0.45),
    minDim,
    maxDim,
    s,
    PI: Math.PI,
    TAU: Math.PI * 2,
    px: (nx: number) => (toNum(nx, 0.5) + offsetX * 0.45) * w,
    py: (ny: number) => (toNum(ny, 0.5) + offsetY * 0.45) * h,
    ps: (units: number) => toNum(units, 1) * s,
    seed: seedFloat,
    rng,
    rand: randFn,
    random: randFn,
    srand: srandFn,
    createRng: (seedInput = 1) => createSeededRng(seedFloat * 13.37 + toNum(seedInput, 1)),
    randInt: (min: number, max?: number) => {
      if (max === undefined) {
        const hi = Math.max(1, Math.floor(toNum(min, 1)));
        return Math.floor(rng() * hi);
      }
      const lo = Math.ceil(Math.min(toNum(min, 0), toNum(max, 1)));
      const hi = Math.floor(Math.max(toNum(min, 0), toNum(max, 1)));
      return lo + Math.floor(rng() * Math.max(1, hi - lo + 1));
    },
    pick: <T,>(arr: readonly T[]): T | undefined =>
      Array.isArray(arr) && arr.length > 0 ? arr[Math.floor(rng() * arr.length)] : undefined,
    range: randFn,
    hash: (x: number, y = 0) => hashScalar2D(x, y, seedFloat * 0.01),
    density,
    scale,
    rotationDeg,
    rotationRad,
    offsetX,
    offsetY,
    warp,
    grain,
    lineWeight,
    glow,
    depth,
    transparent,
    palette,
    rgba,
    mix: mixHex,
    clamp,
    lerp: (a: number, b: number, t: number) => {
      const av = toNum(a, 0);
      const bv = toNum(b, 0);
      return av + (bv - av) * clamp(t, 0, 1);
    },
    map: (v: number, inMin: number, inMax: number, outMin: number, outMax: number, clamped = false) => {
      const i0 = toNum(inMin, 0);
      const i1 = toNum(inMax, 1);
      const o0 = toNum(outMin, 0);
      const o1 = toNum(outMax, 1);
      const span = i1 - i0;
      const t = Math.abs(span) < 1e-9 ? 0 : (toNum(v, i0) - i0) / span;
      const u = clamped ? clamp(t, 0, 1) : t;
      return o0 + (o1 - o0) * u;
    },
    smoothstep: (edge0: number, edge1: number, x: number) => {
      const e0 = toNum(edge0, 0);
      const e1 = toNum(edge1, 1);
      const denom = e1 - e0;
      const t = Math.abs(denom) < 1e-9 ? (toNum(x, 0) >= e1 ? 1 : 0) : clamp((toNum(x, 0) - e0) / denom, 0, 1);
      return t * t * (3 - 2 * t);
    },
    dist: (x1: number, y1: number, x2: number, y2: number) =>
      Math.hypot(toNum(x2, 0) - toNum(x1, 0), toNum(y2, 0) - toNum(y1, 0)),
    hypot: Math.hypot,
    rad: (degVal: number) => (toNum(degVal, 0) * Math.PI) / 180,
    deg: (radVal: number) => (toNum(radVal, 0) * 180) / Math.PI,
    noise: (x: number, y = 0, offset = 0) =>
      noise2D(x, y, seedFloat * 0.01 + toNum(offset, 0)),
    fbm: (x: number, y = 0, octaves = 4, offset = 0) =>
      fbm2D(x, y, seedFloat * 0.01 + toNum(offset, 0), octaves),
    curl: (x: number, y = 0): [number, number] => {
      const nx = toNum(x, 0);
      const ny = toNum(y, 0);
      const eps = 0.015;
      const n1 = fbm2D(nx, ny + eps, seedFloat * 0.01, 3);
      const n2 = fbm2D(nx, ny - eps, seedFloat * 0.01, 3);
      const n3 = fbm2D(nx + eps, ny, seedFloat * 0.01, 3);
      const n4 = fbm2D(nx - eps, ny, seedFloat * 0.01, 3);
      return [(n1 - n2) / (2 * eps), -(n3 - n4) / (2 * eps)];
    },
    hsl: (hue: number, sat = 70, light = 50, alpha = 1) =>
      `hsla(${((toNum(hue, 0) % 360) + 360) % 360}, ${clamp(sat, 0, 100)}%, ${clamp(light, 0, 100)}%, ${clamp(alpha, 0, 1)})`,
    fillBackground: (alpha = 1) => {
      if (transparent) return;
      ctx.fillStyle = rgba(palette.base, alpha);
      ctx.fillRect(0, 0, w, h);
    },
    meshBackdrop: (spotCount = 3) => {
      if (transparent) return;
      ctx.fillStyle = rgba(palette.base, 1);
      ctx.fillRect(0, 0, w, h);
      const colors = [palette.primary, palette.secondary, palette.accent];
      const count = clamp(Math.round(spotCount), 1, 5);
      for (let i = 0; i < count; i++) {
        const bx = w * (0.2 + rng() * 0.6 + offsetX * 0.25);
        const by = h * (0.2 + rng() * 0.6 + offsetY * 0.25);
        const br = maxDim * (0.45 + rng() * 0.35);
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        const col = colors[i % colors.length];
        grad.addColorStop(0, rgba(col, (0.28 + depth * 0.26) * (palette.isLight ? 0.65 : 1)));
        grad.addColorStop(0.55, rgba(col, 0.08));
        grad.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    },
    ambientOrb: (x: number, y: number, radius: number, colorHex: string, alpha = 0.4) => {
      const r = Math.max(2, radius);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(colorHex, clamp(alpha, 0, 1)));
      grad.addColorStop(0.45, rgba(colorHex, clamp(alpha * 0.42, 0, 1)));
      grad.addColorStop(1, rgba(colorHex, 0));
      ctx.save();
      if (!palette.isLight && !transparent) ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    glowStroke: (drawPath: () => void, colorHex: string, widthPx = 1.6, glowBoost = 1) => {
      const lw = Math.max(0.5, widthPx * lineWeight);
      const gAmt = clamp(glow * glowBoost, 0, 1.5);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (gAmt > 0.05) {
        if (!palette.isLight && !transparent) ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = rgba(colorHex, clamp(0.14 * gAmt, 0.02, 0.45));
        ctx.lineWidth = lw + 10 * s * gAmt;
        ctx.beginPath();
        drawPath();
        ctx.stroke();

        ctx.strokeStyle = rgba(colorHex, clamp(0.32 * gAmt, 0.05, 0.7));
        ctx.lineWidth = lw + 3.6 * s * gAmt;
        ctx.beginPath();
        drawPath();
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = colorHex.startsWith('rgb') || colorHex.startsWith('hsl') ? colorHex : rgba(colorHex, 0.96);
      ctx.lineWidth = lw;
      ctx.beginPath();
      drawPath();
      ctx.stroke();
      ctx.restore();
    },
    isoBox: (
      x: number,
      y: number,
      size: number,
      heightRatio = 1,
      topCol = palette.accent,
      leftCol = palette.primary,
      rightCol = palette.secondary,
      edgeCol?: string
    ) => {
      const dx = size * 0.8660254;
      const dy = size * 0.5;
      const hPx = size * Math.max(0.1, heightRatio);
      // Top face
      ctx.beginPath();
      ctx.moveTo(x, y - hPx);
      ctx.lineTo(x + dx, y - hPx + dy);
      ctx.lineTo(x, y - hPx + size);
      ctx.lineTo(x - dx, y - hPx + dy);
      ctx.closePath();
      ctx.fillStyle = topCol;
      ctx.fill();
      if (edgeCol) {
        ctx.strokeStyle = edgeCol;
        ctx.lineWidth = Math.max(0.6, s * 0.9 * lineWeight);
        ctx.stroke();
      }
      // Left face
      ctx.beginPath();
      ctx.moveTo(x - dx, y - hPx + dy);
      ctx.lineTo(x, y - hPx + size);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - dx, y + dy);
      ctx.closePath();
      ctx.fillStyle = leftCol;
      ctx.fill();
      if (edgeCol) ctx.stroke();
      // Right face
      ctx.beginPath();
      ctx.moveTo(x, y - hPx + size);
      ctx.lineTo(x + dx, y - hPx + dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.lineTo(x, y + size);
      ctx.closePath();
      ctx.fillStyle = rightCol;
      ctx.fill();
      if (edgeCol) ctx.stroke();
    },
    project3D: (x: number, y: number, z: number, fov = 1.65, camDist = 3.2) => {
      const ca = Math.cos(rotationRad);
      const sa = Math.sin(rotationRad);
      const rx = x * ca - z * sa;
      const rz = x * sa + z * ca;
      const denom = Math.max(0.25, camDist + rz);
      const persp = fov / denom;
      const cxShift = w * (0.5 + offsetX * 0.45);
      const cyShift = h * (0.5 + offsetY * 0.45);
      return {
        x: cxShift + rx * minDim * 0.5 * scale * persp,
        y: cyShift + y * minDim * 0.5 * scale * persp,
        scale: persp,
        z: rz,
      };
    },
    line: (x1: number, y1: number, x2: number, y2: number, strokeStyle: string, widthPx = 1.5) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = Math.max(0.5, widthPx * lineWeight);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    circle: (x: number, y: number, r: number, fillStyle?: string, strokeStyle?: string, widthPx = 1.4) => {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.3, r), 0, Math.PI * 2);
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = Math.max(0.5, widthPx * lineWeight);
        ctx.stroke();
      }
    },
    polygon: (pts: Array<[number, number]>, fillStyle?: string, strokeStyle?: string, widthPx = 1.2) => {
      if (!pts || pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = Math.max(0.5, widthPx * lineWeight);
        ctx.stroke();
      }
    },
    withTransform: (fn: () => void, cxRatio = 0.5, cyRatio = 0.5) => {
      ctx.save();
      ctx.translate(w * (cxRatio + offsetX * 0.45), h * (cyRatio + offsetY * 0.45));
      ctx.rotate(rotationRad);
      ctx.scale(scale, scale);
      ctx.translate(-w * cxRatio, -h * cyRatio);
      try {
        fn();
      } finally {
        ctx.restore();
      }
    },
  };

  const sanitized = sanitizeAiCanvasCode(rawCode);
  ctx.save();
  try {
    // Disallow DOM/network access inside user-agent code execution
    const fn = new Function(
      'ctx',
      'w',
      'h',
      'api',
      `"use strict";
      const window = undefined, document = undefined, fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, localStorage = undefined;
      ${sanitized}`
    );
    fn(ctx, w, h, api);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, errorMsg: err?.message || 'Dynamic canvas execution error' };
  } finally {
    ctx.restore();
  }
}
