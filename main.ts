// Hourly-impulse rider for cbBTC/USDC, agent-fun/bars-replay/v1.
//
// Idea: 1-minute bars are mostly noise (about 8 bps of wiggle per bar), so
// this bot ignores the minute-to-minute chop and only trades when the tape
// shows a real one-hour impulse, then rides it with a wide trailing stop.
//
//   Entry (flat only): the 60-bar (1h) close-to-close return is at least
//   +40 bps, or the 240-bar (4h) return is at least +150 bps (a slow grind
//   with no sharp impulse), and the 14-bar RSI is at most 80 so we do not
//   chase a vertical spike. Buys 100% of cash.
//   Exit (long only): the close falls 200 bps below the highest close seen
//   since entry (trailing stop), or the 240-bar return turns below -150 bps
//   (the uptrend has faded into a slow bleed). Sells the whole position.
//   After an exit the bot waits 30 bars before it may re-enter.
//
// Every fill costs roughly 13 bps one way (4 bps fee, 2 bps slippage, about
// 7 bps of pool impact on a full-size order), so a round trip needs a move
// well above 26 bps to pay; the 40 bps hourly trigger and the 2% trailing
// stop are both far above that noise floor, which keeps trade count low.
//
// Deterministic: no clock, no network, no randomness; every decision is a
// function of the bars seen so far. No dependencies, erasable TypeScript.

const SYMBOL = "CBBTC";
const MAX_SLIPPAGE_BPS = 100;

// Entry: 60-bar return >= 40 bps, or 240-bar return >= 150 bps.
const IMPULSE_BARS = 60;
const IMPULSE_BPS = 40n;
const DRIFT_BARS = 240;
const DRIFT_BPS = 150n;
// RSI cap on entry.
const RSI_BARS = 14;
const RSI_MAX = 80;
// Exit: trailing stop 200 bps below the peak close since entry.
const TRAIL_BPS = 200n;
// Exit: 240-bar return below -150 bps.
const FADE_BPS = -150n;
// Bars to wait after an exit before re-entering.
const COOLDOWN_BARS = 30;

type Order = {
  side: string;
  client_id: string;
  symbol: string;
  notional_quote_units?: string;
  qty?: string;
  max_slippage_bps: number;
};

class Bot {
  closes: bigint[] = [];
  cash = 0n;
  qty = 0n;
  minNotional = 1000000n;
  warmupBars = 0;
  seq = -1;
  peak: bigint | null = null;
  lastExit = -1000000000;
  counter = 0;
  // RSI state (Wilder's smoothing over 14 changes).
  prevClose: bigint | null = null;
  firstChanges: bigint[] = [];
  avgGain: number | null = null;
  avgLoss: number | null = null;

  noteClose(close: bigint): void {
    this.closes.push(close);
    if (this.prevClose !== null) {
      const change = close - this.prevClose;
      if (this.avgGain === null) {
        this.firstChanges.push(change);
        if (this.firstChanges.length === RSI_BARS) {
          let ups = 0;
          let downs = 0;
          for (const c of this.firstChanges) {
            if (c > 0n) ups += Number(c);
            else downs += Number(-c);
          }
          this.avgGain = ups / RSI_BARS;
          this.avgLoss = downs / RSI_BARS;
        }
      } else {
        const up = change > 0n ? Number(change) : 0;
        const down = change < 0n ? Number(-change) : 0;
        const k = 1 / RSI_BARS;
        this.avgGain = this.avgGain * (1 - k) + up * k;
        this.avgLoss = this.avgLoss * (1 - k) + down * k;
      }
    }
    this.prevClose = close;
  }

  rsi(): number | null {
    if (this.avgGain === null || this.avgLoss === null) return null;
    const moved = this.avgGain + this.avgLoss;
    if (moved === 0) return 50;
    return (100 * this.avgGain) / moved;
  }

  // Close-to-close return over barsBack bars, in bps (exact bigint math,
  // truncated toward zero like the harness's own integer arithmetic).
  retBps(barsBack: number, close: bigint): bigint | null {
    if (this.closes.length <= barsBack) return null;
    const old = this.closes[this.closes.length - 1 - barsBack];
    return ((close - old) * 10000n) / old;
  }

  decide(fresh: boolean): Order[] {
    if (!fresh || this.seq < this.warmupBars) return [];
    const close = this.closes[this.closes.length - 1];
    const rsi = this.rsi();
    if (this.qty > 0n) {
      if (this.peak === null || close > this.peak) this.peak = close;
      if (close * 10000n <= this.peak * (10000n - TRAIL_BPS)) return [this.sell()];
      const fade = this.retBps(DRIFT_BARS, close);
      if (fade !== null && fade < FADE_BPS) return [this.sell()];
      return [];
    }
    if (this.seq - this.lastExit < COOLDOWN_BARS) return [];
    const impulse = this.retBps(IMPULSE_BARS, close);
    const drift = this.retBps(DRIFT_BARS, close);
    const fired =
      (impulse !== null && impulse >= IMPULSE_BPS) ||
      (drift !== null && drift >= DRIFT_BPS);
    if (fired && (rsi === null || rsi <= RSI_MAX)) {
      if (this.cash < this.minNotional) return [];
      this.peak = close;
      return [this.buy(this.cash)];
    }
    return [];
  }

  buy(notional: bigint): Order {
    this.counter += 1;
    return {
      side: "buy",
      client_id: "b" + this.counter,
      symbol: SYMBOL,
      notional_quote_units: notional.toString(),
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    };
  }

  sell(): Order {
    this.counter += 1;
    this.lastExit = this.seq;
    this.peak = null;
    return {
      side: "sell",
      client_id: "s" + this.counter,
      symbol: SYMBOL,
      qty: this.qty.toString(),
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    };
  }
}

async function main(): Promise<void> {
  const bot = new Bot();
  let buf = "";
  for await (const chunk of process.stdin) {
    buf += chunk.toString();
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (line === "") continue;
      const msg = JSON.parse(line) as Record<string, unknown>;
      const kind = msg["type"];
      if (kind === "hello") {
        const capital = msg["capital"] as Record<string, unknown>;
        const fees = msg["fees"] as Record<string, unknown>;
        bot.cash = BigInt(capital["quote_units"] as string);
        bot.minNotional = BigInt(fees["min_notional_quote_units"] as string);
        bot.warmupBars = Number(msg["warmup_bars"] ?? 0);
      } else if (kind === "batch") {
        bot.seq = Number(msg["seq"]);
        let fresh = false;
        const bars = (msg["bars"] as Record<string, unknown>[]) ?? [];
        for (const bar of bars) {
          if (bar["symbol"] === SYMBOL) {
            bot.noteClose(BigInt(bar["c"] as string));
            fresh = true;
          }
        }
        const account = (msg["account"] as Record<string, unknown>) ?? {};
        bot.cash = BigInt((account["cash_quote_units"] as string) ?? "0");
        bot.qty = 0n;
        const positions = (account["positions"] as Record<string, unknown>[]) ?? [];
        for (const pos of positions) {
          if (pos["symbol"] === SYMBOL) bot.qty = BigInt(pos["qty"] as string);
        }
        const orders = bot.decide(fresh);
        process.stdout.write(
          JSON.stringify({ type: "reply", seq: bot.seq, orders }) + "\n",
        );
      } else if (kind === "done") {
        return;
      }
    }
  }
}

main();
