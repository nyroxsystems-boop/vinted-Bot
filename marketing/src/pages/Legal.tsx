import { useParams } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';

const DOCS: Record<string, { title: string; body: JSX.Element }> = {
  agb: {
    title: 'Allgemeine Geschäftsbedingungen',
    body: (
      <>
        <h2>1. Geltungsbereich</h2>
        <p>
          Diese AGB regeln die Nutzung der Blackruby-Software ("Software") zwischen Blackruby Systems
          ("Anbieter") und dem Lizenznehmer ("Nutzer").
        </p>
        <h2>2. Vertragsgegenstand</h2>
        <p>
          Der Anbieter überlässt dem Nutzer eine zeitlich begrenzte (Starter/Hustler) oder zeitlich
          unbegrenzte (Lifetime) Lizenz zur Nutzung der Software. Die Lizenz ist nicht übertragbar
          und nicht unterlizenzierbar.
        </p>
        <h2>3. Preise &amp; Zahlung</h2>
        <p>
          Es gelten die zum Zeitpunkt der Bestellung auf <code>/pricing</code> aufgeführten Preise.
          Die Zahlungsabwicklung erfolgt über Stripe. Bei Abo-Lizenzen verlängert sich die Lizenz
          automatisch um die gewählte Periode (Monat/Jahr), wenn sie nicht spätestens 24 h vor
          Ablauf gekündigt wird.
        </p>
        <h2>4. Widerruf &amp; Geld-zurück-Garantie</h2>
        <p>
          Innerhalb von 7 Tagen nach Kauf kann der Nutzer ohne Angabe von Gründen den Kauf rückgängig
          machen. Die Lizenz wird deaktiviert, der Kaufpreis erstattet.
        </p>
        <h2>5. Nutzungsbeschränkungen &amp; Risiken automatisierter Marktplatz-Nutzung</h2>
        <p>
          Die Software automatisiert Aufgaben (Inserate erstellen, Chats beantworten, Verkäufe
          abwickeln) auf Drittanbieter-Marktplätzen (Vinted, eBay, Kleinanzeigen, Depop, Mercari,
          Wallapop u. a.). <strong>Der Nutzer nimmt ausdrücklich zur Kenntnis und akzeptiert</strong>:
        </p>
        <ul>
          <li>
            Die AGB praktisch aller genannten Marktplätze untersagen oder beschränken die Nutzung
            von Bots, Scrapern und automatisierten Tools. Der Einsatz von Blackruby kann gegen
            diese AGB verstoßen.
          </li>
          <li>
            Marktplätze können den Account des Nutzers jederzeit ohne Vorwarnung sperren, einfrieren,
            löschen oder Guthaben einbehalten. Dies ist ein <strong>vom Nutzer allein getragenes Risiko</strong>.
          </li>
          <li>
            Der Anbieter haftet weder für Account-Sperrungen, Guthaben-Verluste, Daten-Verluste,
            entgangene Umsätze noch für sonstige rechtliche oder finanzielle Folgen der Nutzung
            der Software auf einem Drittanbieter-Marktplatz.
          </li>
          <li>
            Der Nutzer ist <strong>allein verantwortlich</strong> für die Einhaltung sämtlicher
            anwendbarer Nutzungsbedingungen, gesetzlicher Vorschriften (Steuer-, Handels-,
            Verbraucherschutzrecht) und Plattform-Regeln seines Tätigkeitslandes.
          </li>
          <li>
            Die Software wird "as is" geliefert. Der Anbieter sichert keinen bestimmten wirtschaftlichen
            Erfolg, keine Anti-Detection-Wirksamkeit und keine dauerhafte Kompatibilität mit den
            laufend geänderten Schnittstellen der Drittanbieter zu.
          </li>
        </ul>
        <p>
          Wer Blackruby einsetzt, tut dies in vollem Bewusstsein dieser Risiken. Eine Rückerstattung
          aufgrund von Marktplatz-Sperren ist ausgeschlossen (Geld-zurück-Garantie nach §4 bleibt
          unberührt für die ersten 7 Tage).
        </p>
        <h2>6. Haftung</h2>
        <p>
          Der Anbieter haftet nur für Schäden, die auf Vorsatz oder grober Fahrlässigkeit beruhen.
          Eine darüber hinausgehende Haftung — insbesondere für entgangene Gewinne, Datenverluste
          oder Marktplatz-Sperren — ist ausgeschlossen.
        </p>
        <h2>7. Schlussbestimmungen</h2>
        <p>
          Es gilt deutsches Recht. Gerichtsstand ist der Sitz des Anbieters, soweit gesetzlich
          zulässig.
        </p>
      </>
    ),
  },
  datenschutz: {
    title: 'Datenschutzerklärung',
    body: (
      <>
        <h2>Verantwortlicher</h2>
        <p>Blackruby Systems · support@blackruby.app</p>
        <h2>Erhobene Daten</h2>
        <p>
          Beim Kauf erheben wir nur die für die Vertragsabwicklung notwendigen Daten: E-Mail,
          Lizenz-Tier, Stripe-Customer-ID. Die Software selbst läuft lokal auf deinem Rechner —
          Listings, Cookies, API-Keys und Verkaufsdaten verlassen dein Gerät nicht.
        </p>
        <h2>Stripe</h2>
        <p>
          Zahlungsabwicklung erfolgt über Stripe Payments Europe Ltd. Stripe verarbeitet
          Zahlungsdaten gemäß <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">stripe.com/privacy</a>.
        </p>
        <h2>Auto-Updater</h2>
        <p>
          Die App prüft regelmäßig den Update-Server auf neue Versionen. Dabei wird die installierte
          Version, OS und Lizenz-Status (gültig/ungültig) übermittelt — keine Listings- oder
          Kundendaten.
        </p>
        <h2>Datenverarbeiter (Art. 28 DSGVO)</h2>
        <p>
          Für bestimmte Verarbeitungstätigkeiten setzen wir externe Dienstleister ein, mit denen jeweils
          ein Auftragsverarbeitungsvertrag (AV-Vertrag) gemäß Art. 28 DSGVO besteht bzw. von den
          Anbietern bereitgestellt wird:
        </p>
        <ul>
          <li>
            <strong>Stripe Payments Europe Ltd.</strong> (Zahlungsabwicklung) —{' '}
            <a href="https://stripe.com/de/privacy" target="_blank" rel="noreferrer">stripe.com/de/privacy</a>{' '}
            · AV-Vertrag:{' '}
            <a href="https://stripe.com/de/legal/dpa" target="_blank" rel="noreferrer">stripe.com/de/legal/dpa</a>
          </li>
          <li>
            <strong>Google Ireland Ltd. — Gemini API</strong> (Bild- und Textgenerierung) —{' '}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">policies.google.com/privacy</a>{' '}
            · AV-Vertrag:{' '}
            <a href="https://cloud.google.com/terms/data-processing-addendum" target="_blank" rel="noreferrer">cloud.google.com/terms/data-processing-addendum</a>
          </li>
          <li>
            <strong>Anthropic PBC</strong> (optionaler LLM-Provider, nur bei Aktivierung) —{' '}
            <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noreferrer">anthropic.com/legal/privacy</a>{' '}
            · AV-Vertrag siehe Anbieter.
          </li>
          <li>
            <strong>CJ Dropshipping</strong> (Fulfillment, Versand an Endkunden bei Verkauf) —{' '}
            <a href="https://cjdropshipping.com/privacy-policy" target="_blank" rel="noreferrer">cjdropshipping.com/privacy-policy</a>{' '}
            · AV-Vertrag siehe Anbieter.
          </li>
        </ul>
        <p className="text-zinc-500">
          Hinweis: Die KI- und Fulfillment-Provider werden ausschließlich auf deinem Gerät mit deinen
          API-Keys angesprochen. Übermittelt werden nur die Daten, die du selbst für Listings/Bestellungen
          eingibst (Produktfotos, Adressdaten des Endkunden).
        </p>
        <h2>Deine Rechte</h2>
        <p>
          Du hast jederzeit das Recht auf Auskunft, Berichtigung und Löschung deiner Daten. Anfragen
          an support@blackruby.app.
        </p>
      </>
    ),
  },
  impressum: {
    title: 'Impressum',
    body: (
      <>
        {import.meta.env.VITE_IMPRESSUM_NAME ? (
          <p>
            {import.meta.env.VITE_IMPRESSUM_NAME}<br />
            {import.meta.env.VITE_IMPRESSUM_STREET}<br />
            {import.meta.env.VITE_IMPRESSUM_CITY}<br />
            Deutschland<br />
            {import.meta.env.VITE_IMPRESSUM_EMAIL && <>E-Mail: {import.meta.env.VITE_IMPRESSUM_EMAIL}<br /></>}
            {import.meta.env.VITE_IMPRESSUM_HRB && <>Handelsregister: {import.meta.env.VITE_IMPRESSUM_HRB}<br /></>}
            {import.meta.env.VITE_IMPRESSUM_VAT && <>USt-IdNr.: {import.meta.env.VITE_IMPRESSUM_VAT}</>}
          </p>
        ) : (
          <p style={{ color: '#ef4444', fontWeight: 600 }}>
            ⚠ Impressum nicht konfiguriert. Setze VITE_IMPRESSUM_NAME, VITE_IMPRESSUM_STREET,
            VITE_IMPRESSUM_CITY, VITE_IMPRESSUM_EMAIL, VITE_IMPRESSUM_HRB, VITE_IMPRESSUM_VAT
            vor dem Production-Build. Go-Live ohne diese Werte ist abmahnbar (§5 TMG).
          </p>
        )}
        <p>
          Kontakt: {import.meta.env.VITE_IMPRESSUM_EMAIL ?? 'support@blackruby.app'}
        </p>
        <p className="text-zinc-500">
          Inhaltlich Verantwortlicher gemäß § 18 Abs. 2 MStV:{' '}
          {import.meta.env.VITE_IMPRESSUM_NAME ?? '[Name wird vor Go-Live ergänzt]'}
        </p>
      </>
    ),
  },
};

export function LegalPage() {
  const { doc } = useParams();
  const entry = doc && DOCS[doc];

  return (
    <div className="min-h-screen">
      <Nav />
      <section className="py-20">
        <div className="container-mid">
          {entry ? (
            <>
              <h1 className="font-display text-4xl font-extrabold tracking-tight text-white">
                {entry.title}
              </h1>
              <div className="prose prose-invert prose-zinc mt-8 max-w-none text-zinc-300 [&_a]:text-ruby-300 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_p]:mt-3 [&_p]:leading-relaxed">
                {entry.body}
              </div>
            </>
          ) : (
            <div className="card-glass">
              <p className="text-zinc-300">Dokument nicht gefunden.</p>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
