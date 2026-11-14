import { atlasOrigin, backingSize, type AtlasViewport } from './atlas-math';
import { seedVectors } from './atlas-seed';
import { ATLAS_FRAGMENT, ATLAS_VERTEX } from './atlas-shader';

export type AtlasScene = {
  viewport: AtlasViewport;
  cssWidth: number;
  cssHeight: number;
  seed: number;
  appearance: 'dark' | 'light';
};

const DARK = { base: [0.078, 0.09, 0.106] as const, ink: [0.62, 0.66, 0.7] as const };
const LIGHT = { base: [0.953, 0.941, 0.918] as const, ink: [0.42, 0.39, 0.35] as const };

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

export class AtlasRenderer {
  private raf = 0;
  private disposed = false;
  private lost = false;
  private drawn = '';
  private pending: AtlasScene | null = null;
  private readonly locations: Record<string, WebGLUniformLocation | null>;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
    private readonly vao: WebGLVertexArrayObject,
  ) {
    this.locations = {
      css: gl.getUniformLocation(program, 'uCssResolution'),
      backing: gl.getUniformLocation(program, 'uBackingResolution'),
      tile: gl.getUniformLocation(program, 'uTile'),
      local: gl.getUniformLocation(program, 'uLocalOrigin'),
      zoom: gl.getUniformLocation(program, 'uZoom'),
      seedA: gl.getUniformLocation(program, 'uSeedA'),
      seedB: gl.getUniformLocation(program, 'uSeedB'),
      seedC: gl.getUniformLocation(program, 'uSeedC'),
      base: gl.getUniformLocation(program, 'uBaseColor'),
      ink: gl.getUniformLocation(program, 'uInkColor'),
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  static create(canvas: HTMLCanvasElement): AtlasRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return null;
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
    return new AtlasRenderer(canvas, gl, program, vao);
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
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }

  private draw(): void {
    const scene = this.pending;
    if (!scene || this.disposed || this.lost || document.hidden) return;
    const key = sceneKey(scene);
    if (key === this.drawn) return;
    const backing = backingSize(scene.cssWidth, scene.cssHeight, window.devicePixelRatio || 1);
    if (this.canvas.width !== backing.width || this.canvas.height !== backing.height) {
      this.canvas.width = backing.width;
      this.canvas.height = backing.height;
    }
    const origin = atlasOrigin(scene.viewport);
    const seeds = seedVectors(scene.seed);
    const palette = scene.appearance === 'light' ? LIGHT : DARK;
    const gl = this.gl;
    gl.viewport(0, 0, backing.width, backing.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.locations.css, scene.cssWidth, scene.cssHeight);
    gl.uniform2f(this.locations.backing, backing.width, backing.height);
    gl.uniform2f(this.locations.tile, origin.tileX, origin.tileY);
    gl.uniform2f(this.locations.local, origin.localX, origin.localY);
    gl.uniform1f(this.locations.zoom, origin.zoom);
    gl.uniform2f(this.locations.seedA, seeds.a[0], seeds.a[1]);
    gl.uniform2f(this.locations.seedB, seeds.b[0], seeds.b[1]);
    gl.uniform2f(this.locations.seedC, seeds.c[0], seeds.c[1]);
    gl.uniform3f(this.locations.base, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.locations.ink, palette.ink[0], palette.ink[1], palette.ink[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawn = key;
  }

  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  private onRestored = () => {
    this.lost = false;
    this.drawn = '';
    if (this.pending) this.setScene(this.pending);
  };
}

function sceneKey(scene: AtlasScene): string {
  return [scene.viewport.x, scene.viewport.y, scene.viewport.zoom, scene.cssWidth, scene.cssHeight, scene.seed, scene.appearance].join(':');
}
