import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { Range, Scope, UsageState } from './extension';

export interface DashboardHost {
  state: UsageState;
  refresh(): Promise<void>;
  setRange(range: Range): Promise<void>;
  setScope(scope: Scope): Promise<void>;
  addAccount(): Promise<void>;
  switchAccount(id?: string): Promise<void>;
  renameAccount(id?: string): Promise<void>;
  removeAccount(id?: string): Promise<void>;
  reauthenticate(): Promise<void>;
  showDashboard(): void;
}

/** Every live webview (editor panel + sidebar view) that renders usage state. */
const webviews = new Set<vscode.Webview>();

export function broadcast(state: UsageState) {
  for (const w of webviews) { void w.postMessage({ type: 'state', state }); }
}

function attach(webview: vscode.Webview, host: DashboardHost, compact: boolean): vscode.Disposable {
  webview.html = html(crypto.randomBytes(16).toString('hex'), webview.cspSource, compact);
  webviews.add(webview);
  const sub = webview.onDidReceiveMessage(msg => {
    switch (msg?.type) {
      case 'ready': void webview.postMessage({ type: 'state', state: host.state }); break;
      case 'refresh': void host.refresh(); break;
      case 'range': void host.setRange(msg.value); break;
      case 'scope': void host.setScope(msg.value); break;
      case 'addAccount': void host.addAccount(); break;
      case 'switchAccount': void host.switchAccount(msg.value); break;
      case 'renameAccount': void host.renameAccount(msg.value); break;
      case 'removeAccount': void host.removeAccount(msg.value); break;
      case 'reauth': void host.reauthenticate(); break;
      case 'open': host.showDashboard(); break;
    }
  });
  return new vscode.Disposable(() => { webviews.delete(webview); sub.dispose(); });
}

/** Full dashboard in an editor tab. */
export class DashboardPanel {
  private static current?: vscode.WebviewPanel;

  static show(extensionUri: vscode.Uri, host: DashboardHost) {
    if (DashboardPanel.current) {
      DashboardPanel.current.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('litellmUsage', 'LiteLLM Usage', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [extensionUri],
    });
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
    const binding = attach(panel.webview, host, false);
    panel.onDidDispose(() => { binding.dispose(); DashboardPanel.current = undefined; });
    DashboardPanel.current = panel;
  }
}

/** Compact usage view in the LiteLLM activity bar container. */
export class UsageViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'litellm.usageView';

  constructor(private readonly host: DashboardHost) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true };
    const binding = attach(view.webview, this.host, true);
    view.onDidDispose(() => binding.dispose());
  }
}

function html(nonce: string, cspSource: string, compact: boolean): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground);
         padding: 16px 20px; max-width: 980px; }
  h1 { font-size: 1.4em; margin: 0; } h2 { font-size: 1.05em; margin: 22px 0 8px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .spacer { flex: 1; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
           border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, transparent);
          border-radius: 6px; padding: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .big { font-size: 1.6em; font-weight: 600; font-variant-numeric: tabular-nums; }
  .error { color: var(--vscode-errorForeground); margin: 10px 0; white-space: pre-wrap; }
  .bar { height: 6px; border-radius: 3px; background: var(--vscode-editorWidget-border, #8884); overflow: hidden; }
  .bar > div { height: 100%; background: var(--vscode-progressBar-background); }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 5px 8px; border-bottom: 1px solid var(--vscode-widget-border, #8883); }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--vscode-descriptionForeground); font-weight: normal; }
  svg .b { fill: var(--vscode-charts-blue, var(--vscode-progressBar-background)); }
  svg text { fill: var(--vscode-descriptionForeground); font-size: 10px; }
  code { font-family: var(--vscode-editor-font-family); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
  body.compact { padding: 4px 12px 16px; }
  body.compact h1 { font-size: 1.1em; }
  body.compact h2 { margin: 16px 0 6px; }
  body.compact .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  body.compact .card { padding: 8px; }
  body.compact .big { font-size: 1.2em; }
  body.compact button { padding: 3px 7px; }
  .model { margin-bottom: 8px; }
  .model .row { gap: 4px; }
  .model code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .full { width: 100%; margin-top: 16px; }
  .accountbar { margin: 8px 0 4px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border, transparent); padding: 3px 6px; border-radius: 3px; font: inherit;
           flex: 1; min-width: 0; max-width: 360px; }
  .acct { padding: 8px 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--vscode-widget-border, #8883); margin-bottom: 6px; }
  .acct:hover { background: var(--vscode-list-hoverBackground); }
  .acct.active { border-color: var(--vscode-focusBorder); }
</style>
</head>
<body class="${compact ? 'compact' : ''}">
<div id="root" class="muted">Loading…</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let chartMetric = 'spend';
const compact = document.body.classList.contains('compact');
let state;

const money = v => !v ? '$0' : v < 0.01 ? '$' + v.toFixed(4) : v < 100 ? '$' + v.toFixed(2) : '$' + v.toFixed(0);
const tokens = v => v >= 1e9 ? (v/1e9).toFixed(1)+'B' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : String(v);
const num = v => (v ?? 0).toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(); };

window.addEventListener('message', e => { if (e.data?.type === 'state') { state = e.data.state; render(); } });
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action;
  if (a === 'chart') { chartMetric = t.dataset.value; render(); return; }
  const v = t.dataset.value;
  vscode.postMessage({ type: a, value: a === 'range' ? +v : v });
});
document.addEventListener('change', e => {
  if (e.target.id === 'account') vscode.postMessage({ type: 'switchAccount', value: e.target.value });
});
vscode.postMessage({ type: 'ready' });

function chart(days) {
  if (days.length < 2) return '';
  const val = m => chartMetric === 'spend' ? m.spend : chartMetric === 'tokens' ? m.total_tokens : m.api_requests;
  const fmt = chartMetric === 'spend' ? money : tokens;
  const W = compact ? 320 : 900, H = compact ? 130 : 160, pad = compact ? 34 : 40, max = Math.max(...days.map(d => val(d.metrics)), 1e-9);
  const bw = (W - pad) / days.length;
  const bars = days.map((d, i) => {
    const h = (val(d.metrics) / max) * (H - 30);
    const x = pad + i * bw;
    const maxLabels = compact ? 6 : 30;
    const label = i % Math.ceil(days.length / maxLabels) === 0
      ? '<text x="' + (x + bw/2) + '" y="' + (H - 4) + '" text-anchor="middle">' + d.date.slice(5) + '</text>' : '';
    return '<rect class="b" x="' + (x + 1) + '" y="' + (H - 18 - h) + '" width="' + Math.max(1, bw - 2) + '" height="' + h + '" rx="2">'
      + '<title>' + d.date + ': ' + fmt(val(d.metrics)) + '</title></rect>' + label;
  }).join('');
  const axis = '<text x="0" y="12">' + fmt(max) + '</text><text x="0" y="' + (H - 18) + '">0</text>';
  const btn = (k, l) => '<button data-action="chart" data-value="' + k + '" class="' + (chartMetric === k ? 'active' : '') + '">' + l + '</button>';
  return '<h2 class="row">Daily <span class="spacer"></span>' + btn('spend','Spend') + btn('tokens','Tokens') + btn('requests','Requests') + '</h2>'
    + '<div class="card"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + axis + bars + '</svg></div>';
}

function accountBar(s) {
  const options = s.accounts.map(a => '<option value="' + esc(a.id) + '"' + (a.active ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('');
  const active = s.accounts.find(a => a.active);
  return '<div class="row accountbar">'
    + (s.accounts.length ? '<select id="account" title="Switch account">' + options + '</select>' : '')
    + '<button data-action="addAccount" title="Add account">+ Add</button>'
    + (active ? '<button data-action="renameAccount" data-value="' + esc(active.id) + '" title="Rename account">Rename</button>'
      + '<button data-action="removeAccount" data-value="' + esc(active.id) + '" title="Remove account">Remove</button>' : '')
    + '</div>';
}

function render() {
  const root = document.getElementById('root');
  const s = state;
  if (!s.configured) {
    root.innerHTML = '<h1>LiteLLM Usage</h1>'
      + (s.accounts.length
        ? '<p class="muted">Could not load the selected account.</p>' + accountBar(s) + (s.error ? '<div class="error">⚠ ' + esc(s.error) + '</div>' : '')
          + (s.needsReauth ? '<button class="primary" data-action="reauth">Sign in again</button>' : '')
        : '<p class="muted">Add a LiteLLM account to see your spend, token and model usage.</p><button class="primary" data-action="addAccount">Add account</button>');
    root.classList.remove('muted');
    return;
  }
  root.classList.remove('muted');
  const ui = s.userInfo?.user_info, ki = s.keyInfo ?? {};
  const spend = ui?.spend ?? ki.spend ?? 0;
  const budget = ki.max_budget ?? ui?.max_budget;
  const reset = ki.budget_reset_at ?? ui?.budget_reset_at;
  const t = s.totals;
  const rangeBtn = (v, l) => '<button data-action="range" data-value="' + v + '" class="' + (s.range === v ? 'active' : '') + '">' + l + '</button>';
  const scopeBtn = (v, l) => '<button data-action="scope" data-value="' + v + '" class="' + (s.scope === v ? 'active' : '') + '">' + l + '</button>';

  let h = compact
    ? accountBar(s) + '<div class="muted">' + esc(s.host) + (s.loading ? ' · Refreshing…' : '') + '</div>'
    : '<div class="row"><h1>' + esc(s.accountLabel || ki.key_alias || 'LiteLLM') + '</h1><span class="muted">' + esc(s.host) + '</span>'
      + '<span class="spacer"></span>' + (s.loading ? '<span class="muted">Refreshing…</span>' : '')
      + '<button data-action="refresh">Refresh</button></div>' + accountBar(s);
  if (s.error) h += '<div class="error">⚠ ' + esc(s.error) + '</div>';
  if (s.needsReauth) h += '<button class="primary" data-action="reauth">Sign in again</button>';

  h += '<h2>Budget</h2><div class="card"><div class="row"><span class="big">' + money(spend) + '</span>'
    + (budget ? '<span class="muted">/ ' + money(budget) + '</span>' : '<span class="muted">no budget limit</span>')
    + '<span class="spacer"></span>'
    + (ki.rpm_limit ? '<span class="muted">RPM ' + num(ki.rpm_limit) + '</span>' : '')
    + (ki.tpm_limit ? '<span class="muted">TPM ' + tokens(ki.tpm_limit) + '</span>' : '') + '</div>';
  if (budget) h += '<div class="bar" style="margin-top:8px"><div style="width:' + Math.min(100, spend / budget * 100).toFixed(1) + '%"></div></div>';
  if (reset) h += '<div class="muted" style="margin-top:6px">Resets: ' + fmtDate(reset) + '</div>';
  if (s.sessionExpiresAt) h += '<div class="muted" style="margin-top:6px">SSO session expires: ' + fmtDate(s.sessionExpiresAt) + '</div>';
  h += '</div>';

  h += '<h2 class="row">Usage <span class="spacer"></span>' + (compact
      ? '</h2><div class="row">' + rangeBtn(1,'1d') + rangeBtn(7,'7d') + rangeBtn(30,'30d') + rangeBtn(90,'90d')
        + '<span class="spacer"></span>' + scopeBtn('user','All keys') + scopeBtn('key','This key') + '</div><div style="height:8px"></div>'
      : rangeBtn(1,'Today') + rangeBtn(7,'7 days') + rangeBtn(30,'30 days') + rangeBtn(90,'90 days')
        + '<span style="width:12px"></span>' + scopeBtn('user','All my keys') + scopeBtn('key','This key') + '</h2>');
  h += '<div class="grid">'
    + '<div class="card"><div class="muted">Spend</div><div class="big">' + money(t.spend) + '</div></div>'
    + '<div class="card"><div class="muted">Total tokens</div><div class="big">' + tokens(t.total_tokens) + '</div></div>'
    + '<div class="card"><div class="muted">Input / Output</div><div class="big">' + tokens(t.prompt_tokens) + ' / ' + tokens(t.completion_tokens) + '</div></div>'
    + '<div class="card"><div class="muted">Requests</div><div class="big">' + num(t.api_requests) + '</div>'
    + (t.failed_requests ? '<div class="error" style="margin:0">' + num(t.failed_requests) + ' failed</div>' : '') + '</div></div>';

  if (s.activityUnsupported) {
    h += '<p class="muted">This account cannot access /user/daily/activity, so daily and per-model breakdowns are unavailable.</p>';
  } else {
    h += chart(s.days);
    h += '<h2>Models</h2>';
    if (!s.modelUsage.length) {
      h += '<p class="muted">No usage in this period.</p>';
    } else {
      const maxSpend = Math.max(...s.modelUsage.map(m => m.metrics.spend), 1e-9);
      if (compact) {
        h += s.modelUsage.map(m => '<div class="model"><div class="row"><code title="' + esc(m.name) + '">' + esc(m.name) + '</code><span>' + money(m.metrics.spend) + '</span></div>'
          + '<div class="bar"><div style="width:' + (m.metrics.spend / maxSpend * 100).toFixed(1) + '%"></div></div>'
          + '<div class="muted">' + tokens(m.metrics.total_tokens) + ' tokens · ' + num(m.metrics.api_requests) + ' requests</div></div>').join('');
      } else h += '<table><tr><th>Model</th><th>Spend</th><th>Tokens</th><th>Input</th><th>Output</th><th>Requests</th><th style="width:22%"></th></tr>'
        + s.modelUsage.map(m => '<tr><td><code>' + esc(m.name) + '</code></td><td>' + money(m.metrics.spend) + '</td><td>' + tokens(m.metrics.total_tokens)
          + '</td><td>' + tokens(m.metrics.prompt_tokens) + '</td><td>' + tokens(m.metrics.completion_tokens) + '</td><td>' + num(m.metrics.api_requests)
          + '</td><td><div class="bar"><div style="width:' + (m.metrics.spend / maxSpend * 100).toFixed(1) + '%"></div></div></td></tr>').join('')
        + '</table>';
    }
  }

  if (s.accounts.length > 1) {
    h += '<h2>Accounts</h2>' + s.accounts.map(a => '<div class="acct' + (a.active ? ' active' : '') + '" data-action="switchAccount" data-value="' + esc(a.id) + '">'
      + '<div class="row"><strong>' + esc(a.label) + '</strong><span class="spacer"></span>'
      + (a.error ? '<span class="error" style="margin:0" title="' + esc(a.error) + '">⚠</span>' : a.spend !== undefined ? '<span>' + money(a.spend) + (a.maxBudget ? ' <span class="muted">/ ' + money(a.maxBudget) + '</span>' : '') + '</span>' : '<span class="muted">…</span>')
      + '</div><div class="muted">' + esc(a.host) + '</div></div>').join('');
  }

  const keys = s.userInfo?.keys ?? [];
  if (keys.length > 1) {
    h += '<h2>My keys</h2><table><tr><th>Key</th><th>Spend</th><th>Budget</th></tr>'
      + [...keys].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)).map(k => '<tr><td>' + esc(k.key_alias || k.key_name || 'Unnamed')
        + '</td><td>' + money(k.spend ?? 0) + '</td><td>' + (k.max_budget ? money(k.max_budget) : '—') + '</td></tr>').join('') + '</table>';
  }
  if (s.models.length) {
    h += '<h2>Available models (' + s.models.length + ')</h2><div class="chips">' + s.models.map(m => '<code>' + esc(m) + '</code>').join('') + '</div>';
  }
  if (compact) h += '<button class="primary full" data-action="open">Open full dashboard</button>';
  if (s.lastUpdated) h += '<p class="muted" style="margin-top:' + (compact ? 10 : 20) + 'px">Last updated: ' + fmtDate(s.lastUpdated) + '</p>';
  root.innerHTML = h;
}
</script>
</body>
</html>`;
}
