// Minimal Claude Messages API client for the browser.
// Calls api.anthropic.com directly using the user's own key (stored only on the device).

const API_URL = 'https://api.anthropic.com/v1/messages';

export class ClaudeError extends Error {
  constructor(message, { status, type } = {}) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(apiKey, body, { signal, timeoutMs = 180000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort);
  try {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (ctrl.signal.aborted) throw new ClaudeError(signal?.aborted ? 'Cancelled' : 'The request took too long. Check your connection and try again.');
        if (attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
        throw new ClaudeError('No connection to Claude. Check mobile data or Wi-Fi.');
      }
      if (res.ok) return res.json();
      let payload = {};
      try { payload = await res.json(); } catch {}
      const type = payload?.error?.type;
      const msg = payload?.error?.message || res.statusText;
      const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
      if (retryable && attempt < 3) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : 2000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) throw new ClaudeError('The API key was rejected. Check it in Settings.', { status: 401, type });
      if (res.status === 403) throw new ClaudeError(`Access denied: ${msg}`, { status: 403, type });
      if (res.status === 400 && /credit|billing/i.test(msg)) throw new ClaudeError('Your Anthropic account has no credit left. Top up in the Claude Console.', { status: 400, type });
      throw new ClaudeError(`Claude API error ${res.status}: ${msg}`, { status: res.status, type });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Send a message and follow `pause_turn` continuations (server tools such as web search).
 * Returns { text, citations, usage }.
 */
export async function ask(apiKey, { model, system, content, tools, effort, maxTokens = 16000, signal }) {
  const messages = [{ role: 'user', content }];
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
  let texts = [];
  const citations = new Map();

  for (let turn = 0; turn < 6; turn++) {
    const body = { model, max_tokens: maxTokens, system, messages };
    if (tools) body.tools = tools;
    if (effort) body.output_config = { effort };
    const data = await post(apiKey, body, { signal });

    usage.input_tokens += data.usage?.input_tokens || 0;
    usage.input_tokens += data.usage?.cache_read_input_tokens || 0;
    usage.output_tokens += data.usage?.output_tokens || 0;
    usage.web_search_requests += data.usage?.server_tool_use?.web_search_requests || 0;

    for (const block of data.content || []) {
      if (block.type === 'text') {
        texts.push(block.text);
        for (const c of block.citations || []) {
          if (c.url) citations.set(c.url, { url: c.url, title: c.title || c.url });
        }
      }
    }

    if (data.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    if (data.stop_reason === 'max_tokens') {
      // Keep what we have; the JSON parser will tell us if it is unusable.
      break;
    }
    break;
  }
  return { text: texts.join('\n'), citations: [...citations.values()], usage };
}

/** Cheap call to validate a key from the Settings screen. */
export async function testKey(apiKey, model) {
  await post(apiKey, { model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] }, { timeoutMs: 30000 });
  return true;
}

/** USD cost estimate from usage. Rates are per million tokens. */
export function estimateCost(usage, rates) {
  return (
    (usage.input_tokens / 1e6) * rates.in +
    (usage.output_tokens / 1e6) * rates.out +
    (usage.web_search_requests || 0) * 0.01
  );
}
