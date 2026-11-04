// WebAudio-synthesised sound: racket hits, bounces, net, crowd bed + applause, optional English umpire calls.
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const PT = { 0: 'love', 15: 'fifteen', 30: 'thirty', 40: 'forty' };

export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false; this.volume = 0.8;
    this.speechOn = false; this.surface = 'hard';
    this.noiseBuf = null; this.crowdGain = null; this.excite = 0;
    this._lastSquawk = 0;
  }

  // must be called from a user gesture (first click / key)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // wait for a real gesture
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.startCrowd();
    } catch (e) { this.ctx = null; }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; if (m && window.speechSynthesis) speechSynthesis.cancel(); }
  setVolume(v) { this.volume = v; if (this.master && !this.muted) this.master.gain.value = v; }
  setSurface(s) { this.surface = s; }

  _noise(dur, { type = 'bandpass', freq = 1500, q = 1, gain = 0.5, attack = 0.002, decay = dur, pan = 0, when = 0 } = {}) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    let out = g;
    src.connect(f); f.connect(g);
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(this.master);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + attack + decay + 0.05);
  }
  _tone(freq, dur, { type = 'sine', gain = 0.3, endFreq = null, pan = 0, when = 0, attack = 0.002 } = {}) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    let out = g;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  _pan(pos) { return pos ? Math.max(-0.8, Math.min(0.8, pos.x / 9)) : 0; }
  _dist(pos) { return pos ? (pos.z < 0 ? 0.72 : 1) : 1; }

  hit(e = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const pw = Math.max(0.15, Math.min(1, e.power == null ? 0.6 : e.power));
    const pan = this._pan(e.pos), v = this._dist(e.pos);
    const shot = e.shot || 'topspin';
    const q = e.quality == null ? 0.7 : e.quality;
    let nf = 2200, tf = 260, tg = 0.4, dec = 0.05;
    if (shot === 'slice') { nf = 1500; tf = 200; tg = 0.3; dec = 0.06; }
    else if (shot === 'flat') { nf = 2800; tf = 300; tg = 0.5; }
    else if (shot === 'lob') { nf = 1400; tf = 210; tg = 0.28; dec = 0.07; }
    else if (shot === 'volley') { nf = 2400; tf = 280; tg = 0.35; dec = 0.035; }
    else if (shot === 'smash') { nf = 3000; tf = 190; tg = 0.65; dec = 0.07; }
    const A = (0.35 + 0.65 * pw) * v;
    this._noise(0.012 + dec, { freq: nf * (0.9 + q * 0.2), q: 0.9, gain: 0.7 * A, decay: dec, pan });
    this._noise(0.03, { type: 'highpass', freq: 4500, q: 0.4, gain: 0.25 * A * q, decay: 0.03, pan });
    this._tone(tf * (0.9 + pw * 0.2), 0.09, { gain: tg * A, endFreq: tf * 0.55, pan });
    this._tone(900 + q * 500, 0.14, { type: 'triangle', gain: 0.07 * A * q, endFreq: 780, pan }); // string ping
    if (e.type === 'serve' || shot === 'smash') this._noise(0.15, { type: 'lowpass', freq: 500, gain: 0.2 * A, decay: 0.15, pan });
  }

  bounce(e = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const pan = this._pan(e.pos), v = this._dist(e.pos);
    const s = this.surface;
    if (s === 'clay') {
      this._noise(0.1, { type: 'lowpass', freq: 700, q: 0.7, gain: 0.5 * v, decay: 0.08, pan });
      this._tone(130, 0.07, { gain: 0.25 * v, endFreq: 80, pan });
    } else if (s === 'grass') {
      this._noise(0.08, { type: 'lowpass', freq: 420, q: 0.6, gain: 0.4 * v, decay: 0.07, pan });
      this._tone(110, 0.06, { gain: 0.18 * v, endFreq: 70, pan });
    } else {
      this._noise(0.06, { type: 'bandpass', freq: 1400, q: 1.1, gain: 0.55 * v, decay: 0.05, pan });
      this._tone(190, 0.06, { gain: 0.32 * v, endFreq: 120, pan });
    }
    if (e.in === false) this._noise(0.02, { type: 'highpass', freq: 5000, gain: 0.05, decay: 0.02, pan });
  }

  net(e = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const pan = this._pan(e.pos);
    for (let i = 0; i < 4; i++) this._noise(0.09, { type: 'bandpass', freq: 900 + Math.random() * 500, q: 2, gain: 0.25 / (1 + i * 0.6), decay: 0.08, pan, when: i * 0.035 });
    this._tone(150, 0.12, { gain: 0.15, endFreq: 90, pan });
    if (e.cord) this._tone(1800, 0.08, { gain: 0.1, pan });
  }

  squeak() {
    if (!this.ctx || this.ctx.state !== 'running' || this.surface !== 'hard') return;
    const now = this.ctx.currentTime;
    if (now - this._lastSquawk < 0.25) return;
    this._lastSquawk = now;
    this._tone(1400 + Math.random() * 500, 0.07, { type: 'square', gain: 0.025, endFreq: 2400 });
  }

  // crowd ----------------------------------------------------------------
  startCrowd() {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.45;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0.05;
    src.connect(bp); bp.connect(lp); lp.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
    // slow swell LFO
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    const lg = c.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(this.crowdGain.gain); lfo.start();
    this._crowdBP = bp;
  }
  applause(strength = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t0 = c.currentTime, dur = 1.6 + strength * 2.0;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = 1.3;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
    const g = c.createGain(); g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.16 * strength, t0 + 0.25);
    // clap texture: random gain flutter
    for (let t = 0.25; t < dur; t += 0.045) g.gain.linearRampToValueAtTime((0.05 + Math.random() * 0.13) * strength * (1 - t / (dur * 1.05)), t0 + t);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.1);
    // cheering swell
    if (strength > 0.5) this._noise(dur, { type: 'bandpass', freq: 900, q: 0.8, gain: 0.12 * strength, attack: 0.3, decay: dur - 0.3 });
  }
  ooh() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this._noise(0.9, { type: 'bandpass', freq: 650, q: 1.2, gain: 0.1, attack: 0.15, decay: 0.7 });
    this._tone(330, 0.8, { type: 'sawtooth', gain: 0.012, endFreq: 240, attack: 0.15 });
  }

  // umpire ---------------------------------------------------------------
  say(text, rate = 0.95) {
    if (!this.speechOn || this.muted || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB'; u.rate = rate; u.pitch = 0.9; u.volume = Math.min(1, this.volume);
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  scoreToWords(text, server) {
    if (!text) return null;
    if (text === 'DEUCE') return 'Deuce';
    if (text === 'AD IN') return 'Advantage server';
    if (text === 'AD OUT') return 'Advantage receiver';
    const m = /^(\d+)-(\d+)$/.exec(text);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    if ([0, 15, 30, 40].includes(a) && [0, 15, 30, 40].includes(b) && (a > 10 || b > 10 || a === 0 || b === 0)) {
      if (a === b) return `${PT[a]} all`;
      return `${PT[a]} ${PT[b]}`;
    }
    if (a === b) return `${NUM[a] || a} all`;
    return `${NUM[a] || a} ${NUM[b] || b}`;
  }

  handleEvents(events, state) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let calledOut = false;
    for (const e of events) {
      switch (e.type) {
        case 'hit': if (!e.serve) this.hit(e); break;
        case 'serve': this.hit({ ...e, type: 'serve', shot: 'smash', power: 0.95, pos: e.pos, quality: 0.8 }); break;
        case 'bounce': this.bounce(e); break;
        case 'net': this.net(e); this.ooh(); break;
        case 'point': this.applause(e.winner === 0 ? 1 : 0.65); break;
        case 'call': {
          const map = { OUT: 'Out', FAULT: 'Fault', 'DOUBLE FAULT': 'Double fault', LET: 'Let', 'NOT UP': 'Not up', ACE: '' };
          if (map[e.text]) this.say(map[e.text], 1.0);
          if (e.text === 'ACE') this.applause(0.9);
          calledOut = true;
          break;
        }
        case 'score': {
          if (e.text === 'GAME') this.say('Game');
          else if (e.text === 'SET') this.say('Game and set');
          else if (e.text === 'MATCH') this.say('Game, set and match');
          else { const w = this.scoreToWords(e.text); if (w) this.say(w); }
          break;
        }
        case 'whiff': this._noise(0.12, { type: 'bandpass', freq: 700, gain: 0.12, decay: 0.1 }); break;
        default: break;
      }
    }
  }
}
