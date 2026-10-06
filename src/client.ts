import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';

export interface Metrics {
  spend: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  api_requests: number;
  successful_requests: number;
  failed_requests: number;
}

export interface KeyInfo {
  token?: string;
  key_alias?: string;
  key_name?: string;
  spend?: number;
  max_budget?: number | null;
  budget_reset_at?: string | null;
  user_id?: string | null;
  team_id?: string | null;
  tpm_limit?: number | null;
  rpm_limit?: number | null;
}

export interface UserKey {
  token?: string;
  key_alias?: string | null;
  key_name?: string | null;
  spend?: number;
  max_budget?: number | null;
}

export interface UserInfoResponse {
  user_id?: string;
  user_info?: {
    user_email?: string | null;
    user_role?: string | null;
    spend?: number;
    max_budget?: number | null;
    budget_reset_at?: string | null;
  } | null;
  keys?: UserKey[];
}

interface UserInfoV2Response {
  user_id?: string;
  user_email?: string | null;
  user_role?: string | null;
  spend?: number;
  max_budget?: number | null;
  budget_reset_at?: string | null;
}

export interface DailyEntry {
  date: string;
  metrics: Partial<Metrics>;
  breakdown?: { models?: Record<string, { metrics: Partial<Metrics> }> };
}

export interface SessionInfo {
  key: string;
  userId?: string;
  userEmail?: string;
}

export interface SsoSession {
  loginId: string;
  /** Present on proxies with the hardened flow (`POST /sso/cli/start`); absent on the legacy flow. */
  pollSecret?: string;
  userCode?: string;
  browserUrl: string;
}

export interface SsoTeam {
  id: string;
  alias?: string;
}

export type SsoResult =
  | { kind: 'ready'; key: string; userId?: string; teamId?: string }
  | { kind: 'selectTeam'; teams: SsoTeam[] };

export interface SsoWaitOptions {
  teamId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  isCancelled?: () => boolean;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
  get unauthorized() { return this.status === 401 || this.status === 403; }
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function emptyMetrics(): Metrics {
  return {
    spend: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
    api_requests: 0, successful_requests: 0, failed_requests: 0,
  };
}

export function addMetrics(a: Metrics, b: Partial<Metrics>): Metrics {
  const total = b.total_tokens || (b.prompt_tokens ?? 0) + (b.completion_tokens ?? 0);
  return {
    spend: a.spend + (b.spend ?? 0),
    prompt_tokens: a.prompt_tokens + (b.prompt_tokens ?? 0),
    completion_tokens: a.completion_tokens + (b.completion_tokens ?? 0),
    total_tokens: a.total_tokens + total,
    api_requests: a.api_requests + (b.api_requests ?? 0),
    successful_requests: a.successful_requests + (b.successful_requests ?? 0),
    failed_requests: a.failed_requests + (b.failed_requests ?? 0),
  };
}

export class LiteLLMClient {
  constructor(
    private readonly base: URL,
    private readonly apiKey?: string,
    private readonly allowInsecureTLS = false,
  ) {}

  static normalize(raw: string | undefined): URL | undefined {
    let s = (raw ?? '').trim().replace(/\/+$/, '');
    if (s.endsWith('/ui')) { s = s.slice(0, -3); }
    if (!s) { return undefined; }
    if (!/^https?:\/\//i.test(s)) { s = 'https://' + s; }
    try { return new URL(s); } catch { return undefined; }
  }

  keyInfo(): Promise<{ key?: string; info: KeyInfo }> {
    return this.get('key/info');
  }

  async userInfo(userId: string): Promise<UserInfoResponse> {
    try {
      const v2 = await this.get<UserInfoV2Response>('v2/user/info', { user_id: userId });
      return {
        user_id: v2.user_id,
        user_info: {
          user_email: v2.user_email,
          user_role: v2.user_role,
          spend: v2.spend,
          max_budget: v2.max_budget,
          budget_reset_at: v2.budget_reset_at,
        },
      };
    } catch (e) {
      // Keep compatibility with proxies released before /v2/user/info.
      if (!(e instanceof ApiError) || e.status !== 404) { throw e; }
      return this.get('user/info', { user_id: userId });
    }
  }

  async models(): Promise<string[]> {
    const res = await this.get<{ data: { id: string }[] }>('v1/models');
    return res.data.map(m => m.id).sort();
  }

  async dailyActivity(start: string, end: string, apiKeyHash?: string): Promise<DailyEntry[]> {
    const all: DailyEntry[] = [];
    for (let page = 1; page <= 20; page++) {
      const q: Record<string, string> = { start_date: start, end_date: end, page: String(page), page_size: '100' };
      if (apiKeyHash) { q.api_key = apiKeyHash; }
      const res = await this.get<{ results: DailyEntry[]; metadata?: { has_more?: boolean; total_pages?: number } }>(
        'user/daily/activity', q);
      all.push(...res.results);
      const more = res.metadata?.has_more ?? (res.metadata?.total_pages ?? 1) > page;
      if (!more || res.results.length === 0) { break; }
    }
    return all;
  }

  /** Logs in with LiteLLM UI credentials and returns the session key embedded in the JWT cookie. */
  async login(username: string, password: string): Promise<SessionInfo> {
    const form = new URLSearchParams({ username, password }).toString();
    const r1 = await this.request('POST', 'login', undefined, form, { 'Content-Type': 'application/x-www-form-urlencoded' });
    const t1 = extractToken(r1);
    if (t1) { return decodeSession(t1); }
    if (r1.status === 401 || r1.status === 403) { throw new ApiError(r1.status, errorMessage(r1)); }

    const r2 = await this.request('POST', 'v2/login', undefined, JSON.stringify({ username, password }),
      { 'Content-Type': 'application/json' });
    const t2 = extractToken(r2);
    if (t2) { return decodeSession(t2); }
    if (r2.status >= 400) { throw new ApiError(r2.status, errorMessage(r2)); }
    throw new Error('Login succeeded but no session key was returned. If your proxy uses SSO, sign in with an API key instead.');
  }

  /**
   * Starts LiteLLM's CLI SSO flow: the user signs in with the proxy's own SSO provider
   * (Google, Microsoft, Okta, …) in the browser while we poll for the resulting session key.
   */
  async startSso(): Promise<SsoSession> {
    const res = await this.request('POST', 'sso/cli/start');
    if (res.status === 404 || res.status === 405) {
      // Proxies before the hardened flow: the client chooses the session id.
      const loginId = `sk-${crypto.randomUUID()}`;
      return { loginId, browserUrl: this.url('sso/key/generate', { source: 'litellm-cli', key: loginId }).href };
    }
    if (res.status !== 200) { throw new ApiError(res.status, errorMessage(res)); }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new Error('The proxy returned a non-JSON response to /sso/cli/start. A gateway in front of LiteLLM may be intercepting it.');
    }
    const { login_id: loginId, poll_secret: pollSecret, user_code: userCode } = data;
    if (typeof loginId !== 'string' || typeof pollSecret !== 'string') {
      throw new Error('Unexpected response from /sso/cli/start. The proxy version may not support SSO sign-in for tools.');
    }
    const query: Record<string, string> = { source: 'litellm-cli', key: loginId };
    if (typeof userCode === 'string' && typeof data.verification_uri_complete === 'string') { query.user_code = userCode; }
    return {
      loginId,
      pollSecret,
      userCode: typeof userCode === 'string' ? userCode : undefined,
      browserUrl: this.url('sso/key/generate', query).href,
    };
  }

  /** Polls until the browser sign-in finishes, the user must pick a team, or the session expires. */
  async waitForSso(session: SsoSession, opts: SsoWaitOptions = {}): Promise<SsoResult> {
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    const interval = opts.pollIntervalMs ?? 2000;
    const headers: Record<string, string> = session.pollSecret ? { 'x-litellm-cli-poll-secret': session.pollSecret } : {};
    const query: Record<string, string> = opts.teamId ? { team_id: opts.teamId } : {};

    while (Date.now() < deadline) {
      if (opts.isCancelled?.()) { throw new Error('Sign-in cancelled.'); }
      let res: RawResponse | undefined;
      try {
        res = await this.request('GET', `sso/cli/poll/${encodeURIComponent(session.loginId)}`, query, undefined, headers);
      } catch {
        // Transient network error: keep polling.
      }
      if (res?.status === 200) {
        const data = JSON.parse(res.body);
        if (data.status === 'ready') {
          if (data.requires_team_selection && !opts.teamId) {
            return { kind: 'selectTeam', teams: normalizeTeams(data.teams, data.team_details) };
          }
          if (typeof data.key !== 'string') { throw new Error('Sign-in finished but the proxy returned no key.'); }
          const claims = jwtClaims(data.key);
          return {
            kind: 'ready',
            key: data.key,
            userId: data.user_id ?? claims?.user_id,
            teamId: data.team_id ?? undefined,
          };
        }
      } else if (res && session.pollSecret && res.status >= 400 && res.status < 500 && res.status !== 429) {
        // The hardened flow reports rejected / expired sessions as client errors; the legacy flow 404s until ready.
        throw new ApiError(res.status, `The proxy rejected the sign-in session. ${errorMessage(res)}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error('Timed out waiting for the browser sign-in. If you finished signing in, the proxy may not support SSO sign-in '
      + 'for tools, or it runs several workers without a shared Redis cache.');
  }

  private url(path: string, query?: Record<string, string>): URL {
    const url = new URL(this.base.pathname.replace(/\/$/, '') + '/' + path, this.base);
    for (const [k, v] of Object.entries(query ?? {})) { url.searchParams.set(k, v); }
    return url;
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const res = await this.request('GET', path, query);
    if (res.status < 200 || res.status >= 300) { throw new ApiError(res.status, errorMessage(res)); }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error(`${path}: response is not valid JSON`);
    }
  }

  private request(method: string, path: string, query?: Record<string, string>, body?: string,
                  extraHeaders: Record<string, string> = {}): Promise<RawResponse> {
    const url = this.url(path, query);

    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
    if (this.apiKey) { headers.Authorization = `Bearer ${this.apiKey}`; }
    if (body !== undefined) { headers['Content-Length'] = String(Buffer.byteLength(body)); }

    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const options: https.RequestOptions = { method, headers, timeout: 30_000 };
    if (isHttps && this.allowInsecureTLS) { options.rejectUnauthorized = false; }

    // Redirects are intentionally not followed so the login response keeps its Set-Cookie.
    return new Promise((resolve, reject) => {
      const req = mod.request(url, options, res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      req.on('error', reject);
      if (body !== undefined) { req.write(body); }
      req.end();
    });
  }
}

function extractToken(res: RawResponse): string | undefined {
  for (const c of res.headers['set-cookie'] ?? []) {
    const m = /^token=([^;]+)/.exec(c);
    if (m) { return decodeURIComponent(m[1]); }
  }
  try {
    const json = JSON.parse(res.body);
    for (const k of ['token', 'access_token', 'jwt']) {
      if (typeof json[k] === 'string' && json[k].split('.').length === 3) { return json[k]; }
    }
  } catch { /* not JSON */ }
  return undefined;
}

function normalizeTeams(teams: unknown, details: unknown): SsoTeam[] {
  if (Array.isArray(details) && details.length) {
    return details.filter(d => d && d.team_id).map(d => ({ id: String(d.team_id), alias: d.team_alias ?? undefined }));
  }
  return Array.isArray(teams) ? teams.map(t => ({ id: String(t) })) : [];
}

/** Decodes a JWT payload without verifying it (the proxy is the one that trusts it). */
export function jwtClaims(token: string): Record<string, any> | undefined {
  const part = token.split('.')[1];
  if (!part || token.split('.').length !== 3) { return undefined; }
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function decodeSession(jwt: string): SessionInfo {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
  if (typeof payload.key !== 'string') { throw new Error('Session key not found in login token.'); }
  return { key: payload.key, userId: payload.user_id, userEmail: payload.user_email };
}

function errorMessage(res: RawResponse): string {
  let msg = res.body.slice(0, 300);
  try {
    const j = JSON.parse(res.body);
    msg = j?.error?.message ?? (typeof j?.detail === 'string' ? j.detail : j?.detail?.error) ?? msg;
  } catch { /* keep raw body */ }
  if (res.status === 401 || res.status === 403) {
    return `Unauthorized (${res.status}). Your key or session may be invalid or expired. ${msg}`;
  }
  return `Server error (${res.status}): ${msg}`;
}
