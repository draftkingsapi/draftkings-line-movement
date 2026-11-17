import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseHistory, publicMoveRow, propHistoryRows, impliedProbability, sportFromBoard } from '../src/moves.js';

const q = (seq, eventId, market, side, line, american, at, offer = `o${seq}`) => ({ seq: String(seq), offer_id: offer, observed_at: at, data: { event_id: eventId, market, period: 'game', side, line, american, observed_at: at } });

test('moves are consecutive changes per event, market and side, even when the offer id changes', () => {
    const events = new Map([['e1', { id: 'e1', sport: 'NBA', home: 'Home', away: 'Away', starts_at: '2026-11-20T00:00:00Z' }]]);
    const rows = [
        q(1, 'e1', 'spread', 'home', -3.5, -110, '2026-11-17T01:00:00Z'),
        q(2, 'e1', 'spread', 'home', -3.5, -110, '2026-11-17T02:00:00Z'),
        q(3, 'e1', 'spread', 'home', -4.5, -105, '2026-11-17T03:00:00Z'),
        q(4, 'e1', 'spread', 'home', -4.5, -115, '2026-11-17T04:00:00Z'),
        q(5, 'e1', 'spread', 'away', 3.5, -110, '2026-11-17T01:00:00Z'),
    ];
    const { moves, summaries } = analyseHistory(rows, events);
    assert.equal(moves.length, 2);
    assert.deepEqual([moves[0].kind, moves[0].line_move, moves[0].direction, moves[0].team], ['line', -1, 'down', 'Home']);
    assert.deepEqual([moves[1].kind, moves[1].price_direction, moves[1].change_id], ['price', 'shorter', '4']);
    const home = summaries.find((s) => s.side === 'home');
    assert.deepEqual([home.open_line, home.line, home.line_moves, home.price_moves, home.captures], [-3.5, -4.5, 1, 1, 4]);
    assert.equal(home.event, 'Away @ Home');
});

test('public feed rows map to the same shape', () => {
    const r = publicMoveRow({ league: 'cbb', home: 'H', away: 'A', market: 'total', side: 'over', previous_line: 140.5, line: 142.5, previous_american: -110, american: -110, kind: 'line', observed_at: 't' });
    assert.deepEqual([r.sport, r.kind, r.line_move, r.direction, r.data_mode], ['NCAAB', 'line', 2, 'up', 'free_preview']);
});

test('prop line history points and summary', () => {
    const body = {
        market: { market_id: '1', region: 'US-NJ', stat: 'Points', player: 'P', event: 'A @ B', starts_at: 's' },
        open: { line: 7.5, over: -113, under: null, observed_at: 'o' },
        close: { line: 6.5, over: -114, under: -112, closed: false, observed_at: 'c' },
        data: [{ line: 7.5, over: -113, under: -107, kind: 'open' }, { line: 6.5, over: -118, under: -108, kind: 'line_move' }, { line: 6.5, over: -114, under: -112, kind: 'price_move' }],
    };
    const pts = propHistoryRows(body, { marketId: '1', state: 'NJ', sport: 'NBA' });
    assert.equal(pts.length, 3);
    assert.deepEqual([pts[1].line_move, pts[1].direction, pts[0].state], [-1, 'down', 'NJ']);
    const [s] = propHistoryRows(body, { marketId: '1', state: 'NJ', sport: 'NBA', summary: true });
    assert.deepEqual([s.line_move, s.line_moves, s.price_moves, s.points], [-1, 1, 1, 3]);
});

test('helpers', () => {
    assert.equal(impliedProbability(-110), 0.5238);
    assert.equal(impliedProbability(150), 0.4);
    assert.equal(sportFromBoard('CBB:92483:4511'), 'NCAAB');
});
