// Fully synthesized SFX via WebAudio — zero audio assets, instant load.

type AudioCtx = globalThis.AudioContext;

class SoundFX {
  private ctx: AudioCtx | null = null;
  private master: GainNode | null = null;
  muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.muted = window.localStorage.getItem("serp_muted") === "1";
    }
  }

  private ensure(): AudioCtx | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  unlock() {
    this.ensure();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (typeof window !== "undefined") window.localStorage.setItem("serp_muted", this.muted ? "1" : "0");
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  private env(gain: GainNode, t0: number, a: number, peak: number, d: number) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private osc(type: OscillatorType, freq: number, t0: number, dur: number, peak = 0.3, freqEnd?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    this.env(g, t0, 0.008, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(t0: number, dur: number, peak = 0.2, filterFreq = 3000, q = 1, filterEnd?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(filterFreq, t0);
    f.Q.value = q;
    if (filterEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, filterEnd), t0 + dur);
    const g = ctx.createGain();
    this.env(g, t0, 0.01, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  private now(): number {
    const ctx = this.ensure();
    return ctx ? ctx.currentTime : 0;
  }

  click() {
    const t = this.now();
    this.osc("triangle", 660, t, 0.06, 0.18);
    this.osc("sine", 990, t + 0.02, 0.05, 0.1);
  }

  diceRoll() {
    const t = this.now();
    for (let i = 0; i < 11; i++) {
      const dt = i * 0.055 + Math.random() * 0.01;
      this.noise(t + dt, 0.03, 0.22, 2600 + Math.random() * 1800, 2);
      this.osc("square", 180 + Math.random() * 120, t + dt, 0.03, 0.06);
    }
  }

  diceLand(v: number) {
    const t = this.now();
    this.osc("triangle", 300 + v * 60, t, 0.1, 0.25);
    this.osc("triangle", 450 + v * 60, t + 0.07, 0.12, 0.2);
  }

  hop(i: number) {
    const t = this.now();
    this.osc("sine", 340 + (i % 6) * 40, t, 0.07, 0.16);
    this.noise(t, 0.03, 0.05, 1800, 1.4);
  }

  land() {
    const t = this.now();
    this.osc("sine", 190, t, 0.12, 0.3, 90);
    this.noise(t, 0.06, 0.12, 900, 1);
  }

  ladder() {
    const t = this.now();
    const notes = [330, 415, 494, 659, 830];
    notes.forEach((n, i) => this.osc("triangle", n, t + i * 0.09, 0.16, 0.22));
    this.noise(t, 0.4, 0.04, 5000, 3, 8000);
  }

  hiss(dur = 0.8) {
    const t = this.now();
    this.noise(t, dur, 0.2, 6500, 2.2, 2400);
    this.noise(t + dur * 0.2, dur * 0.6, 0.1, 4200, 3, 1400);
  }

  /** Cartoon gulp: deep glug + bubble pops. */
  gulp() {
    const t = this.now();
    this.osc("sine", 340, t, 0.28, 0.35, 70);
    this.osc("sine", 130, t + 0.05, 0.22, 0.3, 55);
    this.osc("sine", 90, t + 0.3, 0.12, 0.25, 160);
    this.osc("sine", 120, t + 0.42, 0.1, 0.22, 240);
    this.noise(t + 0.05, 0.2, 0.12, 500, 1.4, 200);
  }

  /** Bubbly wobble while the swallowed token travels inside the snake. */
  bulgeTravel() {
    const t = this.now();
    for (let i = 0; i < 6; i++) {
      const dt = i * 0.07;
      this.osc("sine", 90 + Math.random() * 60, t + dt, 0.06, 0.16, 180 + Math.random() * 120);
    }
    this.noise(t, 0.4, 0.06, 400, 1, 900);
  }

  pop() {
    const t = this.now();
    this.noise(t, 0.05, 0.28, 1400, 1.2);
    this.osc("sine", 520, t, 0.09, 0.22, 780);
    this.osc("sine", 240, t + 0.04, 0.1, 0.2, 120);
  }

  slideWhistle() {
    const t = this.now();
    this.osc("sine", 900, t, 0.55, 0.18, 220);
    this.osc("sine", 1400, t, 0.45, 0.08, 300);
  }

  shakeThud() {
    const t = this.now();
    this.osc("sine", 120, t, 0.18, 0.35, 40);
    this.noise(t, 0.12, 0.18, 300, 1);
  }

  turnDing() {
    const t = this.now();
    this.osc("sine", 780, t, 0.12, 0.16);
    this.osc("sine", 1170, t + 0.06, 0.14, 0.14);
  }

  win() {
    const t = this.now();
    const seq = [523, 659, 784, 1047, 784, 1047, 1319];
    seq.forEach((n, i) => {
      this.osc("triangle", n, t + i * 0.11, 0.22, 0.24);
      this.osc("sine", n * 2, t + i * 0.11, 0.18, 0.08);
    });
    this.noise(t + 0.7, 0.8, 0.06, 9000, 2, 4000);
  }

  fireAlarm() {
    const t = this.now();
    this.osc("sawtooth", 220, t, 0.14, 0.1, 340);
    this.osc("sawtooth", 220, t + 0.18, 0.14, 0.1, 340);
  }
}

export const sfx = new SoundFX();
