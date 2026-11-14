import { atlasOrigin, backingSize, type AtlasViewport } from './atlas-math';
import { seedVectors } from './atlas-seed';
import { CONTOURS_FRAGMENT, CONTOURS_VERTEX } from './contours-shader';
import { CONTOURS_V1_TERRAIN, clampContoursTuning, contourWeights, contoursSceneKey, type ContoursTuning } from './contours-tuning';

export type ContoursScene = {
  viewport: AtlasViewport;
  cssWidth: number;
  cssHeight: number;
  seed: number;
  appearance: 'dark' | 'light';
  devicePixelRatio: number;
  tuning: ContoursTuning;
};

const DARK = { base: [0.078, 0.09, 0.106] as const, line: [0.58, 0.64, 0.7] as const };
const LIGHT = { base: [0.953, 0.941, 0.918] as const, line: [0.42, 0.36, 0.3] as const };

type GpuResources = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  locations: Record<string, WebGLUniformLocation | null>;
};

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function buildGpu(gl: WebGL2RenderingContext): GpuResources | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, CONTOURS_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, CONTOURS_FRAGMENT);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  const vao = gl.createVertexArray();
  if (!program || !vao) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    gl.deleteVertexArray(vao);
    return null;
  }
  const names = [
    'uCssResolution', 'uBackingResolution', 'uTile', 'uLocalOrigin', 'uZoom', 'uSeedA', 'uSeedB', 'uSeedC',
    'uBaseColor', 'uLineColor', 'uNoiseScales', 'uNoiseWeights', 'uDensityThresholds', 'uMinorInterval', 'uMajorEvery',
    'uMinorWidthPx', 'uMajorWidthPx', 'uMinorOpacity', 'uMajorOpacity', 'uCoastOpacity', 'uLodFade',
  ];
  const locations: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) locations[name] = gl.getUniformLocation(program, name);
  return { program, vao, locations };
}

export class ContoursRenderer {
  private raf = 0;
  private disposed = false;
  private lost = false;
  private drawn = '';
  private pending: ContoursScene | null = null;
  private gpu: GpuResources | null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    gpu: GpuResources,
    private readonly onUnavailable: () => void,
  ) {
    this.gpu = gpu;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  static create(canvas: HTMLCanvasElement, onUnavailable: () => void): ContoursRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    const gpu = buildGpu(gl);
    if (!gpu) return null;
    return new ContoursRenderer(canvas, gl, gpu, onUnavailable);
  }

  setScene(scene: ContoursScene): void {
    this.pending = scene;
    if (this.disposed || this.lost || document.hidden) return;
    const key = sceneKey(scene);
    if (key === this.drawn || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  redraw(): void {
    this.drawn = '';
    if (this.pending) this.setScene(this.pending);
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.deleteGpu();
  }

  private draw(): void {
    const scene = this.pending;
    const gpu = this.gpu;
    if (!scene || !gpu || this.disposed || this.lost || document.hidden) return;
    const key = sceneKey(scene);
    if (key === this.drawn) return;
    const backing = backingSize(scene.cssWidth, scene.cssHeight, scene.devicePixelRatio);
    if (this.canvas.width !== backing.width || this.canvas.height !== backing.height) {
      this.canvas.width = backing.width;
      this.canvas.height = backing.height;
    }
    const origin = atlasOrigin(scene.viewport);
    const seeds = seedVectors(scene.seed);
    const palette = scene.appearance === 'light' ? LIGHT : DARK;
    const tuning = clampContoursTuning(scene.tuning);
    const weights = contourWeights();
    const gl = this.gl;
    gl.viewport(0, 0, backing.width, backing.height);
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    const loc = gpu.locations;
    gl.uniform2f(loc.uCssResolution ?? null, scene.cssWidth, scene.cssHeight);
    gl.uniform2f(loc.uBackingResolution ?? null, backing.width, backing.height);
    gl.uniform2f(loc.uTile ?? null, origin.tileX, origin.tileY);
    gl.uniform2f(loc.uLocalOrigin ?? null, origin.localX, origin.localY);
    gl.uniform1f(loc.uZoom ?? null, origin.zoom);
    gl.uniform2f(loc.uSeedA ?? null, seeds.a[0], seeds.a[1]);
    gl.uniform2f(loc.uSeedB ?? null, seeds.b[0], seeds.b[1]);
    gl.uniform2f(loc.uSeedC ?? null, seeds.c[0], seeds.c[1]);
    gl.uniform3f(loc.uBaseColor ?? null, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(loc.uLineColor ?? null, palette.line[0], palette.line[1], palette.line[2]);
    gl.uniform3f(loc.uNoiseScales ?? null, CONTOURS_V1_TERRAIN.largeScale, CONTOURS_V1_TERRAIN.mediumScale, CONTOURS_V1_TERRAIN.detailScale);
    gl.uniform3f(loc.uNoiseWeights ?? null, weights[0], weights[1], weights[2]);
    gl.uniform2f(loc.uDensityThresholds ?? null, CONTOURS_V1_TERRAIN.densityLow, CONTOURS_V1_TERRAIN.densityHigh);
    gl.uniform1f(loc.uMinorInterval ?? null, tuning.minorInterval);
    gl.uniform1f(loc.uMajorEvery ?? null, tuning.majorEvery);
    gl.uniform1f(loc.uMinorWidthPx ?? null, tuning.minorWidthPx);
    gl.uniform1f(loc.uMajorWidthPx ?? null, tuning.majorWidthPx);
    gl.uniform1f(loc.uMinorOpacity ?? null, tuning.minorOpacity);
    gl.uniform1f(loc.uMajorOpacity ?? null, tuning.majorOpacity);
    gl.uniform1f(loc.uCoastOpacity ?? null, tuning.coastlineOpacity);
    gl.uniform2f(loc.uLodFade ?? null, tuning.lodFadeStartPx, tuning.lodFadeEndPx);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawn = key;
  }

  private deleteGpu(): void {
    if (!this.gpu || this.gl.isContextLost()) {
      this.gpu = null;
      return;
    }
    this.gl.deleteProgram(this.gpu.program);
    this.gl.deleteVertexArray(this.gpu.vao);
    this.gpu = null;
  }

  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.gpu = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  private onRestored = () => {
    if (this.disposed) return;
    const gpu = buildGpu(this.gl);
    if (!gpu) {
      this.lost = true;
      this.onUnavailable();
      return;
    }
    this.gpu = gpu;
    this.lost = false;
    this.drawn = '';
    if (this.pending) this.setScene(this.pending);
  };
}

function sceneKey(scene: ContoursScene): string {
  return contoursSceneKey({
    x: scene.viewport.x,
    y: scene.viewport.y,
    zoom: scene.viewport.zoom,
    cssWidth: scene.cssWidth,
    cssHeight: scene.cssHeight,
    seed: scene.seed,
    appearance: scene.appearance,
    dpr: scene.devicePixelRatio,
    tuning: scene.tuning,
  });
}
