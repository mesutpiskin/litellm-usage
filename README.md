# LiteLLM Usage for VS Code

[![CI](https://github.com/mesutpiskin/litellm-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/mesutpiskin/litellm-usage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**See how much you spend on LLMs, without leaving your editor.**

LiteLLM Usage connects to your company's [LiteLLM](https://github.com/BerriAI/litellm) proxy and shows your spend, tokens, requests and per-model usage in the status bar, the sidebar and a full dashboard. Sign in with the same **Google / Microsoft / Okta SSO** you already use, and you don't need an admin account.

![LiteLLM Usage dashboard](media/screenshot.png)

## Why you'll like it

- 💸 **Know your spend at a glance.** Today's cost sits in the status bar and updates on its own.
- 🎯 **Stay inside your budget.** A progress bar shows total spend against your budget and when it resets.
- 📊 **See where the tokens go.** Get a daily chart and a per-model breakdown of spend, input / output tokens and requests for today or the last 7, 30 or 90 days.
- 🔐 **Sign in the way your company does.** Use browser SSO (Google, Microsoft Entra ID, Okta…), a virtual key or a LiteLLM username and password.
- 👥 **Work with multiple accounts.** Keep work and personal proxies or keys side by side, see each one's spend and switch in one click.
- 🧭 **Use it where you want.** It lives in the Activity Bar sidebar, in a full dashboard tab and in the status bar tooltip.
- 🛡️ **Keep credentials safe.** Keys and sessions are stored in your OS keychain through VS Code SecretStorage. Your SSO password never touches the extension.
- 🏢 **Use it on corporate networks.** It follows VS Code proxy settings and can trust internal / self-signed certificates.

## Installation

- **VS Code:** search for **LiteLLM Usage** in the Extensions view, or install it from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=mesutpiskin.litellm-usage).
- **Cursor, VSCodium, Windsurf:** install it from [Open VSX](https://open-vsx.org/extension/mesutpiskin/litellm-usage).
- **Offline / manual:** download the `.vsix` from [Releases](https://github.com/mesutpiskin/litellm-usage/releases) and run:
  ```bash
  code --install-extension litellm-usage-<version>.vsix
  ```

## Getting started

1. Click the **LiteLLM** icon in the Activity Bar (left side), then **Add account**. You can also click **LiteLLM: Add account** in the status bar.
2. Enter your proxy URL. This is the address of your LiteLLM dashboard without `/ui`, for example `https://litellm.example.com`.
3. Pick how you sign in:

   | Method | Pick it when… | What happens |
   |---|---|---|
   | **Browser sign-in (SSO)** | You sign in to the LiteLLM dashboard with Google, Microsoft, Okta… | Your browser opens the proxy's login page. Once you finish there, VS Code signs in on its own. If you're in more than one team, you pick one. |
   | **API Key** | You have a virtual key (`sk-…`) | Paste the key. It's checked right away. |
   | **Username / Password** | You sign in to the LiteLLM dashboard with a username and password | Enter them. You can save the password so the session renews itself. |

4. Give the account a name, or keep the suggested one. That's it, and your usage shows up in a few seconds.

> **Where do I find my virtual key?** Open your LiteLLM dashboard, go to **Virtual Keys**, and create or copy a key.

## Using it

### Sidebar
The **LiteLLM** icon in the Activity Bar opens a compact view with your budget, usage cards, the daily chart and your top models.
- The toolbar has **Refresh**, **Switch account** and **Open full dashboard**.
- The `…` menu has **Add**, **Rename** and **Remove** account.

### Dashboard
Click the status bar item, or run **LiteLLM: Show Usage Dashboard**, to open the full view in an editor tab. From there you can:
- Switch the time range: **Today**, **7 days**, **30 days** or **90 days**.
- Switch the scope: **All my keys** or **This key**.
- Chart **Spend**, **Tokens** or **Requests** per day.
- Browse the model table, your keys and the models available to you.

### Status bar
It shows today's spend. Hover over it for today's tokens and requests, your total spend against budget, and every account's spend at a glance. You can make it show tokens or total spend instead in [Settings](#settings).

### Multiple accounts
Add as many accounts as you like, for different proxies, keys or teams. You can switch between them from:
- the account drop-down,
- the **Accounts** list, where each account shows its own spend and budget,
- or **LiteLLM: Switch Account** in the Command Palette.

## Commands

Open the Command Palette (<kbd>⇧⌘P</kbd> / <kbd>Ctrl+Shift+P</kbd>) and type **LiteLLM**:

| Command | What it does |
|---|---|
| `LiteLLM: Show Usage Dashboard` | Open the full dashboard |
| `LiteLLM: Add Account` | Connect another proxy or key |
| `LiteLLM: Switch Account` | Change the active account |
| `LiteLLM: Rename Account` | Rename an account |
| `LiteLLM: Remove Account` | Remove an account and its stored credentials |
| `LiteLLM: Sign In Again (SSO)` | Renew an expired SSO session |
| `LiteLLM: Refresh` | Refresh now |

## Settings

| Setting | Default | Description |
|---|---|---|
| `litellm.statusBar` | `todaySpend` | What the status bar shows: `todaySpend`, `todayTokens`, `totalSpend` or `icon` |
| `litellm.refreshMinutes` | `5` | How often usage refreshes, in minutes |
| `litellm.allowInsecureTLS` | `false` | Trust self-signed / internal certificates |

## FAQ & troubleshooting

**Do I need an admin account?**
No. Everything uses endpoints that any LiteLLM user can call for their own data.

**The SSO session keeps expiring.**
SSO sessions are short-lived by design, 24 hours by default. When one expires, the extension shows **Sign in again**, which takes one click in your browser. Your LiteLLM admin can change the lifetime with `LITELLM_CLI_JWT_EXPIRATION_HOURS`.

**SSO sign-in finishes in the browser but VS Code times out.**
Your proxy probably runs several workers or replicas without a shared Redis cache, which the SSO flow needs. Ask your LiteLLM admin to set up Redis (see the [LiteLLM CLI SSO docs](https://docs.litellm.ai/docs/proxy/cli_sso)). Until then, sign in with a virtual key.

**I don't see the daily chart or the model breakdown.**
These need access to the `/user/daily/activity` endpoint. On older proxies, or when a virtual key is not permitted to call it, only total spend is shown.

**"This key" shows the same numbers as "All my keys".**
SSO accounts sign in as a user rather than as a single key, so their usage is always per user.

**I get certificate errors.**
Turn on `litellm.allowInsecureTLS` if your proxy uses an internal or self-signed certificate.

**What does the extension send, and where?**
It only talks to the proxy URL you enter, using these endpoints: `/key/info`, `/v2/user/info` (with `/user/info` fallback for older proxies), `/user/daily/activity`, `/v1/models`, and the login endpoints (`/login`, `/sso/cli/*`). There's no telemetry.

## Contributing

Issues and pull requests are welcome. To hack on it:

```bash
npm install
npm test        # compile and run the tests against a mock LiteLLM proxy
```

Then press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

## License

[MIT](LICENSE)
