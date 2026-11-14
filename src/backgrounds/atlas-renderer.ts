import { atlasOrigin, backingSize, type AtlasViewport } from './atlas-math';
import { seedVectors } from './atlas-seed';
import { ATLAS_FRAGMENT, ATLAS_VERTEX } from './atlas-shader';
import { atlasSceneKey, resolveAtlas, type AtlasTuning } from './atlas-tuning';

export type AtlasScene = {
  viewport: AtlasViewport;
  cssWidth: number;
  cssHeight: number;
  seed: number;
  appearance: 'dark' | 'light';
  devicePixelRatio: number;
  tuning: AtlasTuning;
};

const DARK = { base: [0.078, 0.09, 0.106] as const, ink: [0.62, 0.66, 0.7] as const };
const LIGHT = { base: [0.953, 0.941, 0.918] as const, ink: [0.42, 0.39, 0.35] as const };

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
  const vertex = compile(gl, gl.VERTEX_SHADER, ATLAS_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, ATLAS_FRAGMENT);
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
  const names = ['uCssResolution', 'uBackingResolution', 'uTile', 'uLocalOrigin', 'uZoom', 'uSeedA', 'uSeedB', 'uSeedC', 'uBaseColor', 'uInkColor', 'uNoiseScales', 'uNoiseWeights', 'uDensityThresholds', 'uInkStrength', 'uDitherMode', 'uSmoothFade', 'uCells', 'uLodBlend'];
  const locations: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) locations[name] = gl.getUniformLocation(program, name);
  return { program, vao, locations };
}

export class AtlasRenderer {
  private raf = 0;
  private disposed = false;
  private lost = false;
  private drawn = '';
  private pending: AtlasScene | null = null;
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

  static create(canvas: HTMLCanvasElement, onUnavailable: () => void): AtlasRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
    const gpu = buildGpu(gl);
    if (!gpu) return null;
    return new AtlasRenderer(canvas, gl, gpu, onUnavailable);
  }

  setScene(scene: AtlasScene): void {
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
    const pixelScale = backing.width / Math.max(scene.cssWidth, 1);
    const resolved = resolveAtlas(scene.tuning, origin.zoom, pixelScale);
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
    gl.uniform3f(loc.uInkColor ?? null, palette.ink[0], palette.ink[1], palette.ink[2]);
    gl.uniform3f(loc.uNoiseScales ?? null, resolved.scales[0], resolved.scales[1], resolved.scales[2]);
    gl.uniform3f(loc.uNoiseWeights ?? null, resolved.weights[0], resolved.weights[1], resolved.weights[2]);
    gl.uniform2f(loc.uDensityThresholds ?? null, resolved.thresholds[0], resolved.thresholds[1]);
    gl.uniform1f(loc.uInkStrength ?? null, resolved.inkStrength);
    gl.uniform1i(loc.uDitherMode ?? null, resolved.mode);
    gl.uniform2f(loc.uSmoothFade ?? null, resolved.fade[0], resolved.fade[1]);
    gl.uniform2f(loc.uCells ?? null, resolved.cells[0], resolved.cells[1]);
    gl.uniform1f(loc.uLodBlend ?? null, resolved.blend);
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

function sceneKey(scene: AtlasScene): string {
  return atlasSceneKey({
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
