// Development stand-in for src/game/simulation.js. Same public interface (DESIGN.md §2), fake but plausible motion.
const NAMES = ['0', '15', '30', '40'];
const LOOKS = [
  { skin: '#e0a97c', hair: '#2a1d12', shirt: '#e23d3d', shorts: '#26376b', shoes: '#f0f0f0', headband: null },
  { skin: '#c98a5b', hair: '#101010', shirt: '#f2c230', shorts: '#1c2a46', shoes: '#f0f0f0', headband: '#ffffff' },
];

export class Simulation {
  constructor(opts = {}) {
    this.opts = opts;
    this.t = 0; this.events = []; this.paused = false;
    this.script = { phaseT: 0, hit: 0, n: 0, server: 0, rallyLen: 4 };
    const mkP = (i) => ({
      pos: { x: 0, z: i === 0 ? 13.2 : -13.2 }, vel: { x: 0, z: 0 }, facing: i === 0 ? 1 : -1, hand: i === 0 ? (opts.humanHand || 'R') : 'R',
      isHuman: i === 0, name: (opts.playerNames || ['你', 'AI'])[i], look: LOOKS[i],
      anim: { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0 }, racketHead: { x: 0, y: 1, z: 0 }, stamina: 1,
    });
    this.state = {
      time: 0, surface: opts.surface || 'hard',
      ball: { pos: { x: 0, y: 1, z: 13 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, visible: false, inPlay: false, bounces: 0, lastHitBy: -1, marks: [] },
      players: [mkP(0), mkP(1)],
      match: { phase: 'serve-prep', server: 0, serveCourt: 'deuce', faultCount: 0, points: [0, 0], games: [0, 0], sets: [], setsWon: [0, 0], isTiebreak: false, pointText: '0-0', winner: null, stats: { aces: [0, 0], doubleFaults: [0, 0], winners: [0, 0], unforcedErrors: [0, 0], firstServePct: [62, 58], maxServeKmh: [0, 0] } },
      lastShot: null, hint: { i: 0, reachable: false, side: 'fh', contactIn: null },
    };
    this.seg = null;
    this.startServe();
  }
  pause(b) { this.paused = !!b; }
  setMove() {} prepare() {} swing() {} serveToss() {}
  drainEvents() { const e = this.events; this.events = []; return e; }

  startServe() {
    const S = this.script, st = this.state;
    st.match.phase = 'serve-prep';
    S.phase = 'serve'; S.phaseT = 0; S.hit = 0;
    S.rallyLen = 3 + ((S.n * 7) % 5);
    const sv = S.server;
    st.match.server = sv;
    st.match.serveCourt = (st.match.points[0] + st.match.points[1]) % 2 === 0 ? 'deuce' : 'ad';
    const sx = st.match.serveCourt === 'deuce' ? 1 : -1;
    const P = st.players[sv];
    P.pos.x = sx * 1.6 * (sv === 0 ? 1 : -1); P.pos.z = sv === 0 ? 12.6 : -12.6;
    st.players[1 - sv].pos.x = -sx * 2 * (sv === 0 ? 1 : -1); st.players[1 - sv].pos.z = sv === 0 ? -12.8 : 12.8;
    st.ball.visible = true; st.ball.inPlay = false;
    this.seg = null;
  }

  pointText() {
    const m = this.state.match; const [a, b] = m.points;
    if (a >= 3 && b >= 3) return a === b ? 'DEUCE' : (a > b ? 'AD IN' : 'AD OUT');
    return `${NAMES[Math.min(3, a)]}-${NAMES[Math.min(3, b)]}`;
  }

  endPoint(winner, reason, call) {
    const st = this.state, m = st.match, S = this.script;
    if (call) this.events.push({ type: 'call', text: call });
    this.events.push({ type: 'point', winner, reason });
    m.points[winner]++;
    const [a, b] = m.points;
    let text = null;
    if ((a >= 4 || b >= 4) && Math.abs(a - b) >= 2) {
      m.points = [0, 0]; m.games[winner]++; text = 'GAME'; S.server = 1 - S.server;
      if (m.games[winner] >= 3) { m.sets.push([...m.games]); m.setsWon[winner]++; m.games = [0, 0]; text = 'SET'; }
      if (m.setsWon[winner] >= 2) { m.phase = 'match-over'; m.winner = winner; text = 'MATCH'; }
    }
    m.pointText = this.pointText();
    this.events.push({ type: 'score', text: text || m.pointText });
    st.ball.visible = false; st.ball.inPlay = false;
    S.phase = 'over'; S.phaseT = 0; S.winner = winner; S.n++;
    if (reason === 'ace') m.stats.aces[winner]++;
    else m.stats.winners[winner]++;
    if (m.phase !== 'match-over') m.phase = 'point-over';
  }

  launch(from, to, hitter, dur, shot) {
    // ball flight from player-contact to the next player's contact point
    const st = this.state;
    this.seg = { t0: this.t, dur, a: { ...from }, c: { ...to }, hitter, shot, bounced: false };
    st.ball.lastHitBy = hitter; st.ball.bounces = 0;
    const S = this.script;
    const near = Math.abs(to.z) < 5.5;
    const shots = ['topspin', 'topspin', 'slice', 'flat', 'lob', 'topspin'];
    const sh = near ? (S.hit % 2 ? 'volley' : 'smash') : shots[(S.hit + S.n) % shots.length];
    this.state.players[1 - hitter].swing = { tc: this.t + dur * 0.97, shot: sh, side: (S.hit + S.n) % 3 === 1 ? 'bh' : 'fh' };
    this.state.players[hitter].swing = this.state.players[hitter].swing && this.state.players[hitter].swing.tc > this.t - 0.3 ? this.state.players[hitter].swing : null;
  }

  step(dt) {
    if (this.paused) return;
    this.t += dt; const st = this.state, S = this.script; st.time = this.t;
    S.phaseT += dt;
    for (const mk of st.ball.marks) mk.age += dt;
    st.ball.marks = st.ball.marks.filter((m) => m.age < 40);
    const P = st.players;
    const idleAnim = (p, i) => { if (p.anim.name === 'swing' || p.anim.name === 'serve' || p.anim.name === 'run' || p.anim.name === 'split') p.anim = { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0 }; };
    if (S.phase === 'serve') {
      const sv = S.server, p = P[sv];
      const ph = Math.min(1, S.phaseT / 2.4);
      p.anim = { name: 'serve', shot: 'flat', side: null, phase: ph, dir: { x: 0, z: 0 }, speed: 0 };
      p.facing = sv === 0 ? 1 : -1;
      // toss
      const tossY = ph < 0.2 ? 1.0 : ph < 0.65 ? 1.0 + 1.9 * Math.sin(((ph - 0.2) / 0.45) * Math.PI * 0.5) : 2.5;
      st.ball.pos = { x: p.pos.x + 0.35, y: ph < 0.2 ? 1.0 : tossY, z: p.pos.z + (sv === 0 ? -0.4 : 0.4) };
      st.ball.vel = { x: 0, y: 0, z: 0 };
      if (ph >= 0.66) {
        const sgn = sv === 0 ? -1 : 1, c = { ...st.ball.pos };
        const tx = (st.match.serveCourt === 'deuce' ? -1 : 1) * 2.2 * sgn * -1;
        this.events.push({ type: 'serve', by: sv, speedKmh: 150 + (S.n * 13) % 50, pos: c });
        this.events.push({ type: 'hit', by: sv, shot: 'flat', side: 'fh', power: 0.9, quality: 0.8, speedKmh: 175, spinRpm: 800, pos: c });
        st.lastShot = { by: sv, shot: 'flat', side: 'fh', speedKmh: 150 + (S.n * 13) % 50, spinRpm: 800, quality: 0.8, timingMs: 5 };
        st.match.stats.maxServeKmh[sv] = Math.max(st.match.stats.maxServeKmh[sv], st.lastShot.speedKmh);
        S.phase = 'rally'; S.phaseT = 0; S.hit = 0;
        st.match.phase = 'rally'; st.ball.inPlay = true;
        const recv = P[1 - sv];
        this.launch(c, { x: tx, y: 0.9, z: recv.pos.z + (sv === 0 ? 0.8 : -0.8) }, sv, 1.15, 'flat');
        S.contactPos = [c, this.seg.c];
      }
    } else if (S.phase === 'rally' && this.seg) {
      const sg = this.seg, u = Math.min(1, (this.t - sg.t0) / sg.dur);
      const b = st.ball;
      b.pos.x = sg.a.x + (sg.c.x - sg.a.x) * u; b.pos.z = sg.a.z + (sg.c.z - sg.a.z) * u;
      const ub = 0.62;
      if (u < ub) { const s = u / ub; b.pos.y = sg.a.y * (1 - s) + 1.5 * 4 * s * (1 - s); }
      else { const s = (u - ub) / (1 - ub); b.pos.y = sg.c.y * s + 1.1 * 4 * s * (1 - s); }
      b.vel = { x: (sg.c.x - sg.a.x) / sg.dur, y: 0, z: (sg.c.z - sg.a.z) / sg.dur * (sg.hitter === 0 ? 1 : 1) };
      if (!sg.bounced && u >= ub) {
        sg.bounced = true; b.bounces = 1;
        const pos = { x: b.pos.x, y: 0, z: b.pos.z };
        b.marks.push({ x: pos.x, z: pos.z, age: 0 });
        this.events.push({ type: 'bounce', pos, in: true, court: 'singles' });
      }
      // receiver
      const rcv = 1 - sg.hitter, rp = P[rcv];
      const tC = sg.dur * 0.97;
      const tx = sg.c.x, tz = sg.c.z;
      const dx = tx - rp.pos.x, dz = tz - rp.pos.z, dist = Math.hypot(dx, dz);
      const timeLeft = Math.max(0.05, sg.t0 + tC - this.t);
      const spd = Math.min(6, dist / timeLeft);
      const sw0 = rp.swing && Math.abs(this.t - rp.swing.tc) < 0.3;
      if (dist > 0.05 && u < 0.97 && !sw0) {
        rp.vel = { x: dx / dist * spd, z: dz / dist * spd };
        rp.pos.x += rp.vel.x * dt; rp.pos.z += rp.vel.z * dt;
        rp.anim = { name: 'run', shot: null, side: null, phase: 0, dir: { x: dx / dist, z: dz / dist }, speed: Math.min(1, spd / 6) };
      } else rp.vel = { x: 0, z: 0 };
      if (rcv === 0) st.hint = { i: 0, reachable: u > 0.5, side: 'fh', contactIn: Math.max(0, sg.dur - (this.t - sg.t0)) };
      else st.hint = { i: 0, reachable: false, side: 'fh', contactIn: null };
      if (u >= 1) {
        // next hit
        S.hit++;
        const hp = rp;
        const hpos = { x: hp.pos.x + (rcv === 0 ? 0.5 : -0.5), y: 0.95, z: hp.pos.z };
        const shot = ['topspin', 'slice', 'flat', 'topspin', 'lob'][(S.hit + S.n) % 5];
        const side = (S.hit + S.n) % 3 === 1 ? 'bh' : 'fh';
        const spd = 90 + ((S.hit * 17 + S.n * 5) % 60);
        this.events.push({ type: 'hit', by: rcv, shot, side, power: 0.7, quality: 0.4 + ((S.hit * 37) % 60) / 100, speedKmh: spd, spinRpm: 1800 + S.hit * 300, pos: hpos });
        st.lastShot = { by: rcv, shot, side, speedKmh: spd, spinRpm: 1800 + S.hit * 300, quality: 0.4 + ((S.hit * 37) % 60) / 100, timingMs: -12 + S.hit * 5 };
        b.lastHitBy = rcv;
        if (S.hit >= S.rallyLen) {
          // finish: net / out / winner
          const kind = (S.n % 3);
          if (kind === 0) { this.events.push({ type: 'net', pos: { x: hpos.x, y: 0.8, z: 0 }, cord: false }); this.endPoint(1 - rcv, 'net'); }
          else if (kind === 1) { this.events.push({ type: 'bounce', pos: { x: 5.5, y: 0, z: rcv === 0 ? -9 : 9 }, in: false, court: null }); this.endPoint(1 - rcv, 'out', 'OUT'); }
          else this.endPoint(rcv, 'winner');
        } else {
          const tx2 = (((S.hit * 53 + S.n * 29) % 100) / 100 - 0.5) * 7;
          const tz2 = (rcv === 0 ? -1 : 1) * (11.2 - ((S.hit * 3) % 4) * 0.5);
          const op = P[1 - rcv];
          op.facing = rcv === 0 ? -1 : 1;
          // quick fake "opponent next contact" near its current spot
          const to = { x: tx2 * 0.9 + 0.3, y: 0.9, z: tz2 + (rcv === 0 ? -0.5 : 0.5) };
          this.launch(hpos, to, rcv, 0.9 + (spd > 130 ? -0.15 : 0.2), shot);
          // ball lands near "to" a bit before: fine for a stub
        }
      }
    } else if (S.phase === 'over') {
      const w = S.winner;
      P[w].anim = { name: 'celebrate', shot: null, side: null, phase: (S.phaseT * 1.5) % 1, dir: { x: 0, z: 0 }, speed: 0 };
      P[1 - w].anim = { name: S.phaseT < 1.8 ? 'dejected' : 'walk', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0.3 };
      if (S.phaseT > 3.2 && st.match.phase !== 'match-over') {
        for (const p of P) p.anim = { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0 };
        this.startServe();
      }
      if (st.match.phase === 'match-over' && S.phaseT > 3.2) { st.match.points = [0, 0]; st.match.games = [0, 0]; st.match.sets = []; st.match.setsWon = [0, 0]; st.match.winner = null; st.match.phase = 'point-over'; this.startServe(); }
    }
    for (let i = 0; i < 2; i++) {
      const p = P[i];
      if (p.swing && S.phase === 'rally') {
        const ph = 0.5 + (this.t - p.swing.tc) / 0.6;
        if (ph > 1) { p.swing = null; p.anim = { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0 }; }
        else if (ph >= 0) { p.anim = { name: 'swing', shot: p.swing.shot, side: p.swing.side, phase: ph, dir: { x: 0, z: 0 }, speed: 0 }; p.vel = { x: 0, z: 0 }; }
      }
    }
    // receiver anim when not running/swinging
    for (let i = 0; i < 2; i++) {
      const p = P[i];
      p.facing = i === 0 ? 1 : -1;
    }
    for (let i = 0; i < 2; i++) {
      const p = P[i];
      if (S.phase === 'rally' && this.seg && this.seg.hitter === i && p.anim.name === 'run' && !p.swing) p.anim = { name: 'ready', shot: null, side: null, phase: 0, dir: { x: 0, z: 0 }, speed: 0 };
    }
  }
}
