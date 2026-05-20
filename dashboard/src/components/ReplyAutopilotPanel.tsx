// ──────────────────────────────────────────────────────────────────────────────
// ReplyAutopilotPanel
//
// Konfiguriert wie Claude auf Käufer-Nachrichten antwortet:
//   - Modus: draft (Review-Queue) | auto (selbständig senden)
//   - Verzögerung: 10-15min Default (menschlich), konfigurierbar
//   - Lookback-Fenster + Verhandlungs-Slack
// ──────────────────────────────────────────────────────────────────────────────

export function ReplyAutopilotPanel(props: {
  draft: Record<string, string>;
  set: (k: string, v: string) => void;
  onSave: () => void;
}) {
  const enabled = props.draft.auto_reply_enabled === 'true';
  const mode = (props.draft.auto_reply_send_mode ?? 'draft') as 'draft' | 'auto';
  const provider = props.draft.llm_provider ?? 'claude_cli';
  const delayMin = parseInt(props.draft.auto_reply_delay_min_s ?? '600', 10);
  const delayMax = parseInt(props.draft.auto_reply_delay_max_s ?? '900', 10);
  const lookback = parseInt(props.draft.auto_reply_lookback_min ?? '60', 10);
  const dropPct = parseFloat(props.draft.auto_reply_max_negotiation_drop_pct ?? '15');

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Reply-Autopilot</h2>
        <p className="text-xs text-zinc-400">
          Claude beantwortet Käufer-Nachrichten. Im Auto-Modus mit 10-15min Verzögerung — wirkt menschlich, nicht wie ein Bot.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">Autopilot aktiv</div>
          <div className="text-xs text-zinc-400">Bei deaktiv: keine Drafts, keine Sends.</div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => props.set('auto_reply_enabled', e.target.checked ? 'true' : 'false')}
            className="peer sr-only"
          />
          <div className="h-6 w-11 rounded-full bg-zinc-800 transition peer-checked:bg-rose-600"></div>
          <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-zinc-50 transition peer-checked:translate-x-5"></div>
        </label>
      </div>

      <div>
        <div className="label">Modus</div>
        <div className="flex flex-wrap gap-2">
          {([
            { id: 'draft', label: 'Draft (Review-Queue)', hint: 'Du bestätigst jede Antwort vor dem Senden.' },
            { id: 'auto',  label: 'Auto (mit Delay)',     hint: '10-15min später wird automatisch gesendet.' },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              onClick={() => props.set('auto_reply_send_mode', opt.id)}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                mode === opt.id
                  ? 'border-rose-500 bg-rose-500/10 text-rose-300'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="opacity-70">{opt.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="label">LLM-Provider</div>
        <select
          className="input max-w-[280px]"
          value={provider}
          onChange={(e) => props.set('llm_provider', e.target.value)}
        >
          <option value="claude_cli">Claude CLI (lokal, gratis über Abo)</option>
          <option value="anthropic">Anthropic API (Pay-per-Token)</option>
          <option value="gemini">Gemini API (Free-Tier)</option>
        </select>
        <div className="mt-1 text-xs text-zinc-400">
          Claude CLI nutzt dein lokales Abo — keine API-Kosten. Voraussetzung: `claude` Binary im PATH.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="label">Min. Verzögerung (Sekunden)</div>
          <input
            type="number"
            min={0}
            step={30}
            className="input max-w-[160px]"
            value={delayMin}
            onChange={(e) => props.set('auto_reply_delay_min_s', String(Math.max(0, parseInt(e.target.value, 10) || 0)))}
          />
          <div className="mt-1 text-xs text-zinc-400">{Math.round(delayMin / 60)} min</div>
        </div>
        <div>
          <div className="label">Max. Verzögerung (Sekunden)</div>
          <input
            type="number"
            min={delayMin}
            step={30}
            className="input max-w-[160px]"
            value={delayMax}
            onChange={(e) => props.set('auto_reply_delay_max_s', String(Math.max(delayMin, parseInt(e.target.value, 10) || delayMin)))}
          />
          <div className="mt-1 text-xs text-zinc-400">{Math.round(delayMax / 60)} min</div>
        </div>
        <div>
          <div className="label">Lookback-Fenster (min)</div>
          <input
            type="number"
            min={5}
            step={5}
            className="input max-w-[160px]"
            value={lookback}
            onChange={(e) => props.set('auto_reply_lookback_min', String(parseInt(e.target.value, 10) || 60))}
          />
          <div className="mt-1 text-xs text-zinc-400">Wie weit zurück nach unbeantworteten Nachrichten geschaut wird.</div>
        </div>
        <div>
          <div className="label">Max. Preis-Nachlass (%)</div>
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            className="input max-w-[160px]"
            value={dropPct}
            onChange={(e) => props.set('auto_reply_max_negotiation_drop_pct', String(parseFloat(e.target.value) || 15))}
          />
          <div className="mt-1 text-xs text-zinc-400">Über diesem Nachlass keine automatische Zusage.</div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button className="btn-primary" onClick={props.onSave}>Speichern</button>
      </div>
    </div>
  );
}
