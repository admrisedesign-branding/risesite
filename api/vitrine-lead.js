// /api/vitrine-lead.js — recebe o diagnóstico da página /vitrine (vitrine de Black Friday das empreendedoras)
// e entrega ao Capta (tenant "rise"). O token do Capta fica só aqui, em variável de ambiente
// (nunca no HTML nem no repositório, que é público).
//
// Env na Vercel (projeto risesite): as mesmas da /matriculas.
//   CAPTA_RISE_INGEST_TOKEN  (obrigatória) token de captação do espaço da RISE no Capta
//   CAPTA_INGEST_URL         (opcional)    padrão: https://capta.riseagencia.com/api/capta-ingest
//
// As respostas vão em "extra" (viram anotação no lead) e NÃO em "respostas": o espaço da RISE no Capta
// tem as perguntas das escolas cadastradas, e o Capta casa "respostas" por posição quando o texto não bate.
// Assim as respostas da vitrine não se misturam com as perguntas do funil de escolas.

const SLUG = 'rise';
const INGEST_URL = process.env.CAPTA_INGEST_URL || 'https://capta.riseagencia.com/api/capta-ingest';

// Valores aceitos (os mesmos botões da página). Qualquer outro valor é recusado.
const OPCOES = {
  oferece: ['Um serviço', 'Um produto físico', 'Um produto digital ou curso', 'Serviço e produto'],
  ramo: ['Estética e saúde', 'Moda e beleza', 'Festas e eventos', 'Fotografia', 'Consultoria e organização', 'Alimentação e doces', 'Outro'],
  quer: ['Um serviço ou pacote com desconto', 'Um vale-presente', 'Vagas limitadas de um serviço', 'Ainda não sei, me ajude'],
  onde: ['Instagram', 'WhatsApp', 'Loja ou atendimento presencial', 'Site'],
  trava: ['Falta de tempo', 'Não sei o que postar', 'Não tenho página ou site', 'Falta de arte e identidade'],
  precisa: ['Uma vitrine com a minha oferta', 'Artes para divulgar', 'Uma página de vendas', 'Só orientação'],
  divulga: ['Organicamente', 'Com tráfego pago', 'Quero entender melhor'],
  modelo: ['Valor fixo (pacote)', 'Sem custo inicial, com percentual das vendas', 'Quero entender qual vale mais a pena'],
};

const MODELO_TAG = { 'Valor fixo (pacote)': 'modelo-fixo', 'Sem custo inicial, com percentual das vendas': 'modelo-percentual', 'Quero entender qual vale mais a pena': 'modelo-duvida' };

// Serviços da RISE (múltipla escolha, opcional).
const SERVICOS = ['Captação de vídeo', 'Gestão de tráfego pago', 'Artes e identidade visual', 'Site ou página completa', 'Nenhum por enquanto'];

// Texto mostrado ao lado do aceite. O servidor registra SEMPRE este texto (não o que vier do navegador).
const CONSENT_VERSAO = 'rise-vitrine-v1';
const CONSENT_TEXTO = 'Autorizo a RISE Design & Branding a entrar em contato comigo por WhatsApp sobre a minha vitrine de Black Friday e o diagnóstico gratuito, e a usar os dados que informei só para essa finalidade, conforme a Política de Privacidade.';

const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function origemDe(utm) {
  // Divulgação do grupo é orgânica (link no Instagram e no WhatsApp): só marca "pago" com sinal claro de anúncio.
  const meio = String(utm.utm_medium || '').toLowerCase();
  if (utm.fbclid || /paid|cpc|cpm|ads|anuncio/.test(meio)) return 'meta_paid';
  return 'vitrine_grupo';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  if (JSON.stringify(body).length > 6000) return res.status(413).json({ ok: false, erro: 'Envio grande demais.' });

  // Robô: campo escondido preenchido ou formulário enviado rápido demais. Responde "ok" sem registrar nada.
  if (txt(body.website, 50) || (Number(body.t) >= 0 && Number(body.t) < 4000)) return res.status(200).json({ ok: true });

  const nome = txt(body.nome, 120);
  const insta = txt(body.insta, 60).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@+/, '').replace(/\/.*$/, '');
  const fone = String(body.whatsapp || '').replace(/\D/g, '');
  const resp = {};
  const falta = [];
  for (const k of Object.keys(OPCOES)) {
    resp[k] = txt(body[k], 80);
    if (!OPCOES[k].includes(resp[k])) falta.push(k);
  }
  const servicos = (Array.isArray(body.servicos) ? body.servicos : []).slice(0, 5).map((v) => txt(v, 40));
  if (servicos.some((v) => !SERVICOS.includes(v))) falta.push('servicos');
  const servicosOk = [...new Set(servicos)];
  if (nome.length < 2) falta.push('nome');
  if (fone.length < 10 || fone.length > 13) falta.push('whatsapp');
  if (body.consentimento !== true) falta.push('consentimento');
  if (falta.length) return res.status(400).json({ ok: false, erro: 'Confira os campos.', campos: falta });

  const token = process.env.CAPTA_RISE_INGEST_TOKEN;
  if (!token) {
    console.error('[vitrine-lead] falta CAPTA_RISE_INGEST_TOKEN');
    return res.status(500).json({ ok: false, erro: 'Formulário indisponível no momento.' });
  }

  const u = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const utm = {
    utm_source: txt(u.utm_source, 120), utm_medium: txt(u.utm_medium, 120), utm_campaign: txt(u.utm_campaign, 200),
    utm_content: txt(u.utm_content, 200), utm_term: txt(u.utm_term, 200),
    fbclid: txt(u.fbclid, 300), gclid: txt(u.gclid, 300),
    referrer: txt(u.referrer, 500), landing: txt(u.landing || body.pagina, 500),
  };
  const origem = origemDe(utm);

  const payload = {
    slug: SLUG, token,
    nome, contato: fone, origem,
    respostas: [],
    tags: ['black-friday', 'vitrine-grupo', ...(resp.divulga === 'Com tráfego pago' || servicosOk.includes('Gestão de tráfego pago') ? ['quer-trafego'] : []), ...(MODELO_TAG[resp.modelo] ? [MODELO_TAG[resp.modelo]] : [])],
    extra: {
      fonte: utm.utm_source || origem,
      notas: 'Diagnóstico da vitrine de Black Friday (grupo de empreendedoras)',
      oferece: resp.oferece, ramo: resp.ramo, quer_vender: resp.quer, vende_onde: resp.onde,
      trava: resp.trava, precisa: resp.precisa,
      divulgar: resp.divulga,
      modelo_vitrine: resp.modelo,
      servicos_interesse: servicosOk.join(', ') || 'nenhum informado',
      ...(insta ? { instagram: '@' + insta } : {}),
    },
    utm,
    consentimento: { contato: true, canal: 'site', versao: CONSENT_VERSAO, texto: CONSENT_TEXTO, url: txt(body.pagina, 300) },
  };

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(INGEST_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      console.error('[vitrine-lead] capta respondeu', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[vitrine-lead] falha ao falar com o capta:', e.message);
    return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
  }
};
