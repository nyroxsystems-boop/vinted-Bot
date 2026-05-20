// Manueller Sale eintragen — für Bestellungen die durchgerutscht sind,
// weil der zugehörige Bot offline war oder die Plattform gar nicht angebunden.
// Erzeugt einen Listings-Stub (falls keine vorhandene listing_id übergeben
// wird) und einen Sales-Eintrag mit Käuferadresse, damit CJ-Fulfillment die
// Order weiterreichen kann.

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from '../api/client';
import { toast } from './Toast';

const MARKETPLACES: Array<{ id: string; label: string }> = [
  { id: 'vinted',        label: 'Vinted' },
  { id: 'kleinanzeigen', label: 'Kleinanzeigen' },
  { id: 'ebay_de',       label: 'eBay DE' },
  { id: 'ebay_uk',       label: 'eBay UK' },
  { id: 'depop',         label: 'Depop' },
  { id: 'mercari',       label: 'Mercari' },
  { id: 'wallapop',      label: 'Wallapop' },
  { id: 'etsy',          label: 'Etsy' },
];

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function ManualSaleModal({ onClose, onCreated }: Props) {
  const [marketplace, setMarketplace] = useState('kleinanzeigen');
  const [title, setTitle] = useState('');
  const [listPriceEur, setListPriceEur] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [street, setStreet] = useState('');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('DE');
  const [phone, setPhone] = useState('');
  const [externalId, setExternalId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    if (!buyerName.trim() || !street.trim() || !zip.trim() || !city.trim()) {
      toast.error('Bitte Käufer-Name + Straße + PLZ + Ort ausfüllen.');
      return;
    }
    if (!title.trim() || !Number.isFinite(Number(listPriceEur)) || Number(listPriceEur) <= 0) {
      toast.error('Titel + Listpreis (€) erforderlich.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<{ ok: boolean; sale_id: number; listing_id: number }>(
        '/sales/manual',
        {
          marketplace,
          title: title.trim(),
          list_price_eur: Number(listPriceEur),
          external_id: externalId.trim() || undefined,
          buyer_name: buyerName.trim(),
          buyer_address: {
            name: buyerName.trim(),
            street: street.trim(),
            zip: zip.trim(),
            city: city.trim(),
            country: country.trim() || 'DE',
            phone: phone.trim() || undefined,
          },
          buyer_phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      );
      toast.success(`Sale #${result.sale_id} eingetragen`, {
        detail: 'Wenn das Listing mit einem CJ-Produkt verknüpft ist, übernimmt der Fulfillment-Worker beim nächsten Tick. Sonst manuell bei CJ ordern.',
      });
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Manuellen Sale eintragen</div>
            <div className="text-xs text-zinc-500">Für Bestellungen die der Bot nicht erfasst hat</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Marktplatz</div>
              <select className="input w-full" value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
                {MARKETPLACES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Plattform-ID (optional)</div>
              <input className="input w-full" placeholder="z.B. KA-Inserat-ID" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Listing-Titel</div>
              <input className="input w-full" placeholder="z.B. Sommerkleid rot Größe S" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Listpreis €</div>
              <input className="input w-24" type="number" min="0" step="0.01" placeholder="29.99" value={listPriceEur} onChange={(e) => setListPriceEur(e.target.value)} />
            </label>
          </div>

          <div className="space-y-1 border-t border-zinc-800 pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Käufer + Lieferadresse</div>
            <input className="input w-full" placeholder="Vollständiger Name (z.B. Peri Haufler)" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            <input className="input w-full" placeholder="Straße + Hausnummer" value={street} onChange={(e) => setStreet(e.target.value)} />
            <div className="grid grid-cols-[120px_1fr_80px] gap-2">
              <input className="input" placeholder="PLZ" value={zip} onChange={(e) => setZip(e.target.value)} />
              <input className="input" placeholder="Ort" value={city} onChange={(e) => setCity(e.target.value)} />
              <input className="input" placeholder="Land" value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <input className="input w-full" placeholder="Telefon (optional, oft von CJ verlangt)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          <label className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Notiz (optional)</div>
            <input className="input w-full" placeholder='z.B. „Direkt-Kauf auf KA — Bot war offline"' value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button className="btn-ghost" onClick={onClose} disabled={submitting}>Abbrechen</button>
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => void submit()} disabled={submitting}>
            {submitting && <Loader2 size={13} className="animate-spin" />}
            Sale eintragen
          </button>
        </div>
      </div>
    </div>
  );
}
