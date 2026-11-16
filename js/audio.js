// Procedural WebAudio: gunshots, footsteps, impacts, UI and bomb beeps. No sample files.
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.7; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const c = this.ctx; this.master = c.createGain(); this.master.gain.value = this.vol;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 6; this.master.connect(this.comp); this.comp.connect(c.destination);
    const len = c.sampleRate * 1.5; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // short reverb for the warehouse
    const rl = c.sampleRate * 1.6, ir = c.createBuffer(2, rl, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); for (let i = 0; i < rl; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2); }
    this.verb = c.createConvolver(); this.verb.buffer = ir; this.verbGain = c.createGain(); this.verbGain.gain.value = 0.22; this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  listener(pos, fwd) {
    if (!this.ctx) return; const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t); L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t); L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t); }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  out(pos, gain = 1, ref = 4, wet = true) { // returns input node routed (optionally spatial) to master
    const c = this.ctx, g = c.createGain(); g.gain.value = gain;
    if (pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 120; if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z); g.connect(p); p.connect(this.master); if (wet) p.connect(this.verb); }
    else { g.connect(this.master); if (wet) g.connect(this.verb); }
    return g;
  }
  noiseSrc(dur, offset = Math.random()) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.start(this.ctx.currentTime, offset, dur + 0.05); return s; }
  gun(spec, pos, local) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = this.out(local ? null : pos, local ? 0.55 : 1.0, 6);
    const n = this.noiseSrc(spec.d), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(local ? 7000 : 4500, t); f.frequency.exponentialRampToValueAtTime(600, t + spec.d);
    const ng = c.createGain(); ng.gain.setValueAtTime(spec.n * 2.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + spec.d); n.connect(f); f.connect(ng); ng.connect(o);
    const os = c.createOscillator(); os.type = 'triangle'; os.frequency.setValueAtTime(spec.f, t); os.frequency.exponentialRampToValueAtTime(spec.f * 0.35, t + 0.12);
    const og = c.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14); os.connect(og); og.connect(o); os.start(t); os.stop(t + 0.16);
    const cr = c.createBiquadFilter(); cr.type = 'highpass'; cr.frequency.value = 2500; const cn = this.noiseSrc(0.03), cg = c.createGain(); cg.gain.setValueAtTime(0.8, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03); cn.connect(cr); cr.connect(cg); cg.connect(o);
  }
  step(pos, local, soft) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = this.out(local ? null : pos, (local ? 0.14 : 0.5) * (soft ? 0.4 : 1), 2, false);
    const n = this.noiseSrc(0.07), f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 300; f.Q.value = 1.2;
    const g = c.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07); n.connect(f); f.connect(g); g.connect(o);
  }
  impact(pos, flesh) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = this.out(pos, flesh ? 0.5 : 0.35, 2);
    const n = this.noiseSrc(0.06), f = c.createBiquadFilter(); f.type = flesh ? 'lowpass' : 'bandpass'; f.frequency.value = flesh ? 900 : 2800 + Math.random() * 1500;
    const g = c.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + (flesh ? 0.09 : 0.05)); n.connect(f); f.connect(g); g.connect(o);
  }
  tone(freq, dur, type = 'sine', gain = 0.25, pos = null, slide = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = this.out(pos, gain, 5, !!pos), os = c.createOscillator(); os.type = type; os.frequency.setValueAtTime(freq, t); if (slide) os.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); os.connect(g); g.connect(o); os.start(t); os.stop(t + dur + 0.02);
  }
  hitmarker(head) { this.tone(head ? 1800 : 1250, 0.06, 'square', head ? 0.12 : 0.08); }
  hurt() { this.tone(220, 0.18, 'sawtooth', 0.12, null, 0.6); }
  click() { this.tone(900, 0.03, 'square', 0.06); }
  buy() { this.tone(660, 0.05, 'triangle', 0.12); setTimeout(() => this.tone(990, 0.07, 'triangle', 0.1), 50); }
  empty() { this.tone(1500, 0.02, 'square', 0.08); }
  reload(pos, local) { if (!this.ctx) return; this.tone(420, 0.05, 'square', local ? 0.08 : 0.15, local ? null : pos); setTimeout(() => this.tone(300, 0.07, 'square', local ? 0.1 : 0.15, local ? null : pos), 380); }
  beep(pos) { this.tone(2100, 0.09, 'square', 0.22, pos); }
  explosion(pos, big) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, d = big ? 2.2 : 1.1, o = this.out(pos, big ? 2.4 : 1.4, big ? 14 : 8);
    const n = this.noiseSrc(d), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(120, t + d);
    const g = c.createGain(); g.gain.setValueAtTime(1.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); n.connect(f); f.connect(g); g.connect(o);
    const os = c.createOscillator(); os.frequency.setValueAtTime(90, t); os.frequency.exponentialRampToValueAtTime(30, t + d * 0.6); const og = c.createGain(); og.gain.setValueAtTime(1.4, t); og.gain.exponentialRampToValueAtTime(0.001, t + d * 0.6); os.connect(og); og.connect(o); os.start(t); os.stop(t + d);
  }
  hiss(pos) { if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = this.out(pos, 0.35, 4), n = this.noiseSrc(1.4), f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000; const g = c.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4); n.connect(f); f.connect(g); g.connect(o); }
  flashRing() { if (!this.ctx) return; this.tone(3600, 2.6, 'sine', 0.18); }
  roundStart() { this.tone(523, 0.12, 'triangle', 0.18); setTimeout(() => this.tone(784, 0.2, 'triangle', 0.18), 130); }
  roundEnd(win) { const seq = win ? [523, 659, 784, 1046] : [523, 415, 349]; seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.2), i * 140)); }
  heartbeat() { this.tone(70, 0.12, 'sine', 0.35); setTimeout(() => this.tone(60, 0.14, 'sine', 0.28), 160); }
}
export const audio = new Audio();
