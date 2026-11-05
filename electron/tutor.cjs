const active = new Map();

function endpoint(config) {
  const base = new URL(config.endpoint || (config.mode === 'ollama' ? 'http://127.0.0.1:11434' : ''));
  if (base.username || base.password || !['http:', 'https:'].includes(base.protocol)) throw new Error('Use an HTTP(S) endpoint without embedded credentials.');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Remote tutors require HTTPS. Use HTTP only for a local model server.');
  return base.href.replace(/\/$/, '');
}

function auth(config) {
  return { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
}

async function listModels(config) {
  if (!['ollama', 'api'].includes(config.mode)) throw new Error('Choose Ollama or an API tutor first.');
  const base = endpoint(config);
  const response = await fetch(base + (config.mode === 'ollama' ? '/api/tags' : '/models'), { headers: auth(config), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Model server returned HTTP ${response.status}. Check the endpoint and credentials.`);
  const result = await response.json();
  return config.mode === 'ollama' ? (result.models || []).map(x => x.name) : (result.data || []).map(x => x.id);
}

async function chat({ config, messages, requestId }, onChunk = () => {}) {
  if (!['ollama', 'api'].includes(config.mode)) throw new Error('Conversational tutoring is switched off.');
  if (!config.model || typeof requestId !== 'string' || requestId.length > 100) throw new Error('Select a model before asking the tutor.');
  if (active.has(requestId)) throw new Error('A tutor request with this identifier is already running.');
  if (!Array.isArray(messages) || messages.length > 30 || messages.some(x => !['system', 'user', 'assistant'].includes(x.role) || typeof x.content !== 'string' || x.content.length > 45000)) throw new Error('This conversation is too large. Start a new conversation.');
  const controller = new AbortController();
  active.set(requestId, controller);
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const local = config.mode === 'ollama';
    const response = await fetch(endpoint(config) + (local ? '/api/chat' : '/chat/completions'), {
      method: 'POST', headers: auth(config), redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ model: config.model, messages, stream: true, ...(local ? { options: { num_predict: 1000, temperature: 0.2 } } : { max_tokens: 1000, temperature: 0.2 }) }),
    });
    if (!response.ok) throw new Error(`The tutor could not answer (HTTP ${response.status}). Check your model and connection settings.`);
    if (!response.body) throw new Error('The tutor returned an empty response.');
    let pending = '', text = '';
    const decoder = new TextDecoder();
    function consume(line) {
      const trimmed = line.trim();
      if (!trimmed || (!local && !trimmed.startsWith('data:'))) return;
      const raw = local ? trimmed : trimmed.slice(5).trim();
      if (raw === '[DONE]') return;
      let value;
      try { value = JSON.parse(raw); } catch { return; }
      if (value.error) throw new Error('The selected model could not complete this request.');
      const token = local ? value.message?.content : value.choices?.[0]?.delta?.content;
      if (typeof token === 'string') { text += token; onChunk({ requestId, text: token }); }
      if (text.length > 60000) throw new Error('Tutor response exceeded the size limit.');
    }
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n'); pending = lines.pop() || '';
      lines.forEach(consume);
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
    if (!text.trim()) throw new Error('The model returned no answer. Try another model or ask again.');
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Tutor request stopped or timed out.');
    if (error instanceof TypeError) throw new Error('Could not reach the tutor. Check that the server is running and the endpoint is correct.');
    throw error;
  } finally { clearTimeout(timer); active.delete(requestId); }
}

function cancel(requestId) { active.get(requestId)?.abort(); }

module.exports = { listModels, chat, cancel };
