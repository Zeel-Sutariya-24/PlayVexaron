// Spell and interface sounds use a WebAudio synth; menu and battle music use separate bundled tracks.
import type { ElementId, SpellType } from "./elements";

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  slide?: number;
  delay?: number;
  attack?: number;
}
interface NoiseOpts {
  vol?: number;
  freq?: number;
  q?: number;
  filter?: BiquadFilterType;
  slide?: number;
  delay?: number;
  attack?: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private menuTrack: HTMLAudioElement | null = null;
  private battleTrack: HTMLAudioElement | null = null;
  private musicMode: "menu" | "battle" | null = null;
  private musicVolume = 0.8;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  private lastHitAt = 0;

  init() {
    if (typeof window === "undefined") return;
    if (!this.menuTrack) {
      this.menuTrack = new Audio("/music/home-menu.mp3");
      this.menuTrack.preload = "auto";
      this.menuTrack.loop = true;
      this.menuTrack.muted = this.muted;
    }
    if (!this.battleTrack) {
      this.battleTrack = new Audio("/music/hit-me-where-it-hurts.mp3");
      this.battleTrack.preload = "auto";
      this.battleTrack.loop = true;
      this.battleTrack.muted = this.muted;
    }
    this.applyMusicVolumes();
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
    if (this.menuTrack) this.menuTrack.muted = m;
    if (this.battleTrack) this.battleTrack.muted = m;
  }

  setMusicVolume(volume: number) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.applyMusicVolumes();
  }

  isMuted() {
    return this.muted;
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + (o.delay ?? 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t0 + dur);
    const vol = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, o: NoiseOpts = {}) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + (o.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = o.filter ?? "bandpass";
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.slide), t0 + dur);
    f.Q.value = o.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.2, t0 + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  // ---- UI -------------------------------------------------------------
  ui() {
    this.tone(660, 0.08, { type: "triangle", vol: 0.12 });
  }
  select() {
    this.tone(520, 0.07, { type: "triangle", vol: 0.1 });
    this.tone(780, 0.09, { type: "triangle", vol: 0.08, delay: 0.04 });
  }
  deny() {
    this.tone(160, 0.18, { type: "square", vol: 0.1, slide: 100 });
  }
  pick(el: ElementId) {
    const f = { fire: 330, water: 392, wind: 523, earth: 262 }[el];
    this.tone(f, 0.25, { type: "triangle", vol: 0.14 });
    this.tone(f * 1.5, 0.3, { type: "sine", vol: 0.08, delay: 0.05 });
    this.noise(0.15, { freq: 2000, vol: 0.04 });
  }
  forge() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, { type: "triangle", vol: 0.12, delay: i * 0.06, attack: 0.02 }));
    this.noise(0.5, { freq: 3000, q: 0.6, vol: 0.1, slide: 800 });
    this.tone(90, 0.6, { type: "sine", vol: 0.3, slide: 40 });
  }
  tick(n: number) {
    this.tone(n === 0 ? 880 : 440, n === 0 ? 0.5 : 0.15, { type: "triangle", vol: 0.16 });
  }

  // ---- Combat ---------------------------------------------------------
  cast(type: SpellType, elements: ElementId | readonly ElementId[], power = 0, mine = true) {
    const els: readonly ElementId[] = typeof elements === "string" ? [elements] : elements;
    const el = els[0] ?? "fire";
    const second = els[1] ?? el;
    const note = (e: ElementId) => ({ fire: 330, water: 440, wind: 620, earth: 150 })[e];
    const v = mine ? 1 : 0.65;
    const p = 1 + power * 0.6;
    if (type === "ball") {
      this.noise(0.3, { freq: 420, slide: 1900, q: 0.8, vol: 0.2 * v });
      this.tone(note(el) * 0.72, 0.28, { type: el === "earth" ? "sine" : "triangle", vol: 0.13 * v, slide: note(el) * (el === "water" ? 2.1 : 1.35) });
      this.noise(0.16, { freq: note(el) * 4, filter: el === "fire" || el === "wind" ? "highpass" : "bandpass", slide: note(second) * 5, vol: 0.08 * v, delay: 0.025 });
      this.tone(note(second) * p, 0.2, { type: "sine", vol: 0.055 * v, slide: note(second) * 1.8, delay: 0.04 });
    } else if (type === "slash") {
      this.noise(0.17, { freq: 7200, slide: 900, q: 0.55, vol: 0.3 * v, filter: "highpass" });
      this.noise(0.12, { freq: 1100, slide: 4200, q: 0.9, vol: 0.12 * v, filter: "bandpass", delay: 0.025 });
      this.tone(note(el) * 2.1, 0.16, { type: "triangle", vol: 0.09 * v, slide: note(second) * 0.8, delay: 0.015 });
    } else {
      this.tone(58, 0.62, { type: "sine", vol: 0.38 * v, slide: 34 });
      this.noise(0.52, { freq: 130, filter: "lowpass", vol: 0.34 * v, slide: 520 });
      this.noise(0.24, { freq: note(el), filter: "bandpass", q: 0.65, vol: 0.13 * v, slide: note(second) * 1.8, delay: 0.07 });
      this.tone(note(second) * 0.5, 0.32, { type: "triangle", vol: 0.055 * v, slide: note(second) * 0.8, delay: 0.1 });
    }
  }
  hit(dmg: number, mine: boolean, type: SpellType = "ball") {
    const now = performance.now();
    if (now - this.lastHitAt < 40) return;
    this.lastHitAt = now;
    const v = Math.min(1, 0.4 + dmg / 30);
    this.tone(mine ? 140 : 110, 0.22, { type: "square", vol: 0.14 * v, slide: 50 });
    this.noise(0.18, { freq: 900, q: 0.7, vol: 0.28 * v, slide: 200 });
    if (type === "slash") this.noise(0.11, { freq: 5200, filter: "highpass", q: 0.7, vol: 0.11 * v });
    else if (type === "wall") this.tone(72, 0.2, { type: "sine", vol: 0.16 * v, slide: 38 });
  }
  hurt(dmg: number) {
    this.tone(100, 0.35, { type: "sawtooth", vol: 0.2, slide: 45 });
    this.noise(0.3, { freq: 500, filter: "lowpass", vol: 0.3 * Math.min(1, 0.4 + dmg / 25), slide: 120 });
  }
  impact(el: ElementId) {
    if (el === "fire") this.noise(0.4, { freq: 1800, slide: 300, vol: 0.2 });
    else if (el === "water") this.noise(0.35, { freq: 1200, slide: 3000, q: 0.5, vol: 0.18 });
    else if (el === "wind") this.noise(0.4, { freq: 4000, filter: "highpass", vol: 0.12 });
    else this.noise(0.4, { freq: 260, filter: "lowpass", vol: 0.35, slide: 80 });
  }
  clash() {
    this.tone(1200, 0.2, { type: "triangle", vol: 0.12, slide: 400 });
    this.noise(0.2, { freq: 3000, vol: 0.14 });
  }
  wallHit() {
    this.noise(0.15, { freq: 400, filter: "lowpass", vol: 0.25, slide: 150 });
    this.tone(160, 0.12, { type: "square", vol: 0.08 });
  }
  wallBreak() {
    this.noise(0.6, { freq: 700, slide: 100, q: 0.5, vol: 0.4 });
    this.tone(60, 0.5, { type: "sine", vol: 0.3, slide: 30 });
  }
  dash() {
    this.noise(0.25, { freq: 1500, slide: 4000, q: 0.5, vol: 0.16, filter: "bandpass" });
  }
  dodge() {
    this.tone(880, 0.12, { type: "triangle", vol: 0.12 });
    this.tone(1320, 0.18, { type: "triangle", vol: 0.1, delay: 0.07 });
  }
  deflect() {
    this.tone(1500, 0.3, { type: "triangle", vol: 0.15, slide: 600 });
    this.noise(0.25, { freq: 4000, vol: 0.18 });
  }
  interrupt() {
    this.tone(300, 0.25, { type: "sawtooth", vol: 0.12, slide: 80 });
  }
  noMana() {
    this.tone(220, 0.14, { type: "square", vol: 0.08, slide: 160 });
  }
  combo() {
    this.tone(660, 0.12, { type: "triangle", vol: 0.12 });
    this.tone(990, 0.2, { type: "triangle", vol: 0.12, delay: 0.07 });
  }
  win() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.7, { type: "triangle", vol: 0.16, delay: i * 0.12 }));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.8, { type: "sawtooth", vol: 0.1, delay: i * 0.16, slide: f * 0.9 }));
  }

  // ---- Charge loop ----------------------------------------------------
  chargeStart() {
    if (!this.ctx || !this.master || this.chargeOsc) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 110;
    g.gain.value = 0.0001;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 600;
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start();
    g.gain.setTargetAtTime(0.07, this.ctx.currentTime, 0.05);
    this.chargeOsc = osc;
    this.chargeGain = g;
  }
  chargeUpdate(t01: number) {
    if (!this.ctx || !this.chargeOsc) return;
    this.chargeOsc.frequency.setTargetAtTime(110 + t01 * 330, this.ctx.currentTime, 0.05);
  }
  chargeStop() {
    if (!this.ctx || !this.chargeOsc || !this.chargeGain) return;
    const o = this.chargeOsc;
    this.chargeGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
    o.stop(this.ctx.currentTime + 0.2);
    this.chargeOsc = null;
    this.chargeGain = null;
  }

  // ---- Ambient --------------------------------------------------------
  menuMusic(on: boolean) {
    if (!on) {
      this.menuTrack?.pause();
      return;
    }
    this.playMusic("menu");
  }

  battleMusic() {
    this.playMusic("battle");
  }

  private playMusic(mode: "menu" | "battle") {
    if (typeof window === "undefined") return;
    this.init();
    const track = mode === "menu" ? this.menuTrack : this.battleTrack;
    if (!track) return;
    const changed = this.musicMode !== mode;
    this.musicMode = mode;
    if (mode === "menu") this.battleTrack?.pause();
    else this.menuTrack?.pause();
    track.loop = true;
    this.applyMusicVolumes();
    track.muted = this.muted;
    if (changed) track.currentTime = 0;
    void track.play().catch(() => {
      // Autoplay can be denied until a player interacts with the page.
    });
  }

  private applyMusicVolumes() {
    if (this.menuTrack) this.menuTrack.volume = this.musicVolume * 0.28;
    if (this.battleTrack) this.battleTrack.volume = this.musicVolume * 0.72;
  }
}

export const sfx = new AudioEngine();
