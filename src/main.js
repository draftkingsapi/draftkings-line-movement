import { Actor, log } from 'apify';
import { getJson, errorText } from './common.js';
import { SPORTS, analyseHistory, publicMoveRow, propHistoryRows, playerMarkets, sportFromBoard } from './moves.js';

const SITE = 'https://draftkingsapi.com';
const BASE = `${SITE}/api/v1`;
const UA = 'apify-actor/draftkings-line-movement';
const STATE_STORE = 'draftkings-line-movement-state';

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const {
    apiKey, mode = 'moves', sport = 'all', market = 'all', moveType = 'all', games = 'upcoming', search, eventId,
    lookbackHours = 24, resumeFromLastRun = true, stateKey = 'default',
    state = 'NJ', marketIds = [], player, stat, propOutput = 'points', maxMarkets = 20,
    maxRequests = 50, maxItems = 1000,
} = input;
const sportCode = sport && sport !== 'all' ? String(sport).trim().toUpperCase() : '';
const marketCode = market && market !== 'all' ? String(market).trim().toLowerCase() : '';
const keepKind = (r) => moveType === 'all' || !moveType || r.kind === moveType;
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// No key: real DraftKings moneyline, spread and total moves from the keyless public feed that powers draftkingsapi.com (delayed, capped).
if (!apiKey) {
    const p = new URLSearchParams({ limit: '200', market: 'sportsbook' });
    if (sportCode && SPORTS[sportCode]) p.set('league', SPORTS[sportCode].pub);
    const { ok, status: code, body } = await getJson(`${BASE}/public/line-moves?${p}`, {}, UA);
    if (!ok) await Actor.fail(errorText(body, code));
    const rows = (body?.sportsbook_moves ?? []).map(publicMoveRow)
        .filter((r) => (!marketCode || r.market === marketCode) && keepKind(r)
            && (!search || `${r.home} ${r.away}`.toLowerCase().includes(String(search).toLowerCase())))
        .slice(0, maxItems);
    if (rows.length) await Actor.pushData(rows);
    if (mode !== 'moves') log.info(`The "${mode}" mode needs a key; this free preview returns recent game-line moves instead.`);
    log.info(`Free preview: ${rows.length} real DraftKings moneyline, spread and total moves from the keyless public feed (delayed and capped, built ${body?.generated_at ?? 'recently'}).`);
    log.info(`For every move of every game, opening vs current lines and player prop line history, add a free API key from ${SITE}/sign-up (no card).`);
    await Actor.exit();
}

const auth = { authorization: `Bearer ${apiKey}`, 'x-user-request': `Apify Actor: DraftKings line movement ${mode} ${sportCode}`.trim() };
let requests = 0;
const call = async (path) => { requests++; return getJson(`${BASE}${path}`, auth, UA); };
let pushed = 0;

/** Every page of a cursor-paginated list, within the request budget. */
async function pageAll(path, params, budget) {
    const out = [];
    let cursor = null;
    let complete = true;
    do {
        if (requests >= budget) { complete = false; break; }
        const p = new URLSearchParams(params);
        p.set('limit', '100');
        if (cursor) p.set('cursor', cursor);
        const { ok, status: code, body } = await call(`${path}?${p}`);
        if (!ok) {
            if (out.length) { log.warning(`Stopped paging ${path}: ${errorText(body, code)}`); complete = false; break; }
            await Actor.fail(errorText(body, code));
        }
        out.push(...(body?.data ?? []));
        cursor = body?.pagination?.next_cursor ?? null;
    } while (cursor);
    return { rows: out, complete };
}

if (mode === 'moves' || mode === 'open-vs-current') {
    const filters = {};
    if (sportCode) filters.sport = sportCode;
    if (search) filters.search = String(search);
    if (eventId) filters.event_id = String(eventId);
    if (games === 'upcoming') { filters.status = 'pre'; filters.start_after = nowIso(); }
    else if (games === 'today') filters.start_after = new Date(Date.now() - 6 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Event names, so each row says who is playing.
    const events = new Map();
    const ev = await pageAll('/events', filters, Math.max(2, Math.floor(maxRequests / 5)));
    for (const e of ev.rows) events.set(e.id, e);

    const hp = { ...filters };
    if (marketCode) hp.market = marketCode;
    const hist = await pageAll('/history', hp, maxRequests);
    if (!hist.complete) log.warning(`Reached the request limit (${maxRequests}) before the end of the history; raise "Max API requests" for a complete result.`);
    const { moves, summaries } = analyseHistory(hist.rows, events);

    if (mode === 'moves') {
        const store = await Actor.openKeyValueStore(STATE_STORE);
        const stateName = `seq-${String(stateKey).replace(/[^A-Za-z0-9_-]/g, '') || 'default'}-${sportCode || 'ALL'}-${marketCode || 'all'}`;
        const saved = resumeFromLastRun ? await store.getValue(stateName) : null;
        const since = Date.now() - Math.max(1, Number(lookbackHours) || 24) * 3600_000;
        const fresh = moves.filter((m) => (saved ? Number(m.change_id) > Number(saved) : Date.parse(m.observed_at) >= since));
        const rows = fresh.filter(keepKind).sort((a, b) => Number(b.change_id) - Number(a.change_id)).slice(0, maxItems);
        if (rows.length) await Actor.pushData(rows);
        pushed = rows.length;
        const maxSeq = hist.rows.reduce((mx, r) => Math.max(mx, Number(r.seq) || 0), Number(saved) || 0);
        if (maxSeq) await store.setValue(stateName, String(maxSeq));
        log.info(saved
            ? `Resumed after change ${saved}: ${pushed} new moves. Next run resumes after change ${maxSeq}.`
            : `First run: ${pushed} moves from the last ${lookbackHours} hours. Schedule this Actor (for example every 15 minutes) and each run returns only new moves.`);
    } else {
        const rows = summaries
            .filter((s) => moveType === 'all' || !moveType || (moveType === 'line' ? s.line_moves > 0 : s.price_moves > 0))
            .sort((a, b) => String(a.starts_at ?? '').localeCompare(String(b.starts_at ?? '')))
            .slice(0, maxItems);
        if (rows.length) await Actor.pushData(rows);
        pushed = rows.length;
        log.info(`Saved ${pushed} sides with opening and current line and price (${hist.rows.length} captured quotes read).`);
    }
} else if (mode === 'prop-history') {
    const stateCode = String(state || 'NJ').trim().toUpperCase();
    let markets = (Array.isArray(marketIds) ? marketIds : String(marketIds).split(/[\s,]+/)).map(String).map((s) => s.trim()).filter(Boolean)
        .map((id) => ({ marketId: id, sport: sportCode || null }));
    if (!markets.length) {
        const { ok, status: code, body } = await call('/sportsbook/scopes');
        if (!ok) await Actor.fail(errorText(body, code));
        const board = sportCode ? SPORTS[sportCode]?.board ?? sportCode : '';
        const scopes = (body?.scopes ?? []).filter((s) => s.available && s.state === stateCode
            && (s.retained_counts?.player_prop_markets ?? 0) > 0 && (!board || String(s.board_id).startsWith(`${board}:`)));
        if (!scopes.length) await Actor.fail(`No DraftKings player prop boards for ${sportCode || 'any sport'} in ${stateCode} right now. Try another sport or state.`);
        const found = new Map();
        for (const s of scopes.slice(0, 12)) {
            if (requests >= maxRequests) break;
            const snap = await call(`/sportsbook/snapshot?scope=${encodeURIComponent(s.scope_id)}`);
            if (!snap.ok) { log.warning(`${s.scope_id}: ${errorText(snap.body, snap.status)}`); continue; }
            for (const m of playerMarkets(snap.body)) {
                if (player && !m.player.toLowerCase().includes(String(player).toLowerCase())) continue;
                if (stat && !`${m.marketType} ${m.label}`.toLowerCase().includes(String(stat).toLowerCase())) continue;
                if (!found.has(m.marketId)) found.set(m.marketId, { ...m, sport: sportFromBoard(s.board_id) });
            }
        }
        markets = [...found.values()].sort((a, b) => String(a.startsAt ?? '').localeCompare(String(b.startsAt ?? '')));
        log.info(`Found ${markets.length} player over/under markets in ${stateCode}${player ? ` for "${player}"` : ''}${stat ? ` (${stat})` : ''}.`);
    }
    for (const m of markets.slice(0, Math.max(1, maxMarkets))) {
        if (pushed >= maxItems) break;
        if (requests >= maxRequests) { log.warning(`Reached the request limit (${maxRequests}); raise "Max API requests" for more markets.`); break; }
        const { ok, status: code, body } = await call(`/sportsbook/line-history?${new URLSearchParams({ market_id: m.marketId, state: stateCode, limit: '500' })}`);
        if (!ok) { log.warning(`${m.marketId}: ${errorText(body, code)}`); continue; }
        const rows = propHistoryRows(body, { marketId: m.marketId, state: stateCode, sport: m.sport, summary: propOutput === 'summary' }).slice(0, maxItems - pushed);
        if (rows.length) await Actor.pushData(rows);
        pushed += rows.length;
    }
    log.info(`Saved ${pushed} player prop ${propOutput === 'summary' ? 'summaries' : 'line history points'}.`);
} else {
    await Actor.fail(`Unknown mode "${mode}". Use moves, open-vs-current or prop-history.`);
}
log.info(`Used ${requests} API requests. Data: draftkingsapi.com, independent and not affiliated with DraftKings.`);
await Actor.exit();
