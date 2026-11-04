// Pure tennis scoring: points / deuce / advantage, games, sets, tiebreak (to 7 by 2), server rotation,
// deuce/ad courts, changeovers. No physics, DOM-free.

const CALL = ['0', '15', '30', '40'];

/**
 * @typedef {{sets:number, gamesPerSet:number, tiebreak:boolean, shortGames:boolean}} MatchFormat
 *  gamesPerSet 0 = a single tiebreak decides the set ("抢七"). shortGames = no-ad scoring (sudden death at 40-40).
 */
export const DEFAULT_FORMAT = Object.freeze({ sets: 1, gamesPerSet: 6, tiebreak: true, shortGames: false });

export class Match {
  /** @param {Partial<MatchFormat>} format @param {0|1} firstServer */
  constructor(format = {}, firstServer = 0) {
    this.format = { ...DEFAULT_FORMAT, ...format };
    this.setsToWin = Math.ceil(this.format.sets / 2);
    this.points = [0, 0];          // points in the current game / tiebreak
    this.games = [0, 0];           // games in the current set
    this.sets = [];                // completed sets [[g0,g1],...]
    this.setsWon = [0, 0];
    this.server = firstServer;     // current server
    this.isTiebreak = false;
    this.tbFirstServer = firstServer;
    this.winner = null;
    this.totalPointsPlayed = 0;
    if (this.format.gamesPerSet === 0) this._startTiebreak();
  }

  _startTiebreak() {
    this.isTiebreak = true;
    this.points = [0, 0];
    this.tbFirstServer = this.server;
  }

  get receiver() { return 1 - this.server; }
  /** 'deuce' or 'ad' court for the next point. */
  get serveCourt() { return (this.points[0] + this.points[1]) % 2 === 0 ? 'deuce' : 'ad'; }

  /** Score call from the server's perspective: '15-30', 'DEUCE', 'AD IN', 'AD OUT', or '3-2' in a tiebreak. */
  get pointText() {
    const s = this.points[this.server], r = this.points[1 - this.server];
    if (this.isTiebreak) return `${s}-${r}`;
    if (this.format.shortGames) return s >= 3 && r >= 3 ? '40-40' : `${CALL[s]}-${CALL[r]}`;
    if (s >= 3 && r >= 3) {
      if (s === r) return 'DEUCE';
      return s > r ? 'AD IN' : 'AD OUT';
    }
    return `${CALL[s]}-${CALL[r]}`;
  }

  /** Is the next point a game point / set point etc.? (cheap helper for HUD) */
  isBreakPoint() { return !this.isTiebreak && this._wouldWinGame(1 - this.server); }

  _wouldWinGame(i) {
    const t = this.points.slice(); t[i]++;
    return this._gameDone(t, i);
  }
  _gameDone(p, i) {
    const o = p[1 - i];
    if (this.isTiebreak) return p[i] >= 7 && p[i] - o >= 2;
    if (this.format.shortGames) return p[i] >= 4;
    return p[i] >= 4 && p[i] - o >= 2;
  }

  /**
   * Award a point.
   * @returns {{gameWon:boolean, setWon:boolean, matchWon:boolean, changeover:boolean, text:string}}
   */
  pointWon(i) {
    this.totalPointsPlayed++;
    this.points[i]++;
    const res = { gameWon: false, setWon: false, matchWon: false, changeover: false, text: '' };
    if (this.format.shortGames && !this.isTiebreak && this.points[0] >= 3 && this.points[1] >= 3 && this.points[i] < 4) {
      res.text = this.pointText;
      return res;
    }
    if (!this._gameDone(this.points, i)) {
      res.text = this.pointText;
      // tiebreak: change ends every 6 points, server changes after 1st point then every 2
      const n = this.points[0] + this.points[1];
      if (this.isTiebreak) {
        this.server = this._tbServer(n);
        if (n % 6 === 0) res.changeover = true;
      }
      return res;
    }
    // ---- game (or tiebreak) won
    res.gameWon = true;
    const wasTb = this.isTiebreak;
    this.games[i]++;
    this.points = [0, 0];
    this.isTiebreak = false;
    const G = this.format.gamesPerSet;
    const g = this.games;
    let setDone = false;
    if (wasTb) setDone = true;
    else if (G > 0) {
      if (g[i] >= G && g[i] - g[1 - i] >= 2) setDone = true;
      else if (this.format.tiebreak && g[0] === G && g[1] === G) { /* start tiebreak below */ }
      else if (this.format.tiebreak && g[i] === G + 1) setDone = true;     // 7-5 style handled by lead; defensive
    }
    if (setDone) {
      res.setWon = true;
      this.sets.push(this.games.slice());
      this.setsWon[i]++;
      const total = this.games[0] + this.games[1];
      if (this.setsWon[i] >= this.setsToWin) {
        this.winner = i; res.matchWon = true; res.text = 'MATCH';
        return res;
      }
      this.games = [0, 0];
      // next set: server = opposite of whoever served the last game / first tiebreak point
      this.server = wasTb ? 1 - this.tbFirstServer : 1 - this.server;
      res.changeover = total % 2 === 1 || wasTb;
      res.text = 'SET';
      return res;
    }
    // next game
    this.server = 1 - this.server;
    if (this.format.tiebreak && G > 0 && g[0] === G && g[1] === G) this._startTiebreak();
    res.changeover = (g[0] + g[1]) % 2 === 1;
    res.text = 'GAME';
    return res;
  }

  _tbServer(n) {
    // first point: tbFirstServer; then two each
    const k = Math.floor((n + 1) / 2) % 2;
    return k === 0 ? this.tbFirstServer : 1 - this.tbFirstServer;
  }
}
