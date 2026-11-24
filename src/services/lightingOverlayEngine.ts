import { canvasToBlobAsync } from './techBgEngine';
import {
  LightingOverlayDoc,
  OverlayAspectRatio,
  OverlayBackgroundMode,
  OverlayCategory,
  OverlayExportFormat,
  OverlayLayerConfig,
  OverlayLayerType,
  OverlayResolutionPreset,
  createDefaultLayer,
  makeOverlayLayerId,
  resolveOverlayDimensions,
} from './lightingOverlayTypes';

// ============================================================================
// Seeded PRNG & Color Helpers
// ============================================================================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateOverlaySeedCode(): string {
  const n = Math.floor(100000 + Math.random() * 899999);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `LUX-${n}-${chars[Math.floor(Math.random() * chars.length)]}${chars[Math.floor(Math.random() * chars.length)]}`;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string, fallback: RGB = { r: 255, g: 180, b: 80 }): RGB {
  const clean = (hex || '').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return fallback;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(c: RGB, alpha: number): string {
  return `rgba(${Math.round(clamp(c.r, 0, 255))},${Math.round(clamp(c.g, 0, 255))},${Math.round(clamp(c.b, 0, 255))},${clamp(alpha, 0, 1).toFixed(4)})`;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const u = clamp(t, 0, 1);
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = clamp(s, 0, 1);
  const lit = clamp(l, 0, 1);
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (sat === 0) {
    r = g = b = lit;
  } else {
    const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
    const p = 2 * lit - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(clamp(v * 255, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Curated stock optical color palettes
const OPTICAL_PALETTES: Array<{
  name: string;
  primary: string;
  secondary: string;
  core: string;
}> = [
  { name: 'Solar Gold', primary: '#ffaa2b', secondary: '#ff4800', core: '#fff8e1' },
  { name: 'Cinema Anamorphic', primary: '#2d9cff', secondary: '#ff8a24', core: '#f0f8ff' },
  { name: 'Electric Plasma', primary: '#49c6ff', secondary: '#2653ff', core: '#ffffff' },
  { name: 'Crimson Voltage', primary: '#ff2442', secondary: '#b80036', core: '#ffe6eb' },
  { name: 'Emerald Cyber', primary: '#2aff6d', secondary: '#00b876', core: '#ebfff1' },
  { name: '35mm Warm Leak', primary: '#ff6f1e', secondary: '#e81e63', core: '#ffe29a' },
  { name: 'Arctic Daylight', primary: '#e3eeff', secondary: '#6da5ff', core: '#ffffff' },
  { name: 'Violet Laser', primary: '#d926ff', secondary: '#29b6ff', core: '#fceaff' },
  { name: 'Rose Amber', primary: '#ff5286', secondary: '#ffaa3b', core: '#fff2e6' },
  { name: 'Pure Studio White', primary: '#dce6f5', secondary: '#8aa4cc', core: '#ffffff' },
  { name: 'Sunset Ember', primary: '#ff8021', secondary: '#7a1cff', core: '#fff4d4' },
  { name: 'Teal Horizon', primary: '#00f0d4', secondary: '#006aff', core: '#e6fffa' },
];

function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  blades: number,
  rotRad: number
) {
  ctx.beginPath();
  if (blades < 3) {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  for (let i = 0; i < blades; i++) {
    const a = rotRad + (i / blades) * Math.PI * 2;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawFourPointGlint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotRad: number,
  color: RGB,
  alpha: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotRad);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
  g.addColorStop(0, rgba({ r: 255, g: 255, b: 255 }, alpha));
  g.addColorStop(0.35, rgba(color, alpha * 0.65));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();

  for (let pass = 0; pass < 2; pass++) {
    ctx.save();
    ctx.rotate(pass * (Math.PI / 2));
    const sg = ctx.createLinearGradient(-size, 0, size, 0);
    sg.addColorStop(0, rgba(color, 0));
    sg.addColorStop(0.45, rgba(color, alpha * 0.7));
    sg.addColorStop(0.5, rgba({ r: 255, g: 255, b: 255 }, alpha));
    sg.addColorStop(0.55, rgba(color, alpha * 0.7));
    sg.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * 0.06, size, 0);
    ctx.quadraticCurveTo(0, size * 0.06, -size, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ============================================================================
// Smooth Exponential Radial Gradient Helper (12+ stops to prevent 8-bit bands)
// ============================================================================

function fillExponentialGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  coreColor: RGB,
  primaryColor: RGB,
  secondaryColor: RGB,
  softness: number, // 0..1
  intensity: number // 0..1.5
) {
  if (radius < 1) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  const stops = 14;
  const power = 1.65 + softness * 1.9;
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const falloff = Math.pow(1 - t, power);
    let col: RGB;
    if (t < 0.22) {
      col = mixRgb(coreColor, primaryColor, t / 0.22);
    } else {
      col = mixRgb(primaryColor, secondaryColor, (t - 0.22) / 0.78);
    }
    const a = clamp(falloff * intensity * (1 - t * 0.08), 0, 1);
    g.addColorStop(t, rgba(col, a));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================================
// Layer Renderers (100% Procedural Code-Based Optics)
// ============================================================================

function renderRadialGlow(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const shortEdge = Math.min(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });
  const scaleFactor = layer.scale / 100;
  const radius = shortEdge * 0.52 * scaleFactor;
  const softness = clamp(layer.softness / 100, 0.05, 1);

  ctx.save();
  ctx.translate(layer.x * w, layer.y * h);
  ctx.rotate((layer.angle * Math.PI) / 180);
  ctx.scale(layer.stretchX / 100, layer.stretchY / 100);

  // Outer atmospheric halo
  fillExponentialGlow(ctx, 0, 0, radius * 1.35, primary, secondary, secondary, softness, 0.55);
  // Main ambient orb
  fillExponentialGlow(ctx, 0, 0, radius, core, primary, secondary, softness * 0.9, 0.92);
  // Inner crisp nucleus controlled by sharpness
  const sharpFactor = clamp(layer.sharpness / 100, 0, 1);
  if (sharpFactor > 0.15) {
    fillExponentialGlow(
      ctx,
      0,
      0,
      radius * (0.28 + (1 - sharpFactor) * 0.2),
      core,
      core,
      primary,
      0.55,
      0.75 * sharpFactor
    );
  }
  ctx.restore();
}

function renderSunburstRays(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x9e3779b9);
  const longEdge = Math.hypot(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });
  const rayCount = Math.max(8, Math.min(120, Math.round(layer.count * 1.4)));
  const scaleFactor = layer.scale / 100;
  const maxLen = longEdge * 0.56 * scaleFactor;
  const spreadAmt = clamp(layer.spread / 100, 0.08, 1);
  const sharpAmt = clamp(layer.sharpness / 100, 0.05, 1);
  const chaosAmt = clamp(layer.chaos / 100, 0, 1);
  const softness = clamp(layer.softness / 100, 0.05, 1);

  ctx.save();
  ctx.translate(layer.x * w, layer.y * h);
  ctx.rotate((layer.angle * Math.PI) / 180);
  ctx.scale(layer.stretchX / 100, layer.stretchY / 100);

  // Outer atmospheric bloom
  fillExponentialGlow(ctx, 0, 0, maxLen * 0.58, core, primary, secondary, softness, 0.72);

  // Conical multi-harmonic ray wedges
  for (let i = 0; i < rayCount; i++) {
    const baseAngle = (i / rayCount) * Math.PI * 2;
    const jitterAngle = (rng() - 0.5) * (Math.PI * 2 / rayCount) * chaosAmt * 0.85;
    const theta = baseAngle + jitterAngle;
    const len = maxLen * (0.42 + rng() * (0.35 + chaosAmt * 0.45));
    const halfWidth =
      ((Math.PI * 2) / rayCount) *
      (0.22 + (1 - sharpAmt) * 0.55) *
      spreadAmt *
      (0.65 + rng() * 0.7);
    const alpha = (0.06 + rng() * 0.16) * (0.45 + sharpAmt * 0.55);
    const rayCol = rng() > 0.35 ? primary : mixRgb(primary, secondary, rng());

    const xEnd = Math.cos(theta) * len;
    const yEnd = Math.sin(theta) * len;
    const g = ctx.createLinearGradient(0, 0, xEnd, yEnd);
    g.addColorStop(0, rgba(core, alpha * 1.3));
    g.addColorStop(0.2, rgba(rayCol, alpha));
    g.addColorStop(0.65, rgba(secondary, alpha * 0.32));
    g.addColorStop(1, rgba(secondary, 0));

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(theta - halfWidth) * len, Math.sin(theta - halfWidth) * len);
    ctx.lineTo(Math.cos(theta + halfWidth) * len, Math.sin(theta + halfWidth) * len);
    ctx.closePath();
    ctx.fill();
  }

  // Diffraction star spikes (4, 6, or 8 blades)
  const spikes = layer.apertureBlades >= 5 ? layer.apertureBlades : 4;
  for (let s = 0; s < spikes; s++) {
    const theta = (s / spikes) * Math.PI * 2;
    const len = maxLen * (0.7 + sharpAmt * 0.35);
    const thickness = Math.max(2, maxLen * (0.014 - sharpAmt * 0.009));

    ctx.save();
    ctx.rotate(theta);
    const sg = ctx.createLinearGradient(0, 0, len, 0);
    sg.addColorStop(0, rgba(core, 0.92));
    sg.addColorStop(0.18, rgba(primary, 0.58));
    sg.addColorStop(0.55, rgba(secondary, 0.18));
    sg.addColorStop(1, rgba(secondary, 0));
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, -thickness);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, thickness);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Intense solar core
  fillExponentialGlow(ctx, 0, 0, maxLen * 0.24, core, core, primary, 0.55, 1.0);

  // Subtle rainbow dispersion halo around core
  if (layer.dispersion > 12) {
    const dAmt = clamp(layer.dispersion / 100, 0, 1);
    const ringR = maxLen * 0.22;
    const rg = ctx.createRadialGradient(0, 0, ringR * 0.55, 0, 0, ringR * 1.15);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(0.35, `rgba(255,80,40,${(0.18 * dAmt).toFixed(4)})`);
    rg.addColorStop(0.55, `rgba(255,220,60,${(0.15 * dAmt).toFixed(4)})`);
    rg.addColorStop(0.75, `rgba(50,210,255,${(0.16 * dAmt).toFixed(4)})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, ringR * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function renderAnamorphicFlare(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x517cc1b7);
  const shortEdge = Math.min(w, h);
  const longEdge = Math.max(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });

  const ox = layer.x * w;
  const oy = layer.y * h;
  const rad = (layer.angle * Math.PI) / 180;
  const scaleFactor = layer.scale / 100;
  const sx = layer.stretchX / 100;
  const sy = layer.stretchY / 100;
  const sharpAmt = clamp(layer.sharpness / 100, 0.05, 1);
  const dispersionAmt = clamp(layer.dispersion / 100, 0, 1);
  const softness = clamp(layer.softness / 100, 0.05, 1);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(rad);

  // 1. Wide Anamorphic Horizontal Streak (Cinema streak)
  const streakHalfLen = longEdge * 0.56 * scaleFactor * Math.max(0.7, sx * 0.65);
  const streakThickness = shortEdge * (0.04 + (1 - sharpAmt) * 0.09) * scaleFactor * sy;

  ctx.save();
  ctx.scale(1, streakThickness / Math.max(1, streakHalfLen));
  fillExponentialGlow(ctx, 0, 0, streakHalfLen, core, primary, secondary, softness * 0.75, 0.85);
  ctx.restore();

  // Sharp thin optical razor line
  const coreThick = Math.max(1.5, shortEdge * (0.008 - sharpAmt * 0.004) * scaleFactor);
  ctx.save();
  ctx.scale(1, coreThick / Math.max(1, streakHalfLen * 0.85));
  fillExponentialGlow(ctx, 0, 0, streakHalfLen * 0.85, core, core, primary, 0.45, 0.98);
  ctx.restore();

  // Secondary parallel chromatic streaks
  if (dispersionAmt > 0.1) {
    const offsetY = coreThick * (1.8 + dispersionAmt * 2.8);
    ctx.save();
    ctx.translate(0, -offsetY);
    ctx.scale(1, (coreThick * 1.4) / Math.max(1, streakHalfLen * 0.65));
    fillExponentialGlow(ctx, 0, 0, streakHalfLen * 0.65, primary, secondary, secondary, 0.6, 0.42 * dispersionAmt);
    ctx.restore();

    ctx.save();
    ctx.translate(0, offsetY);
    ctx.scale(1, (coreThick * 1.4) / Math.max(1, streakHalfLen * 0.65));
    fillExponentialGlow(ctx, 0, 0, streakHalfLen * 0.65, secondary, primary, secondary, 0.6, 0.42 * dispersionAmt);
    ctx.restore();
  }

  // 2. Main Circular Halo & Soft Bloom
  const mainHaloR = shortEdge * 0.28 * scaleFactor;
  fillExponentialGlow(ctx, 0, 0, mainHaloR * 1.4, primary, secondary, secondary, softness, 0.52);
  fillExponentialGlow(ctx, 0, 0, mainHaloR * 0.48, core, core, primary, 0.5, 0.95);

  // Chromatic iris ring around main flare
  if (dispersionAmt > 0.08) {
    const ringR = mainHaloR * 0.95;
    const rg = ctx.createRadialGradient(0, 0, ringR * 0.7, 0, 0, ringR * 1.18);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(0.45, rgba(secondary, 0.18 * dispersionAmt));
    rg.addColorStop(0.68, rgba(primary, 0.26 * dispersionAmt));
    rg.addColorStop(0.85, rgba(core, 0.12 * dispersionAmt));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, ringR * 1.18, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // 3. Collinear Optical Ghost Rings & Polygon Iris Reflections across image center
  const ghostCount = Math.max(3, Math.min(28, Math.round(layer.count)));
  const axisX = w * 0.5 - ox;
  const axisY = h * 0.5 - oy;
  const blades = layer.apertureBlades;

  for (let i = 0; i < ghostCount; i++) {
    const t = -0.35 + (i / Math.max(1, ghostCount - 1)) * 2.55 + (rng() - 0.5) * 0.14;
    if (Math.abs(t) < 0.16) continue; // skip right on top of core
    const gx = ox + axisX * t * (0.9 + (rng() - 0.5) * 0.08 * (layer.chaos / 100));
    const gy = oy + axisY * t * (0.9 + (rng() - 0.5) * 0.08 * (layer.chaos / 100));
    const gRad = shortEdge * (0.015 + rng() * 0.085) * scaleFactor * (0.6 + Math.abs(t) * 0.35);
    const isRing = rng() > 0.45;
    const gCol =
      rng() < 0.45
        ? primary
        : rng() < 0.8
          ? secondary
          : mixRgb(primary, { r: 100, g: 230, b: 255 }, rng());
    const alpha = clamp((0.05 + rng() * 0.15) * (1.25 - Math.abs(t - 0.9) * 0.3), 0.02, 0.28);

    ctx.save();
    if (isRing) {
      const rg = ctx.createRadialGradient(gx, gy, gRad * 0.35, gx, gy, gRad);
      rg.addColorStop(0, rgba(gCol, alpha * 0.18));
      rg.addColorStop(0.75, rgba(gCol, alpha * 0.52));
      rg.addColorStop(0.92, rgba(mixRgb(gCol, core, 0.4), alpha * 1.15));
      rg.addColorStop(1, rgba(gCol, 0));
      ctx.fillStyle = rg;
      tracePolygonPath(ctx, gx, gy, gRad, blades, rad + rng() * 0.25);
      ctx.fill();
    } else {
      const dg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gRad);
      dg.addColorStop(0, rgba(gCol, alpha * 0.72));
      dg.addColorStop(0.7, rgba(gCol, alpha * 0.45));
      dg.addColorStop(1, rgba(gCol, 0));
      ctx.fillStyle = dg;
      tracePolygonPath(ctx, gx, gy, gRad, blades, rad);
      ctx.fill();
    }
    ctx.restore();
  }
}

function renderGodRays(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x85ebca6b);
  const diag = Math.hypot(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });

  const ox = layer.x * w;
  const oy = layer.y * h;
  const baseAngle = (layer.angle * Math.PI) / 180;
  const spreadAngle = ((clamp(layer.spread, 6, 100) / 100) * Math.PI * 0.88);
  const rayCount = Math.max(6, Math.min(90, Math.round(layer.count * 1.2)));
  const len = diag * 1.15 * (layer.scale / 100);
  const sharpAmt = clamp(layer.sharpness / 100, 0.05, 1);
  const chaosAmt = clamp(layer.chaos / 100, 0, 1);
  const softness = clamp(layer.softness / 100, 0.05, 1);

  ctx.save();
  ctx.translate(ox, oy);

  // Soft wide atmospheric mist cone
  const coneG = ctx.createRadialGradient(0, 0, 0, 0, 0, len * 0.85);
  coneG.addColorStop(0, rgba(core, 0.48));
  coneG.addColorStop(0.25, rgba(primary, 0.26));
  coneG.addColorStop(0.65, rgba(secondary, 0.08));
  coneG.addColorStop(1, rgba(secondary, 0));
  ctx.fillStyle = coneG;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, len * 0.85, baseAngle - spreadAngle * 0.65, baseAngle + spreadAngle * 0.65);
  ctx.closePath();
  ctx.fill();

  // Individual volumetric shafts
  for (let i = 0; i < rayCount; i++) {
    const u = rayCount === 1 ? 0.5 : i / (rayCount - 1);
    const offset = (u - 0.5) * spreadAngle + (rng() - 0.5) * spreadAngle * 0.14 * chaosAmt;
    const theta = baseAngle + offset;
    const rayLen = len * (0.55 + rng() * 0.45);
    const angularWidth =
      (spreadAngle / rayCount) * (0.45 + (1 - sharpAmt) * 0.9 + softness * 0.45) * (0.6 + rng() * 0.8);
    const edgeFalloff = 1 - Math.pow(Math.abs(u - 0.5) * 2, 1.8) * 0.65;
    const alpha = (0.04 + rng() * 0.11) * edgeFalloff;
    const col = mixRgb(primary, secondary, rng() * 0.6);

    const ex = Math.cos(theta) * rayLen;
    const ey = Math.sin(theta) * rayLen;
    const g = ctx.createLinearGradient(0, 0, ex, ey);
    g.addColorStop(0, rgba(core, alpha * 1.45));
    g.addColorStop(0.18, rgba(col, alpha));
    g.addColorStop(0.62, rgba(secondary, alpha * 0.42));
    g.addColorStop(1, rgba(secondary, 0));

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(theta - angularWidth) * rayLen, Math.sin(theta - angularWidth) * rayLen);
    ctx.lineTo(Math.cos(theta + angularWidth) * rayLen, Math.sin(theta + angularWidth) * rayLen);
    ctx.closePath();
    ctx.fill();
  }

  // Suspended illuminated dust motes drifting inside the shafts
  const dustCount = Math.round(rayCount * 1.6);
  for (let d = 0; d < dustCount; d++) {
    const dist = diag * (0.08 + rng() * 0.82) * (layer.scale / 100);
    const theta = baseAngle + (rng() - 0.5) * spreadAngle * 0.92;
    const dx = Math.cos(theta) * dist;
    const dy = Math.sin(theta) * dist;
    const r = Math.max(1, Math.min(w, h) * (0.0012 + rng() * 0.0045));
    const da = (0.12 + rng() * 0.35) * (1 - dist / (diag * 1.1));
    if (da <= 0.01) continue;
    const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, r * 2.2);
    dg.addColorStop(0, rgba(core, da));
    dg.addColorStop(0.5, rgba(primary, da * 0.5));
    dg.addColorStop(1, rgba(primary, 0));
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(dx, dy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function renderLightLeak(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0xc2b2ae35);
  const shortEdge = Math.min(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 220, b: 150 });
  const blobCount = Math.max(3, Math.min(18, Math.round(layer.count)));
  const scaleFactor = layer.scale / 100;
  const spread = clamp(layer.spread / 100, 0.15, 1);
  const softness = clamp(layer.softness / 100, 0.25, 1);
  const chaos = clamp(layer.chaos / 100, 0, 1);

  ctx.save();
  ctx.translate(layer.x * w, layer.y * h);
  ctx.rotate((layer.angle * Math.PI) / 180);
  ctx.scale(layer.stretchX / 100, layer.stretchY / 100);

  for (let i = 0; i < blobCount; i++) {
    const angle = (rng() - 0.5) * Math.PI * 1.4 * spread;
    const dist = shortEdge * (0.05 + rng() * 0.45 * spread) * scaleFactor;
    const bx = Math.cos(angle) * dist * (0.8 + chaos * 0.5);
    const by = Math.sin(angle) * dist * (0.8 + chaos * 0.5);
    const rx = shortEdge * (0.28 + rng() * 0.36) * scaleFactor;
    const ry = rx * (0.42 + rng() * 0.65);
    const rot = (rng() - 0.5) * 1.4;
    const c1 = mixRgb(primary, secondary, rng());
    const c2 = mixRgb(secondary, core, rng() * 0.45);
    const intensity = 0.35 + rng() * 0.42;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(rot);
    ctx.scale(1, ry / Math.max(1, rx));
    fillExponentialGlow(ctx, 0, 0, rx, core, c1, c2, softness, intensity);
    ctx.restore();
  }

  // Classic 35mm vertical emulsion burn bar
  const burnW = shortEdge * 0.14 * scaleFactor;
  const burnH = shortEdge * 0.92 * scaleFactor;
  const burnG = ctx.createLinearGradient(-burnW, 0, burnW, 0);
  burnG.addColorStop(0, rgba(secondary, 0));
  burnG.addColorStop(0.42, rgba(primary, 0.38));
  burnG.addColorStop(0.5, rgba(core, 0.55));
  burnG.addColorStop(0.58, rgba(primary, 0.38));
  burnG.addColorStop(1, rgba(secondary, 0));
  ctx.save();
  ctx.scale(1, burnH / Math.max(1, burnW * 2));
  ctx.fillStyle = burnG;
  ctx.beginPath();
  ctx.arc(0, 0, burnW, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function renderPrismSpectrum(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x27d4eb2f);
  const shortEdge = Math.min(w, h);
  const longEdge = Math.max(w, h);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });
  const bands = Math.max(4, Math.min(28, Math.round(layer.count)));
  const scaleFactor = layer.scale / 100;
  const dispersionAmt = clamp(layer.dispersion / 100, 0.25, 1);
  const spreadAmt = clamp(layer.spread / 100, 0.15, 1);
  const softness = clamp(layer.softness / 100, 0.15, 1);

  const spectrumStops: RGB[] = [
    { r: 255, g: 55, b: 75 },
    { r: 255, g: 165, b: 35 },
    { r: 255, g: 240, b: 85 },
    { r: 50, g: 245, b: 145 },
    { r: 20, g: 215, b: 255 },
    { r: 95, g: 110, b: 255 },
    { r: 205, g: 65, b: 255 },
  ];

  ctx.save();
  ctx.translate(layer.x * w, layer.y * h);
  ctx.rotate((layer.angle * Math.PI) / 180);
  ctx.scale(layer.stretchX / 100, layer.stretchY / 100);

  // Refracted spectral ribbon bands
  for (let i = 0; i < bands; i++) {
    const offsetX = (rng() - 0.5) * shortEdge * 0.72 * spreadAmt * scaleFactor;
    const offsetY = (rng() - 0.5) * shortEdge * 0.48 * spreadAmt * scaleFactor;
    const bandWidth = shortEdge * (0.14 + rng() * 0.26) * scaleFactor * (0.4 + dispersionAmt * 0.8);
    const bandLen = longEdge * (0.38 + rng() * 0.46) * scaleFactor;
    const bandTilt = (rng() - 0.5) * 0.22 * (layer.chaos / 100 + 0.25);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.rotate(bandTilt);

    const g = ctx.createLinearGradient(-bandWidth * 0.5, 0, bandWidth * 0.5, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    for (let s = 0; s < spectrumStops.length; s++) {
      const stopPos = 0.08 + (s / (spectrumStops.length - 1)) * 0.84;
      const col = mixRgb(hexToRgb(layer.colorPrimary), spectrumStops[s], 0.35 + dispersionAmt * 0.65);
      const alpha = (0.07 + rng() * 0.14) * Math.sin(((s + 0.5) / spectrumStops.length) * Math.PI);
      g.addColorStop(stopPos, rgba(col, alpha));
    }
    g.addColorStop(1, 'rgba(0,0,0,0)');

    // Fade top & bottom smoothly via elliptical mask stretch
    ctx.scale(1, bandLen / Math.max(1, bandWidth));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, bandWidth * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Specular caustic highlight edge
    if (rng() > 0.4) {
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, bandWidth * 0.35);
      cg.addColorStop(0, rgba(core, 0.26 * (1 - softness * 0.4)));
      cg.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, 0, bandWidth * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Curved glass caustic arc
  const arcR = shortEdge * 0.38 * scaleFactor;
  const arcG = ctx.createRadialGradient(0, 0, arcR * 0.72, 0, 0, arcR);
  arcG.addColorStop(0, 'rgba(0,0,0,0)');
  arcG.addColorStop(0.55, rgba(spectrumStops[0], 0.16 * dispersionAmt));
  arcG.addColorStop(0.7, rgba(spectrumStops[2], 0.18 * dispersionAmt));
  arcG.addColorStop(0.84, rgba(spectrumStops[4], 0.2 * dispersionAmt));
  arcG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = arcG;
  ctx.beginPath();
  ctx.arc(0, 0, arcR, -0.75, 0.75);
  ctx.arc(0, 0, arcR * 0.7, 0.75, -0.75, true);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function buildLightningPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  displace: number,
  chaosAmt: number,
  rng: () => number,
  depth: number
): Array<{ x: number; y: number }> {
  if (depth <= 0 || displace < 1.5) {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  }
  const mx = (x1 + x2) * 0.5;
  const my = (y1 + y2) * 0.5;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = (rng() - 0.5) * displace * (0.65 + chaosAmt * 0.75);
  const px = mx + nx * offset;
  const py = my + ny * offset;

  const left = buildLightningPoints(x1, y1, px, py, displace * 0.52, chaosAmt, rng, depth - 1);
  const right = buildLightningPoints(px, py, x2, y2, displace * 0.52, chaosAmt, rng, depth - 1);
  return [...left.slice(0, -1), ...right];
}

function strokeBoltPath(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  baseWidth: number,
  primary: RGB,
  secondary: RGB,
  core: RGB,
  softness: number,
  sharpAmt: number
) {
  if (pts.length < 2) return;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const passes: Array<{ width: number; color: string }> = [
    { width: baseWidth * (6.5 + softness * 6), color: rgba(secondary, 0.16) },
    { width: baseWidth * (3.2 + softness * 2.8), color: rgba(primary, 0.34) },
    { width: baseWidth * 1.55, color: rgba(mixRgb(primary, core, 0.45), 0.72) },
    { width: Math.max(1, baseWidth * (0.62 - sharpAmt * 0.25)), color: rgba(core, 0.96) },
  ];

  for (const pass of passes) {
    trace();
    ctx.lineWidth = pass.width;
    ctx.strokeStyle = pass.color;
    ctx.stroke();
  }
  ctx.restore();
}

function renderLightningArc(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x165667b1);
  const shortEdge = Math.min(w, h);
  const diag = Math.hypot(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });

  const ox = layer.x * w;
  const oy = layer.y * h;
  const baseAngle = (layer.angle * Math.PI) / 180;
  const scaleFactor = layer.scale / 100;
  const spreadAmt = clamp(layer.spread / 100, 0.1, 1);
  const chaosAmt = clamp(layer.chaos / 100, 0.1, 1);
  const sharpAmt = clamp(layer.sharpness / 100, 0.1, 1);
  const softness = clamp(layer.softness / 100, 0.1, 1);

  const mainBolts = Math.max(1, Math.min(8, Math.round(1 + layer.count * 0.14)));
  const branchFactor = clamp(layer.count / 24, 0.3, 2.2);
  const strokeBase = Math.max(1.5, shortEdge * 0.0042 * (1.25 - sharpAmt * 0.5) * scaleFactor);

  // Origin discharge glow
  fillExponentialGlow(ctx, ox, oy, shortEdge * 0.28 * scaleFactor, core, primary, secondary, 0.65, 0.85);

  for (let b = 0; b < mainBolts; b++) {
    const boltAngle = baseAngle + (b - (mainBolts - 1) / 2) * (0.28 * spreadAmt) + (rng() - 0.5) * 0.25 * spreadAmt;
    const len = diag * (0.62 + rng() * 0.36) * scaleFactor;
    const ex = ox + Math.cos(boltAngle) * len;
    const ey = oy + Math.sin(boltAngle) * len;

    const mainPts = buildLightningPoints(
      ox,
      oy,
      ex,
      ey,
      len * (0.14 + chaosAmt * 0.16),
      chaosAmt,
      rng,
      6
    );
    strokeBoltPath(ctx, mainPts, strokeBase, primary, secondary, core, softness, sharpAmt);

    // Secondary & tertiary branches
    const branchCount = Math.max(3, Math.round(8 * branchFactor * (0.4 + chaosAmt)));
    for (let br = 0; br < branchCount; br++) {
      const idx = Math.floor(2 + rng() * Math.max(1, mainPts.length - 6));
      const start = mainPts[idx];
      if (!start) continue;
      const side = rng() > 0.5 ? 1 : -1;
      const subAngle = boltAngle + side * (0.25 + rng() * 0.72 * spreadAmt);
      const subLen = len * (0.18 + rng() * 0.34);
      const bx2 = start.x + Math.cos(subAngle) * subLen;
      const by2 = start.y + Math.sin(subAngle) * subLen;
      const subPts = buildLightningPoints(
        start.x,
        start.y,
        bx2,
        by2,
        subLen * (0.16 + chaosAmt * 0.18),
        chaosAmt,
        rng,
        5
      );
      strokeBoltPath(ctx, subPts, strokeBase * 0.52, primary, secondary, core, softness, sharpAmt);

      // Tiny fork off the branch
      if (rng() > 0.42 && subPts.length > 4) {
        const bStart = subPts[Math.floor(subPts.length * (0.3 + rng() * 0.4))];
        const forkAngle = subAngle + (rng() > 0.5 ? 1 : -1) * (0.3 + rng() * 0.55);
        const forkLen = subLen * (0.28 + rng() * 0.32);
        const forkPts = buildLightningPoints(
          bStart.x,
          bStart.y,
          bStart.x + Math.cos(forkAngle) * forkLen,
          bStart.y + Math.sin(forkAngle) * forkLen,
          forkLen * 0.2,
          chaosAmt,
          rng,
          4
        );
        strokeBoltPath(ctx, forkPts, strokeBase * 0.3, primary, secondary, core, softness, sharpAmt);
      }
    }
  }
}

function renderBokehField(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x4cf5ad43);
  const shortEdge = Math.min(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 245, b: 220 });
  const orbCount = Math.max(8, Math.min(140, Math.round(layer.count * 1.15)));
  const scaleFactor = layer.scale / 100;
  const spreadAmt = clamp(layer.spread / 100, 0.15, 1);
  const sharpAmt = clamp(layer.sharpness / 100, 0, 1);
  const blades = layer.apertureBlades;
  const rotRad = (layer.angle * Math.PI) / 180;

  ctx.save();
  // Ambient soft background haze centered at origin
  fillExponentialGlow(
    ctx,
    layer.x * w,
    layer.y * h,
    shortEdge * 0.58 * scaleFactor,
    primary,
    secondary,
    secondary,
    0.85,
    0.26
  );

  for (let i = 0; i < orbCount; i++) {
    // Cluster around origin based on spread, spreading to full frame at 100%
    const ox =
      layer.x * w +
      (rng() - 0.5) * w * (0.35 + spreadAmt * 0.85) * (layer.stretchX / 100);
    const oy =
      layer.y * h +
      (rng() - 0.5) * h * (0.35 + spreadAmt * 0.85) * (layer.stretchY / 100);
    const sizeTier = rng();
    const radius =
      sizeTier < 0.55
        ? shortEdge * (0.004 + rng() * 0.012) * scaleFactor
        : sizeTier < 0.88
          ? shortEdge * (0.018 + rng() * 0.036) * scaleFactor
          : shortEdge * (0.042 + rng() * 0.068) * scaleFactor;
    const col = mixRgb(primary, secondary, rng());
    const alpha = sizeTier < 0.55 ? 0.25 + rng() * 0.45 : 0.09 + rng() * 0.22;

    if (sizeTier < 0.35) {
      // Micro sparkle dust
      fillExponentialGlow(ctx, ox, oy, radius * 1.9, core, col, col, 0.55, alpha);
      if (rng() > 0.72) {
        drawFourPointGlint(ctx, ox, oy, radius * 4.2, rotRad, col, alpha * 0.85);
      }
      continue;
    }

    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
    const rimBoost = 0.4 + sharpAmt * 0.85;
    g.addColorStop(0, rgba(col, alpha * 0.42));
    g.addColorStop(0.68, rgba(col, alpha * 0.55));
    g.addColorStop(0.88, rgba(mixRgb(col, core, 0.38), clamp(alpha * rimBoost * 1.25, 0, 0.9)));
    g.addColorStop(0.96, rgba(col, alpha * 0.32));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    tracePolygonPath(ctx, ox, oy, radius, blades, rotRad + rng() * 0.35);
    ctx.fill();
  }
  ctx.restore();
}

function renderSparkSwirl(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x6c8e9cf5);
  const shortEdge = Math.min(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 245, b: 215 });

  const ox = layer.x * w;
  const oy = layer.y * h;
  const scaleFactor = layer.scale / 100;
  const spreadAmt = clamp(layer.spread / 100, 0.2, 1);
  const chaosAmt = clamp(layer.chaos / 100, 0, 1);
  const sharpAmt = clamp(layer.sharpness / 100, 0.1, 1);
  const ribbonCount = Math.max(8, Math.min(64, Math.round(layer.count * 0.75)));

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate((layer.angle * Math.PI) / 180);
  ctx.scale(layer.stretchX / 100, layer.stretchY / 100);

  fillExponentialGlow(ctx, 0, 0, shortEdge * 0.42 * scaleFactor, core, primary, secondary, 0.75, 0.42);

  // Flowing curled golden energy ribbons
  for (let i = 0; i < ribbonCount; i++) {
    const startAngle = rng() * Math.PI * 2;
    const baseR = shortEdge * (0.04 + rng() * 0.42 * spreadAmt) * scaleFactor;
    const sweep = (0.7 + rng() * 1.65) * (rng() > 0.15 ? 1 : -1);
    const steps = 28;
    const pts: Array<{ x: number; y: number }> = [];
    const drift = (rng() - 0.5) * shortEdge * 0.18 * scaleFactor;

    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const a = startAngle + sweep * u + Math.sin(u * Math.PI * 2) * chaosAmt * 0.35;
      const r = baseR * (0.48 + u * (0.65 + chaosAmt * 0.35)) + Math.sin(u * 4 + i) * drift * 0.25;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }

    const col = mixRgb(primary, secondary, rng());
    const alpha = 0.08 + rng() * 0.26;
    const width = Math.max(1, shortEdge * (0.002 + rng() * 0.008) * (1.2 - sharpAmt * 0.5) * scaleFactor);

    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let s = 1; s < pts.length; s++) {
      ctx.lineTo(pts[s].x, pts[s].y);
    }
    ctx.lineWidth = width * 4.5;
    ctx.strokeStyle = rgba(secondary, alpha * 0.24);
    ctx.stroke();

    ctx.lineWidth = width * 1.8;
    ctx.strokeStyle = rgba(col, alpha * 0.65);
    ctx.stroke();

    ctx.lineWidth = Math.max(0.8, width * 0.55);
    ctx.strokeStyle = rgba(core, alpha * 0.95);
    ctx.stroke();
  }

  // Glowing embers + crisp 4-point star glints along the vortex
  const sparkCount = Math.max(24, Math.round(layer.count * 2.2));
  for (let k = 0; k < sparkCount; k++) {
    const theta = rng() * Math.PI * 2;
    const r = shortEdge * (0.04 + Math.pow(rng(), 0.72) * 0.52 * spreadAmt) * scaleFactor;
    const sx = Math.cos(theta) * r;
    const sy = Math.sin(theta) * r;
    const size = shortEdge * (0.0025 + rng() * 0.009) * scaleFactor;
    const col = mixRgb(primary, secondary, rng());
    const alpha = 0.32 + rng() * 0.62;

    if (rng() > 0.78) {
      drawFourPointGlint(ctx, sx, sy, size * 3.5, theta * 0.5, col, alpha);
    } else {
      fillExponentialGlow(ctx, sx, sy, size * 2.1, core, col, secondary, 0.5, alpha);
    }
  }

  ctx.restore();
}

function renderLaserBeams(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  const rng = mulberry32(layer.seed ^ 0x3c6ef372);
  const diag = Math.hypot(w, h);
  const shortEdge = Math.min(w, h);
  const primary = hexToRgb(layer.colorPrimary);
  const secondary = hexToRgb(layer.colorSecondary);
  const core = hexToRgb(layer.colorCore, { r: 255, g: 255, b: 255 });

  const ox = layer.x * w;
  const oy = layer.y * h;
  const baseAngle = (layer.angle * Math.PI) / 180;
  const spreadAngle = (clamp(layer.spread, 10, 100) / 100) * Math.PI * 0.95;
  const beamCount = Math.max(3, Math.min(48, Math.round(layer.count)));
  const scaleFactor = layer.scale / 100;
  const sharpAmt = clamp(layer.sharpness / 100, 0.1, 1);
  const chaosAmt = clamp(layer.chaos / 100, 0, 1);
  const softness = clamp(layer.softness / 100, 0.05, 1);

  ctx.save();
  // Emitter origin hotspot
  fillExponentialGlow(ctx, ox, oy, shortEdge * 0.24 * scaleFactor, core, primary, secondary, 0.65, 0.9);

  for (let i = 0; i < beamCount; i++) {
    const u = beamCount === 1 ? 0.5 : i / (beamCount - 1);
    const theta = baseAngle + (u - 0.5) * spreadAngle + (rng() - 0.5) * 0.08 * chaosAmt;
    const beamLen = diag * (0.75 + rng() * 0.35) * scaleFactor;
    const beamW = Math.max(1.5, shortEdge * (0.008 - sharpAmt * 0.0055) * scaleFactor);
    const col = i % 2 === 0 ? primary : secondary;

    const ex = ox + Math.cos(theta) * beamLen;
    const ey = oy + Math.sin(theta) * beamLen;

    // Outer beam bloom
    const gOuter = ctx.createLinearGradient(ox, oy, ex, ey);
    gOuter.addColorStop(0, rgba(col, 0.45));
    gOuter.addColorStop(0.5, rgba(col, 0.22));
    gOuter.addColorStop(1, rgba(col, 0));
    ctx.strokeStyle = gOuter;
    ctx.lineCap = 'round';
    ctx.lineWidth = beamW * (4 + softness * 6);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Inner bright laser core
    const gCore = ctx.createLinearGradient(ox, oy, ex, ey);
    gCore.addColorStop(0, rgba(core, 0.96));
    gCore.addColorStop(0.35, rgba(mixRgb(core, col, 0.35), 0.72));
    gCore.addColorStop(1, rgba(col, 0));
    ctx.strokeStyle = gCore;
    ctx.lineWidth = beamW;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // Optional hotspot flare along beam
    if (rng() > 0.65) {
      const dist = beamLen * (0.25 + rng() * 0.45);
      const hx = ox + Math.cos(theta) * dist;
      const hy = oy + Math.sin(theta) * dist;
      fillExponentialGlow(ctx, hx, hy, beamW * 8, core, col, col, 0.6, 0.45);
    }
  }

  ctx.restore();
}

function renderSingleLayer(
  ctx: CanvasRenderingContext2D,
  layer: OverlayLayerConfig,
  w: number,
  h: number
) {
  if (!layer.enabled || layer.opacity <= 0) return;

  ctx.save();
  ctx.globalCompositeOperation =
    layer.blendMode === 'normal' ? 'source-over' : layer.blendMode;
  ctx.globalAlpha = clamp(layer.opacity / 100, 0, 1);

  switch (layer.type) {
    case 'radial-glow':
      renderRadialGlow(ctx, layer, w, h);
      break;
    case 'sunburst-rays':
      renderSunburstRays(ctx, layer, w, h);
      break;
    case 'anamorphic-flare':
      renderAnamorphicFlare(ctx, layer, w, h);
      break;
    case 'god-rays':
      renderGodRays(ctx, layer, w, h);
      break;
    case 'light-leak':
      renderLightLeak(ctx, layer, w, h);
      break;
    case 'prism-spectrum':
      renderPrismSpectrum(ctx, layer, w, h);
      break;
    case 'lightning-arc':
      renderLightningArc(ctx, layer, w, h);
      break;
    case 'bokeh-field':
      renderBokehField(ctx, layer, w, h);
      break;
    case 'spark-swirl':
      renderSparkSwirl(ctx, layer, w, h);
      break;
    case 'laser-beams':
      renderLaserBeams(ctx, layer, w, h);
      break;
  }

  ctx.restore();
}

// ============================================================================
// Strip-Safe Master Post-Processor (8K Memory Safe + Anti-Banding + Alpha)
// ============================================================================

function applyMasterPostProcess(
  canvas: HTMLCanvasElement,
  doc: LightingOverlayDoc,
  isPreviewFast: boolean
) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const exposure = clamp(doc.masterExposure / 100, 0.25, 2.5);
  const contrast = clamp(doc.masterContrast / 100, 0.4, 2.0);
  const saturation = clamp(doc.masterSaturation / 100, 0, 2.5);
  const temp = clamp(doc.temperature / 100, -1, 1); // + warm, - cool
  const edgeFadeAmt = clamp(doc.edgeFade / 100, 0, 1);
  const grainAmp = clamp(doc.grain, 0, 60);
  const baseDitherAmp = Math.max(isPreviewFast ? 0.65 : 1.15, grainAmp * 0.42);
  const isTransparent = doc.backgroundMode === 'transparent';
  const caAmt = clamp(doc.chromaticAberration / 100, 0, 1);

  // Subtle horizontal/radial Chromatic Aberration by shifting R/B inside each strip
  const stripHeight = Math.min(h, Math.max(64, Math.floor(2_200_000 / Math.max(1, w))));
  const rng = mulberry32(hashString(doc.globalSeed || 'LUX') ^ 0xa5a5a5a5);

  const warmR = 1 + temp * 0.16;
  const warmG = 1 + temp * 0.02;
  const warmB = 1 - temp * 0.18;

  const maxCaShift = Math.round(caAmt * Math.max(2, w * 0.0045));

  for (let sy = 0; sy < h; sy += stripHeight) {
    const sh = Math.min(stripHeight, h - sy);
    const imgData = ctx.getImageData(0, sy, w, sh);
    const data = imgData.data;

    // Keep row scratch buffer if chromatic aberration is enabled
    let rowScratch: Uint8ClampedArray | null = null;
    if (maxCaShift > 0) {
      rowScratch = new Uint8ClampedArray(w * 4);
    }

    for (let y = 0; y < sh; y++) {
      const globalY = sy + y;
      const ny = (globalY / Math.max(1, h - 1)) * 2 - 1;
      const rowOffset = y * w * 4;

      if (rowScratch && maxCaShift > 0) {
        rowScratch.set(data.subarray(rowOffset, rowOffset + w * 4));
      }

      // Vertical border fade factor
      let edgeY = 1;
      if (edgeFadeAmt > 0.01) {
        const dy = Math.min(globalY, h - 1 - globalY) / Math.max(1, h * 0.22 * edgeFadeAmt);
        edgeY = dy >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * clamp(dy, 0, 1));
      }

      for (let x = 0; x < w; x++) {
        const idx = rowOffset + x * 4;
        const nx = (x / Math.max(1, w - 1)) * 2 - 1;

        let r: number;
        let g: number;
        let b: number;

        if (rowScratch && maxCaShift > 0) {
          const radialPull = Math.round(nx * maxCaShift * (0.35 + Math.abs(ny) * 0.65));
          const rx = clamp(x - radialPull, 0, w - 1);
          const bx = clamp(x + radialPull, 0, w - 1);
          r = rowScratch[rx * 4];
          g = rowScratch[x * 4 + 1];
          b = rowScratch[bx * 4 + 2];
        } else {
          r = data[idx];
          g = data[idx + 1];
          b = data[idx + 2];
        }

        // Edge Fade mask (keeps screen overlays 100% seamless at frame edges)
        if (edgeFadeAmt > 0.01) {
          const dx = Math.min(x, w - 1 - x) / Math.max(1, w * 0.22 * edgeFadeAmt);
          const edgeX = dx >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * clamp(dx, 0, 1));
          const mask = edgeX * edgeY;
          r *= mask;
          g *= mask;
          b *= mask;
        }

        // Master Exposure & Temperature
        r *= exposure * warmR;
        g *= exposure * warmG;
        b *= exposure * warmB;

        // Soft Highlight Rolloff (HDR-like shoulder above 220 so whites stay silky)
        if (r > 215) r = 215 + (40 * (r - 215)) / (r - 215 + 45);
        if (g > 215) g = 215 + (40 * (g - 215)) / (g - 215 + 45);
        if (b > 215) b = 215 + (40 * (b - 215)) / (b - 215 + 45);

        // Master Contrast
        if (Math.abs(contrast - 1) > 0.005) {
          r = ((r / 255 - 0.5) * contrast + 0.5) * 255;
          g = ((g / 255 - 0.5) * contrast + 0.5) * 255;
          b = ((b / 255 - 0.5) * contrast + 0.5) * 255;
        }

        // Master Saturation
        if (Math.abs(saturation - 1) > 0.005) {
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          r = lum + (r - lum) * saturation;
          g = lum + (g - lum) * saturation;
          b = lum + (b - lum) * saturation;
        }

        // Triangular Anti-Banding Micro-Dither + Film Grain
        const dither = (rng() - rng()) * baseDitherAmp;
        r = clamp(r + dither, 0, 255);
        g = clamp(g + dither, 0, 255);
        b = clamp(b + dither, 0, 255);

        if (isTransparent) {
          // Extract clean un-premultiplied alpha from additive luminance
          const maxC = Math.max(r, g, b);
          if (maxC <= 1.2) {
            data[idx] = 0;
            data[idx + 1] = 0;
            data[idx + 2] = 0;
            data[idx + 3] = 0;
          } else {
            const alpha01 = clamp(Math.pow(maxC / 255, 0.82), 0, 1);
            const invAlpha = 1 / Math.max(0.015, alpha01);
            data[idx] = Math.round(clamp(r * invAlpha, 0, 255));
            data[idx + 1] = Math.round(clamp(g * invAlpha, 0, 255));
            data[idx + 2] = Math.round(clamp(b * invAlpha, 0, 255));
            data[idx + 3] = Math.round(alpha01 * 255);
          }
        } else {
          data[idx] = Math.round(r);
          data[idx + 1] = Math.round(g);
          data[idx + 2] = Math.round(b);
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, sy);
  }
}

// ============================================================================
// Main Render & Export API
// ============================================================================

export function renderOverlayToCanvas(
  doc: LightingOverlayDoc,
  options?: {
    previewMaxEdge?: number;
    fastMode?: boolean;
  }
): HTMLCanvasElement {
  const target = resolveOverlayDimensions(doc);
  let w = target.width;
  let h = target.height;

  if (options?.previewMaxEdge && Math.max(w, h) > options.previewMaxEdge) {
    const scale = options.previewMaxEdge / Math.max(w, h);
    w = Math.max(64, Math.round(w * scale));
    h = Math.max(64, Math.round(h * scale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  // Render onto pure optical black first for authentic additive light physics
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  for (const layer of doc.layers) {
    renderSingleLayer(ctx, layer, w, h);
  }

  applyMasterPostProcess(canvas, doc, Boolean(options?.fastMode));
  return canvas;
}

export async function exportOverlayBlob(
  doc: LightingOverlayDoc,
  format: OverlayExportFormat,
  qualityPct: number
): Promise<{ blob: Blob; width: number; height: number }> {
  // Yield one frame so UI loading indicators paint smoothly before heavy 4K/6K/8K render
  await new Promise((r) => setTimeout(r, 16));
  const canvas = renderOverlayToCanvas(doc);
  let outCanvas = canvas;

  // JPEG does not support alpha transparency; composite over pure black if transparent mode is active
  if (format === 'jpeg' && doc.backgroundMode === 'transparent') {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const fctx = flat.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#000000';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(canvas, 0, 0);
      outCanvas = flat;
    }
  }

  const blob = await canvasToBlobAsync(outCanvas, format, qualityPct);
  return {
    blob,
    width: outCanvas.width,
    height: outCanvas.height,
  };
}

// ============================================================================
// Procedural Random & Preset Composition Generator
// ============================================================================

function randomPalette(rng: () => number) {
  if (rng() < 0.72) {
    return OPTICAL_PALETTES[Math.floor(rng() * OPTICAL_PALETTES.length)];
  }
  const h1 = Math.floor(rng() * 360);
  const h2 = (h1 + 25 + Math.floor(rng() * 90)) % 360;
  return {
    name: 'Harmonic Custom',
    primary: hslToHex(h1, 0.88, 0.58),
    secondary: hslToHex(h2, 0.92, 0.46),
    core: hslToHex(h1, 0.22, 0.96),
  };
}

function makeRandomizedLayer(
  type: OverlayLayerType,
  rng: () => number,
  palette: { primary: string; secondary: string; core: string }
): OverlayLayerConfig {
  const base = createDefaultLayer(type, Math.floor(1000 + rng() * 999999));
  const edgeOrCenter = rng();

  let x = 0.5;
  let y = 0.5;
  let angle = Math.round(rng() * 360);

  if (type === 'light-leak') {
    const corner = Math.floor(rng() * 4);
    x = corner % 2 === 0 ? 0.04 + rng() * 0.2 : 0.76 + rng() * 0.2;
    y = corner < 2 ? 0.05 + rng() * 0.25 : 0.7 + rng() * 0.25;
    angle = Math.round(-45 + rng() * 90);
  } else if (type === 'god-rays') {
    const mode = rng();
    if (mode < 0.45) {
      x = 0.3 + rng() * 0.4;
      y = -0.08 + rng() * 0.14;
      angle = Math.round(72 + rng() * 36);
    } else if (mode < 0.8) {
      x = rng() > 0.5 ? -0.05 : 1.05;
      y = rng() * 0.45;
      angle = x < 0.5 ? Math.round(20 + rng() * 40) : Math.round(120 + rng() * 40);
    } else {
      x = 0.2 + rng() * 0.6;
      y = 0.15 + rng() * 0.35;
      angle = Math.round(45 + rng() * 90);
    }
  } else if (type === 'lightning-arc') {
    const originType = rng();
    if (originType < 0.5) {
      x = 0.18 + rng() * 0.64;
      y = 0.02 + rng() * 0.08;
      angle = Math.round(75 + rng() * 30);
    } else if (originType < 0.8) {
      x = rng() > 0.5 ? 0.03 : 0.97;
      y = 0.15 + rng() * 0.7;
      angle = x < 0.5 ? Math.round(-25 + rng() * 50) : Math.round(155 + rng() * 50);
    } else {
      x = 0.3 + rng() * 0.4;
      y = 0.3 + rng() * 0.4;
      angle = Math.round(rng() * 360);
    }
  } else if (type === 'laser-beams') {
    x = 0.2 + rng() * 0.6;
    y = rng() > 0.5 ? 0.04 + rng() * 0.18 : 0.82 + rng() * 0.14;
    angle = y < 0.5 ? Math.round(72 + rng() * 36) : Math.round(252 + rng() * 36);
  } else if (edgeOrCenter < 0.45) {
    x = 0.5 + (rng() - 0.5) * 0.16;
    y = 0.5 + (rng() - 0.5) * 0.16;
  } else {
    x = 0.16 + rng() * 0.68;
    y = 0.18 + rng() * 0.64;
  }

  return {
    ...base,
    id: makeOverlayLayerId(),
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    angle,
    scale: Math.round(80 + rng() * 85),
    stretchX:
      type === 'anamorphic-flare'
        ? Math.round(155 + rng() * 140)
        : Math.round(85 + rng() * 65),
    stretchY:
      type === 'anamorphic-flare'
        ? Math.round(65 + rng() * 50)
        : Math.round(85 + rng() * 65),
    spread: Math.round(35 + rng() * 60),
    count:
      type === 'bokeh-field'
        ? Math.round(28 + rng() * 56)
        : type === 'sunburst-rays'
          ? Math.round(24 + rng() * 54)
          : type === 'lightning-arc'
            ? Math.round(14 + rng() * 24)
            : Math.round(10 + rng() * 26),
    sharpness: Math.round(35 + rng() * 60),
    chaos: Math.round(25 + rng() * 65),
    dispersion:
      type === 'prism-spectrum'
        ? Math.round(70 + rng() * 30)
        : Math.round(rng() * 75),
    softness: Math.round(35 + rng() * 55),
    apertureBlades: ([0, 5, 6, 8] as const)[Math.floor(rng() * 4)],
    opacity: Math.round(78 + rng() * 22),
    colorPrimary: palette.primary,
    colorSecondary: palette.secondary,
    colorCore: palette.core,
  };
}

export function generateRandomOverlayDoc(
  category: OverlayCategory = 'all-random',
  existing?: Partial<
    Pick<
      LightingOverlayDoc,
      | 'aspectRatio'
      | 'customRatioW'
      | 'customRatioH'
      | 'resolutionPreset'
      | 'customWidth'
      | 'customHeight'
      | 'backgroundMode'
      | 'previewBackdrop'
    >
  >
): LightingOverlayDoc {
  const seed = generateOverlaySeedCode();
  const rng = mulberry32(hashString(seed) ^ Math.floor(Math.random() * 99999));

  const allTypes: OverlayLayerType[] = [
    'anamorphic-flare',
    'god-rays',
    'sunburst-rays',
    'light-leak',
    'prism-spectrum',
    'lightning-arc',
    'bokeh-field',
    'spark-swirl',
    'laser-beams',
    'radial-glow',
  ];

  const primaryType: OverlayLayerType =
    category === 'all-random'
      ? allTypes[Math.floor(rng() * allTypes.length)]
      : (category as OverlayLayerType);

  // Pick domain-appropriate palette boost when specific types are selected
  let palette = randomPalette(rng);
  if (primaryType === 'lightning-arc' && rng() < 0.78) {
    const lightningPalettes = [
      { name: 'Electric Blue', primary: '#49c6ff', secondary: '#2653ff', core: '#ffffff' },
      { name: 'Crimson Arc', primary: '#ff2442', secondary: '#b80036', core: '#fff0f3' },
      { name: 'Neon Plasma', primary: '#2aff6d', secondary: '#00b876', core: '#effff4' },
      { name: 'Pure Silver Arc', primary: '#d8e6ff', secondary: '#7a9dff', core: '#ffffff' },
      { name: 'Violet Storm', primary: '#d15cff', secondary: '#5e17eb', core: '#ffffff' },
    ];
    palette = lightningPalettes[Math.floor(rng() * lightningPalettes.length)];
  } else if (primaryType === 'spark-swirl' && rng() < 0.72) {
    palette = { name: 'Golden Swirl', primary: '#ffaa2b', secondary: '#ff4800', core: '#fff8e1' };
  } else if (primaryType === 'light-leak' && rng() < 0.72) {
    palette = { name: 'Film Burn', primary: '#ff6a1e', secondary: '#e81e63', core: '#ffe29a' };
  }

  const layers: OverlayLayerConfig[] = [];
  const mainLayer = makeRandomizedLayer(primaryType, rng, palette);
  layers.push(mainLayer);

  // Add complementary secondary / accent optical layers for authentic commercial depth
  if (primaryType === 'anamorphic-flare') {
    const dust = makeRandomizedLayer('bokeh-field', rng, palette);
    dust.name = 'Lens Dust & Bokeh';
    dust.opacity = Math.round(45 + rng() * 35);
    dust.count = Math.round(28 + rng() * 35);
    layers.push(dust);
  } else if (primaryType === 'sunburst-rays') {
    const glow = makeRandomizedLayer('radial-glow', rng, palette);
    glow.x = mainLayer.x;
    glow.y = mainLayer.y;
    glow.opacity = Math.round(55 + rng() * 30);
    glow.scale = Math.round(mainLayer.scale * 0.85);
    layers.unshift(glow);

    if (rng() > 0.35) {
      const dust = makeRandomizedLayer('bokeh-field', rng, palette);
      dust.opacity = Math.round(35 + rng() * 30);
      dust.count = 32;
      layers.push(dust);
    }
  } else if (primaryType === 'god-rays') {
    const rimGlow = makeRandomizedLayer('radial-glow', rng, palette);
    rimGlow.x = mainLayer.x;
    rimGlow.y = mainLayer.y;
    rimGlow.opacity = 70;
    rimGlow.scale = 140;
    layers.unshift(rimGlow);
  } else if (primaryType === 'light-leak') {
    const secondaryCorner = makeRandomizedLayer('light-leak', rng, {
      primary: palette.secondary,
      secondary: palette.primary,
      core: palette.core,
    });
    secondaryCorner.x = Number((1 - mainLayer.x).toFixed(2));
    secondaryCorner.y = Number((1 - mainLayer.y).toFixed(2));
    secondaryCorner.opacity = Math.round(48 + rng() * 35);
    layers.push(secondaryCorner);
  } else if (primaryType === 'lightning-arc') {
    if (rng() > 0.45) {
      const bolt2 = makeRandomizedLayer('lightning-arc', rng, palette);
      bolt2.opacity = Math.round(50 + rng() * 30);
      bolt2.scale = Math.round(mainLayer.scale * 0.82);
      layers.push(bolt2);
    }
  } else if (primaryType === 'prism-spectrum') {
    const flare = makeRandomizedLayer('anamorphic-flare', rng, palette);
    flare.x = mainLayer.x;
    flare.y = mainLayer.y;
    flare.opacity = Math.round(42 + rng() * 30);
    flare.dispersion = 85;
    layers.push(flare);
  } else if (primaryType === 'bokeh-field') {
    const warmLeak = makeRandomizedLayer('light-leak', rng, palette);
    warmLeak.opacity = Math.round(32 + rng() * 32);
    layers.unshift(warmLeak);
  } else if (primaryType === 'laser-beams') {
    if (rng() > 0.3) {
      const twin = makeRandomizedLayer('laser-beams', rng, palette);
      twin.x = Number(clamp(1 - mainLayer.x, 0.1, 0.9).toFixed(2));
      twin.y = mainLayer.y;
      twin.angle = mainLayer.y < 0.5 ? 180 - mainLayer.angle : 540 - mainLayer.angle;
      twin.opacity = 78;
      layers.push(twin);
    }
  }

  // Surprise Mix occasionally layers two contrasting optical phenomena
  if (category === 'all-random' && rng() > 0.52 && layers.length < 3) {
    const bonusChoices: OverlayLayerType[] = ['bokeh-field', 'prism-spectrum', 'radial-glow', 'light-leak'];
    const bonusType = bonusChoices[Math.floor(rng() * bonusChoices.length)];
    const bonus = makeRandomizedLayer(bonusType, rng, palette);
    bonus.opacity = Math.round(38 + rng() * 32);
    layers.push(bonus);
  }

  const labelMap: Record<OverlayLayerType, string> = {
    'anamorphic-flare': 'Anamorphic Flare',
    'god-rays': 'Volumetric God Rays',
    'sunburst-rays': 'Solar Sunburst',
    'light-leak': '35mm Light Leak',
    'prism-spectrum': 'Prism Dispersion',
    'lightning-arc': 'Plasma Lightning',
    'bokeh-field': 'Cinema Bokeh & Dust',
    'spark-swirl': 'Golden Spark Swirl',
    'laser-beams': 'Stage Laser Array',
    'radial-glow': 'Soft Ambient Glow',
  };

  return {
    title: `${labelMap[primaryType]} — ${palette.name}`,
    category,
    backgroundMode: existing?.backgroundMode || 'black',
    previewBackdrop: existing?.previewBackdrop || 'auto',
    aspectRatio: existing?.aspectRatio || ('16:9' as OverlayAspectRatio),
    customRatioW: existing?.customRatioW || 16,
    customRatioH: existing?.customRatioH || 9,
    resolutionPreset: existing?.resolutionPreset || ('4K' as OverlayResolutionPreset),
    customWidth: existing?.customWidth || 3840,
    customHeight: existing?.customHeight || 2160,
    masterExposure: 105,
    masterContrast: 104,
    masterSaturation: 108,
    temperature: 0,
    chromaticAberration: primaryType === 'prism-spectrum' || primaryType === 'anamorphic-flare' ? 24 : 8,
    edgeFade: existing?.backgroundMode === 'transparent' ? 0 : 28,
    grain: 8,
    globalSeed: seed,
    layers,
  };
}
