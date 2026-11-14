export function createOpenBotNotifications({ getSettings, automation, readConnections } = {}) {
  const getCfg = () => {
    const s = getSettings ? getSettings() : null;
    return s?.office?.notifications || {
      enabled: true,
      whatsappOrchestrator: true,
      telegramOrchestrator: true,
      webhookUrl: '',
      telegramBotToken: '',
      telegramChatId: '',
      events: { taskCompleted: true, taskFailed: true, selfHealing: true, approvalNeeded: true }
    };
  };

  const getConnections = () => {
    if (typeof readConnections === 'function') {
      try { return readConnections(); } catch { return []; }
    }
    return [];
  };

  async function sendToOrchestrator(agentId, text, platform) {
    if (!automation?.url || !automation?.token) {
      return { ok: false, error: 'OpenBot otomasyon bağlantı kimliği bulunamadı' };
    }
    const res = await fetch(`${automation.url}/v1/agents/${encodeURIComponent(agentId)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${automation.token}`
      },
      body: JSON.stringify({
        text,
        clientMessageId: `my-office:${platform}:${Date.now()}`
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: body?.error || body?.message || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, deliveryId: body?.deliveryId || body?.task?.id || null };
  }

  async function sendWebhook(url, payload) {
    if (!url) return { ok: false, error: 'Webhook URL boş' };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  }

  async function sendDirectTelegram(token, chatId, text) {
    if (!token || !chatId) return { ok: false, error: 'Telegram bot token veya chatId boş' };
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && Boolean(body.ok), status: res.status, body };
  }

  async function notify({ event, title, body, meta = {} }) {
    const cfg = getCfg();
    if (!cfg.enabled) return { ok: true, skipped: 'disabled' };
    if (cfg.events && cfg.events[event] === false) return { ok: true, skipped: 'event_filtered' };

    const formattedTitle = `🏢 <b>[My Office Director]</b> ${title}`;
    const plainText = `${formattedTitle}\n\n${body}${meta.taskPrompt ? `\n📌 Görev: ${meta.taskPrompt}` : ''}`;
    const results = {};
    const connections = getConnections();

    // 1. WhatsApp Orchestrator
    if (cfg.whatsappOrchestrator !== false) {
      const wa = connections.find((c) => c.platform === 'whatsapp' && c.enabled);
      if (wa?.orchestratorAgentId) {
        try {
          const dispatchText = `🏢 [My Office Director Bildirimi]\n${title}\n${body}${meta.taskPrompt ? `\n📌 Görev: ${meta.taskPrompt}` : ''}\n\nLütfen bu durumu bağlı WhatsApp kullanıcısına (${wa.workspaceName}) ilet.`;
          results.whatsappOrchestrator = await sendToOrchestrator(wa.orchestratorAgentId, dispatchText, 'whatsapp');
        } catch (e) {
          results.whatsappOrchestrator = { ok: false, error: e.message };
        }
      } else {
        results.whatsappOrchestrator = { ok: false, error: 'Aktif WhatsApp bağlantısı bulunamadı' };
      }
    }

    // 2. Telegram Orchestrator
    if (cfg.telegramOrchestrator !== false) {
      const tg = connections.find((c) => c.platform === 'telegram' && c.enabled);
      if (tg?.orchestratorAgentId) {
        try {
          const dispatchText = `🏢 [My Office Director Bildirimi]\n${title}\n${body}${meta.taskPrompt ? `\n📌 Görev: ${meta.taskPrompt}` : ''}\n\nLütfen bu durumu bağlı Telegram kullanıcısına (${tg.workspaceName}) ilet.`;
          results.telegramOrchestrator = await sendToOrchestrator(tg.orchestratorAgentId, dispatchText, 'telegram');
        } catch (e) {
          results.telegramOrchestrator = { ok: false, error: e.message };
        }
      } else {
        results.telegramOrchestrator = { ok: false, error: 'Aktif Telegram bağlantısı bulunamadı' };
      }
    }

    // 3. Webhook (Discord / Slack)
    if (cfg.webhookUrl) {
      try {
        const webhookPayload = {
          content: plainText,
          username: 'OpenBot Director',
          embeds: [{
            title,
            description: body,
            color: event === 'taskFailed' ? 15158332 : event === 'selfHealing' ? 15105570 : 3066993,
            fields: Object.entries(meta).map(([k, v]) => ({ name: k, value: String(v), inline: true })),
            timestamp: new Date().toISOString()
          }]
        };
        results.webhook = await sendWebhook(cfg.webhookUrl, webhookPayload);
      } catch (e) {
        results.webhook = { ok: false, error: e.message };
      }
    }

    // 4. Doğrudan Telegram Bot API (Opsiyonel)
    if (cfg.telegramBotToken && cfg.telegramChatId) {
      try {
        results.directTelegram = await sendDirectTelegram(cfg.telegramBotToken, cfg.telegramChatId, plainText);
      } catch (e) {
        results.directTelegram = { ok: false, error: e.message };
      }
    }

    return { ok: true, results };
  }

  async function test(customConfig, { channel = 'all' } = {}) {
    const cfg = customConfig || getCfg();
    const results = {};
    const testTitle = '🧪 Test Bildirimi';
    const testBody = 'OpenBot Ofis Telegram ve WhatsApp orkestrasyonu başarıyla bağlandı ve test edildi!';
    const connections = getConnections();

    if (channel === 'all' || channel === 'whatsapp') {
      const wa = connections.find((c) => c.platform === 'whatsapp' && c.enabled);
      if (wa?.orchestratorAgentId) {
        try {
          const msg = `🏢 [My Office Director]: WhatsApp orkestrasyon bağlantı testi. Bu mesaj otomatik ofis entegrasyonu tarafından (${wa.workspaceName}) kanalına iletilmek üzere gönderilmiştir.`;
          results.whatsappOrchestrator = await sendToOrchestrator(wa.orchestratorAgentId, msg, 'whatsapp');
        } catch (e) { results.whatsappOrchestrator = { ok: false, error: e.message }; }
      } else {
        results.whatsappOrchestrator = { ok: false, error: 'Aktif WhatsApp bağlantısı bulunamadı' };
      }
    }

    if (channel === 'all' || channel === 'telegram') {
      const tg = connections.find((c) => c.platform === 'telegram' && c.enabled);
      if (tg?.orchestratorAgentId) {
        try {
          const msg = `🏢 [My Office Director]: Telegram orkestrasyon bağlantı testi. Bu mesaj otomatik ofis entegrasyonu tarafından (${tg.workspaceName}) kanalına iletilmek üzere gönderilmiştir.`;
          results.telegramOrchestrator = await sendToOrchestrator(tg.orchestratorAgentId, msg, 'telegram');
        } catch (e) { results.telegramOrchestrator = { ok: false, error: e.message }; }
      } else {
        results.telegramOrchestrator = { ok: false, error: 'Aktif Telegram bağlantısı bulunamadı' };
      }
    }

    if ((channel === 'all' || channel === 'webhook') && cfg.webhookUrl) {
      try {
        results.webhook = await sendWebhook(cfg.webhookUrl, {
          content: `🏢 <b>[OpenBot Office]</b> ${testTitle}\n${testBody}`,
          username: 'OpenBot Director'
        });
      } catch (e) { results.webhook = { ok: false, error: e.message }; }
    }

    if ((channel === 'all' || channel === 'directTelegram') && cfg.telegramBotToken && cfg.telegramChatId) {
      try {
        results.directTelegram = await sendDirectTelegram(cfg.telegramBotToken, cfg.telegramChatId, `🏢 <b>[OpenBot Office]</b> ${testTitle}\n${testBody}`);
      } catch (e) { results.directTelegram = { ok: false, error: e.message }; }
    }

    return { ok: true, results };
  }

  return { notify, test, getConnections };
}
