export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, region, utm = {}, pageUrl } = req.body || {};

  if (!name || !phone) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const date = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  // UTM metkalari (bo'sh bo'lsa tushmaydi)
  const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const utmLines = UTM_KEYS
    .filter((k) => utm[k])
    .map((k) => `${k}: ${utm[k]}`);

  // ── Saytdagi formadan olingan BARCHA ma'lumotlar (Bitrix izohi uchun) ──
  const commentLines = [
    `Offer ID: Champion`,
    `Ismi: ${name}`,
    `Raqami: ${phone}`,
    `Manzili: ${region || '—'}`,
    `Sayt: ${pageUrl || '—'}`,
    `Vaqt: ${date}`,
    ...(utmLines.length ? ['', 'UTM metkalari:', ...utmLines] : []),
  ];
  const comments = commentLines.join('\n');

  // ───────────────── Telegram guruh ─────────────────
  async function sendTelegram() {
    const tgText =
      `🏆 <b>CHAMPION</b>\n\n` +
      `👤 Исми: <b>${name}</b>\n` +
      `📞 Раками: <b>${phone}</b>\n` +
      `📍 Вилояти: ${region || '—'}\n` +
      `🌐 Сайт: ${pageUrl || '—'}\n` +
      `⏰ Вакти: ${date}`;

    const r = await fetch(
      `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.CHAT_ID,
          text: tgText,
          parse_mode: 'HTML',
        }),
      }
    );
    if (!r.ok) throw new Error('telegram: ' + JSON.stringify(await r.json()));
    return true;
  }

  // ───────────────── Bitrix24 (Lead) ─────────────────
  async function sendBitrix() {
    let base = process.env.BITRIX_WEBHOOK_URL || '';
    if (!base || base.includes('REPLACE_ME')) {
      throw new Error('bitrix: BITRIX_WEBHOOK_URL sozlanmagan');
    }
    if (!base.endsWith('/')) base += '/';

    const fields = {
      TITLE: 'Champion',                                 // Offer ID: Champion (doim)
      NAME: name,                                        // Ismi
      PHONE: [{ VALUE: phone, VALUE_TYPE: 'WORK' }],     // Raqami
      SOURCE_ID: process.env.BITRIX_SOURCE_ID || 'WEB',  // Источник: Landing
      SOURCE_DESCRIPTION: pageUrl || '',                 // допольнительно об источнике: sayt urli
      ASSIGNED_BY_ID: process.env.BITRIX_ASSIGNED_BY_ID, // Ответственный: Руслан РОП
      COMMENTS: comments,                                // Saytdagi barcha ma'lumotlar
    };

    // UTM metkalari — Bitrix native maydonlari
    if (utm.utm_source)   fields.UTM_SOURCE   = utm.utm_source;
    if (utm.utm_medium)   fields.UTM_MEDIUM   = utm.utm_medium;
    if (utm.utm_campaign) fields.UTM_CAMPAIGN = utm.utm_campaign;
    if (utm.utm_content)  fields.UTM_CONTENT  = utm.utm_content;
    if (utm.utm_term)     fields.UTM_TERM     = utm.utm_term;

    const r = await fetch(`${base}crm.lead.add.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, params: { REGISTER_SONET_EVENT: 'Y' } }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error('bitrix: ' + JSON.stringify(data));
    return true;
  }

  // Ikkala kanalni ham urinib ko'ramiz — birortasi ishlamasa ham lidni yo'qotmaymiz
  const results = await Promise.allSettled([sendTelegram(), sendBitrix()]);
  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message || String(r.reason));

  const anyOk = results.some((r) => r.status === 'fulfilled');

  if (!anyOk) {
    return res.status(502).json({ ok: false, errors });
  }

  // Kamida bittasi ketdi — mijozga muvaffaqiyat, lekin xatolarni log uchun qaytaramiz
  return res.status(200).json({ ok: true, errors });
}
