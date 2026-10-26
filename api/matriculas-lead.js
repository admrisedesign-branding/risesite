// /api/matriculas-lead.js — recebe o formulário da landing /matriculas e entrega ao Capta (tenant "rise").
// O token do Capta fica só aqui, em variável de ambiente (nunca no HTML nem no repositório, que é público).
//
// Env na Vercel (projeto risesite):
//   CAPTA_RISE_INGEST_TOKEN  (obrigatória) token de captação do espaço da RISE no Capta
//   CAPTA_INGEST_URL         (opcional)    padrão: https://capta.riseagencia.com/api/capta-ingest

const SLUG = 'rise';
const INGEST_URL = process.env.CAPTA_INGEST_URL || 'https://capta.riseagencia.com/api/capta-ingest';

// Mesmos textos e pontos cadastrados no formulário do Capta (capta_perguntas): é por eles que o Capta pontua o lead.
const PERGUNTA_DESAFIO = 'Qual é o principal desafio da escola hoje?';
const DESAFIO = {
  'Receber mais interessados': 2,
  'Melhorar o atendimento': 2,
  'Transformar contatos em matrículas': 3,
  'Organizar o processo todo': 3,
};
const PERGUNTA_QUANDO = 'Quando você quer começar?';
const QUANDO = {
  'Imediatamente': 3,
  'Em novembro ou dezembro': 2,
  'Em 2027': 1,
};

// Texto mostrado ao lado do aceite. O servidor registra SEMPRE este texto (não o que vier do navegador).
const CONSENT_VERSAO = 'rise-matriculas-v1';
const CONSENT_TEXTO = 'Autorizo a RISE Design & Branding a entrar em contato comigo por WhatsApp ou telefone sobre o diagnóstico gratuito do funil da minha escola e a usar os dados que informei só para essa finalidade, conforme a Política de Privacidade.';

const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function origemDe(utm) {
  const fonte = String(utm.utm_source || '').toLowerCase();
  const meio = String(utm.utm_medium || '').toLowerCase();
  if (/(^|[^a-z])(ig|instagram)([^a-z]|$)/.test(fonte)) return 'instagram_paid';
  if (utm.fbclid || /paid|cpc|cpm|ads|anuncio/.test(meio) || /(facebook|fb|meta)/.test(fonte)) return 'meta_paid';
  return 'site_matriculas';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  if (JSON.stringify(body).length > 6000) return res.status(413).json({ ok: false, erro: 'Envio grande demais.' });

  // Robô: campo escondido preenchido ou formulário enviado rápido demais. Responde "ok" sem registrar nada.
  if (txt(body.website, 50) || (Number(body.t) >= 0 && Number(body.t) < 1500)) return res.status(200).json({ ok: true });

  const nome = txt(body.nome, 120);
  const escola = txt(body.escola, 120);
  const fone = String(body.whatsapp || '').replace(/\D/g, '');
  const desafio = txt(body.desafio, 80);
  const quando = txt(body.quando, 80);

  const falta = [];
  if (nome.length < 2) falta.push('nome');
  if (escola.length < 2) falta.push('escola');
  if (fone.length < 10 || fone.length > 13) falta.push('whatsapp');
  if (!(desafio in DESAFIO)) falta.push('desafio');
  if (!(quando in QUANDO)) falta.push('quando');
  if (body.consentimento !== true) falta.push('consentimento');
  if (falta.length) return res.status(400).json({ ok: false, erro: 'Confira os campos.', campos: falta });

  const token = process.env.CAPTA_RISE_INGEST_TOKEN;
  if (!token) {
    console.error('[matriculas-lead] falta CAPTA_RISE_INGEST_TOKEN');
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
    respostas: [
      { texto: PERGUNTA_DESAFIO, label: desafio, pontos: DESAFIO[desafio] },
      { texto: PERGUNTA_QUANDO, label: quando, pontos: QUANDO[quando] },
    ],
    extra: { escola, fonte: utm.utm_source || origem, notas: 'Landing Matrículas 2027' },
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
      console.error('[matriculas-lead] capta respondeu', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[matriculas-lead] falha ao falar com o capta:', e.message);
    return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
  }
};
