## DraftKings Line Movement Tracker and Historical Odds

Track DraftKings Sportsbook line movement. Every time a DraftKings moneyline, spread or total moves, this Actor records the game, market, side, old line, new line, old price, new price and which way it went. Schedule it and you keep a complete, gap-free log of every DraftKings line move.

It also gives you **opening vs current lines** for every side of every upcoming game, and the **full line history of DraftKings player props** (points, rebounds, passing yards, shots on goal and the rest): every recorded change of the main line and both prices, with the opening and closing line.

**Try it with no key.** Run it empty to get real DraftKings line and price moves from the last few hours.

### Modes

| Mode | What it returns |
|---|---|
| Line moves (tracker) | One row per move: `event`, `market` (moneyline, spread, total), `side`, `team`, `previous_line`, `line`, `line_move`, `direction` (up/down), `previous_american`, `american`, implied probability before and after, `price_direction` (shorter/longer), `observed_at`. Filter to line moves or price moves only. |
| Opening vs current line | One row per side: `open_line`, `open_american`, current `line` and `american`, how far it moved, `line_moves`, `price_moves`, `opened_at`. For closing line value, steam and reverse line movement checks. |
| Player prop line history | Every recorded change of DraftKings player over/unders in one state: `player`, `stat`, `line`, `over_american`, `under_american`, `kind` (line or price move), with the prop's opening line. Or one summary row per prop. |

Sports: NBA, NFL, NHL, MLB, college basketball, college football, Premier League and MLS. Player props follow what DraftKings lists in season.

### How the tracker works

The first run returns the moves of the last 24 hours (you choose the window). Each later run returns only the moves recorded since the run before, so a schedule (every 5 to 15 minutes) never misses or repeats a move. Use a separate **Tracker name** for each sport or strategy.

### Why not a DraftKings scraper

A scraper only sees the board at the moment it runs, so it cannot tell you where a line opened or when it moved, and DraftKings blocks it without residential proxies. This Actor reads a continuously collected record from [draftkingsapi.com](https://draftkingsapi.com), so moves between your runs are never lost and nothing gets blocked. Runs take seconds.

The same data is a REST API ([docs](https://draftkingsapi.com/docs)) and a remote MCP server for Claude, ChatGPT and Cursor at `https://draftkingsapi.com/api/mcp`.

### How to use it

1. Run it once with no key to see real recent moves.
2. Get a free API key at [draftkingsapi.com/sign-up](https://draftkingsapi.com/sign-up). There is a free plan and it needs no card.
3. Paste the key, pick a mode and a sport, and run. For tracking, add a schedule in Apify.
4. Export as JSON, CSV or Excel, or send each run to a webhook, Google Sheets, Slack or your database through Apify integrations.

Each page of up to 100 quotes, each sportsbook snapshot and each prop history is one request on your draftkingsapi.com plan. "Max API requests" caps how many a run uses. See [pricing](https://draftkingsapi.com/pricing).

### Example row (illustrative values)

```json
{
  "observed_at": "2026-11-17T15:17:37.110Z",
  "sport": "NBA",
  "event": "Portland Trail Blazers @ Minnesota Timberwolves",
  "market": "spread",
  "side": "home",
  "team": "Minnesota Timberwolves",
  "kind": "line",
  "previous_line": -6.5,
  "line": -7.5,
  "line_move": -1,
  "direction": "down",
  "previous_american": -110,
  "american": -108,
  "price_direction": "longer"
}
```

### FAQ

**Does DraftKings have a public odds API?** No public odds API. This Actor and draftkingsapi.com give you DraftKings Sportsbook lines and their history as structured data.

**How fresh is the data?** Every row carries `observed_at`. The free preview is delayed and capped; a key gives the full record.

**Can I get DraftKings closing lines?** Yes. Opening vs current gives the last captured line before each game, and player prop line history marks the close with `closed: true` once the game has started.

For current DraftKings odds, Pick6 lines and DFS salaries, use the companion **DraftKings Odds API** and **DraftKings Pick6 API** Actors by the same publisher.

Information only, not betting advice.

Independent data service operated by Stunning Couches LLC, not affiliated with or endorsed by DraftKings.
