// 2D simplex noise by Ian McEwan, Ashima Arts, maintained by Stefan Gustavson.
// Copyright (C) 2011 Ashima Arts. Distributed under the MIT License.
// https://github.com/ashima/webgl-noise
// https://github.com/stegu/webgl-noise

export const CONTOURS_VERTEX = `#version 300 es
void main() {
  vec2 pos = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const CONTOURS_FRAGMENT = `#version 300 es
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
uniform vec3 uLineColor;
uniform vec3 uNoiseScales;
uniform vec3 uNoiseWeights;
uniform vec2 uDensityThresholds;
uniform float uMinorInterval;
uniform float uMajorEvery;
uniform float uMinorWidthPx;
uniform float uMajorWidthPx;
uniform float uMinorOpacity;
uniform float uMajorOpacity;
uniform float uCoastOpacity;
uniform vec2 uLodFade;

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

float isoline(float level, float footprint, float widthPx, float pixelScale) {
  float phase = fract(level);
  float distanceToLine = min(phase, 1.0 - phase);
  float pixels = distanceToLine / footprint;
  float halfWidth = max(widthPx, 0.0) * pixelScale * 0.5;
  return 1.0 - smoothstep(halfWidth, halfWidth + 1.0, pixels);
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uBackingResolution.y - gl_FragCoord.y) * (uCssResolution / uBackingResolution);
  vec2 world = uTile + uLocalOrigin + css / max(uZoom, 0.0001);
  float large = snoise(world / max(uNoiseScales.x, 1.0) + uSeedA);
  float medium = snoise(world / max(uNoiseScales.y, 1.0) + uSeedB);
  float detail = snoise(world / max(uNoiseScales.z, 1.0) + uSeedC);
  float terrain = large * uNoiseWeights.x + medium * uNoiseWeights.y + detail * uNoiseWeights.z;
  float density = smoothstep(uDensityThresholds.x, uDensityThresholds.y, terrain);
  float interval = max(uMinorInterval, 0.025);
  float every = max(uMajorEvery, 2.0);
  float minorLevel = terrain / interval;
  float majorLevel = terrain / (interval * every);
  float minorFoot = max(fwidth(minorLevel), 0.00001);
  float majorFoot = max(fwidth(majorLevel), 0.00001);
  float coastHeight = terrain - uDensityThresholds.x;
  float coastFoot = max(fwidth(terrain), 0.00001);
  float pixelScale = uBackingResolution.x / max(uCssResolution.x, 1.0);
  float minorSpacing = 1.0 / minorFoot;
  float majorSpacing = 1.0 / majorFoot;
  float minorFade = smoothstep(uLodFade.x, max(uLodFade.y, uLodFade.x + 0.001), minorSpacing);
  float majorFade = smoothstep(uLodFade.x, max(uLodFade.y, uLodFade.x + 0.001), majorSpacing);
  float minorInk = isoline(minorLevel, minorFoot, uMinorWidthPx, pixelScale) * uMinorOpacity * minorFade;
  float majorInk = isoline(majorLevel, majorFoot, uMajorWidthPx, pixelScale) * uMajorOpacity * majorFade;
  float land = density > 0.0 ? 1.0 : 0.0;
  float contour = max(minorInk, majorInk) * land;
  float coastPixels = abs(coastHeight) / coastFoot;
  float coastHalf = 0.9 * pixelScale * 0.5;
  float coast = (1.0 - smoothstep(coastHalf, coastHalf + 1.0, coastPixels)) * uCoastOpacity;
  float ink = clamp(max(contour, coast), 0.0, 1.0);
  fragColor = vec4(mix(uBaseColor, uLineColor, ink), 1.0);
}
`;
