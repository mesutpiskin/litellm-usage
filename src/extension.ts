import * as vscode from 'vscode';
import { Account, AccountStore, AuthMode } from './accounts';
import { addMetrics, ApiError, DailyEntry, emptyMetrics, jwtClaims, KeyInfo, LiteLLMClient, Metrics, UserInfoResponse } from './client';
import { broadcast, DashboardPanel, UsageViewProvider } from './dashboard';

export type Range = 1 | 7 | 30 | 90;
export type Scope = 'user' | 'key';

export interface AccountSummary {
  id: string;
  label: string;
  host: string;
  active: boolean;
  spend?: number;
  maxBudget?: number | null;
  error?: string;
}

export interface UsageState {
  configured: boolean;
  loading: boolean;
  host: string;
  accountLabel?: string;
  accounts: AccountSummary[];
  error?: string;
  /** The active SSO session expired; the user has to sign in again in the browser. */
  needsReauth?: boolean;
  sessionExpiresAt?: string;
  lastUpdated?: string;
  range: Range;
  scope: Scope;
  keyInfo?: KeyInfo;
  userInfo?: UserInfoResponse;
  models: string[];
  days: { date: string; metrics: Metrics }[];
  modelUsage: { name: string; metrics: Metrics }[];
  totals: Metrics;
  today: Metrics;
  activityUnsupported: boolean;
}

let controller: UsageController | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const accounts = new AccountStore(context);
  await accounts.migrateLegacy();

  controller = new UsageController(context, accounts);
  context.subscriptions.push(
    controller,
    vscode.window.registerWebviewViewProvider(UsageViewProvider.viewType, new UsageViewProvider(controller),
      { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('litellm.showDashboard', () => controller!.showDashboard()),
    vscode.commands.registerCommand('litellm.addAccount', () => controller!.addAccount()),
    vscode.commands.registerCommand('litellm.switchAccount', () => controller!.switchAccount()),
    vscode.commands.registerCommand('litellm.renameAccount', () => controller!.renameAccount()),
    vscode.commands.registerCommand('litellm.removeAccount', () => controller!.removeAccount()),
    vscode.commands.registerCommand('litellm.reauthenticate', () => controller!.reauthenticate()),
    vscode.commands.registerCommand('litellm.refresh', () => controller!.refresh()),
  );
  void controller.refresh();
}

export function deactivate() {
  controller = undefined;
}

class UsageController implements vscode.Disposable {
  private readonly statusItem: vscode.StatusBarItem;
  private timer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];
  /** Incremented on every refresh / account switch so late responses from a previous account are dropped. */
  private generation = 0;
  /** SSO accounts we already nagged about an expired session (cleared on successful sign-in). */
  private readonly reauthPrompted = new Set<string>();
  state: UsageState;

  constructor(private readonly context: vscode.ExtensionContext, private readonly accounts: AccountStore) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusItem.show();

    this.state = {
      configured: false,
      loading: false,
      host: '',
      accounts: [],
      range: context.globalState.get<Range>('range', 7),
      scope: context.globalState.get<Scope>('scope', 'user'),
      ...emptyUsage(),
    };

    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('litellm')) {
        this.scheduleTimer();
        void this.refresh();
      }
    }));
    this.scheduleTimer();
    this.render();
  }

  dispose() {
    if (this.timer) { clearInterval(this.timer); }
    this.statusItem.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  private get config() { return vscode.workspace.getConfiguration('litellm'); }
  private get insecure() { return this.config.get<boolean>('allowInsecureTLS', false); }

  private client(account: Account, key?: string): LiteLLMClient | undefined {
    const base = LiteLLMClient.normalize(account.baseUrl);
    return base ? new LiteLLMClient(base, key, this.insecure) : undefined;
  }

  private scheduleTimer() {
    if (this.timer) { clearInterval(this.timer); }
    const minutes = Math.max(1, this.config.get<number>('refreshMinutes', 5));
    this.timer = setInterval(() => void this.refresh(), minutes * 60_000);
  }

  // MARK: Commands

  showDashboard() {
    DashboardPanel.show(this.context.extensionUri, this);
  }

  async setRange(range: Range) {
    this.state.range = range;
    await this.context.globalState.update('range', range);
    await this.refresh();
  }

  async setScope(scope: Scope) {
    this.state.scope = scope;
    await this.context.globalState.update('scope', scope);
    await this.refresh();
  }

  async addAccount() {
    const baseUrl = await vscode.window.showInputBox({
      title: 'Add LiteLLM account (1/3): proxy URL',
      prompt: 'e.g. https://litellm.example.com',
      value: this.accounts.active?.baseUrl.replace(/\/$/, '') ?? '',
      ignoreFocusOut: true,
      validateInput: v => LiteLLMClient.normalize(v) ? undefined : 'Invalid URL',
    });
    if (!baseUrl) { return; }
    const base = LiteLLMClient.normalize(baseUrl)!;

    const pick = await vscode.window.showQuickPick([
      { label: '$(globe) Browser sign-in (SSO)', description: 'Google, Microsoft, Okta… via your proxy', mode: 'sso' as AuthMode },
      { label: '$(key) API Key', description: 'Virtual key (sk-…)', mode: 'apiKey' as AuthMode },
      { label: '$(account) Username / Password', description: 'LiteLLM UI credentials', mode: 'password' as AuthMode },
    ], { title: 'Add LiteLLM account (2/3): sign-in method', ignoreFocusOut: true });
    if (!pick) { return; }

    try {
      let account: Omit<Account, 'id'>;
      let secrets: { apiKey?: string; sessionKey?: string; password?: string };
      let suggested: string;

      if (pick.mode === 'sso') {
        const result = await this.ssoSignIn(base);
        if (!result) { return; }
        account = { label: '', baseUrl: base.href, authMode: 'sso', userId: result.userId };
        secrets = { sessionKey: result.key };
        suggested = `${result.userId ?? 'SSO'} @ ${base.host}`;
      } else if (pick.mode === 'apiKey') {
        const key = (await vscode.window.showInputBox({
          title: 'Add LiteLLM account (3/3): virtual key', prompt: 'sk-...', password: true, ignoreFocusOut: true,
        }))?.trim();
        if (!key) { return; }
        const { info } = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'LiteLLM: verifying key…' },
          () => new LiteLLMClient(base, key, this.insecure).keyInfo());
        account = { label: '', baseUrl: base.href, authMode: 'apiKey' };
        secrets = { apiKey: key };
        suggested = info.key_alias ? `${info.key_alias} @ ${base.host}` : base.host;
      } else {
        const username = await vscode.window.showInputBox({
          title: 'Add LiteLLM account (3/3): username / email', ignoreFocusOut: true,
        });
        if (!username) { return; }
        const password = await vscode.window.showInputBox({ title: 'Password', password: true, ignoreFocusOut: true });
        if (!password) { return; }
        const session = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'LiteLLM: signing in…' },
          () => new LiteLLMClient(base, undefined, this.insecure).login(username, password));
        const remember = await vscode.window.showQuickPick(['Yes', 'No'], {
          title: 'Store the password in secure storage to renew the session automatically when it expires?',
          ignoreFocusOut: true,
        });
        account = { label: '', baseUrl: base.href, authMode: 'password', username };
        secrets = { sessionKey: session.key, password: remember === 'Yes' ? password : undefined };
        suggested = `${username} @ ${base.host}`;
      }

      const label = await vscode.window.showInputBox({
        title: 'Account name', prompt: 'Shown in the account switcher', value: suggested, ignoreFocusOut: true,
      });
      const created = await this.accounts.add({ ...account, label: label?.trim() || suggested }, secrets);
      await this.activate(created);
      vscode.window.showInformationMessage(`LiteLLM: added "${created.label}".`);
    } catch (e) {
      vscode.window.showErrorMessage(`LiteLLM: ${(e as Error).message}`);
    }
  }

  /** Runs LiteLLM's browser SSO flow and returns the session key, or undefined when cancelled. */
  private async ssoSignIn(base: URL): Promise<{ key: string; userId?: string } | undefined> {
    const client = new LiteLLMClient(base, undefined, this.insecure);
    const session = await client.startSso();
    const opened = await vscode.env.openExternal(vscode.Uri.parse(session.browserUrl, true));
    if (!opened) { throw new Error(`Could not open the browser. Visit ${session.browserUrl} manually.`); }

    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'LiteLLM: finish signing in in your browser',
      cancellable: true,
    }, async (progress, token) => {
      if (session.userCode) { progress.report({ message: `Verification code: ${session.userCode}` }); }
      const isCancelled = () => token.isCancellationRequested;
      let result = await client.waitForSso(session, { isCancelled });
      if (result.kind === 'selectTeam') {
        const team = await vscode.window.showQuickPick(
          result.teams.map(t => ({ label: t.alias ?? t.id, description: t.alias ? t.id : undefined, id: t.id })),
          { title: 'Select the team for this session', ignoreFocusOut: true });
        if (!team) { return undefined; }
        progress.report({ message: `Signing in to team ${team.label}…` });
        result = await client.waitForSso(session, { teamId: team.id, isCancelled });
      }
      return result.kind === 'ready' ? { key: result.key, userId: result.userId } : undefined;
    }).then(undefined, e => {
      if ((e as Error).message === 'Sign-in cancelled.') { return undefined; }
      throw e;
    });
  }

  /** Renews an expired SSO session for the active account. */
  async reauthenticate() {
    const account = this.accounts.active;
    const base = account && LiteLLMClient.normalize(account.baseUrl);
    if (!account || !base) { return this.addAccount(); }
    if (account.authMode !== 'sso') { return this.refresh(); }
    try {
      const result = await this.ssoSignIn(base);
      if (!result) { return; }
      await this.accounts.setSecret(account, 'sessionKey', result.key);
      if (result.userId && result.userId !== account.userId) { await this.accounts.update(account.id, { userId: result.userId }); }
      this.reauthPrompted.delete(account.id);
      await this.refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`LiteLLM: ${(e as Error).message}`);
    }
  }

  async switchAccount(id?: string) {
    const all = this.accounts.list();
    let target = all.find(a => a.id === id);
    if (!target) {
      const activeId = this.accounts.active?.id;
      type Item = vscode.QuickPickItem & { account?: Account };
      const items: Item[] = [
        ...all.map(a => ({
          label: `${a.id === activeId ? '$(check)' : '$(blank)'} ${a.label}`,
          description: hostOf(a),
          account: a,
        })),
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(add) Add account…' },
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Switch LiteLLM account' });
      if (!pick) { return; }
      if (!pick.account) { return this.addAccount(); }
      target = pick.account;
    }
    await this.activate(target);
  }

  async renameAccount(id?: string) {
    const account = id ? this.accounts.list().find(a => a.id === id) : await this.pickAccount('Rename LiteLLM account');
    if (!account) { return; }
    const label = await vscode.window.showInputBox({ title: 'Account name', value: account.label, ignoreFocusOut: true });
    if (!label?.trim()) { return; }
    await this.accounts.rename(account.id, label.trim());
    this.state.accounts = this.state.accounts.map(a => a.id === account.id ? { ...a, label: label.trim() } : a);
    if (account.id === this.accounts.active?.id) { this.state.accountLabel = label.trim(); }
    this.render();
  }

  async removeAccount(id?: string) {
    const account = id ? this.accounts.list().find(a => a.id === id) : await this.pickAccount('Remove LiteLLM account');
    if (!account) { return; }
    const ok = await vscode.window.showWarningMessage(
      `Remove "${account.label}"? Its stored credentials will be deleted.`, { modal: true }, 'Remove');
    if (ok !== 'Remove') { return; }
    await this.accounts.remove(account.id);
    Object.assign(this.state, emptyUsage(), { error: undefined, lastUpdated: undefined });
    await this.refresh();
  }

  private async pickAccount(title: string): Promise<Account | undefined> {
    const all = this.accounts.list();
    if (all.length <= 1) { return all[0]; }
    const activeId = this.accounts.active?.id;
    const pick = await vscode.window.showQuickPick(
      all.map(a => ({ label: a.label, description: hostOf(a) + (a.id === activeId ? ' · active' : ''), account: a })),
      { title });
    return pick?.account;
  }

  private async activate(account: Account) {
    await this.accounts.setActive(account.id);
    Object.assign(this.state, emptyUsage(), { error: undefined, lastUpdated: undefined });
    await this.refresh();
  }

  // MARK: Refresh

  private async reloginIfPossible(account: Account): Promise<boolean> {
    const password = await this.accounts.secret(account, 'password');
    const client = this.client(account);
    if (account.authMode !== 'password' || !password || !account.username || !client) { return false; }
    try {
      const session = await client.login(account.username, password);
      await this.accounts.setSecret(account, 'sessionKey', session.key);
      return true;
    } catch {
      return false;
    }
  }

  private promptReauth(account: Account) {
    if (this.reauthPrompted.has(account.id)) { return; }
    this.reauthPrompted.add(account.id);
    void vscode.window.showWarningMessage(`LiteLLM: the SSO session for "${account.label}" has expired.`, 'Sign in again')
      .then(choice => { if (choice) { void this.reauthenticate(); } });
  }

  async refresh(retried = false): Promise<void> {
    const gen = ++this.generation;
    const account = this.accounts.active;
    const key = account && await this.accounts.key(account);
    const client = account && this.client(account, key);

    this.state.host = account ? hostOf(account) : '';
    this.state.accountLabel = account?.label;
    this.state.configured = !!(key && client);
    this.state.accounts = this.accounts.list().map(a => ({
      ...(this.state.accounts.find(s => s.id === a.id) ?? {}),
      id: a.id, label: a.label, host: hostOf(a), active: a.id === account?.id,
    }));
    if (!account || !key || !client) { this.render(); return; }

    void this.refreshSummaries(gen);
    this.state.loading = true;
    this.render();
    const sso = account.authMode === 'sso';
    try {
      // SSO session tokens are short-lived per-session credentials, not virtual keys, so /key/info
      // does not describe them; usage and budget come from the user instead.
      const info: KeyInfo = sso ? { user_id: account.userId ?? jwtClaims(key)?.user_id } : (await client.keyInfo()).info;
      const modelsP = client.models().catch(e => {
        if (sso && e instanceof ApiError && e.unauthorized) { throw e; }
        return this.state.models;
      });
      const userP = info.user_id
        ? client.userInfo(info.user_id).catch(e => {
          if (sso && e instanceof ApiError && e.unauthorized) { throw e; }
          return undefined;
        })
        : Promise.resolve(undefined);

      const [start, end] = dateBounds(this.state.range);
      const activityP = client.dailyActivity(start, end, this.state.scope === 'key' ? info.token : undefined)
        .then(entries => ({ entries, unsupported: false }), (e: unknown) => {
          // Virtual keys commonly have access to /key/info and /v2/user/info but not the
          // analytics route. Preserve their total spend/budget instead of failing refresh.
          if (e instanceof ApiError && (e.status === 404 || (!sso && e.unauthorized))) {
            return { entries: [] as DailyEntry[], unsupported: true };
          }
          throw e;
        });
      // Awaited together so a failure in one request never leaves another rejection unhandled.
      const [models, userInfo, { entries, unsupported }] = await Promise.all([modelsP, userP, activityP]);
      if (gen !== this.generation) { return; }

      this.state.keyInfo = info;
      this.state.userInfo = userInfo;
      this.state.models = models;
      this.state.activityUnsupported = unsupported;
      this.aggregate(entries, end);
      this.updateSummary(account.id, {
        spend: userInfo?.user_info?.spend ?? info.spend, maxBudget: info.max_budget ?? userInfo?.user_info?.max_budget,
        error: undefined,
      });
      const exp = sso ? jwtClaims(key)?.exp : undefined;
      this.state.sessionExpiresAt = typeof exp === 'number' ? new Date(exp * 1000).toISOString() : undefined;
      this.state.needsReauth = false;
      this.state.lastUpdated = new Date().toISOString();
      this.state.error = undefined;
    } catch (e) {
      if (gen !== this.generation) { return; }
      if (e instanceof ApiError && e.unauthorized && !retried && await this.reloginIfPossible(account)) {
        return this.refresh(true);
      }
      this.state.error = (e as Error).message;
      if (sso && e instanceof ApiError && e.unauthorized) {
        this.state.needsReauth = true;
        this.state.error = 'Your SSO session has expired. Sign in again to continue.';
        this.promptReauth(account);
      }
      this.updateSummary(account.id, { error: this.state.error });
    } finally {
      if (gen === this.generation) {
        this.state.loading = false;
        this.render();
      }
    }
  }

  /** Fetches total spend for the non-active accounts so the switcher can show them side by side. */
  private async refreshSummaries(gen: number) {
    const others = this.accounts.list().filter(a => a.id !== this.accounts.active?.id);
    await Promise.all(others.map(async a => {
      try {
        const client = this.client(a, await this.accounts.key(a));
        if (!client) { return; }
        const info: KeyInfo = a.authMode === 'sso' ? { user_id: a.userId } : (await client.keyInfo()).info;
        const user = info.user_id
          ? await client.userInfo(info.user_id).catch(e => { if (a.authMode === 'sso') { throw e; } return undefined; })
          : undefined;
        if (gen === this.generation) {
          this.updateSummary(a.id, {
            spend: user?.user_info?.spend ?? info.spend, maxBudget: info.max_budget ?? user?.user_info?.max_budget,
            error: undefined,
          });
        }
      } catch (e) {
        if (gen === this.generation) { this.updateSummary(a.id, { error: (e as Error).message }); }
      }
    }));
    if (gen === this.generation) { this.render(); }
  }

  private updateSummary(id: string, patch: Partial<AccountSummary>) {
    this.state.accounts = this.state.accounts.map(a => a.id === id ? { ...a, ...patch } : a);
  }

  private aggregate(entries: DailyEntry[], todayStr: string) {
    const byDay = new Map<string, Metrics>();
    const byModel = new Map<string, Metrics>();
    for (const e of entries) {
      byDay.set(e.date, addMetrics(byDay.get(e.date) ?? emptyMetrics(), e.metrics));
      for (const [name, item] of Object.entries(e.breakdown?.models ?? {})) {
        byModel.set(name, addMetrics(byModel.get(name) ?? emptyMetrics(), item.metrics));
      }
    }
    this.state.days = [...byDay].map(([date, metrics]) => ({ date, metrics })).sort((a, b) => a.date.localeCompare(b.date));
    this.state.modelUsage = [...byModel].map(([name, metrics]) => ({ name, metrics }))
      .sort((a, b) => b.metrics.spend - a.metrics.spend || b.metrics.total_tokens - a.metrics.total_tokens);
    this.state.totals = [...byDay.values()].reduce((acc, m) => addMetrics(acc, m), emptyMetrics());
    this.state.today = byDay.get(todayStr) ?? emptyMetrics();
  }

  // MARK: Rendering

  private render() {
    const s = this.state;
    const item = this.statusItem;
    if (!s.configured) {
      item.text = '$(pulse) LiteLLM: Add account';
      item.tooltip = 'Add a LiteLLM account to see your usage';
      item.command = s.accounts.length > 1 ? 'litellm.switchAccount' : 'litellm.addAccount';
    } else {
      item.command = s.needsReauth ? 'litellm.reauthenticate' : 'litellm.showDashboard';
      const icon = s.loading ? '$(sync~spin)' : s.error ? '$(warning)' : '$(pulse)';
      let text = '';
      switch (this.config.get<string>('statusBar', 'todaySpend')) {
        case 'todaySpend': text = money(s.today.spend); break;
        case 'todayTokens': text = tokens(s.today.total_tokens); break;
        case 'totalSpend': text = money(s.userInfo?.user_info?.spend ?? s.keyInfo?.spend ?? 0); break;
      }
      item.text = s.lastUpdated && text ? `${icon} ${text}` : icon;

      const tip = new vscode.MarkdownString(undefined, true);
      tip.appendMarkdown(`**LiteLLM** · ${s.accountLabel ?? s.host}\n\n`);
      if (s.error) { tip.appendMarkdown(`$(warning) ${s.error}\n\n`); }
      tip.appendMarkdown(`Today: **${money(s.today.spend)}** · ${tokens(s.today.total_tokens)} tokens · ${s.today.api_requests} requests\n\n`);
      tip.appendMarkdown(`Total spend: **${money(s.userInfo?.user_info?.spend ?? s.keyInfo?.spend ?? 0)}**`);
      const budget = s.keyInfo?.max_budget ?? s.userInfo?.user_info?.max_budget;
      if (budget) { tip.appendMarkdown(` / ${money(budget)}`); }
      if (s.accounts.length > 1) {
        tip.appendMarkdown('\n\n---\n\n');
        for (const a of s.accounts) {
          const value = a.error ? '$(warning)' : a.spend !== undefined ? money(a.spend) : '…';
          tip.appendMarkdown(`${a.active ? '$(check)' : '$(blank)'} ${a.label}: ${value}\n\n`);
        }
      }
      tip.appendMarkdown('\n\n_Click to open the dashboard_');
      item.tooltip = tip;
    }
    broadcast(s);
  }
}

function emptyUsage() {
  return {
    needsReauth: false, sessionExpiresAt: undefined as string | undefined,
    keyInfo: undefined, userInfo: undefined, models: [] as string[], days: [], modelUsage: [],
    totals: emptyMetrics(), today: emptyMetrics(), activityUnsupported: false,
  };
}

function hostOf(account: Account): string {
  return LiteLLMClient.normalize(account.baseUrl)?.host ?? account.baseUrl;
}

function dateBounds(range: Range): [string, string] {
  const now = new Date();
  const start = new Date(now.getTime() - (range - 1) * 86_400_000);
  return [start.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
}

export function money(v: number): string {
  if (!v) { return '$0'; }
  if (v < 0.01) { return `$${v.toFixed(4)}`; }
  if (v < 100) { return `$${v.toFixed(2)}`; }
  return `$${v.toFixed(0)}`;
}

export function tokens(v: number): string {
  if (v >= 1e9) { return `${(v / 1e9).toFixed(1)}B`; }
  if (v >= 1e6) { return `${(v / 1e6).toFixed(1)}M`; }
  if (v >= 1e3) { return `${(v / 1e3).toFixed(1)}K`; }
  return String(v);
}
