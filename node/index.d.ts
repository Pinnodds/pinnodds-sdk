/** pinnodds — real-time Pinnacle odds & drop alerts. https://pinnodds.com */

export declare const DEFAULT_BASE_URL: string;

/** Dropping-odds sport ids accepted by every endpoint's sportId param. */
export declare const SPORTS: Readonly<{
  soccer: 1; tennis: 2; basketball: 3; hockey: 4; football: 5; baseball: 6;
  rugby: 7; mma: 8; boxing: 9; other: 10; esports: 11; golf: 12;
}>;

export declare class PinnoddsError extends Error {
  status: number | null;
  payload: unknown;
}
export declare class AuthError extends PinnoddsError {}
export declare class RateLimitError extends PinnoddsError {
  /** Seconds until the rate-limit window resets (if the server provided it). */
  retryAfter: number | null;
}

export interface ClientOptions {
  /** Override for self-hosted/proxy setups. Default "https://pinnodds.com". */
  baseUrl?: string;
  /** REST request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Custom fetch implementation (testing / proxies). */
  fetch?: typeof fetch;
}

/**
 * A row from the REST drops buffer (`GET /api/drops`).
 *
 * Note this is NOT the same shape as the SSE alerts — see {@link DropAlert}.
 * The REST rows are the normalised, enriched form: they name the market, carry
 * a precomputed `drop_pct`, and use `from`/`to` for the prices.
 */
export interface Drop {
  ts: number;
  age_s: number;
  event_id: number;
  parent_id: number | null;
  sport_id: number;
  sport_name: string;
  league: string | null;
  home: string | null;
  away: string | null;
  score: string | null;
  starts: string;
  time_to_start_s: number;
  match_minute: number | null;
  is_live: boolean;
  /** Lower-case market name, e.g. "moneyline", "total", "spread". */
  market: string;
  period: number;
  side: string | null;
  /** "home" | "away" | "draw" | "over" | "under" for the dropping selection. */
  designation: string | null;
  participant_id: number | null;
  participant_name: string | null;
  points: number | null;
  market_key: string;
  from: number;
  to: number;
  nvp: number | null;
  /** Percentage fall, precomputed. Present on REST rows only. */
  drop_pct: number;
  ratio: number;
  [key: string]: unknown;
}

/**
 * A live alert from the SSE streams (`/odds-drop`, `/odds-drop-prematch`).
 *
 * Deliberately different from {@link Drop}: this is the alert-shaped payload
 * the drops pipeline emits, so the market is `sect` (title-cased), the prices
 * are `from_price`/`to_price`, the event id is `id`, and there is **no**
 * `drop_pct` — derive it as `(1 - to_price / from_price) * 100` if you need it.
 */
export interface DropAlert {
  /** Event id. Named `id` here, `event_id` on REST rows. */
  id: number;
  home: string | null;
  away: string | null;
  league: string | null;
  league_id: number | null;
  sport: string;
  sport_id: number;
  /** Human-readable market, e.g. "Moneyline", "Total Game". */
  sect: string;
  period: number;
  period_name: string | null;
  /** Which selection moved, e.g. "Home", "Away", "Over". */
  outcome: string | null;
  point: number | null;
  from_price: number;
  to_price: number;
  /** Prices of the other selections in the same market at alert time. */
  price_x: number | null;
  price_y: number | null;
  price_z: number | null;
  /** No-vig fair price for the dropping selection. */
  nvp: number | null;
  /** Pinnacle's max stake on this selection, in account currency. */
  limit: number | null;
  home_score: number | null;
  away_score: number | null;
  /** Seconds the price took to move across the buffer window. */
  interval: number | null;
  /** Kickoff, unix seconds. */
  starts: number;
  /** Alert time, unix seconds and ms. */
  alerted: number;
  alerted_ms: number;
  dispatched_ms: number;
  flushed_ms: number;
  [key: string]: unknown;
}

export interface StreamDropsOptions {
  /** "live" (default) → /odds-drop; "prematch" → /odds-drop-prematch. */
  mode?: "live" | "prematch";
  /** Drop threshold in percent (server default 5, floor 1). */
  minDrop?: number;
  /** Prematch only: hold an alert N seconds and re-verify before sending. */
  recheck?: number;
  /** Auto-reconnect on transient network errors. Default true. */
  reconnect?: boolean;
  /** Delay between reconnect attempts in ms. Default 3000. */
  backoffMs?: number;
  /** Abort to stop the stream cleanly. */
  signal?: AbortSignal;
}

export declare class Client {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  constructor(apiKey: string, opts?: ClientOptions);

  /**
   * Live (default) or prematch markets for one sport. GET /kit/v1/markets
   *
   * `includeSpecials` adds props, futures and outrights as extra event rows;
   * off by default because they dominate the payload (soccer prematch goes
   * from ~1.5k to ~12.4k events).
   */
  markets(opts: {
    sportId: number;
    eventType?: "live" | "prematch";
    since?: number;
    includeSpecials?: boolean;
  }): Promise<any>;
  /** Single live event by id. GET /kit/v1/details */
  details(eventId: number): Promise<any>;
  /** All prematch fixtures for a sport. GET /kit/v1/prematch/fixtures */
  prematchFixtures(opts: { sportId: number; since?: number }): Promise<any>;
  /** Full markets for one prematch event. GET /kit/v1/prematch/markets */
  prematchMarkets(eventId: number): Promise<any>;
  /** Compact line view for one prematch event. GET /kit/v1/prematch/lines */
  prematchLines(eventId: number, opts?: { marketType?: string }): Promise<any>;
  /** Recent dropping-odds events (queryable buffer). GET /api/drops */
  drops(opts?: {
    mode?: "live" | "prematch";
    sportId?: number;
    minDropPct?: number;
    maxDropPct?: number;
    maxAgeSec?: number;
    liveOnly?: boolean;
    markets?: string[] | string;
    periods?: number[] | string;
    limit?: number;
  }): Promise<{ total: number; drops: Drop[]; meta: any }>;
  /** Service status. GET /health */
  health(): Promise<any>;
  /** Public liveness probe (no auth). GET /ping → "ok" */
  ping(): Promise<string>;
  /**
   * Real-time odds-drop alerts over Server-Sent Events.
   * Control frames (the opening `{type:"connected"}` handshake) are filtered
   * out, so every yielded value is a real alert.
   */
  streamDrops(opts?: StreamDropsOptions): AsyncGenerator<DropAlert, void, void>;
}
