const MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5.6-luna';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const FINANCE_ACCESS_TOKEN = Deno.env.get('FINANCE_ACCESS_TOKEN') || '';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*';

const categories = [
  'Зарплата','Прочий доход','Еда','Рестораны','Аренда/Жильё','Коммунальные',
  'Транспорт','Топливо','Авто','Покупки','Развлечения','Подписки','Здоровье',
  'Спорт','Путешествия','Страхование','Налоги/Сборы','Переводы','Возвраты',
  'Погашение долга','Наличные','Другое'
] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'content-type, x-finance-access',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function redactSensitive(input: string) {
  return String(input || '')
    .replace(/\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]){10,30}\b/gi, '[IBAN]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[CARD/ID]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;
  for (const item of data?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!FINANCE_ACCESS_TOKEN) return json({ error: 'FINANCE_ACCESS_TOKEN is not configured in Supabase' }, 500);
  if (req.headers.get('x-finance-access') !== FINANCE_ACCESS_TOKEN) return json({ error: 'Invalid access token' }, 401);

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (body?.operation === 'ping') {
    if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY is not configured in Supabase' }, 500);
    return json({ ok: true, model: MODEL });
  }

  if (body?.operation !== 'classify') return json({ error: 'Unknown operation' }, 400);
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY is not configured in Supabase' }, 500);

  const incoming = Array.isArray(body?.transactions) ? body.transactions : [];
  if (!incoming.length) return json({ error: 'No transactions supplied' }, 400);
  if (incoming.length > 80) return json({ error: 'Maximum 80 transactions per request' }, 400);

  const transactions = incoming.map((t: any) => ({
    id: String(t?.id || '').slice(0, 100),
    date: String(t?.date || '').slice(0, 10),
    amount: Math.round((Number(t?.amount) || 0) * 100) / 100,
    description: redactSensitive(String(t?.description || '')),
  })).filter((t: any) => t.id && t.date && t.description && Number.isFinite(t.amount) && t.amount !== 0);

  if (!transactions.length) return json({ error: 'No valid transactions supplied' }, 400);

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['classifications'],
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id','kind','category','merchant','confidence','needs_review','reason'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['income','expense','transfer','refund','debt_payment'] },
            category: { type: 'string', enum: categories },
            merchant: { type: 'string' },
            confidence: { type: 'number' },
            needs_review: { type: 'boolean' },
            reason: { type: 'string' },
          }
        }
      }
    }
  };

  const instructions = `You classify personal bank transactions for a user in Belgium/Europe.
Return exactly one classification for every input id and preserve ids exactly.
The amount is SIGNED: positive usually means money coming in; negative usually means money going out.
Descriptions may be Dutch, French, English, Ukrainian, Russian, Spanish or mixed.
Use merchant as a short human-readable counterparty/merchant name without bank reference noise.
Kinds:
- income: salary or genuine new income.
- expense: normal spending.
- transfer: movement between the user's own accounts/cards/savings, not spending and not income. Only use when the description strongly indicates an own-account transfer; otherwise mark needs_review.
- refund: returned/reversed money from an earlier purchase.
- debt_payment: credit card, loan, financing or personal-debt repayment.
Choose category only from the provided enum and keep it consistent with kind: transfer=>Переводы, refund=>Возвраты, debt_payment=>Погашение долга.
Cash withdrawal should normally be kind expense + category Наличные unless it clearly is an own-account cash movement.
Salary/payment from an employer => Зарплата. Unclear positive incoming payment => Прочий доход.
Set needs_review=true when identity, transfer status, refund status, or purpose is uncertain, or confidence < 0.78.
Reason must be concise (max ~12 words), in Russian.`;

  const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      instructions,
      input: JSON.stringify({ transactions }),
      text: {
        format: {
          type: 'json_schema',
          name: 'transaction_classification',
          strict: true,
          schema,
        }
      }
    }),
  });

  const raw = await openaiResponse.json().catch(() => ({}));
  if (!openaiResponse.ok) {
    console.error('OpenAI error', raw?.error?.message || openaiResponse.status);
    return json({ error: raw?.error?.message || `OpenAI request failed (${openaiResponse.status})` }, 502);
  }

  const text = extractOutputText(raw);
  if (!text) return json({ error: 'OpenAI returned no structured output' }, 502);

  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch {
    console.error('Invalid structured output', text.slice(0, 300));
    return json({ error: 'OpenAI returned invalid structured output' }, 502);
  }

  return json({ classifications: parsed.classifications || [], model: MODEL });
});
