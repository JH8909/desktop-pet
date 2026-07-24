const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const AGNES_MODEL = 'agnes-2.5-flash';
const AGNES_FALLBACK_MODEL = 'agnes-2.0-flash';

function getAgnesApiKey(settings = {}, env = process.env) {
  return String(settings.agnesApiKey || env.AGNES_API_KEY || env.AGNES_AI_API_KEY || '').trim();
}

function buildAiOrganizeMessages(files) {
  return [
    {
      role: 'system',
      content: [
        '你是文件整理助手，只能根据文件元数据提出整理建议。',
        '不要要求读取文件内容，不要建议删除文件，不要改变文件扩展名。',
        '只返回 JSON，不要 Markdown。JSON 格式：{"items":[{"source":"完整原路径","category":"分类名","suggestedName":"建议文件名","reason":"简短原因"}]}。',
        'source 必须逐字使用输入里的 source。category 使用简短中文分类名。suggestedName 必须保留原扩展名。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({ files }, null, 2)
    }
  ];
}

function buildAiCleanupMessages(files) {
  return [
    {
      role: 'system',
      content: [
        '你是桌面清理顾问，只能根据文件元数据提出低风险清理建议。',
        '不要要求读取文件内容，不要建议永久删除，不要建议清理不确定的重要文件。',
        '只返回 JSON，不要 Markdown。JSON 格式：{"items":[{"source":"完整原路径","risk":"low|medium|high","reason":"简短原因"}]}。',
        'source 必须逐字使用输入里的 source。只有明显临时文件、日志、缓存、重复下载残留、空文件夹才标 low。普通文档、图片、代码、项目文件标 high 或不要返回。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({ files }, null, 2)
    }
  ];
}

function buildAiCommandMessages(command, files) {
  return [
    {
      role: 'system',
      content: [
        '你是文件怪桌宠的自然语言文件操作规划器，只能根据桌面文件元数据工作。',
        '你可以把用户意图归为 organize、cleanup、answer 三种 action。',
        'organize 用于整理/归类/重命名/按项目聚合；cleanup 只用于低风险清理；answer 只回答问题不移动文件。',
        '不要读取文件内容，不要永久删除，不要改变文件扩展名。',
        '只返回 JSON，不要 Markdown。格式：{"action":"organize|cleanup|answer","answer":"简短回答","items":[{"source":"完整原路径","category":"分类名","suggestedName":"建议文件名","risk":"low|medium|high","reason":"简短原因"}]}。',
        'source 必须逐字使用输入里的 source。cleanup 只有明显临时文件、日志、缓存、重复下载残留、空文件夹才标 low。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({ command, files }, null, 2)
    }
  ];
}

function buildAiRulesMessages(command, rules) {
  return [
    {
      role: 'system',
      content: [
        '你是文件分类规则生成器，把用户自然语言转换成文件怪分类规则。',
        '只返回 JSON，不要 Markdown。格式：{"rules":{"分类名":[".ext"]},"screenshotKeywords":["keyword"]}。',
        '扩展名必须小写且以英文句点开头。不要删除没有被用户明确要求移除的现有规则。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({ command, currentRules: rules }, null, 2)
    }
  ];
}

function buildAiAgentMessages(command, files, context = {}) {
  return [
    {
      role: 'system',
      content: [
        '你是文件怪桌宠里的通用 AI 助手，同时具备桌面文件代理能力。',
        '普通问题、写作、代码解释、计划制定、想法讨论、应用使用建议等，你可以直接回答，不要把所有问题都硬转成桌面整理。',
        '当用户的问题涉及桌面、文件、文件夹、截图、下载、项目归档、规则、清理时，才使用输入里的文件元数据、最近桌面变化和现有规则判断。',
        '你没有被授权直接读取本地文件内容、打开隐私文件、执行系统命令或联网检索；如果需要这些信息，请让用户明确提供内容、公开图片 URL 或后续授权流程。',
        '你可以判断用户意图为 answer、organize、cleanup、rules、clarify 五种。',
        'answer：回答普通问题或解释文件现状，不移动文件。organize：给整理/归类/重命名计划。cleanup：只给低风险清理计划。rules：保存用户习惯规则。clarify：问题太宽泛或风险不清时先追问。',
        '不要直接执行文件操作。organize/cleanup 只输出计划和简短解释，等待用户确认。',
        '普通对话 intent 用 answer，items 为空，把完整有用的中文回答放在 speech。',
        '只返回 JSON，不要 Markdown。格式：{"intent":"answer|organize|cleanup|rules|clarify","speech":"给用户看的中文回答","items":[{"source":"完整原路径","category":"分类名","suggestedName":"建议文件名","risk":"low|medium|high","reason":"简短原因"}],"rules":{"分类名":[".ext"]},"screenshotKeywords":["keyword"]}。',
        'source 必须逐字使用输入里的 source。不要改变文件扩展名。cleanup 只有明显临时文件、日志、缓存、重复下载残留、空文件夹才标 low。普通文档、图片、代码、项目文件不要列入 cleanup。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({ command, files, context }, null, 2)
    }
  ];
}

function buildAiQuestionMessages(question, files) {
  return [
    {
      role: 'system',
      content: [
        '你是文件怪桌宠的文件问答助手，只能根据桌面文件元数据回答。',
        '不要声称读取了文件内容、图片内容或 OCR 内容。',
        '如果问题需要文件内容或截图 OCR，请明确说明当前只能基于文件名、类型、大小和修改时间判断。',
        '用中文简短回答。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({ question, files }, null, 2)
    }
  ];
}

function buildAiImageMessages(question, imageUrl) {
  return [
    {
      role: 'system',
      content: '你是截图和图片理解助手。根据用户提供的公开图片 URL 分析内容，提取错误、票据、设计稿、聊天记录等线索，并给出适合的分类和命名建议。用中文简短回答。'
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: question || '分析这张图片，给出分类和命名建议。' },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ];
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI 返回为空');
  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI 没有返回 JSON 对象');
  return JSON.parse(raw.slice(start, end + 1));
}

function normalizeAiPlanContent(content, files) {
  const parsed = extractJsonObject(content);
  const allowedSources = new Set((files || []).map(file => String(file.source)));
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = [];

  for (const item of rawItems) {
    const source = String(item?.source || '');
    if (!allowedSources.has(source)) continue;
    const category = String(item?.category || '').trim();
    const suggestedName = String(item?.suggestedName || '').trim();
    const reason = String(item?.reason || '').trim();
    if (!category && !suggestedName) continue;
    items.push({ source, category, suggestedName, reason });
  }

  return { items };
}

function normalizeAiCleanupContent(content, files) {
  const parsed = extractJsonObject(content);
  const allowedSources = new Set((files || []).map(file => String(file.source)));
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = [];

  for (const item of rawItems) {
    const source = String(item?.source || '');
    if (!allowedSources.has(source)) continue;
    const risk = String(item?.risk || '').toLowerCase();
    const reason = String(item?.reason || '').trim();
    if (!['low', 'medium', 'high'].includes(risk)) continue;
    items.push({ source, risk, reason });
  }

  return { items };
}

function normalizeAiCommandContent(content, files) {
  const parsed = extractJsonObject(content);
  const action = ['organize', 'cleanup', 'answer'].includes(parsed.action) ? parsed.action : 'answer';
  return {
    action,
    answer: String(parsed.answer || '').trim(),
    items: action === 'cleanup'
      ? normalizeAiCleanupContent(JSON.stringify({ items: parsed.items || [] }), files).items
      : normalizeAiPlanContent(JSON.stringify({ items: parsed.items || [] }), files).items
  };
}

function normalizeAiRulesContent(content) {
  const parsed = extractJsonObject(content);
  const rules = {};
  for (const [category, extensions] of Object.entries(parsed.rules || {})) {
    if (!Array.isArray(extensions)) continue;
    const cleanExts = extensions
      .map(ext => String(ext || '').trim().toLowerCase())
      .filter(ext => /^\.[a-z0-9]+$/.test(ext));
    if (cleanExts.length) rules[String(category || '').trim()] = [...new Set(cleanExts)];
  }
  const screenshotKeywords = Array.isArray(parsed.screenshotKeywords)
    ? parsed.screenshotKeywords.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  return { rules, screenshotKeywords };
}

function normalizeAiAgentContent(content, files) {
  const parsed = extractJsonObject(content);
  const intent = ['answer', 'organize', 'cleanup', 'rules', 'clarify'].includes(parsed.intent) ? parsed.intent : 'answer';
  const speech = String(parsed.speech || parsed.answer || '').trim();
  const items = intent === 'cleanup'
    ? normalizeAiCleanupContent(JSON.stringify({ items: parsed.items || [] }), files).items
    : normalizeAiPlanContent(JSON.stringify({ items: parsed.items || [] }), files).items;
  const rulePlan = normalizeAiRulesContent(JSON.stringify({
    rules: parsed.rules || {},
    screenshotKeywords: parsed.screenshotKeywords || []
  }));

  return {
    intent,
    speech,
    items,
    rules: rulePlan.rules,
    screenshotKeywords: rulePlan.screenshotKeywords
  };
}

function shouldFallbackModel(err) {
  const text = String(err?.message || err || '').toLowerCase();
  return text.includes('model') || text.includes('模型') || text.includes('404') || text.includes('not found') || text.includes('unavailable') || text.includes('不可用');
}

async function callAgnesChatCompletion(settings, messages, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');

  const apiKey = getAgnesApiKey(settings);
  if (!apiKey) throw new Error('请先填写 Agnes API Key，或设置 AGNES_API_KEY 环境变量');

  const baseUrl = String(settings.aiBaseUrl || AGNES_BASE_URL).replace(/\/+$/g, '');
  const model = String(options.model || settings.agnesModel || AGNES_MODEL).trim();
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 2048
    })
  });

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}

  if (!response.ok) {
    const message = body?.error?.message || body?.message || text || `Agnes 请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return body;
}

function extractStreamDelta(payload) {
  const choice = payload?.choices?.[0];
  return String(choice?.delta?.content || choice?.message?.content || choice?.text || '');
}

async function streamAgnesChatCompletion(settings, messages, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch');

  const apiKey = getAgnesApiKey(settings);
  if (!apiKey) throw new Error('请先填写 Agnes API Key，或设置 AGNES_API_KEY 环境变量');

  const baseUrl = String(settings.aiBaseUrl || AGNES_BASE_URL).replace(/\/+$/g, '');
  const model = String(options.model || settings.agnesModel || AGNES_MODEL).trim();
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 2048,
      stream: true
    })
  });

  if (!response.ok) {
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    const message = body?.error?.message || body?.message || text || `Agnes 请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  if (!response.body?.getReader) {
    const body = await response.json();
    const content = String(body?.choices?.[0]?.message?.content || '');
    if (content) options.onDelta?.(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || '';

    for (const part of parts) {
      const lines = part.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let payload = null;
        try { payload = JSON.parse(data); } catch { continue; }
        const delta = extractStreamDelta(payload);
        if (!delta) continue;
        content += delta;
        options.onDelta?.(delta);
      }
    }
  }

  const tail = decoder.decode();
  if (tail) buffer += tail;
  for (const line of buffer.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let payload = null;
    try { payload = JSON.parse(data); } catch { continue; }
    const delta = extractStreamDelta(payload);
    if (!delta) continue;
    content += delta;
    options.onDelta?.(delta);
  }

  return content;
}

async function requestAiOrganizePlan(settings, files, options = {}) {
  const messages = buildAiOrganizeMessages(files);
  const primaryModel = String(settings.agnesModel || AGNES_MODEL).trim();
  const fallbackModel = String(settings.agnesFallbackModel || AGNES_FALLBACK_MODEL).trim();

  try {
    const body = await callAgnesChatCompletion(settings, messages, { ...options, model: primaryModel });
    return normalizeAiPlanContent(body?.choices?.[0]?.message?.content, files);
  } catch (err) {
    if (!fallbackModel || fallbackModel === primaryModel || !shouldFallbackModel(err)) throw err;
    const body = await callAgnesChatCompletion(settings, messages, { ...options, model: fallbackModel });
    return normalizeAiPlanContent(body?.choices?.[0]?.message?.content, files);
  }
}

async function requestAiCleanupPlan(settings, files, options = {}) {
  const messages = buildAiCleanupMessages(files);
  const primaryModel = String(settings.agnesModel || AGNES_MODEL).trim();
  const fallbackModel = String(settings.agnesFallbackModel || AGNES_FALLBACK_MODEL).trim();

  try {
    const body = await callAgnesChatCompletion(settings, messages, { ...options, model: primaryModel });
    return normalizeAiCleanupContent(body?.choices?.[0]?.message?.content, files);
  } catch (err) {
    if (!fallbackModel || fallbackModel === primaryModel || !shouldFallbackModel(err)) throw err;
    const body = await callAgnesChatCompletion(settings, messages, { ...options, model: fallbackModel });
    return normalizeAiCleanupContent(body?.choices?.[0]?.message?.content, files);
  }
}

async function requestWithFallback(settings, messages, normalize, options = {}) {
  const primaryModel = String(settings.agnesModel || AGNES_MODEL).trim();
  const fallbackModel = String(settings.agnesFallbackModel || AGNES_FALLBACK_MODEL).trim();

  try {
    const body = await callAgnesChatCompletion(settings, messages, { ...options, model: primaryModel });
    return normalize(body?.choices?.[0]?.message?.content);
  } catch (err) {
    if (!fallbackModel || fallbackModel === primaryModel || !shouldFallbackModel(err)) throw err;
    const body = await callAgnesChatCompletion(settings, messages, { ...options, model: fallbackModel });
    return normalize(body?.choices?.[0]?.message?.content);
  }
}

async function requestAiCommandPlan(settings, command, files, options = {}) {
  return requestWithFallback(
    settings,
    buildAiCommandMessages(command, files),
    content => normalizeAiCommandContent(content, files),
    options
  );
}

async function requestAiRulesPlan(settings, command, rules, options = {}) {
  return requestWithFallback(
    settings,
    buildAiRulesMessages(command, rules),
    normalizeAiRulesContent,
    options
  );
}

async function requestAiAgentPlan(settings, command, files, context = {}, options = {}) {
  return requestWithFallback(
    settings,
    buildAiAgentMessages(command, files, context),
    content => normalizeAiAgentContent(content, files),
    options
  );
}

async function requestAiQuestionAnswer(settings, question, files, options = {}) {
  return requestWithFallback(
    settings,
    buildAiQuestionMessages(question, files),
    content => ({ answer: String(content || '').trim() }),
    options
  );
}

async function requestAiImageAnswer(settings, question, imageUrl, options = {}) {
  return requestWithFallback(
    settings,
    buildAiImageMessages(question, imageUrl),
    content => ({ answer: String(content || '').trim() }),
    options
  );
}

async function requestStreamingWithFallback(settings, messages, options = {}) {
  const primaryModel = String(settings.agnesModel || AGNES_MODEL).trim();
  const fallbackModel = String(settings.agnesFallbackModel || AGNES_FALLBACK_MODEL).trim();
  let sentAnyDelta = false;
  const onDelta = delta => {
    sentAnyDelta = true;
    options.onDelta?.(delta);
  };

  try {
    return await streamAgnesChatCompletion(settings, messages, { ...options, model: primaryModel, onDelta });
  } catch (err) {
    if (sentAnyDelta || !fallbackModel || fallbackModel === primaryModel || !shouldFallbackModel(err)) throw err;
    return streamAgnesChatCompletion(settings, messages, { ...options, model: fallbackModel });
  }
}

async function requestAiQuestionAnswerStream(settings, question, files, options = {}) {
  const answer = await requestStreamingWithFallback(settings, buildAiQuestionMessages(question, files), options);
  return { answer: String(answer || '').trim() };
}

async function requestAiImageAnswerStream(settings, question, imageUrl, options = {}) {
  const answer = await requestStreamingWithFallback(settings, buildAiImageMessages(question, imageUrl), options);
  return { answer: String(answer || '').trim() };
}

module.exports = {
  AGNES_BASE_URL,
  AGNES_MODEL,
  AGNES_FALLBACK_MODEL,
  getAgnesApiKey,
  buildAiOrganizeMessages,
  buildAiCleanupMessages,
  buildAiCommandMessages,
  buildAiRulesMessages,
  buildAiAgentMessages,
  buildAiQuestionMessages,
  buildAiImageMessages,
  extractJsonObject,
  normalizeAiPlanContent,
  normalizeAiCleanupContent,
  normalizeAiCommandContent,
  normalizeAiRulesContent,
  normalizeAiAgentContent,
  extractStreamDelta,
  requestAiOrganizePlan,
  requestAiCleanupPlan,
  requestAiCommandPlan,
  requestAiRulesPlan,
  requestAiAgentPlan,
  requestAiQuestionAnswer,
  requestAiImageAnswer,
  requestAiQuestionAnswerStream,
  requestAiImageAnswerStream
};
