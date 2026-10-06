# Changelog

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
