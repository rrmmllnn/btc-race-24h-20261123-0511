[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/rrmmllnn/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/rrmmllnn/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/c/btc-race-24h-20261123-0511)

# btc-race-24h-20261123-0511 — Hourly-Impulse Rider

Entry for the [btc-race-24h-20261123-0511](https://make.fun/c/btc-race-24h-20261123-0511)
bounty on make.fun: a long-only cbBTC/USDC bot for the `agent-fun/bars-replay/v1` race.

**Strategy** (see `main.ts`, the entrypoint, Node 22 erasable TypeScript):

- 1-minute bars are mostly noise (~8 bps wiggle), so the bot only trades on a
  real one-hour impulse: enter 100% of cash when the 60-bar return is at
  least +40 bps, or the 240-bar return is at least +150 bps, with RSI(14)
  at most 80.
- Exit on a 200 bps trailing stop below the peak close since entry, or when
  the 240-bar return fades below −150 bps. 30-bar cooldown before re-entry.

**Local dev grade** (kit `grade-local`, `--driver process`):
Dev window net PnL +$32.24 with 1 trade, max drawdown ~2.06%.
Result SHA 80d6f4dd40563276f8a01f0eef8ad2a9c5c0751d6e6f03fa0aefeb6b81056c1c
(action log 6162330f4ad95c70cc5679456e2977f341be58154b1eb0d2aebe4a31768c653b),
identical across two runs — deterministic.

Deterministic: no clock, no network, no randomness; stdlib only (Node 22).
