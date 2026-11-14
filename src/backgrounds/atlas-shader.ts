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

void main() {
  vec2 css = vec2(gl_FragCoord.x, uBackingResolution.y - gl_FragCoord.y) * (uCssResolution / uBackingResolution);
  vec2 world = uTile + uLocalOrigin + css / max(uZoom, 0.0001);
  float large = snoise(world / 900.0 + uSeedA);
  float medium = snoise(world / 340.0 + uSeedB);
  float detail = snoise(world / 105.0 + uSeedC);
  float terrain = large * 0.57 + medium * 0.28 + detail * 0.15;
  float density = smoothstep(-0.18, 0.42, terrain);
  float cell = 4.0;
  float threshold = bayer(ivec2(floor(world / cell)));
  float cellPixels = cell * uZoom * (uBackingResolution.x / max(uCssResolution.x, 1.0));
  float pixels = smoothstep(0.8, 2.4, cellPixels);
  float dithered = step(threshold, density);
  float tone = mix(density, dithered, pixels);
  vec3 color = mix(uBaseColor, uInkColor, clamp(tone, 0.0, 1.0) * 0.72);
  fragColor = vec4(color, 1.0);
}
`;
