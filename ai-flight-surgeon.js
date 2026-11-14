/* =========================================================================
   AI FLIGHT SURGEON  (Groq LLM add-on for EVA-SUIT-REV4)
   Add ONE line before </body> in your HTML, AFTER the main <script>:
       <script src="ai-flight-surgeon.js"></script>
   Features: live-telemetry Q&A, voice in/out, auto triage on new critical
   alerts, forecast, mission debrief, AI-driven 3D part highlighting,
   offline fallback to the built-in rule engine.
   ========================================================================= */
(() => {
  const API = 'https://api.groq.com/openai/v1/chat/completions';
  const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']; // gemma2-9b-it was retired by Groq
  const key = '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';
  let autoOn = true, speakOn = false, busy = false, lastAuto = 0, lastSig = '';
  const chat = [];

  // ---------- UI ----------
  const css = document.createElement('style');
  css.textContent = `
  #panel-ai{bottom:12px;left:12px;top:auto;width:340px}
  #ai-log{display:flex;flex-direction:column;gap:6px;max-height:230px;min-height:90px;overflow-y:auto;user-select:text}
  .ai-msg{font-size:10.5px;line-height:1.45;padding:6px 8px;border-radius:4px;border:1px solid var(--border-panel);background:var(--bg-input);color:var(--text-secondary);white-space:pre-wrap}
  .ai-msg.user{border-color:var(--sim-blue);color:var(--text-primary);background:rgba(29,112,245,.12)}
  .ai-msg.auto{border-left:3px solid var(--status-critical)}
  .ai-msg.sys{font-style:italic;color:var(--text-muted)}
  .ai-row{display:flex;gap:4px;flex-wrap:wrap}
  #ai-in{flex:1;background:var(--bg-input);border:1px solid var(--border-panel);color:var(--text-primary);padding:5px 7px;border-radius:3px;font-size:11px;user-select:text;outline:none}
  #ai-in:focus{border-color:var(--sim-blue)}
  .ai-on{background:rgba(29,112,245,.2)!important;border-color:var(--sim-blue)!important}`;
  document.head.appendChild(css);

  const p = document.createElement('aside');
  p.className = 'wb-panel'; p.id = 'panel-ai';
  p.innerHTML = `
    <div class="wb-panel-header"><div class="wb-panel-title">
      <svg viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zM4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/></svg>
      <span>AI Flight Surgeon (Groq)</span></div>
      <div class="wb-panel-actions"><button class="wb-icon-btn" onclick="togglePanel('panel-ai')">−</button></div></div>
    <div class="wb-panel-body" style="gap:6px">
      <div id="ai-log"></div>
      <div class="ai-row">
        <button class="sim-btn" data-q="assess">Assess</button>
        <button class="sim-btn" data-q="alerts">Explain alerts</button>
        <button class="sim-btn" data-q="forecast">Forecast</button>
        <button class="sim-btn" data-q="debrief">Debrief</button>
      </div>
      <div class="ai-row">
        <input id="ai-in" placeholder="Ask about the astronaut...">
        <button class="sim-btn" id="ai-send">Send</button>
        <button class="sim-btn" id="ai-mic" title="Voice input">🎤</button>
      </div>
      <div class="ai-row">
        <button class="sim-btn ai-on" id="ai-auto">Auto-triage ON</button>
        <button class="sim-btn" id="ai-speak">Voice reply OFF</button>
      </div>
    </div>`;
  document.body.appendChild(p);
  const $ = id => document.getElementById(id);

  function say(text, cls) {
    const d = document.createElement('div');
    d.className = 'ai-msg ' + (cls || '');
    d.textContent = text;
    $('ai-log').appendChild(d);
    $('ai-log').scrollTop = 1e9;
    return d;
  }
  say('Flight Surgeon online. I read your live ESP32 telemetry, trends and mission phase. ' +
      'Ask me anything.', 'sys');

  // ---------- Telemetry context ----------
  const live_ks = () => Object.keys(CH).filter(k => val(k) !== null);
  function trend(k) {
    const a = hist[k].filter(v => v !== null);
    if (a.length < 10) return '';
    const m = (s) => s.reduce((x, y) => x + y, 0) / s.length;
    const d = m(a.slice(-5)) - m(a.slice(0, 5)), span = CH[k].max - CH[k].min;
    return Math.abs(d) < span * 0.01 ? ' →' : d > 0 ? ' ↑' : ' ↓';
  }
  function stats(k) {
    const a = hist[k].filter(v => v !== null);
    if (!a.length) return '';
    const avg = a.reduce((x, y) => x + y, 0) / a.length;
    return ` (min ${Math.min(...a).toFixed(1)}, avg ${avg.toFixed(1)}, max ${Math.max(...a).toFixed(1)})`;
  }
  function snapshot(full) {
    const g = computeHealthScore(), ks = live_ks();
    if (!ks.length) return 'NO LIVE DATA: ESP32 not streaming.';
    const lines = ks.map(k => `${CH[k].name}: ${fmt(k, val(k))} ${CH[k].unit} [${chStatus(k)}]${trend(k)}${full ? stats(k) : ''}`);
    const guide = buildGuidance().map(r => r.replace(/<[^>]+>/g, ''));
    return `Phase: ${PHASES[missionPhase].name}\nHealth score: ${g.score}/100 (${gradeLabel(g.score).t})\n` +
      `DCS risk: ${dcsRiskCache.score}/100 (${dcsRiskCache.level})\nCumulative radiation: ${cumulativeRadiation.toFixed(1)} uSv\n` +
      lines.join('\n') + '\nRule-engine alerts:\n- ' + guide.join('\n- ');
  }

  const SYS = `You are the AI Flight Surgeon for the EVA-SUIT-REV4 astronaut monitor (NASA Space Apps demo).
Rules: use ONLY the telemetry provided, never invent numbers; if a channel is missing say so. Be concise (max ~90 words unless a debrief),
prioritise actions (most urgent first), mention trend arrows (↑ rising, ↓ falling). Note you support, not replace, real flight surgeons.
If one body/suit area is most relevant, end with exactly one tag [[part:ID]] where ID is one of: ` +
    REGIONS.map(r => r.id).join(', ') + '.';

  // ---------- Groq call ----------
  async function ask(text, opts = {}) {
    if (busy) return;
    busy = true;
    if (!opts.auto) say(text, 'user'); else say('⚠ Auto-triage: new critical alert', 'sys');
    const wait = say('Analysing telemetry…', 'sys');
    const msgs = [{ role: 'system', content: SYS }, ...chat.slice(-6),
      { role: 'user', content: text + '\n\nLIVE TELEMETRY:\n' + snapshot(opts.full) }];
    try {
      let r = null;
      for (const model of MODELS) {          // fall back to the next model if one is retired / rate-limited
        r = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model, messages: msgs, temperature: 0.3, max_tokens: opts.full ? 700 : 300 })
        });
        if (r.ok || r.status === 401) break;
      }
      if (r.status === 401) throw new Error('Authorization failed (401), check the key in ai-flight-surgeon.js');
      if (!r.ok) {
        let d = ''; try { d = (await r.json()).error.message; } catch (e) {}
        throw new Error('Groq error ' + r.status + (d ? ': ' + d : ''));
      }
      let out = (await r.json()).choices[0].message.content.trim();
      const m = out.match(/\[\[part:(\w+)\]\]/);
      out = out.replace(/\[\[part:\w+\]\]/g, '').trim();
      chat.push({ role: 'user', content: text }, { role: 'assistant', content: out });
      wait.remove();
      say(out, opts.auto ? 'auto' : '');
      if (m && regionGroups[m[1]] && selectedRegionId !== m[1]) selectOrToggleRegion(m[1]);
      if (speakOn && 'speechSynthesis' in window) {
        speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(out));
      }
    } catch (e) {
      wait.remove();
      say('AI unreachable (' + (e.message || e) + '). Offline fallback, rule engine says:\n• ' +
        buildGuidance().map(r => r.replace(/<[^>]+>/g, '')).join('\n• '), 'sys');
    }
    busy = false;
  }

  // ---------- Controls ----------
  const Q = {
    assess: ['Give a full crew status assessment right now.', {}],
    alerts: ['Explain every active alert, its likely cause and the exact response.', {}],
    forecast: ['Using the trend arrows, forecast the next 10 minutes and say what to do now to prevent problems.', {}],
    debrief: ['Write a mission debrief: summary, notable events, risks, recommendations. Use the min/avg/max stats.', { full: true }]
  };
  p.querySelectorAll('[data-q]').forEach(b => b.onclick = () => ask(...Q[b.dataset.q]));
  const send = () => { const t = $('ai-in').value.trim(); if (t) { $('ai-in').value = ''; ask(t); } };
  $('ai-send').onclick = send;
  $('ai-in').onkeydown = e => { if (e.key === 'Enter') send(); };
  $('ai-auto').onclick = e => { autoOn = !autoOn; e.target.classList.toggle('ai-on', autoOn); e.target.textContent = 'Auto-triage ' + (autoOn ? 'ON' : 'OFF'); };
  $('ai-speak').onclick = e => { speakOn = !speakOn; e.target.classList.toggle('ai-on', speakOn); e.target.textContent = 'Voice reply ' + (speakOn ? 'ON' : 'OFF'); };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('ai-mic').onclick = () => {
    if (!SR) { say('Voice input needs Chrome or Edge.', 'sys'); return; }
    const rec = new SR(); rec.lang = 'en-US';
    rec.onresult = e => ask(e.results[0][0].transcript);
    rec.start();
  };

  // ---------- Auto-triage on NEW critical alerts ----------
  setInterval(() => {
    if (!autoOn || busy) return;
    const crit = live_ks().filter(k => chStatus(k) === 'crit');
    if (dcsRiskCache.level === 'crit') crit.push('dcs');
    const sig = crit.sort().join(',');
    if (sig && sig !== lastSig && Date.now() - lastAuto > 30000) {
      lastAuto = Date.now(); lastSig = sig;
      ask('A new critical alert just triggered (' + sig + '). Give an immediate triage briefing.', { auto: true });
    }
    if (!sig) lastSig = '';
  }, 2000);
})();
