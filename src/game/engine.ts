// Shared WebGL engine: one renderer + optional bloom composer, swapping between scene modules.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface SceneModule {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bloom?: { strength: number; radius: number; threshold: number };
  update(dt: number, t: number): void;
  dispose(): void;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly isMobile: boolean;
  fps = 60;
  qualityLevel = 0;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bloomOn = false;
  private active: SceneModule | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private w = 0;
  private h = 0;
  private basePR = 1;
  private pr = 1;
  private frames = 0;
  private fpsClock = 0;
  private warm = 0;
  private running = false;
  private ro: ResizeObserver | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.isMobile =
      (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) ||
      /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !(this.isMobile && dpr >= 2),
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x05030c, 1);
    this.basePR = Math.min(dpr, this.isMobile ? 1.5 : 2);
    this.pr = this.basePR;
    this.renderer.setPixelRatio(this.pr);

    if (!this.isMobile) this.initComposer();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  private initComposer() {
    try {
      const size = new THREE.Vector2();
      this.renderer.getDrawingBufferSize(size);
      const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.6, 0.85);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
      this.bloomOn = true;
    } catch {
      this.composer = null;
      this.bloomOn = false;
    }
  }

  get drawHeight() {
    return this.canvas.height || 600;
  }

  private resize = () => {
    const w = Math.max(2, this.canvas.clientWidth);
    const h = Math.max(2, this.canvas.clientHeight);
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pr);
      this.composer.setSize(w, h);
    }
    if (this.active) {
      this.active.camera.aspect = w / h;
      this.active.camera.updateProjectionMatrix();
    }
  };

  setScene(m: SceneModule | null) {
    this.active = m;
    if (m) {
      m.camera.aspect = this.w / this.h;
      m.camera.updateProjectionMatrix();
      if (this.bloomPass && m.bloom) {
        this.bloomPass.strength = m.bloom.strength;
        this.bloomPass.radius = m.bloom.radius;
        this.bloomPass.threshold = m.bloom.threshold;
      }
    }
    this.warm = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private degrade() {
    this.qualityLevel++;
    if (this.qualityLevel === 1) {
      this.pr = Math.max(1, this.basePR * 0.75);
    } else if (this.qualityLevel === 2) {
      this.bloomOn = false;
      this.renderer.shadowMap.enabled = false;
    } else if (this.qualityLevel === 3) {
      this.pr = Math.max(0.75, this.pr * 0.8);
    } else return;
    this.w = 0;
    this.resize();
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.05, raw);
    this.time += dt;
    const m = this.active;
    if (!m) return;

    // adaptive quality: sample fps once the scene has warmed up
    if (raw < 0.25) {
      this.warm += raw;
      if (this.warm > 2) {
        this.frames++;
        this.fpsClock += raw;
        if (this.fpsClock >= 1.5) {
          this.fps = this.frames / this.fpsClock;
          if (this.fps < 40 && this.qualityLevel < 3) this.degrade();
          this.frames = 0;
          this.fpsClock = 0;
        }
      }
    }

    m.update(dt, this.time);
    if (this.composer && this.renderPass && this.bloomOn) {
      this.renderPass.scene = m.scene;
      this.renderPass.camera = m.camera;
      this.composer.render(dt);
    } else {
      this.renderer.render(m.scene, m.camera);
    }
  };

  dispose() {
    this.stop();
    window.removeEventListener("resize", this.resize);
    this.ro?.disconnect();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
