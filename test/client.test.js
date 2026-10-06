const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LiteLLMClient, ApiError } = require('../out/client');

const jwt = 'eyJhbGciOiJIUzI1NiJ9.'
  + Buffer.from(JSON.stringify({ key: 'sk-session', user_id: 'u1', user_email: 'dev@example.com' })).toString('base64url')
  + '.sig';

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (new URLSearchParams(body).get('password') !== 'secret') { return json(401, { detail: 'Invalid credentials' }); }
        res.writeHead(303, { Location: '/ui', 'Set-Cookie': `token=${jwt}; Path=/; HttpOnly` });
        res.end();
      });
      return;
    }
    if (!['Bearer sk-test', 'Bearer sk-session'].includes(req.headers.authorization)) {
      return json(401, { error: { message: 'Authentication Error' } });
    }
    switch (url.pathname) {
      case '/key/info':
        return json(200, { key: 'sk-test', info: { token: 'hash1', key_alias: 'my-key', spend: 12.5, max_budget: 50, user_id: 'u1' } });
      case '/v2/user/info':
        return json(200, { user_id: 'u1', user_email: 'dev@example.com', spend: 7.5, max_budget: 100 });
      case '/v1/models':
        return json(200, { data: [{ id: 'gpt-4o' }, { id: 'claude_sonnet' }] });
      case '/user/daily/activity': {
        const page = Number(url.searchParams.get('page'));
        return json(200, {
          results: [{
            date: page === 1 ? '2026-09-29' : '2026-09-30',
            metrics: { spend: 1.5, prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, api_requests: 10 },
            breakdown: { models: { claude_sonnet: { metrics: { spend: 1, total_tokens: 1000 } } } },
          }],
          metadata: { page, total_pages: 2, has_more: page < 2, key: url.searchParams.get('api_key') },
        });
      }
      default:
        return json(404, { detail: 'Not Found' });
    }
  });
  await new Promise(r => server.listen(0, r));
  base = LiteLLMClient.normalize(`http://localhost:${server.address().port}/ui/`);
});

after(() => server.close());

test('normalize strips trailing /ui and adds https', () => {
  assert.equal(LiteLLMClient.normalize('litellm.example.com/ui/').href, 'https://litellm.example.com/');
  assert.equal(LiteLLMClient.normalize(''), undefined);
});

test('reads key info and models with an API key', async () => {
  const client = new LiteLLMClient(base, 'sk-test');
  const { info } = await client.keyInfo();
  assert.equal(info.key_alias, 'my-key');
  assert.equal(info.max_budget, 50);
  assert.deepEqual(await client.models(), ['claude_sonnet', 'gpt-4o']);
  assert.deepEqual(await client.userInfo('u1'), {
    user_id: 'u1',
    user_info: { user_email: 'dev@example.com', user_role: undefined, spend: 7.5, max_budget: 100,
      budget_reset_at: undefined },
  });
});

test('follows daily activity pagination and keeps model names verbatim', async () => {
  const entries = await new LiteLLMClient(base, 'sk-test').dailyActivity('2026-09-24', '2026-09-30');
  assert.equal(entries.length, 2);
  assert.deepEqual(Object.keys(entries[0].breakdown.models), ['claude_sonnet']);
});

test('extracts the session key from the login cookie', async () => {
  const session = await new LiteLLMClient(base).login('dev', 'secret');
  assert.deepEqual(session, { key: 'sk-session', userId: 'u1', userEmail: 'dev@example.com' });
});

test('surfaces unauthorized errors', async () => {
  await assert.rejects(new LiteLLMClient(base).login('dev', 'wrong'), e => e instanceof ApiError && e.status === 401);
  await assert.rejects(new LiteLLMClient(base, 'sk-bad').keyInfo(), e => e instanceof ApiError && e.unauthorized);
});
