// Seeded RNG (mulberry32) with a few convenience helpers. DOM-free, deterministic.

export class RNG {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.s = (Math.floor(seed) >>> 0) || 0x9e3779b9;
    this._spare = null;
  }
  /** @returns {number} uniform in [0,1) */
  next() {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** uniform in [a,b) */
  range(a, b) { return a + (b - a) * this.next(); }
  /** integer in [0,n) */
  int(n) { return Math.floor(this.next() * n); }
  /** true with probability p */
  chance(p) { return this.next() < p; }
  /** Gaussian (Box-Muller) */
  gauss(mean = 0, sd = 1) {
    if (this._spare !== null) { const s = this._spare; this._spare = null; return mean + sd * s; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this._spare = m * Math.sin(2 * Math.PI * v);
    return mean + sd * m * Math.cos(2 * Math.PI * v);
  }
  /** pick an element */
  pick(arr) { return arr[this.int(arr.length)]; }
  /** weighted pick: items = [[value, weight], ...] */
  weighted(items) {
    let tot = 0;
    for (const it of items) tot += it[1];
    let r = this.next() * tot;
    for (const it of items) { r -= it[1]; if (r <= 0) return it[0]; }
    return items[items.length - 1][0];
  }
  /** independent child stream */
  fork() { return new RNG(Math.floor(this.next() * 4294967296)); }
}
