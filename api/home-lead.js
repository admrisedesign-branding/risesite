// /api/home-lead.js — recebe o mini formulário da home (e do portfólio) e entrega ao Capta (tenant "rise").
// O token do Capta fica só aqui, em variável de ambiente (nunca no HTML nem no repositório, que é público).
//
// Env na Vercel (projeto risesite):
//   CAPTA_RISE_INGEST_TOKEN  (obrigatória) token de captação do espaço da RISE no Capta
//   CAPTA_INGEST_URL         (opcional)    padrão: https://capta.riseagencia.com/api/capta-ingest

const SLUG = 'rise';
const INGEST_URL = process.env.CAPTA_INGEST_URL || 'https://capta.riseagencia.com/api/capta-ingest';

const SERVICOS = ['Funil completo', 'Tráfego pago', 'Site', 'Atendimento', 'Identidade visual', 'Outro'];
const ORIGENS = ['site-home', 'site-portfolio'];

// Aviso mostrado junto ao botão. O servidor registra SEMPRE este texto (não o que vier do navegador).
const CONSENT_VERSAO = 'rise-home-v1';
const CONSENT_TEXTO = 'Ao enviar, autorizo a RISE Design & Branding a entrar em contato comigo por WhatsApp ou telefone sobre a minha solicitação e a usar os dados que informei só para essa finalidade, conforme a Política de Privacidade.';

const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === 'object' ? body : {};
  if (JSON.stringify(body).length > 6000) return res.status(413).json({ ok: false, erro: 'Envio grande demais.' });

  // Robô: campo escondido preenchido ou envio rápido demais. Responde "ok" sem registrar nada.
  if (txt(body.website, 50) || (Number(body.t) >= 0 && Number(body.t) < 1500)) return res.status(200).json({ ok: true });

  const nome = txt(body.nome, 120);
  const fone = String(body.whatsapp || '').replace(/\D/g, '');
  const servico = txt(body.servico, 80);
  const origem = ORIGENS.includes(body.origem) ? body.origem : 'site-home';

  const falta = [];
  if (nome.length < 2) falta.push('nome');
  if (fone.length < 10 || fone.length > 13) falta.push('whatsapp');
  if (!SERVICOS.includes(servico)) falta.push('servico');
  if (falta.length) return res.status(400).json({ ok: false, erro: 'Confira os campos.', campos: falta });

  const token = process.env.CAPTA_RISE_INGEST_TOKEN;
  if (!token) {
    console.error('[home-lead] falta CAPTA_RISE_INGEST_TOKEN');
    return res.status(500).json({ ok: false, erro: 'Formulário indisponível no momento.' });
  }

  const u = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const utm = {
    utm_source: txt(u.utm_source, 120), utm_medium: txt(u.utm_medium, 120), utm_campaign: txt(u.utm_campaign, 200),
    utm_content: txt(u.utm_content, 200), utm_term: txt(u.utm_term, 200),
    fbclid: txt(u.fbclid, 300), gclid: txt(u.gclid, 300),
    referrer: txt(u.referrer, 500), landing: txt(u.landing || body.pagina, 500),
  };

  const payload = {
    slug: SLUG, token,
    nome, contato: fone, origem,
    respostas: [{ texto: 'Serviço de interesse', label: servico, pontos: 0 }],
    extra: { fonte: utm.utm_source || origem, notas: `Formulário do site · interesse: ${servico}` },
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
      console.error('[home-lead] capta respondeu', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[home-lead] falha ao falar com o capta:', e.message);
    return res.status(502).json({ ok: false, erro: 'Não foi possível registrar agora.' });
  }
};
