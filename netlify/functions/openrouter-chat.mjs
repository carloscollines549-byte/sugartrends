const ALLOWED_MODELS = new Set([
  'meta-llama/llama-3.3-70b-instruct',
  'google/gemini-2.0-flash-001',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash-preview',
]);

const MAX_BODY_BYTES = 48_000;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_TOTAL_CHARS = 40_000;
const MAX_OUTPUT_TOKENS = 1_024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_IP = 8;
const rateBuckets = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function rateLimitExceeded(ip, now = Date.now()) {
  const recent = (rateBuckets.get(ip) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_PER_IP) {
    rateBuckets.set(ip, recent);
    return true;
  }
  if (!rateBuckets.has(ip) && rateBuckets.size >= 5_000) {
    const oldestIp = rateBuckets.keys().next().value;
    if (oldestIp !== undefined) rateBuckets.delete(oldestIp);
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return false;
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  const expectedOrigin = process.env.SITE_ORIGIN || 'https://sugartrends.netlify.app';
  if (request.headers.get('origin') !== expectedOrigin) {
    return json({ error: 'Request origin is not allowed.' }, 403);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return json({ error: 'OpenRouter is not configured on this site yet.' }, 503);
  }

  const ip = request.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (rateLimitExceeded(ip)) {
    return json({ error: 'Too many AI requests. Please wait a minute and try again.' }, 429);
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request is too large.' }, 413);
  }

  let input;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return json({ error: 'Request is too large.' }, 413);
    }
    input = JSON.parse(raw);
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'Invalid request body.' }, 400);
  }
  if (typeof input.model !== 'string' || !ALLOWED_MODELS.has(input.model)) {
    return json({ error: 'The selected model is not allowed.' }, 400);
  }
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 20) {
    return json({ error: 'Messages must be an array containing 1 to 20 entries.' }, 400);
  }

  let totalChars = 0;
  const messages = [];
  for (const message of input.messages) {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      return json({ error: 'Each message must have a supported role and text content.' }, 400);
    }
    if (message.content.length > MAX_MESSAGE_CHARS) {
      return json({ error: 'A message is too large.' }, 413);
    }
    totalChars += message.content.length;
    messages.push({ role: message.role, content: message.content });
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return json({ error: 'Conversation is too large.' }, 413);
  }

  const temperature = Number(input.temperature);
  const maxTokens = Number(input.max_tokens);
  const payload = {
    model: input.model,
    messages,
    temperature: Number.isFinite(temperature) ? Math.min(1.2, Math.max(0, temperature)) : 0.7,
    max_tokens: Number.isFinite(maxTokens) ? Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(maxTokens))) : MAX_OUTPUT_TOKENS,
    top_p: 1,
  };

  if (input.response_format?.type === 'json_object') {
    payload.response_format = { type: 'json_object' };
  }
  if (Array.isArray(input.tools) && input.tools.length === 1 && input.tools[0]?.type === 'openrouter:web_search') {
    payload.tools = [{ type: 'openrouter:web_search' }];
  }

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'http-referer': expectedOrigin,
        'x-title': 'Sukari Trends KSB Dashboard',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });

    const result = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const message = result?.error?.message || 'OpenRouter could not complete the request.';
      return json({ error: String(message).slice(0, 400) }, 502);
    }
    return json(result);
  } catch (error) {
    console.error('OpenRouter proxy request failed:', error?.name || 'Error');
    return json({ error: 'Could not reach OpenRouter. Please try again later.' }, 502);
  }
};
