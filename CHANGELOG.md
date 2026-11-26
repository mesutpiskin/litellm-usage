# Changelog

## Unreleased

- Show dates in the operating system's regional format (for example `dd.MM.yyyy` with a 24-hour
  clock) instead of VS Code's display language. This covers "Resets", "SSO session expires",
  "Last updated" and the daily chart labels and tooltips. On Windows the short date / time
  patterns are read from the regional settings, on macOS from the system region and the 24-hour
  setting, and elsewhere from `LC_TIME` / `LANG`.

## 0.7.4

- Recover daily and per-model usage from local Claude Code (`~/.claude-corp`, `~/.claude`) and
  Codex CLI (`~/.codex-corp`, `~/.codex`) session logs priced via `/model/info` when a proxy blocks
  virtual keys from calling `/user/daily/activity`.
- Automatically discover companion Claude and Codex virtual keys (`~/.claude-corp/key`,
  `~/.codex-corp/key`) for the same LiteLLM user so both Claude and Codex models, pricing and
  per-key budgets appear together under a single account.

## 0.7.3

- Fix the "This account cannot access /user/daily/activity" regression on proxies that reject a
  key-scoped activity request (unknown hash or a route restricted to the unscoped form): the
  request is retried without the key filter before falling back to the budget-only view.

## 0.7.2

- Fix leaked proxy-wide usage for accounts signed in with another member's virtual key (a common
  admin setup): daily activity is now always scoped to the key, so "Spend" matches the user instead
  of summing every user on the proxy.
- Fix the budget shown for such accounts: the signed-in user's own budget now wins over the cap
  attached to the key (e.g. $1.92 / $1.00 correctly becomes $1.92 / $5.00).

## 0.7.1

- New `LiteLLM: Debug: Copy State to Clipboard` command that shares a scrubbed usage-state snapshot for quick troubleshooting.

## 0.7.0

- Usage distribution: a stacked 100% bar shows what share of spend, tokens or requests goes to each model family.
  Dated and cloud-prefixed variants are grouped automatically, e.g. all `claude-…` aliases roll up to **Claude Sonnet 4.5**
  and `gpt-…-codex` / `codex-…` aliases to **Codex**.
- The model table and sidebar model cards now show each model's percentage share of spend (and tokens in the full dashboard).

## 0.6.2

- Use LiteLLM's new `/v2/user/info` endpoint while retaining compatibility with older proxies.
- Keep total spend and budget available when a virtual key cannot access daily activity analytics.

## 0.6.1

- New README with a screenshot, getting-started guide and FAQ.

## 0.6.0

- Browser sign-in (SSO): sign in with your proxy's identity provider (Google, Microsoft Entra ID, Okta, …) using LiteLLM's CLI SSO flow, including team selection and legacy proxies.
- Expired SSO sessions show a "Sign in again" prompt in the status bar, sidebar and dashboard.

## 0.5.0

- Multiple accounts: add, switch, rename and remove accounts from the sidebar, dashboard, status bar or Command Palette.
- Accounts overview with each account's total spend and budget.
- The `litellm.baseUrl` setting was replaced by per-account URLs; an existing sign-in is migrated automatically.

## 0.4.0

- Activity Bar view: compact usage sidebar with refresh, sign-in / sign-out and "open full dashboard" actions.

## 0.3.0

- English UI and documentation.
- Published to the Visual Studio Marketplace and Open VSX.

## 0.2.0

- Initial VS Code extension: status bar item, usage dashboard, API key and username / password sign-in.
