import { num, round } from './common.js';

/** Sport names as the API's /events and /history use them, with the public feed's league code and the sportsbook board prefix. */
export const SPORTS = {
    NBA: { pub: 'nba', board: 'NBA' },
    NFL: { pub: 'nfl', board: 'NFL' },
    NHL: { pub: 'nhl', board: 'NHL' },
    MLB: { pub: 'mlb', board: 'MLB' },
    NCAAB: { pub: 'cbb', board: 'CBB' },
    NCAAF: { pub: 'cfb', board: 'CFB' },
    EPL: { pub: 'epl', board: null },
    MLS: { pub: 'mls', board: null },
};
const FROM_PUB = Object.fromEntries(Object.entries(SPORTS).map(([k, v]) => [v.pub, k]));
const FROM_BOARD = Object.fromEntries(Object.entries(SPORTS).filter(([, v]) => v.board).map(([k, v]) => [v.board, k]));

export const sportFromPublic = (league) => (league ? FROM_PUB[String(league).toLowerCase()] ?? String(league).toUpperCase() : null);
export const sportFromBoard = (boardId) => {
    const prefix = String(boardId ?? '').split(':')[0];
    return FROM_BOARD[prefix] ?? (prefix || null);
};

/** Implied probability of an American price, 0 to 1. */
export const impliedProbability = (american) => {
    const a = num(american);
    if (a === null || a === 0) return null;
    return round(a < 0 ? -a / (-a + 100) : 100 / (a + 100), 4);
};

const lineDirection = (prev, cur) => (prev === null || cur === null || prev === cur ? null : cur > prev ? 'up' : 'down');
/** A price that now implies a higher chance is shorter; a lower chance is longer. */
const priceDirection = (prevAmerican, american) => {
    const p0 = impliedProbability(prevAmerican);
    const p1 = impliedProbability(american);
    if (p0 === null || p1 === null || p0 === p1) return null;
    return p1 > p0 ? 'shorter' : 'longer';
};
const teamFor = (side, ev) => (side === 'home' ? ev?.home ?? null : side === 'away' ? ev?.away ?? null : null);
const eventName = (ev) => (ev?.away && ev?.home ? `${ev.away} @ ${ev.home}` : null);

/** One move row. prev and cur are { line, american, observed_at, seq }. */
export function moveRow({ ev, sport, eventId, market, period, side, prev, cur, mode }) {
    const lineMoved = prev.line !== cur.line;
    return {
        change_id: cur.seq ?? null,
        sport: sport ?? ev?.sport ?? null,
        event_id: eventId ?? null,
        event: eventName(ev),
        home: ev?.home ?? null,
        away: ev?.away ?? null,
        starts_at: ev?.starts_at ?? null,
        market: market ?? null,
        period: period ?? null,
        side: side ?? null,
        team: teamFor(side, ev),
        kind: lineMoved ? 'line' : 'price',
        previous_line: prev.line,
        line: cur.line,
        line_move: prev.line !== null && cur.line !== null ? round(cur.line - prev.line) : null,
        direction: lineDirection(prev.line, cur.line),
        previous_american: prev.american,
        american: cur.american,
        previous_implied_probability: impliedProbability(prev.american),
        implied_probability: impliedProbability(cur.american),
        price_direction: priceDirection(prev.american, cur.american),
        previous_observed_at: prev.observed_at ?? null,
        observed_at: cur.observed_at ?? null,
        data_mode: mode,
    };
}

/** A row of the keyless public move feed in the same shape. */
export function publicMoveRow(m) {
    const ev = { home: m.home ?? null, away: m.away ?? null };
    return moveRow({
        ev,
        sport: sportFromPublic(m.league),
        eventId: null,
        market: m.market,
        period: 'game',
        side: m.side,
        prev: { line: num(m.previous_line), american: num(m.previous_american), observed_at: null },
        cur: { line: num(m.line), american: num(m.american), observed_at: m.observed_at ?? null, seq: null },
        mode: 'free_preview',
    });
}

/**
 * Group /api/v1/history rows (oldest first) per event, market, period and side, and return
 * every consecutive change of line or price plus a summary per group.
 * DraftKings issues a new offer id when the line changes, so the group key leaves the offer id out.
 */
export function analyseHistory(historyRows, events = new Map()) {
    const rows = [...historyRows].sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    const groups = new Map();
    const moves = [];
    for (const r of rows) {
        const d = r.data && typeof r.data === 'object' ? r.data : r;
        const key = [d.event_id, d.market, d.period ?? 'game', d.side].join('|');
        const cur = { line: num(d.line), american: num(d.american), observed_at: d.observed_at ?? r.observed_at ?? null, seq: r.seq != null ? String(r.seq) : null };
        let g = groups.get(key);
        if (!g) {
            g = { eventId: d.event_id, market: d.market, period: d.period ?? 'game', side: d.side, first: cur, last: cur, captures: 0, lineMoves: 0, priceMoves: 0 };
            groups.set(key, g);
        }
        g.captures++;
        const prev = g.last;
        if (g.captures > 1 && (prev.line !== cur.line || prev.american !== cur.american)) {
            if (prev.line !== cur.line) g.lineMoves++; else g.priceMoves++;
            const ev = events.get(d.event_id);
            moves.push(moveRow({ ev, sport: ev?.sport, eventId: d.event_id, market: d.market, period: g.period, side: d.side, prev, cur, mode: 'live' }));
        }
        g.last = cur;
    }
    const summaries = [...groups.values()].map((g) => {
        const ev = events.get(g.eventId);
        return {
            sport: ev?.sport ?? null,
            event_id: g.eventId ?? null,
            event: eventName(ev),
            home: ev?.home ?? null,
            away: ev?.away ?? null,
            starts_at: ev?.starts_at ?? null,
            market: g.market ?? null,
            period: g.period,
            side: g.side ?? null,
            team: teamFor(g.side, ev),
            open_line: g.first.line,
            open_american: g.first.american,
            line: g.last.line,
            american: g.last.american,
            line_move: g.first.line !== null && g.last.line !== null ? round(g.last.line - g.first.line) : null,
            direction: lineDirection(g.first.line, g.last.line),
            open_implied_probability: impliedProbability(g.first.american),
            implied_probability: impliedProbability(g.last.american),
            price_direction: priceDirection(g.first.american, g.last.american),
            line_moves: g.lineMoves,
            price_moves: g.priceMoves,
            captures: g.captures,
            opened_at: g.first.observed_at,
            observed_at: g.last.observed_at,
            data_mode: 'live',
        };
    });
    return { moves, summaries };
}

/** Rows from /api/v1/sportsbook/line-history for one player over/under market. */
export function propHistoryRows(body, { marketId, state, sport, summary }) {
    const m = body?.market ?? {};
    const open = body?.open ?? {};
    const close = body?.close ?? {};
    const points = Array.isArray(body?.data) ? body.data : [];
    const base = {
        market_id: String(m.market_id ?? marketId),
        state: (m.region ?? state ?? '').replace(/^US-/, '') || null,
        sport: sport ?? null,
        player: m.player ?? null,
        stat: m.stat ?? m.market_type ?? null,
        event: m.event ?? null,
        starts_at: m.starts_at ?? null,
        open_line: num(open.line),
        open_over_american: num(open.over),
        open_under_american: num(open.under),
        opened_at: open.observed_at ?? null,
    };
    if (summary) {
        let lineMoves = 0;
        let priceMoves = 0;
        for (let i = 1; i < points.length; i++) {
            if (num(points[i].line) !== num(points[i - 1].line)) lineMoves++;
            else if (num(points[i].over) !== num(points[i - 1].over) || num(points[i].under) !== num(points[i - 1].under)) priceMoves++;
        }
        const line = num(close.line);
        return [{
            ...base,
            line,
            over_american: num(close.over),
            under_american: num(close.under),
            line_move: base.open_line !== null && line !== null ? round(line - base.open_line) : null,
            direction: lineDirection(base.open_line, line),
            line_moves: lineMoves,
            price_moves: priceMoves,
            points: points.length,
            closed: Boolean(close.closed),
            observed_at: close.observed_at ?? points.at(-1)?.observed_at ?? null,
            data_mode: 'live',
        }];
    }
    return points.map((p, i) => {
        const prevLine = i > 0 ? num(points[i - 1].line) : null;
        const line = num(p.line);
        return {
            ...base,
            kind: p.kind ?? null,
            previous_line: prevLine,
            line,
            line_move: prevLine !== null && line !== null ? round(line - prevLine) : null,
            direction: lineDirection(prevLine, line),
            over_american: num(p.over),
            under_american: num(p.under),
            status: p.status ?? null,
            closed: Boolean(close.closed),
            observed_at: p.observed_at ?? null,
            data_mode: 'live',
        };
    });
}

/** Player over/under markets from a /api/v1/sportsbook/snapshot body. */
export function playerMarkets(snapshot) {
    const st = snapshot?.state ?? {};
    const events = new Map((st.events ?? []).map((e) => [String(e.id), e]));
    const sels = new Map();
    for (const s of st.selections ?? []) {
        if (s.removed) continue;
        const list = sels.get(String(s.market_id)) ?? [];
        list.push(s);
        sels.set(String(s.market_id), list);
    }
    const out = [];
    for (const m of st.markets ?? []) {
        if (m.removed) continue;
        const ss = sels.get(String(m.id)) ?? [];
        const player = ss.flatMap((s) => s.participants ?? []).find((p) => p.type === 'Player');
        const labels = new Set(ss.map((s) => String(s.label ?? '').toLowerCase()));
        if (!player || !(labels.has('over') || labels.has('under'))) continue;
        const ev = events.get(String(m.event_id));
        out.push({ marketId: String(m.id), label: m.label ?? '', marketType: m.market_type ?? '', player: player.name, startsAt: ev?.starts_at ?? null, event: ev?.label ?? null });
    }
    return out;
}
