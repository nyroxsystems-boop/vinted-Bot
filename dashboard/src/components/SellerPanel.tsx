// ──────────────────────────────────────────────────────────────────────────────
// SellerPanel
//
// Multi-tenant-fähiges Verkäufer-Profil. Diese Daten werden von Claude in
// Chat-Antworten genutzt — z.B. "Du kannst per PayPal an X@Y.de zahlen,
// Empfänger: <name>". Damit ist das System nicht hardcoded auf einen User.
// ──────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';

export type PaymentMethod =
  | { type: 'paypal'; handle: string; name: string }
  | { type: 'iban'; handle: string; holder: string }
  | { type: 'ebay'; note?: string }
  | { type: 'vinted'; note?: string }
  | { type: 'cash'; note?: string }
  | { type: 'other'; handle?: string; name?: string; note?: string };

function parseMethods(json: string): PaymentMethod[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed as PaymentMethod[];
    return [];
  } catch { return []; }
}

export function SellerPanel(props: {
  draft: Record<string, string>;
  set: (k: string, v: string) => void;
  onSave: () => void;
}) {
  const methods = useMemo(() => parseMethods(props.draft.payment_methods_json ?? '[]'), [props.draft.payment_methods_json]);

  function updateMethods(next: PaymentMethod[]) {
    props.set('payment_methods_json', JSON.stringify(next));
  }

  function addMethod(type: PaymentMethod['type']) {
    const base: PaymentMethod =
      type === 'paypal' ? { type: 'paypal', handle: '', name: '' } :
      type === 'iban' ? { type: 'iban', handle: '', holder: '' } :
      type === 'ebay' ? { type: 'ebay' } :
      type === 'vinted' ? { type: 'vinted' } :
      type === 'cash' ? { type: 'cash' } :
      { type: 'other', handle: '', name: '' };
    updateMethods([...methods, base]);
  }

  function patchMethod(i: number, patch: Partial<PaymentMethod>) {
    const next = methods.map((m, idx) => idx === i ? ({ ...m, ...patch }) as PaymentMethod : m);
    updateMethods(next);
  }

  function removeMethod(i: number) {
    updateMethods(methods.filter((_, idx) => idx !== i));
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Verkäufer-Profil</h2>
          <p className="text-xs text-zinc-400">
            Wird in Chat-Antworten verwendet (Versand-Adresse, Zahlungs-Daten). Multi-Tenant: jeder Nutzer trägt sein eigenes Profil ein.
          </p>
        </div>
      </div>

      {/* Grunddaten */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="label">Anzeige-Name (im Chat)</div>
          <input
            className="input"
            placeholder="z.B. Lina"
            value={props.draft.seller_display_name ?? ''}
            onChange={(e) => props.set('seller_display_name', e.target.value)}
          />
          <div className="mt-1 text-xs text-zinc-400">So stellt sich Claude vor: "Hi, ich bin Lina :)"</div>
        </div>
        <div>
          <div className="label">Voller Name (für Rechnungen)</div>
          <input
            className="input"
            placeholder="z.B. Lina Müller"
            value={props.draft.seller_name ?? ''}
            onChange={(e) => props.set('seller_name', e.target.value)}
          />
          <div className="mt-1 text-xs text-zinc-400">Wird nur bei Rechnung/Beleg referenziert.</div>
        </div>
        <div>
          <div className="label">PLZ</div>
          <input
            className="input max-w-[120px]"
            placeholder="12345"
            value={props.draft.seller_zip ?? ''}
            onChange={(e) => props.set('seller_zip', e.target.value)}
          />
        </div>
        <div>
          <div className="label">Stadt</div>
          <input
            className="input"
            placeholder="Berlin"
            value={props.draft.seller_city ?? ''}
            onChange={(e) => props.set('seller_city', e.target.value)}
          />
        </div>
        <div>
          <div className="label">Standard-Versender</div>
          <select
            className="input max-w-[180px]"
            value={props.draft.shipping_default_provider ?? 'Hermes'}
            onChange={(e) => props.set('shipping_default_provider', e.target.value)}
          >
            <option value="Hermes">Hermes</option>
            <option value="DHL">DHL</option>
            <option value="DPD">DPD</option>
            <option value="GLS">GLS</option>
            <option value="UPS">UPS</option>
            <option value="Deutsche Post">Deutsche Post</option>
          </select>
        </div>
      </div>

      {/* Zahlungsmethoden */}
      <div className="border-t border-zinc-800 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="font-medium">Zahlungsmethoden</div>
            <div className="text-xs text-zinc-400">Claude antwortet mit GENAU diesen Daten — keine Erfindungen.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary text-xs" onClick={() => addMethod('paypal')}>+ PayPal</button>
            <button className="btn-secondary text-xs" onClick={() => addMethod('iban')}>+ IBAN</button>
            <button className="btn-secondary text-xs" onClick={() => addMethod('ebay')}>+ Kleinanzeigen Direktkauf</button>
            <button className="btn-secondary text-xs" onClick={() => addMethod('vinted')}>+ Vinted Käuferschutz</button>
            <button className="btn-secondary text-xs" onClick={() => addMethod('cash')}>+ Bar bei Abholung</button>
          </div>
        </div>

        {methods.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-sm text-zinc-400">
            Noch keine Zahlungsmethode konfiguriert. Bitte mindestens eine hinzufügen.
          </div>
        )}

        <div className="space-y-3">
          {methods.map((m, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {m.type === 'paypal' && 'PayPal'}
                  {m.type === 'iban' && 'Überweisung (IBAN)'}
                  {m.type === 'ebay' && 'Kleinanzeigen Direktkauf'}
                  {m.type === 'vinted' && 'Vinted Käuferschutz'}
                  {m.type === 'cash' && 'Barzahlung bei Abholung'}
                  {m.type === 'other' && 'Sonstige'}
                </div>
                <button
                  className="text-xs text-zinc-500 hover:text-red-400"
                  onClick={() => removeMethod(i)}
                >
                  Entfernen
                </button>
              </div>

              {m.type === 'paypal' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="input"
                    placeholder="paypal@email.de"
                    value={m.handle ?? ''}
                    onChange={(e) => patchMethod(i, { handle: e.target.value } as Partial<PaymentMethod>)}
                  />
                  <input
                    className="input"
                    placeholder="Empfänger-Name"
                    value={m.name ?? ''}
                    onChange={(e) => patchMethod(i, { name: e.target.value } as Partial<PaymentMethod>)}
                  />
                </div>
              )}
              {m.type === 'iban' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="input"
                    placeholder="DE89 3704 0044 0532 0130 00"
                    value={m.handle ?? ''}
                    onChange={(e) => patchMethod(i, { handle: e.target.value } as Partial<PaymentMethod>)}
                  />
                  <input
                    className="input"
                    placeholder="Kontoinhaber"
                    value={m.holder ?? ''}
                    onChange={(e) => patchMethod(i, { holder: e.target.value } as Partial<PaymentMethod>)}
                  />
                </div>
              )}
              {(m.type === 'ebay' || m.type === 'vinted' || m.type === 'cash') && (
                <input
                  className="input"
                  placeholder="Hinweis (optional)"
                  value={m.note ?? ''}
                  onChange={(e) => patchMethod(i, { note: e.target.value } as Partial<PaymentMethod>)}
                />
              )}
              {m.type === 'other' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Anbieter (Bezeichnung)"
                    value={m.name ?? ''}
                    onChange={(e) => patchMethod(i, { name: e.target.value } as Partial<PaymentMethod>)}
                  />
                  <input
                    className="input"
                    placeholder="Handle / Adresse"
                    value={m.handle ?? ''}
                    onChange={(e) => patchMethod(i, { handle: e.target.value } as Partial<PaymentMethod>)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button className="btn-primary" onClick={props.onSave}>Speichern</button>
      </div>
    </div>
  );
}
