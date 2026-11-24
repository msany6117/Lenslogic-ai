import { BgShaderStyle } from './techBgTypes';

// Tiled WebGL2 GLSL Shader Engine:
// 0: mesh-atmospheric
// 1: raymarch-spheres (Studio 3D Spheres cluster with brushed metal, striped gold & AO)
// 2: raymarch-chrome (Glossy Liquid Chrome sculptural waves on obsidian)
// 3: raymarch-torus (Modular Architectural 3D Ribbed Torus)
// 4: voronoi-caustic (Stained-Glass Voronoi Patterns with crisp border lines)
// 5: fractal-julia (Genuine Mandelbrot/Julia spiral zoom fractal art)
// 6: noise-ridge (Domain-warped luminous ridge turbulence plasma veins)
// 7: studio-minimal (Clean studio mesh)

export function shaderStyleToMode(style: BgShaderStyle): number {
  switch (style) {
    case 'mesh-atmospheric':
      return 0;
    case 'raymarch-spheres':
      return 1;
    case 'raymarch-chrome':
      return 2;
    case 'raymarch-torus':
      return 3;
    case 'voronoi-caustic':
      return 4;
    case 'fractal-julia':
      return 5;
    case 'noise-ridge':
      return 6;
    case 'studio-minimal':
    default:
      return 7;
  }
}

export interface ShaderRenderOptions {
  style: BgShaderStyle;
  seedFloat: number;
  baseRgb: [number, number, number];
  primaryRgb: [number, number, number];
  secondaryRgb: [number, number, number];
  accentRgb: [number, number, number];
  highlightRgb: [number, number, number];
  focalPoint: [number, number];
  lightAngle: number;
  density: number;
  glow: number;
  depth: number;
  lineWeight: number;
  isLightTheme: boolean;
  transparentBackground: boolean;
  geometryScale: number;
}

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_localUv;
void main() {
  v_localUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_localUv;
out vec4 outColor;

uniform vec2 u_fullRes;
uniform vec2 u_tileOffset;
uniform vec2 u_tileScale;
uniform int u_mode;
uniform float u_seed;
uniform vec3 u_base;
uniform vec3 u_primary;
uniform vec3 u_secondary;
uniform vec3 u_accent;
uniform vec3 u_highlight;
uniform vec2 u_focal;
uniform float u_angle;
uniform float u_density;
uniform float u_glow;
uniform float u_depth;
uniform float u_lineWeight;
uniform float u_isLight;
uniform float u_transparent;
uniform float u_geoScale;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34 + u_seed * 0.137, 456.21 + u_seed * 0.293));
  p += dot(p, p + 45.32 + u_seed * 0.071);
  return fract(p.x * p.y);
}

float hash11(float p) {
  p = fract(p * 0.1031 + u_seed * 0.013);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + u_seed * 0.017);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p, int octaves) {
  float val = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    val += amp * valueNoise(p);
    p = rot * p * 2.02 + vec2(11.3, 5.7);
    amp *= 0.5;
  }
  return val;
}

vec3 voronoiExact(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }

  float edgeDist = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      if (dot(mr - r, mr - r) > 0.00001) {
        edgeDist = min(edgeDist, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }

  float cellId = hash21(n + mg);
  return vec3(sqrt(md), edgeDist, cellId);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// Returns vec2(dist, materialId)
vec2 mapSpheres(vec3 pos, vec2 focalP) {
  vec3 p = pos;
  p.xy -= focalP * 0.75;
  p.xz *= rot2(u_angle * 0.6);
  p.yz *= rot2(0.28 + u_depth * 0.25);

  float minD = 100.0;
  float matId = 0.0;

  // Core large hero sphere
  float coreR = 0.28 * u_geoScale;
  float d0 = length(p) - coreR;
  minD = d0;
  matId = 0.2;

  // Surrounding clustered spheres (metallic, striped gold, matte slate)
  int count = clamp(int(8.0 + u_density * 10.0), 8, 18);
  for (int i = 0; i < 18; i++) {
    if (i >= count) break;
    float fi = float(i) + 1.0;
    float theta = fi * 2.39996 + u_seed * 0.13;
    float phi = acos(1.0 - 2.0 * (fi / float(count + 1)));
    float rad = (0.28 + 0.26 * hash11(fi * 7.3)) * u_geoScale;
    vec3 center = vec3(
      sin(phi) * cos(theta),
      cos(phi) * 0.85,
      sin(phi) * sin(theta)
    ) * rad * 1.35;
    float sr = (0.065 + 0.14 * pow(hash11(fi * 19.7), 1.4)) * u_geoScale;
    float d = length(p - center) - sr;
    if (d < minD) {
      minD = d;
      matId = hash11(fi * 31.1);
    }
  }
  return vec2(minD, matId);
}

float mapTorus(vec3 pos, vec2 focalP) {
  vec3 p = pos;
  p.xy -= focalP * 0.65;
  p.xz *= rot2(u_angle * 0.7 + 0.45);
  p.yz *= rot2(0.75 + u_depth * 0.25);

  float majorR = 0.42 * u_geoScale;
  float minorR = 0.145 * u_geoScale;
  vec2 q = vec2(length(p.xz) - majorR, p.y);
  float baseTorus = length(q) - minorR;

  // Architectural modular grid ribs along torus angles
  float theta = atan(p.z, p.x);
  float phi = atan(q.y, q.x);
  float ribsTheta = cos(theta * (18.0 + floor(u_density * 16.0)));
  float ribsPhi = cos(phi * 10.0);
  float grooves = smoothstep(-0.2, 0.35, ribsTheta) * smoothstep(-0.2, 0.35, ribsPhi);
  return baseTorus - grooves * (0.016 * u_geoScale);
}

float mapChrome(vec3 pos, vec2 focalP) {
  vec3 p = pos;
  p.xy -= focalP * 0.5;
  float s = max(0.5, u_geoScale);
  vec3 q = p * (2.2 / s);

  float d1 = length(p - vec3(sin(u_seed) * 0.35, 0.22 * s, 0.0)) - 0.32 * s;
  float d2 = length(p - vec3(-0.32 * s, -0.24 * s, 0.12)) - 0.28 * s;
  float d3 = length(p - vec3(0.26 * s, -0.18 * s, -0.15)) - 0.25 * s;

  float waveSheet = p.z + 0.34 - (
    sin(q.x * 2.1 + u_seed * 0.2) * cos(q.y * 1.9 - u_angle) * 0.16 +
    sin(q.x * 3.8 - q.y * 2.4) * 0.08
  ) * (0.75 + u_depth * 0.6);

  float blobs = smin(smin(d1, d2, 0.26 * s), d3, 0.24 * s);
  return smin(waveSheet, blobs, 0.28 * s);
}

float mapScene3D(vec3 pos, int mode, vec2 focalP, out float matId) {
  matId = 0.5;
  if (mode == 1) {
    vec2 res = mapSpheres(pos, focalP);
    matId = res.y;
    return res.x;
  } else if (mode == 2) {
    return mapChrome(pos, focalP);
  } else {
    return mapTorus(pos, focalP);
  }
}

vec3 calcNormal3D(vec3 pos, int mode, vec2 focalP) {
  vec2 e = vec2(0.0014, -0.0014);
  float dummy;
  return normalize(
    e.xyy * mapScene3D(pos + e.xyy, mode, focalP, dummy) +
    e.yyx * mapScene3D(pos + e.yyx, mode, focalP, dummy) +
    e.yxy * mapScene3D(pos + e.yxy, mode, focalP, dummy) +
    e.xxx * mapScene3D(pos + e.xxx, mode, focalP, dummy)
  );
}

float calcAO(vec3 pos, vec3 nor, int mode, vec2 focalP) {
  float occ = 0.0;
  float sca = 1.0;
  float dummy;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.06 * float(i);
    float d = mapScene3D(pos + h * nor, mode, focalP, dummy);
    occ += (h - d) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.2 * occ, 0.12, 1.0);
}

vec3 studioEnv(vec3 rd, bool monoChrome) {
  float sky = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  if (monoChrome) {
    vec3 c = mix(vec3(0.04), vec3(0.28), sky);
    float softbox1 = smoothstep(0.68, 0.92, dot(rd, normalize(vec3(cos(u_angle), 0.72, sin(u_angle)))));
    float softbox2 = smoothstep(0.75, 0.96, dot(rd, normalize(vec3(-0.7, -0.3, 0.55))));
    c = mix(c, vec3(0.98), softbox1 * 0.95);
    c = mix(c, vec3(0.85), softbox2 * 0.7);
    return c;
  }
  vec3 c = mix(u_primary * 0.65, u_secondary * 0.95, sky);
  float keyBox = smoothstep(0.62, 0.94, dot(rd, normalize(vec3(cos(u_angle), 0.65, sin(u_angle)))));
  float rimBox = smoothstep(0.72, 0.95, dot(rd, normalize(vec3(-cos(u_angle), -0.25, 0.6))));
  c = mix(c, u_highlight, keyBox * (0.65 + 0.35 * u_glow));
  c += u_accent * rimBox * (0.35 + 0.45 * u_glow);
  return c;
}

void main() {
  vec2 uvTopDown = vec2(
    u_tileOffset.x + v_localUv.x * u_tileScale.x,
    u_tileOffset.y + (1.0 - v_localUv.y) * u_tileScale.y
  );

  float aspect = u_fullRes.x / max(1.0, u_fullRes.y);
  vec2 p = (uvTopDown - 0.5) * vec2(aspect, 1.0);
  vec2 focalP = (u_focal - 0.5) * vec2(aspect, 1.0);

  vec2 dir = vec2(cos(u_angle), sin(u_angle));
  vec2 ortho = vec2(-dir.y, dir.x);
  vec2 pRot = vec2(dot(p, dir), dot(p, ortho));

  float distFocal = length(p - focalP);
  float radialGlow = exp(-distFocal * (2.4 - u_depth * 1.0));

  vec3 col = u_base;
  float alphaEnergy = 0.0;

  if (u_mode == 1 || u_mode == 2 || u_mode == 3) {
    // 3D SDF Raymarching Studio
    if (u_mode == 2) {
      // Liquid Chrome: pure deep obsidian studio void
      col = u_base * 0.25;
    } else if (u_mode == 3) {
      // 3D Torus: rich studio gradient backdrop
      col = mix(u_base, u_primary * 0.85, clamp(0.35 + (0.5 - p.y) * 0.55, 0.0, 1.0));
      col = mix(col, u_secondary * 0.95, radialGlow * 0.55);
    } else {
      // 3D Spheres: clean studio backdrop
      col = mix(u_base, mix(u_base, u_primary, 0.45), radialGlow * 0.7);
    }

    vec3 ro = vec3(0.0, 0.0, 1.55);
    vec3 rd = normalize(vec3(p, -1.4));
    float t = 0.0;
    bool hit = false;
    float matId = 0.5;

    for (int i = 0; i < 80; i++) {
      vec3 pos = ro + rd * t;
      float d = mapScene3D(pos, u_mode, focalP, matId);
      if (d < 0.0012) {
        hit = true;
        break;
      }
      if (t > 4.0) break;
      t += d * 0.8;
    }

    if (hit) {
      vec3 pos = ro + rd * t;
      vec3 n = calcNormal3D(pos, u_mode, focalP);
      float ao = calcAO(pos, n, u_mode, focalP);
      vec3 lightDir = normalize(vec3(cos(u_angle) * 0.85, 0.72, 0.75));
      float diff = max(dot(n, lightDir), 0.0);
      vec3 halfDir = normalize(lightDir - rd);
      float spec = pow(max(dot(n, halfDir), 0.0), u_mode == 2 ? 64.0 : 36.0);
      float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

      if (u_mode == 2) {
        // Liquid Chrome HDR reflection
        vec3 refl = studioEnv(reflect(rd, n), true);
        col = refl * (0.45 + 0.55 * ao) + vec3(1.0) * spec * (0.55 + 0.65 * u_glow);
        col += mix(u_accent, vec3(0.9), 0.75) * fresnel * 0.35;
      } else if (u_mode == 1) {
        // 3D Spheres: alternate brushed silver, matte obsidian, and striped accent/gold
        vec3 refl = studioEnv(reflect(rd, n), false);
        if (matId > 0.66) {
          // Striped gold/accent metallic sphere
          float stripe = smoothstep(-0.1, 0.1, sin((pos.x * 16.0 + pos.y * 20.0) * (1.0 / max(0.5, u_geoScale))));
          vec3 surf = mix(u_primary * 0.45, u_accent, stripe);
          col = surf * (0.28 + 0.72 * diff) * ao + refl * (0.38 + 0.35 * fresnel) + u_highlight * spec * (0.5 + 0.7 * u_glow);
        } else if (matId > 0.33) {
          // Brushed platinum/silver metallic sphere
          col = mix(u_highlight * 0.65, refl, 0.7) * (0.35 + 0.65 * ao) + u_highlight * spec * (0.45 + 0.65 * u_glow);
        } else {
          // Matte slate/obsidian sphere
          col = mix(u_base, u_secondary, 0.35) * (0.25 + 0.75 * diff) * ao + u_highlight * fresnel * 0.32;
        }
      } else {
        // 3D Ribbed Torus
        vec3 refl = studioEnv(reflect(rd, n), false);
        vec3 baseMat = mix(u_primary, u_secondary, 0.45 + 0.45 * n.y);
        col = baseMat * (0.25 + 0.8 * diff) * ao;
        col = mix(col, refl, 0.25 + 0.45 * fresnel);
        col += u_highlight * spec * (0.45 + 0.7 * u_glow);
        col += u_accent * fresnel * (0.25 + 0.55 * u_glow);
      }
      alphaEnergy = 0.98;
    } else if (u_transparent > 0.5) {
      alphaEnergy = 0.0;
    }
  } else if (u_mode == 4) {
    // Stained-Glass Voronoi Patterns with Crisp Cell Borders
    float scale = (2.8 + u_density * 5.2) / max(0.55, u_geoScale);
    vec3 v = voronoiExact(pRot * scale);
    float borderThick = (0.04 + 0.045 * u_lineWeight) * (1.0 / max(0.6, u_geoScale));
    float border = 1.0 - smoothstep(borderThick * 0.65, borderThick * 1.15, v.y);

    float tone = v.z;
    vec3 cellColor = mix(u_primary, u_secondary, tone);
    cellColor = mix(cellColor, u_accent, smoothstep(0.55, 0.95, fract(tone * 3.7)) * 0.65);
    cellColor = mix(cellColor, u_highlight, smoothstep(0.7, 1.0, tone) * (u_isLight > 0.5 ? 0.5 : 0.28));

    // Subtle interior cell gradient
    cellColor *= (0.88 + 0.18 * (1.0 - v.x));

    vec3 mortarCol = u_isLight > 0.5 ? vec3(0.98) : mix(u_highlight, vec3(0.97), 0.7);
    if (u_transparent > 0.5) {
      col = cellColor;
      alphaEnergy = 1.0 - border; // Transparent mortar gaps!
    } else {
      col = mix(cellColor, mortarCol, border);
      alphaEnergy = 1.0;
    }
  } else if (u_mode == 5) {
    // Genuine Julia / Mandelbrot Spiral Fractal Art
    vec2 z = (p - focalP * 0.35) * (1.45 / max(0.5, u_geoScale));
    z = vec2(dot(z, dir), dot(z, ortho));
    // Classic rich spiral Julia constant modulated subtly by seed
    float sa = u_seed * 0.031;
    vec2 c = vec2(-0.74543 + cos(sa) * 0.018, 0.11301 + sin(sa) * 0.018);

    float iter = 0.0;
    const float maxIter = 76.0;
    for (int i = 0; i < 76; i++) {
      if (dot(z, z) > 64.0) break;
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      iter += 1.0;
    }

    if (iter >= maxIter) {
      col = u_base;
    } else {
      float sn = iter - log2(log2(max(dot(z, z), 1.0001))) + 4.0;
      float t = fract(sn * (0.045 + u_density * 0.04));
      vec3 fCol = mix(u_primary, u_secondary, smoothstep(0.0, 0.45, t));
      fCol = mix(fCol, u_accent, smoothstep(0.35, 0.75, t));
      fCol = mix(fCol, u_highlight, smoothstep(0.7, 1.0, t));
      col = fCol * (0.75 + 0.5 * u_glow);
    }
    alphaEnergy = 1.0;
  } else if (u_mode == 6) {
    // Domain-Warped Ridge Turbulence Plasma Veins (Noise Patterns)
    vec2 q = pRot * (2.4 / max(0.5, u_geoScale));
    vec2 warp = vec2(
      fbm(q + vec2(u_seed * 0.13, 1.4), 4),
      fbm(q + vec2(5.1, u_seed * 0.27), 4)
    );
    float n1 = fbm(q * (1.2 + u_density * 1.1) + warp * (1.6 + u_depth * 0.8), 5);
    float n2 = fbm(q * (1.8 + u_density * 1.2) - warp * 1.2 + vec2(3.7, 2.1), 4);

    float ridge1 = pow(clamp(1.0 - abs(n1 * 2.0 - 1.0), 0.0, 1.0), 4.5 + (2.0 - u_lineWeight) * 1.5);
    float ridge2 = pow(clamp(1.0 - abs(n2 * 2.0 - 1.0), 0.0, 1.0), 5.0);

    col = u_base * 0.45;
    col += u_primary * ridge2 * (0.65 + 0.5 * u_glow);
    col += mix(u_secondary, u_accent, ridge1) * ridge1 * (0.85 + 0.75 * u_glow);
    col += u_highlight * pow(ridge1, 2.4) * (0.55 + 0.65 * u_glow);
    alphaEnergy = clamp(ridge1 + ridge2 * 0.7, 0.0, 1.0);
  } else if (u_mode == 0) {
    // Atmospheric gradient mesh for vector networks/data overlays
    vec2 q = vec2(
      fbm(pRot * 1.35 + vec2(u_seed * 0.31, 1.7), 3),
      fbm(pRot * 1.35 + vec2(5.2, u_seed * 0.43), 3)
    );
    float f = fbm(pRot * 1.7 + 1.4 * q, 3);
    col = mix(u_base, u_primary, smoothstep(0.2, 0.85, f) * (0.38 + 0.42 * u_depth));
    col = mix(col, u_secondary, smoothstep(0.35, 0.9, q.x) * 0.38);
    if (u_isLight > 0.5) {
      col = mix(col, u_highlight, radialGlow * (0.18 + 0.3 * u_glow));
    } else {
      col += u_accent * radialGlow * (0.16 + 0.4 * u_glow);
    }
    alphaEnergy = clamp(f * 0.35 + radialGlow * 0.45, 0.0, 0.85);
  } else {
    // Studio Minimal Backdrop
    float b1 = exp(-length(p - focalP) * (1.7 - 0.35 * u_depth));
    if (u_isLight > 0.5) {
      col = mix(u_base, mix(u_base, u_primary, 0.16), b1 * 0.75);
    } else {
      col = mix(u_base, u_primary * 0.55, b1 * (0.45 + 0.3 * u_depth));
      col += u_accent * radialGlow * (0.08 + 0.18 * u_glow);
    }
    alphaEnergy = clamp(b1 * 0.4, 0.0, 0.75);
  }

  float dither = (hash21(uvTopDown * u_fullRes) - 0.5) / 230.0;
  col = clamp(col + dither, 0.0, 1.0);

  if (u_transparent > 0.5) {
    outColor = vec4(col, clamp(alphaEnergy, 0.0, 1.0));
  } else {
    outColor = vec4(col, 1.0);
  }
}`;

interface CachedWebGL {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

let cachedGl: CachedWebGL | null = null;

function getWebGLRenderer(): CachedWebGL | null {
  if (typeof document === 'undefined') return null;
  if (cachedGl && !cachedGl.gl.isContextLost()) {
    return cachedGl;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;

    gl.shaderSource(vs, VERTEX_SHADER_SRC);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }

    gl.shaderSource(fs, FRAGMENT_SHADER_SRC);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    const posLoc = gl.getAttribLocation(program, 'a_pos');
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const names = [
      'u_fullRes',
      'u_tileOffset',
      'u_tileScale',
      'u_mode',
      'u_seed',
      'u_base',
      'u_primary',
      'u_secondary',
      'u_accent',
      'u_highlight',
      'u_focal',
      'u_angle',
      'u_density',
      'u_glow',
      'u_depth',
      'u_lineWeight',
      'u_isLight',
      'u_transparent',
      'u_geoScale',
    ];
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of names) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    cachedGl = { canvas, gl, program, uniforms };
    return cachedGl;
  } catch {
    return null;
  }
}

function rgbStr(rgb: [number, number, number], alpha = 1): string {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderSoftwareFallback(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: ShaderRenderOptions
) {
  if (!opts.transparentBackground) {
    ctx.fillStyle = rgbStr(opts.baseRgb, 1);
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  const fx = opts.focalPoint[0] * width;
  const fy = opts.focalPoint[1] * height;
  const rad = Math.max(width, height) * (0.52 + opts.depth * 0.35);

  const g1 = ctx.createRadialGradient(fx, fy, 0, fx, fy, rad);
  g1.addColorStop(0, rgbStr(opts.highlightRgb, opts.transparentBackground ? 0.32 : 0.24 + opts.glow * 0.25));
  g1.addColorStop(0.35, rgbStr(opts.accentRgb, 0.24 + opts.glow * 0.2));
  g1.addColorStop(0.75, rgbStr(opts.primaryRgb, 0.18 + opts.depth * 0.18));
  g1.addColorStop(1, rgbStr(opts.baseRgb, 0));
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, width, height);
}

const yieldFrame = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function renderWebGLFieldToCanvas(
  targetCtx: CanvasRenderingContext2D,
  targetWidth: number,
  targetHeight: number,
  opts: ShaderRenderOptions,
  signal?: AbortSignal
): Promise<void> {
  const renderer = getWebGLRenderer();
  if (!renderer) {
    renderSoftwareFallback(targetCtx, targetWidth, targetHeight, opts);
    return;
  }

  const { gl, canvas: glCanvas, program, uniforms } = renderer;
  const tileMax = 1024;

  gl.useProgram(program);
  gl.disable(gl.BLEND);
  gl.uniform2f(uniforms.u_fullRes, targetWidth, targetHeight);
  gl.uniform1i(uniforms.u_mode, shaderStyleToMode(opts.style));
  gl.uniform1f(uniforms.u_seed, opts.seedFloat);
  gl.uniform3fv(uniforms.u_base, opts.baseRgb);
  gl.uniform3fv(uniforms.u_primary, opts.primaryRgb);
  gl.uniform3fv(uniforms.u_secondary, opts.secondaryRgb);
  gl.uniform3fv(uniforms.u_accent, opts.accentRgb);
  gl.uniform3fv(uniforms.u_highlight, opts.highlightRgb);
  gl.uniform2fv(uniforms.u_focal, opts.focalPoint);
  gl.uniform1f(uniforms.u_angle, opts.lightAngle);
  gl.uniform1f(uniforms.u_density, opts.density);
  gl.uniform1f(uniforms.u_glow, opts.glow);
  gl.uniform1f(uniforms.u_depth, opts.depth);
  gl.uniform1f(uniforms.u_lineWeight, opts.lineWeight);
  gl.uniform1f(uniforms.u_isLight, opts.isLightTheme ? 1.0 : 0.0);
  gl.uniform1f(uniforms.u_transparent, opts.transparentBackground ? 1.0 : 0.0);
  gl.uniform1f(uniforms.u_geoScale, opts.geometryScale);

  const cols = Math.ceil(targetWidth / tileMax);
  const rows = Math.ceil(targetHeight / tileMax);
  const totalTiles = cols * rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (signal?.aborted) {
        throw new DOMException('Render aborted', 'AbortError');
      }

      const x0 = col * tileMax;
      const y0 = row * tileMax;
      const tw = Math.min(tileMax, targetWidth - x0);
      const th = Math.min(tileMax, targetHeight - y0);

      if (glCanvas.width !== tw || glCanvas.height !== th) {
        glCanvas.width = tw;
        glCanvas.height = th;
      }

      gl.viewport(0, 0, tw, th);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(uniforms.u_tileOffset, x0 / targetWidth, y0 / targetHeight);
      gl.uniform2f(uniforms.u_tileScale, tw / targetWidth, th / targetHeight);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      targetCtx.drawImage(glCanvas, 0, 0, tw, th, x0, y0, tw, th);

      if (totalTiles > 1) {
        await yieldFrame();
      }
    }
  }
}
