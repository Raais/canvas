// 2D simplex noise by Ian McEwan, Ashima Arts, maintained by Stefan Gustavson.
// Copyright (C) 2011 Ashima Arts. Distributed under the MIT License.
// https://github.com/ashima/webgl-noise
// https://github.com/stegu/webgl-noise

export const ATLAS_VERTEX = `#version 300 es
void main() {
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const ATLAS_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uCssResolution;
uniform vec2 uBackingResolution;
uniform vec2 uTile;
uniform vec2 uLocalOrigin;
uniform float uZoom;
uniform vec2 uSeedA;
uniform vec2 uSeedB;
uniform vec2 uSeedC;
uniform vec3 uBaseColor;
uniform vec3 uInkColor;
uniform vec3 uNoiseScales;
uniform vec3 uNoiseWeights;
uniform vec2 uDensityThresholds;
uniform float uInkStrength;
uniform int uDitherMode;
uniform vec2 uSmoothFade;
uniform vec2 uCells;
uniform float uLodBlend;
uniform int uVoidEnabled;
uniform float uVoidCutoff;
uniform float uVoidSoftness;

out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float bayer(ivec2 cell) {
  int x = cell.x & 3;
  int y = cell.y & 3;
  int index = y * 4 + x;
  float value = 0.0;
  if (index == 0) value = 0.0;
  else if (index == 1) value = 8.0;
  else if (index == 2) value = 2.0;
  else if (index == 3) value = 10.0;
  else if (index == 4) value = 12.0;
  else if (index == 5) value = 4.0;
  else if (index == 6) value = 14.0;
  else if (index == 7) value = 6.0;
  else if (index == 8) value = 3.0;
  else if (index == 9) value = 11.0;
  else if (index == 10) value = 1.0;
  else if (index == 11) value = 9.0;
  else if (index == 12) value = 15.0;
  else if (index == 13) value = 7.0;
  else if (index == 14) value = 13.0;
  else value = 5.0;
  return value / 16.0;
}

float landMask(float density, float cutoff, float softness) {
  if (softness <= 0.0) return density > cutoff ? 1.0 : 0.0;
  float upper = min(1.0, cutoff + softness);
  if (upper <= cutoff) return density > cutoff ? 1.0 : 0.0;
  return smoothstep(cutoff, upper, density);
}

float toneAt(vec2 world, float density, float cell) {
  float threshold = bayer(ivec2(floor(world / max(cell, 0.001))));
  float dithered = step(threshold, density);
  if (uDitherMode == 0) {
    float cellPixels = cell * uZoom * (uBackingResolution.x / max(uCssResolution.x, 1.0));
    float fade = smoothstep(uSmoothFade.x, uSmoothFade.y, cellPixels);
    return mix(density, dithered, fade);
  }
  return dithered;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uBackingResolution.y - gl_FragCoord.y) * (uCssResolution / uBackingResolution);
  vec2 world = uTile + uLocalOrigin + css / max(uZoom, 0.0001);
  float large = snoise(world / max(uNoiseScales.x, 1.0) + uSeedA);
  float medium = snoise(world / max(uNoiseScales.y, 1.0) + uSeedB);
  float detail = snoise(world / max(uNoiseScales.z, 1.0) + uSeedC);
  float terrain = large * uNoiseWeights.x + medium * uNoiseWeights.y + detail * uNoiseWeights.z;
  float density = smoothstep(uDensityThresholds.x, uDensityThresholds.y, terrain);
  float tone = mix(toneAt(world, density, uCells.x), toneAt(world, density, uCells.y), clamp(uLodBlend, 0.0, 1.0));
  if (uVoidEnabled == 1) tone *= landMask(density, uVoidCutoff, uVoidSoftness);
  vec3 color = mix(uBaseColor, uInkColor, clamp(tone, 0.0, 1.0) * clamp(uInkStrength, 0.0, 1.0));
  fragColor = vec4(color, 1.0);
}
`;
