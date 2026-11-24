export interface DynamicShaderUniforms {
  seedFloat: number;
  baseRgb: [number, number, number];
  primaryRgb: [number, number, number];
  secondaryRgb: [number, number, number];
  accentRgb: [number, number, number];
  highlightRgb: [number, number, number];
  density: number;       // 0.1..1.0
  geometryScale: number; // 0.4..2.2
  rotationRad: number;   // 0..2*PI
  offset: [number, number]; // -0.5..+0.5
  warp: number;          // 0..1.5
  grain: number;         // 0..1.0
  lineWeight: number;    // 0.4..2.2
  glow: number;          // 0..1
  depth: number;         // 0..1
  isLightTheme: boolean;
  transparentBackground: boolean;
}

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const GLSL_STDLIB_HEADER = `#version 300 es
precision highp float;
precision highp int;

out vec4 outColor;

uniform vec2 u_res;
uniform vec2 u_tileOffset;
uniform vec2 u_tileSize;
uniform float u_seed;
uniform float u_density;
uniform float u_scale;
uniform float u_rotation;
uniform vec2 u_offset;
uniform float u_warp;
uniform float u_grain;
uniform float u_lineWeight;
uniform float u_glow;
uniform float u_depth;
uniform float u_transparent;
uniform float u_isLight;
uniform vec3 u_base;
uniform vec3 u_primary;
uniform vec3 u_secondary;
uniform vec3 u_accent;
uniform vec3 u_highlight;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i + vec2(0.0, 0.0)), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = m * p * 2.03 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

float ridgedFbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    v += a * n * n;
    p = m * p * 2.07 + vec2(13.7, 29.3);
    a *= 0.5;
  }
  return v;
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), u.x),
      mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), u.x),
      mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec3(17.1, 31.7, 11.3);
    a *= 0.5;
  }
  return v;
}

float ridgedFbm(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    v += a * n * n;
    p = p * 2.07 + vec3(13.7, 29.3, 7.9);
    a *= 0.5;
  }
  return v;
}

vec2 domainWarp(vec2 p, float amt) {
  vec2 q = vec2(fbm(p + vec2(1.7, 9.2)), fbm(p + vec2(8.3, 2.8)));
  vec2 r = vec2(fbm(p + amt * q + vec2(3.1, 4.4)), fbm(p + amt * q + vec2(6.5, 1.9)));
  return p + amt * r;
}

vec2 curl2(vec2 p) {
  float eps = 0.01;
  float n1 = fbm(p + vec2(0.0, eps));
  float n2 = fbm(p - vec2(0.0, eps));
  float n3 = fbm(p + vec2(eps, 0.0));
  float n4 = fbm(p - vec2(eps, 0.0));
  return vec2((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}

// Returns vec3(minDist, edgeDist, cellId)
vec3 voronoi(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      o = 0.5 + 0.44 * sin(u_seed * 0.13 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
        id = hash21(n + g);
      }
    }
  }
  float edge = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      o = 0.5 + 0.44 * sin(u_seed * 0.13 + 6.2831 * o);
      vec2 r = g + o - f;
      if (dot(mr - r, mr - r) > 0.00001) {
        edge = min(edge, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }
  return vec3(sqrt(md), edge, id);
}

// Returns vec4(localHex.xy, edgeDist, cellId)
vec4 hexGrid(vec2 p) {
  const vec2 r = vec2(1.0, 1.7320508);
  const vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float ed = 0.5 - max(abs(gv.x), dot(abs(gv), normalize(r)));
  vec2 id = p - gv;
  return vec4(gv, ed, hash21(floor(id * 2.0 + 0.5)));
}

float causticsField(vec2 p, float phase) {
  vec2 i = p;
  float c = 0.0;
  float inten = 0.055;
  for (int n = 0; n < 4; n++) {
    float t = phase * (1.0 - (2.4 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / max(length(vec2(p.x / (sin(i.x + t) / inten + 0.001), p.y / (cos(i.y + t) / inten + 0.001))), 0.25);
  }
  c /= 4.0;
  return pow(clamp(1.2 - c * 0.55, 0.0, 1.0), 4.0);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sdCylinder(vec3 p, vec2 h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - h;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  return (p.x + p.y + p.z - s) * 0.57735027;
}

float sdHexPrism(vec3 p, vec2 h) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x), p.z - h.y);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float lineSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

// Anti-aliased SDF shape & stroke helpers (resolution-independent 4K/8K crispness)
float aaFill(float d) {
  float fw = clamp(fwidth(d), 0.0008, 0.015);
  return 1.0 - smoothstep(-fw, fw, d);
}

float aaStroke(float d, float halfWidth) {
  float fw = clamp(fwidth(d), 0.0008, 0.015);
  return 1.0 - smoothstep(halfWidth - fw, halfWidth + fw, abs(d));
}

float glowCurve(float d, float width, float intensity) {
  return exp(-abs(d) / max(width, 0.0004)) * intensity;
}

float bokehDisc(vec2 p, vec2 center, float radius, float feather) {
  float d = length(p - center);
  float body = 1.0 - smoothstep(radius - feather, radius + feather, d);
  float ring = smoothstep(radius * 0.55, radius * 0.94, d) * 0.35;
  return body * (0.72 + ring);
}

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

// Studio Optics, Fresnel, Thin-Film Iridescence & Tone Compression
float fresnelSchlick(float cosTheta, float F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
float fresnelSchlick(float cosTheta) {
  return fresnelSchlick(cosTheta, 0.04);
}

vec3 iridescence(float cosTheta, float phase) {
  return 0.55 + 0.45 * cos(TAU * (phase + clamp(cosTheta, 0.0, 1.0) * 1.1 + vec3(0.0, 0.33, 0.67)));
}
vec3 iridescence(float cosTheta) {
  return iridescence(cosTheta, u_seed * 0.05);
}

vec3 cameraRay(vec2 p, float fov) {
  return normalize(vec3(p, -max(fov, 0.4)));
}

// 3-point softbox HDRI reflection environment for photorealistic chrome, gold & glass
vec3 studioEnv(vec3 rd, vec3 lowCol, vec3 highCol, vec3 keyCol, vec3 rimCol, float gloss) {
  vec3 dir = normalize(rd);
  float sky = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(lowCol, highCol, smoothstep(0.15, 0.85, sky));
  float sharpness = mix(0.32, 0.88, clamp(gloss, 0.0, 1.0));
  vec3 keyDir = normalize(vec3(cos(u_rotation) * 0.85, 0.72, sin(u_rotation) * 0.75 + 0.45));
  vec3 rimDir = normalize(vec3(-cos(u_rotation) * 0.8, -0.35, 0.62));
  vec3 fillDir = normalize(vec3(0.15, 0.95, -0.3));
  float softKey = smoothstep(sharpness - 0.16, sharpness + 0.08, dot(dir, keyDir));
  float softRim = smoothstep(sharpness - 0.1, sharpness + 0.06, dot(dir, rimDir));
  float strip = smoothstep(0.84, 0.96, abs(dot(dir, fillDir)));
  c = mix(c, keyCol, softKey * (0.72 + 0.28 * u_glow));
  c += rimCol * softRim * (0.42 + 0.58 * u_glow);
  c += keyCol * strip * 0.35;
  return c;
}
vec3 studioEnv(vec3 rd, float gloss) {
  return studioEnv(rd, u_base * 0.6, u_primary * 1.15, u_highlight, u_accent, gloss);
}
vec3 studioEnv(vec3 rd) {
  return studioEnv(rd, 0.82);
}

vec3 studioBackdrop(vec2 p, vec2 focal, vec3 baseCol, vec3 primCol, vec3 accCol, float glow) {
  float d = length(p - focal);
  float halo = exp(-d * (1.85 - 0.65 * clamp(u_depth, 0.0, 1.0)));
  vec3 bg = mix(baseCol, mix(baseCol, primCol, 0.55), clamp(0.45 - p.y * 0.45, 0.0, 1.0));
  bg = mix(bg, primCol * 0.9, halo * 0.45);
  bg += accCol * halo * halo * (0.12 + 0.28 * glow);
  return bg;
}
vec3 studioBackdrop(vec2 p, vec2 focal) {
  return studioBackdrop(p, focal, u_base, u_primary, u_accent, u_glow);
}
vec3 studioBackdrop(vec2 p) {
  return studioBackdrop(p, vec2(0.0), u_base, u_primary, u_accent, u_glow);
}

// Filmic tone curves: aces() for linear HDR scenes, studioTone() preserves dark sRGB bases while rolling off bright highlights
vec3 aces(vec3 x) {
  vec3 lin = pow(max(x, vec3(0.0)), vec3(1.8));
  vec3 mapped = (lin * (2.51 * lin + 0.03)) / (lin * (2.43 * lin + 0.59) + 0.14);
  return pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.1));
}

vec3 studioTone(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 shoulder = c / (1.0 + 0.32 * max(c - 0.68, vec3(0.0)));
  return clamp(mix(shoulder, smoothstep(0.0, 1.0, shoulder), 0.14), 0.0, 1.0);
}

// Unified Octane/Cycles-grade 3D PBR + softbox HDRI shader helpers (3 to 8 argument overloads)
vec3 shadeStudio3D(
  vec3 rd,
  vec3 n,
  float ao,
  vec3 surfCol,
  float metalness,
  float roughness,
  vec3 rimTint,
  float iridStrength
) {
  vec3 N = normalize(n);
  vec3 V = normalize(-rd);
  float ndv = max(dot(N, V), 0.0);
  vec3 reflDir = reflect(-V, N);
  vec3 lightDir = normalize(vec3(cos(u_rotation) * 0.82, 0.72, sin(u_rotation) * 0.72 + 0.45));
  float diff = max(dot(N, lightDir), 0.0);
  vec3 halfDir = normalize(lightDir + V);
  float roughClamped = clamp(roughness, 0.02, 1.0);
  float metalClamped = clamp(metalness, 0.0, 1.0);
  float aoClamped = clamp(ao, 0.05, 1.0);
  float shininess = mix(14.0, 92.0, 1.0 - roughClamped);
  float spec = pow(max(dot(N, halfDir), 0.0), shininess);
  float fresnel = fresnelSchlick(ndv, mix(0.04, 0.85, metalClamped));
  vec3 envCol = studioEnv(reflDir, u_base * 0.55, u_primary * 1.15, u_highlight, rimTint, 1.0 - roughClamped);
  vec3 diffuseCol = surfCol * (0.24 + 0.76 * diff) * aoClamped * (1.0 - 0.65 * metalClamped);
  vec3 metalRefl = envCol * mix(vec3(1.0), surfCol * 1.25, metalClamped) * (0.4 + 0.6 * aoClamped);
  vec3 col = mix(diffuseCol, metalRefl, mix(fresnel * 0.78, 0.86, metalClamped));
  col += u_highlight * spec * mix(0.35, 1.15, 1.0 - roughClamped) * (0.4 + 0.75 * u_glow);
  col += rimTint * pow(1.0 - ndv, 3.0) * (0.22 + 0.58 * u_glow);
  if (iridStrength > 0.001) {
    vec3 irid = iridescence(ndv, u_seed * 0.07 + dot(N, reflDir) * 0.35);
    col = mix(col, col * (0.65 + 0.7 * irid) + irid * fresnel * 0.28, clamp(iridStrength, 0.0, 1.0));
  }
  return studioTone(col);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol, float metalness, float roughness, vec3 rimTint) {
  return shadeStudio3D(rd, n, ao, surfCol, metalness, roughness, rimTint, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol, float metalness, float roughness, float iridStrength) {
  return shadeStudio3D(rd, n, ao, surfCol, metalness, roughness, u_accent, iridStrength);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol, float metalness, float roughness) {
  return shadeStudio3D(rd, n, ao, surfCol, metalness, roughness, u_accent, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol, float metalness, float roughness, vec3 rimTint) {
  return shadeStudio3D(rd, n, 1.0, surfCol, metalness, roughness, rimTint, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol, float metalness, float roughness, float iridStrength) {
  return shadeStudio3D(rd, n, 1.0, surfCol, metalness, roughness, u_accent, iridStrength);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol, float metalness, vec3 rimTint) {
  return shadeStudio3D(rd, n, ao, surfCol, metalness, 0.16, rimTint, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol, float metalness) {
  return shadeStudio3D(rd, n, ao, surfCol, metalness, 0.16, u_accent, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol, float metalness, float roughness) {
  return shadeStudio3D(rd, n, 1.0, surfCol, metalness, roughness, u_accent, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol, vec3 rimTint) {
  return shadeStudio3D(rd, n, ao, surfCol, 0.78, 0.16, rimTint, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol, float metalness, vec3 rimTint) {
  return shadeStudio3D(rd, n, 1.0, surfCol, metalness, 0.16, rimTint, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, float ao, vec3 surfCol) {
  return shadeStudio3D(rd, n, ao, surfCol, 0.78, 0.16, u_accent, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol, float metalness) {
  return shadeStudio3D(rd, n, 1.0, surfCol, metalness, 0.16, u_accent, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol, vec3 rimTint) {
  return shadeStudio3D(rd, n, 1.0, surfCol, 0.78, 0.16, rimTint, 0.0);
}
vec3 shadeStudio3D(vec3 rd, vec3 n, vec3 surfCol) {
  return shadeStudio3D(rd, n, 1.0, surfCol, 0.78, 0.16, u_accent, 0.0);
}

#define u_time (u_seed * 0.17)
#define CALC_NORMAL(mapFn, p) normalize(vec3(1.0,-1.0,-1.0)*mapFn((p)+vec3(1.0,-1.0,-1.0)*0.0014)+vec3(-1.0,-1.0,1.0)*mapFn((p)+vec3(-1.0,-1.0,1.0)*0.0014)+vec3(-1.0,1.0,-1.0)*mapFn((p)+vec3(-1.0,1.0,-1.0)*0.0014)+vec3(1.0,1.0,1.0)*mapFn((p)+vec3(1.0,1.0,1.0)*0.0014))
#define CALC_AO(mapFn, pos, nor) clamp(1.0 - 2.0 * ((0.03 - mapFn((pos)+(nor)*0.03)) + (0.08 - mapFn((pos)+(nor)*0.08))*0.7 + (0.16 - mapFn((pos)+(nor)*0.16))*0.5 + (0.28 - mapFn((pos)+(nor)*0.28))*0.35), 0.15, 1.0)
`;

const GLSL_MAIN_FOOTER = `
void main() {
  vec2 fragCoord = u_tileOffset + gl_FragCoord.xy;
  vec2 rawUv = fragCoord / max(u_res, vec2(1.0));
  vec2 uv = rawUv - u_offset * 0.45;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec4 col = renderBackground(uv, p, aspect);
  bool badRgb = any(isnan(col.rgb)) || any(isinf(col.rgb));
  col.rgb = badRgb ? u_base : clamp(col.rgb, 0.0, 1.0);
  if (u_transparent < 0.5) {
    col.a = 1.0;
  } else {
    col.a = (isnan(col.a) || isinf(col.a)) ? 0.0 : clamp(col.a, 0.0, 1.0);
  }
  float dither = (hash21(fragCoord) - 0.5) / 235.0;
  col.rgb = clamp(col.rgb + dither * col.a, 0.0, 1.0);
  outColor = col;
}
`;

export function sanitizeAiGlslCode(rawCode: string): string {
  let code = rawCode.trim();
  // Remove markdown fences if accidentally present
  code = code.replace(/^```(?:glsl)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Strip conflicting header lines
  code = code
    .replace(/^\s*#version\s+.*$/gm, '')
    .replace(/^\s*precision\s+(?:highp|mediump|lowp)\s+\w+\s*;\s*$/gm, '')
    .replace(/^\s*(?:out|in)\s+vec[234]\s+(?:outColor|fragColor|vUv)\s*;\s*$/gm, '')
    .replace(
      /^\s*uniform\s+\w+\s+u_(?:res|tileOffset|tileSize|seed|time|density|scale|rotation|offset|warp|grain|lineWeight|glow|depth|transparent|isLight|base|primary|secondary|accent|highlight)\s*;\s*$/gm,
      ''
    );

  // If the AI didn't wrap in `vec4 renderBackground(vec2 uv, vec2 p, float aspect)`
  // check if `renderBackground` exists; if they used `mainImage` or bare body, adapt cleanly
  if (!/vec4\s+renderBackground\s*\(/.test(code)) {
    if (/void\s+main\s*\(/.test(code)) {
      code = code.replace(/void\s+main\s*\(\s*\)/, 'vec4 renderBackground(vec2 uv, vec2 p, float aspect)');
    } else {
      code = `vec4 renderBackground(vec2 uv, vec2 p, float aspect) {\n${code}\n}`;
    }
  }

  return `${GLSL_STDLIB_HEADER}\n${code}\n${GLSL_MAIN_FOOTER}`;
}

let cachedGlCanvas: HTMLCanvasElement | null = null;
let cachedGl: WebGL2RenderingContext | null = null;
let cachedQuadBuffer: WebGLBuffer | null = null;

function ensureGlContext(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  if (typeof document === 'undefined') return null;
  if (!cachedGlCanvas) {
    cachedGlCanvas = document.createElement('canvas');
  }
  if (!cachedGl || cachedGl.isContextLost()) {
    cachedGl = cachedGlCanvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    cachedQuadBuffer = null;
  }
  if (!cachedGl) return null;

  if (!cachedQuadBuffer) {
    cachedQuadBuffer = cachedGl.createBuffer();
    cachedGl.bindBuffer(cachedGl.ARRAY_BUFFER, cachedQuadBuffer);
    cachedGl.bufferData(
      cachedGl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      cachedGl.STATIC_DRAW
    );
  }
  return { canvas: cachedGlCanvas, gl: cachedGl };
}

export function compileDynamicGlslProgram(rawCode: string): {
  ok: true;
  program: WebGLProgram;
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
} | {
  ok: false;
  errorLog: string;
} {
  const ctx = ensureGlContext();
  if (!ctx) {
    return { ok: false, errorLog: 'WebGL2 is unavailable in this browser.' };
  }
  const { gl, canvas } = ctx;
  const fragSource = sanitizeAiGlslCode(rawCode);

  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, VERTEX_SHADER_SRC);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(vs) || 'Vertex shader error';
    gl.deleteShader(vs);
    return { ok: false, errorLog: err };
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, fragSource);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const rawErr = gl.getShaderInfoLog(fs) || 'Fragment shader compile error';
    const headerLines = GLSL_STDLIB_HEADER.split('\n').length;
    const annotatedErr = rawErr.replace(/ERROR:\s*\d+:(\d+):/g, (full, lineStr) => {
      const snippetLine = Number(lineStr) - headerLines;
      return snippetLine > 0 ? `${full} [user glsl line ${snippetLine}]` : full;
    });
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { ok: false, errorLog: annotatedErr };
  }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(prog) || 'Shader program link error';
    gl.deleteProgram(prog);
    return { ok: false, errorLog: err };
  }

  return { ok: true, program: prog, gl, canvas };
}

export function validateDynamicGlslCompile(
  rawCode: string
): { ok: true } | { ok: false; errorLog: string } {
  const res = compileDynamicGlslProgram(rawCode);
  if (res.ok === false) return { ok: false, errorLog: res.errorLog };
  res.gl.deleteProgram(res.program);
  return { ok: true };
}

const yieldFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function renderDynamicGlslToCanvas(
  targetCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rawGlslCode: string,
  u: DynamicShaderUniforms,
  signal?: AbortSignal
): Promise<{ ok: true } | { ok: false; errorLog: string }> {
  const compiled = compileDynamicGlslProgram(rawGlslCode);
  if (!compiled.ok) {
    return compiled;
  }

  const { program, gl, canvas: glCanvas } = compiled;
  const tileSize = Math.max(width, height) > 2048 ? 1024 : Math.max(width, height);

  try {
    gl.useProgram(program);
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    if (posLoc >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, cachedQuadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    const set1f = (name: string, v: number) => {
      const loc = gl.getUniformLocation(program, name);
      if (loc) gl.uniform1f(loc, v);
    };
    const set2f = (name: string, a: number, b: number) => {
      const loc = gl.getUniformLocation(program, name);
      if (loc) gl.uniform2f(loc, a, b);
    };
    const set3f = (name: string, v: [number, number, number]) => {
      const loc = gl.getUniformLocation(program, name);
      if (loc) gl.uniform3f(loc, v[0], v[1], v[2]);
    };

    set2f('u_res', width, height);
    set1f('u_seed', u.seedFloat);
    set1f('u_density', u.density);
    set1f('u_scale', u.geometryScale);
    set1f('u_rotation', u.rotationRad);
    set2f('u_offset', u.offset[0], u.offset[1]);
    set1f('u_warp', u.warp);
    set1f('u_grain', u.grain);
    set1f('u_lineWeight', u.lineWeight);
    set1f('u_glow', u.glow);
    set1f('u_depth', u.depth);
    set1f('u_transparent', u.transparentBackground ? 1.0 : 0.0);
    set1f('u_isLight', u.isLightTheme ? 1.0 : 0.0);
    set3f('u_base', u.baseRgb);
    set3f('u_primary', u.primaryRgb);
    set3f('u_secondary', u.secondaryRgb);
    set3f('u_accent', u.accentRgb);
    set3f('u_highlight', u.highlightRgb);

    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        if (signal?.aborted) {
          throw new DOMException('Render aborted', 'AbortError');
        }
        const tw = Math.min(tileSize, width - x);
        const th = Math.min(tileSize, height - y);
        if (glCanvas.width !== tw || glCanvas.height !== th) {
          glCanvas.width = tw;
          glCanvas.height = th;
        }
        gl.viewport(0, 0, tw, th);
        const glOffsetY = height - y - th;
        set2f('u_tileOffset', x, glOffsetY);
        set2f('u_tileSize', tw, th);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        targetCtx.drawImage(glCanvas, x, y, tw, th);

        if (width * height > 2500 * 2500) {
          await yieldFrame();
        }
      }
    }

    return { ok: true };
  } finally {
    gl.deleteProgram(program);
  }
}
