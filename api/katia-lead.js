// /api/katia-lead.js — recebe os contatos da página /katia (Kátia Margarida, consultorias de rotina e
// organização) e entrega ao Capta, no espaço PRÓPRIO da Kátia (nunca no da RISE ou de outro cliente).
// O token fica só aqui, em variável de ambiente (o repositório é público).
//
// Env na Vercel (projeto risesite):
//   CAPTA_KATIA_INGEST_TOKEN  (obrigatória) token de captação do espaço da Kátia no Capta
//   CAPTA_KATIA_SLUG          (opcional)    padrão: katia-margarida
//   CAPTA_INGEST_URL          (opcional)    padrão: https://capta.riseagencia.com/api/capta-ingest
//
// Dois tipos de envio:
//   tipo "teste"   → as 3 perguntas do teste + a consultoria recomendada
//   tipo "vitrine" → o plano escolhido na vitrine de Black Friday (ou lista do curso / palestra)
// As respostas vão em "extra" (viram anotação no lead).

const SLUG = process.env.CAPTA_KATIA_SLUG || 'katia-margarida';
const INGEST_URL = process.env.CAPTA_INGEST_URL || 'https://capta.riseagencia.com/api/capta-ingest';

const TESTE = {
  foco: ['Minha rotina', 'Minha casa', 'Os dois'],
  inicio: ['A rotina da semana', 'Guarda-roupa', 'Cozinha e despensa', 'Outro ambiente da casa'],
  jeito: ['Recebo o plano e sigo sozinha', 'Quero alguém me acompanhando', 'Ainda não sei'],
};
const RECOMENDACOES = [
  'Consultoria de rotina com acompanhamento', 'Consultoria de rotina sob medida',
  'Organização com acompanhamento semanal', 'Dossiê de organização',
];
// Nomes dos planos da página (KATIA.rotina / KATIA.ambientes) e dos dois botões extras.
const PLANOS = [
  'Rotina sob medida', 'Trimestral', 'Semestral', 'Dossiê do ambiente', 'Acompanhamento semanal',
  'Lista do curso online', 'Palestra',
];
const PLANO_TAG = {
  'Lista do curso online': 'lista-curso', 'Palestra': 'palestra',
  'Rotina sob medida': 'rotina', 'Trimestral': 'rotina', 'Semestral': 'rotina',
  'Dossiê do ambiente': 'ambientes', 'Acompanhamento semanal': 'ambientes',
};

const CONSENT_VERSAO = 'katia-site-v1';
const CONSENT_TEXTO = 'Autorizo a Kátia Margarida a falar comigo pelo WhatsApp sobre as consultorias e a usar estes dados só para isso, conforme a Política de Privacidade.';

const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function origemDe(utm) {
  const meio = String(utm.utm_medium || '').toLowerCase();
  if (utm.fbclid || /paid|cpc|cpm|ads|anuncio/.test(meio)) return 'meta_paid';
  if (/instagram|ig/.test(String(utm.utm_source || '').toLowerCase())) return 'instagram';
  return 'site';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  if (JSON.stringify(body).length > 5000) return res.status(413).json({ ok: false, erro: 'Envio grande demais.' });

  // Robô: campo escondido preenchido ou envio rápido demais. Responde "ok" sem registrar.
  if (txt(body.website, 50) || (Number(body.t) >= 0 && Number(body.t) < 3000)) return res.status(200).json({ ok: true });

  const tipo = body.tipo === 'vitrine' ? 'vitrine' : 'teste';
  const nome = txt(body.nome, 120);
  const fone = String(body.whatsapp || '').replace(/\D/g, '');
  const falta = [];
  if (nome.length < 2) falta.push('nome');
  if (fone.length < 10 || fone.length > 13) falta.push('whatsapp');
  if (body.consentimento !== true) falta.push('consentimento');

  const extra = {};
  const tags = ['site-katia'];
  if (tipo === 'teste') {
    for (const k of Object.keys(TESTE)) {
      const v = txt(body[k], 80);
      if (!TESTE[k].includes(v)) falta.push(k); else extra[k] = v;
    }
    const reco = txt(body.recomendacao, 80);
    if (!RECOMENDACOES.includes(reco)) falta.push('recomendacao'); else extra.recomendacao = reco;
    tags.push('teste');
    if (extra.jeito === 'Quero alguém me acompanhando') tags.push('quer-acompanhamento');
    extra.notas = 'Teste do site: ' + (extra.recomendacao || '');
  } else {
    const plano = txt(body.plano, 60);
    if (!PLANOS.includes(plano)) falta.push('plano'); else extra.plano = plano;
    if (PLANO_TAG[plano]) tags.push(PLANO_TAG[plano]);
    if (plano !== 'Lista do curso online' && plano !== 'Palestra') tags.push('black-friday');
    extra.notas = 'Escolheu no site: ' + (extra.plano || '');
  }
  if (falta.length) return res.status(400).json({ ok: false, erro: 'Confira os campos.', campos: falta });

  const token = process.env.CAPTA_KATIA_INGEST_TOKEN;
  if (!token) {
    console.error('[katia-lead] falta CAPTA_KATIA_INGEST_TOKEN');
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
  if (origem === 'meta_paid') tags.push('trafego-pago'); // base dos 30% da RISE

  const payload = {
    slug: SLUG, token, nome, contato: fone, origem,
    respostas: [], tags,
    extra: { fonte: utm.utm_source || origem, ...extra },
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
      console.error('[katia-lead] capta respondeu', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[katia-lead] falha ao falar com o capta:', e.message);
    return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
  }
};
