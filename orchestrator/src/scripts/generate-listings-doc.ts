// CLI: tsx src/scripts/generate-listings-doc.ts
// Liest Temu_Produkt_Links.md + alle Ordner, ruft Claude für jedes Produkt
// (parallel, 6er-Chunks), schreibt /Users/home/Vinted/Listings.md mit
// authentischen Vinted-Verkäuferinnen-Texten.
import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { vintedRoot } from '@vinted-system/shared';

// Repo-relative .env — works wherever the script is run from.
const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, '..', '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env'), override: true });

const VINTED_ROOT = vintedRoot();
const TEMU_LINKS = path.join(VINTED_ROOT, 'Temu_Produkt_Links.md');
const OUT = path.join(VINTED_ROOT, 'Listings.md');
const MIN_PRICE_EUR = 20;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
// Fallback-Liste — falls erstes Modell 404 ist, nimmt das Skript das nächste
const ANTHROPIC_MODELS = (process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5,claude-3-5-sonnet-latest,claude-3-5-haiku-latest').split(',').map((s) => s.trim());
let MODEL_INDEX = 0;
const CONCURRENCY = 6;

// ── URL-Slug → strukturiertes Produkt ─────────────────────────────────────

interface ParsedProduct {
  slug: string;
  productType: string;
  color: string;
  features: string[];
  season: string;
  style: string;
}

function unslug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bg \d+/g, '')
    .trim();
}

function parseProduct(slug: string): ParsedProduct {
  const t = unslug(slug).toLowerCase();
  // Reihenfolge wichtig: spezifischer zuerst (Skort vor Rock, Bandeau-Top vor Top etc.)
  const productType =
    // Sets / 2-3 Teiler
    /\b3.?teilig|drei.?teilig|3 teiliges/.test(t) ? '3-Teiler Set'
    : /\b2.?teilig|zwei.?teilig|2 teiliges/.test(t) ? '2-Teiler Set'
    : /\bset\b.*top.*rock|set\b.*top.*hose|cami.*hose|cami.*shorts/.test(t) ? 'Set'

    // Pyjama / Schlaf / Loungewear
    : /pyjama.?set|schlafanzug.?set|schlafanzug/.test(t) ? 'Pyjama-Set'
    : /pyjama|nachthemd|nachtwasche|loungewear|homewear|schlaf|nightwear/.test(t) ? 'Nachtwäsche'

    // Jumpsuit / Overall
    : /jumpsuit|overall|playsuit/.test(t) ? 'Jumpsuit'

    // Sport / Yoga
    : /sport.?bh|sportbh|fitness.?top|yoga.?top|yoga.?tank|sportweste|sport.?weste/.test(t) ? 'Sport-Top'
    : /sport.?jacke|fitness.?jacke|laufjacke/.test(t) ? 'Sportjacke'
    : /sport.?leggings|yoga.?leggings|fitness.?leggings/.test(t) ? 'Sport-Leggings'
    : /sport.?hose|laufhose|fitness.?hose|jogger.*sport/.test(t) ? 'Sporthose'
    : /sport.?shorts|fitness.?shorts/.test(t) ? 'Sport-Shorts'

    // Hosen — sehr spezifisch
    : /skort|rockhose/.test(t) ? 'Skort'
    : /denim.?shorts|jeans.?shorts/.test(t) ? 'Jeansshorts'
    : /\bshorts\b/.test(t) ? 'Shorts'
    : /jeans\b|denim/.test(t) ? 'Jeans'
    : /cargo.?hose|cargohose|cargo/.test(t) ? 'Cargohose'
    : /jogger|jogging|jogginghose/.test(t) ? 'Jogginghose'
    : /leggings/.test(t) ? 'Leggings'
    : /palazzo|wide.?leg|weite[s]?.?bein|weiter.?beinform|fallschirmhose/.test(t) ? 'Wide-Leg-Hose'
    : /strandhose/.test(t) ? 'Strandhose'
    : /hose|pants|trousers|hosen/.test(t) ? 'Hose'

    // Röcke
    : /minirock/.test(t) ? 'Minirock'
    : /midirock/.test(t) ? 'Midirock'
    : /maxirock/.test(t) ? 'Maxirock'
    : /\brock\b|skirt/.test(t) ? 'Rock'

    // Tops
    : /tank.?top|tanktop|trager.?hemd|tragerhemd/.test(t) ? 'Tanktop'
    : /crop.?top|croptop|bauchfrei/.test(t) ? 'Crop Top'
    : /bandeau/.test(t) ? 'Bandeau-Top'
    : /cami.?top|camisole/.test(t) ? 'Cami-Top'
    : /\bbluse\b|blusen/.test(t) ? 'Bluse'
    : /t.?shirt\b|tshirt/.test(t) ? 'T-Shirt'
    : /langarm.?shirt|longsleeve|long.?sleeve/.test(t) ? 'Longsleeve'
    : /shirtkleid/.test(t) ? 'Hemdblusenkleid'
    : /\bhemd\b/.test(t) ? 'Hemd'
    : /sweatshirt|sweater/.test(t) ? 'Sweatshirt'
    : /hoodie|kapuzenpulli|kapuzenpullover/.test(t) ? 'Hoodie'
    : /pullover|pulli|strick/.test(t) ? 'Pullover'
    : /\btop\b/.test(t) ? 'Top'

    // Jacken / Mäntel
    : /jacke|jacket|blazer/.test(t) ? 'Jacke'
    : /mantel|coat/.test(t) ? 'Mantel'

    // Bademode
    : /bikini/.test(t) ? 'Bikini'
    : /badeanzug|swimsuit/.test(t) ? 'Badeanzug'

    // Kleider — am Schluss damit "shirtkleid" oben gewinnt
    : /maxikleid|maxi.kleid/.test(t) ? 'Maxikleid'
    : /midikleid|midi.kleid/.test(t) ? 'Midikleid'
    : /minikleid|mini.kleid|\bmini\b/.test(t) ? 'Minikleid'
    : /sommerkleid/.test(t) ? 'Sommerkleid'
    : /cocktailkleid/.test(t) ? 'Cocktailkleid'
    : /abendkleid/.test(t) ? 'Abendkleid'
    : /alltagskleid|freizeitkleid/.test(t) ? 'Alltagskleid'
    : /strandkleid/.test(t) ? 'Strandkleid'
    : /tragerkleid|spaghetti.?kleid/.test(t) ? 'Trägerkleid'
    : /wickelkleid|wrap.?kleid/.test(t) ? 'Wickelkleid'
    : /a.?linien.?kleid|a.linie/.test(t) ? 'A-Linien-Kleid'
    : /vintage.?kleid/.test(t) ? 'Vintage-Kleid'
    : /kleid|dress/.test(t) ? 'Kleid'

    // Accessoires
    : /tuch|halstuch|schal/.test(t) ? 'Tuch'
    : 'Kleidungsstück';

  const color =
    /schwarz|black/.test(t) ? 'Schwarz'
    : /weiss|weiß|white/.test(t) ? 'Weiß'
    : /rosa|pink/.test(t) ? 'Rosa'
    : /\brot\b|red/.test(t) ? 'Rot'
    : /blau|blue|navy/.test(t) ? 'Blau'
    : /grun|grün|green|khaki/.test(t) ? 'Grün'
    : /gelb|yellow/.test(t) ? 'Gelb'
    : /beige|nude|creme/.test(t) ? 'Beige'
    : /grau|grey|gray/.test(t) ? 'Grau'
    : /braun|brown|schoko/.test(t) ? 'Braun'
    : /lila|purple|violett/.test(t) ? 'Lila'
    : /weinrot|bordeaux|burgundy/.test(t) ? 'Weinrot'
    : /einfarbig/.test(t) ? 'Unifarben'
    : /blumenmuster|blumen|floral/.test(t) ? 'Blumenmuster'
    : 'Mehrfarbig';

  const features: string[] = [];
  if (/spaghetti/.test(t)) features.push('Spaghettiträger');
  if (/stehkragen/.test(t)) features.push('Stehkragen');
  if (/v.?ausschnitt/.test(t)) features.push('V-Ausschnitt');
  if (/rundhals/.test(t)) features.push('Rundhalsausschnitt');
  if (/quadratisch.*ausschnitt/.test(t)) features.push('Eckiger Ausschnitt');
  if (/halter|neckholder/.test(t)) features.push('Neckholder');
  if (/schulterfrei|off.shoulder|bandeau/.test(t)) features.push('Schulterfrei');
  if (/ruckenfrei|backless/.test(t)) features.push('Rückenfrei');
  if (/blumenmuster|floral/.test(t)) features.push('Blumenmuster');
  if (/plissee|pleated/.test(t)) features.push('Plissee');
  if (/satin/.test(t)) features.push('Satin-Look');
  if (/spitze|lace/.test(t)) features.push('Spitze');
  if (/figurbetont|bodycon|engan|fit\b/.test(t)) features.push('Figurbetont');
  if (/taillen|tailliert|gerafft|raffung|rusche/.test(t)) features.push('Tailliert');
  if (/schlitz|slit/.test(t)) features.push('Seitenschlitz');
  if (/asymmetri/.test(t)) features.push('Asymmetrisch');
  if (/langarm|long.sleeve/.test(t)) features.push('Langarm');
  if (/kurzarm|short.sleeve/.test(t)) features.push('Kurzarm');
  if (/armellos|sleeveless/.test(t)) features.push('Ärmellos');
  if (/elegant/.test(t)) features.push('Elegant');
  if (/durchbrochen|hollow/.test(t)) features.push('Cut-Out');
  if (/kordel|drawstring/.test(t)) features.push('Kordelzug');

  const season =
    /sommer|summer|fruhjahr|fruhling|frühling/.test(t) ? 'Sommer'
    : /herbst|winter|fall/.test(t) ? 'Übergangszeit'
    : 'Ganzjährig';

  const style =
    /elegant|abendkleid|cocktail|festlich|gala/.test(t) ? 'Elegant'
    : /strand|urlaub|beach|holiday/.test(t) ? 'Strand & Urlaub'
    : /business/.test(t) ? 'Business Casual'
    : /casual|alltag|freizeit|home/.test(t) ? 'Casual'
    : /party|date|club/.test(t) ? 'Party'
    : 'Alltag';

  return { slug: unslug(slug), productType, color, features, season, style };
}

// ── Claude-Call ────────────────────────────────────────────────────────────

interface LlmListing { title: string; description: string }

async function callClaude(p: ParsedProduct, size: string, priceEur: number): Promise<LlmListing | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const sys = `Du bist eine 19-25 Jahre junge Frau, die ihre Kleidung auf Vinted verkauft. Schreib AUTHENTISCH wie auf Vinted üblich, ABER OHNE EMOJIS.

TITEL-REGELN (max 75 Zeichen):
- Suchbar machen mit echten Vinted-Suchbegriffen
- Brand-Vibe-Tag wie "Zara Stil", "Mango Stil", "& Other Stories" einbauen
- Aesthetic-Tag wie "Y2K", "Coquette", "Cottagecore", "Old Money", "Clean Girl"
- Anlass-Tag wie "Hochzeit", "Cocktail", "Strand", "Going Out"
- Format-Beispiele:
  * "Schwarzes Minikleid V-Ausschnitt Hochzeit Zara Stil"
  * "Y2K Bandeau Minikleid Schwarz Bodycon"
  * "Floral Maxikleid Sommer Cottagecore Mango Stil"
- KEINE Größe im Titel (Größe ist eigenes Vinted-Feld)
- KEINE Emojis im Titel

BESCHREIBUNGS-REGELN:
- 100-200 Wörter
- KEINE EMOJIS, gar keine
- Anfang: kurze authentische Story warum verkauft (1-2 Sätze)
- Mittelteil: konkret was es kann (Schnitt, Material schätzen, Outfit-Tipp)
- Material-Hinweis: Sommerkleider = Polyester/Viskose, Satin-Look = Polyester, Spitze = Spitze/Mix
- Ende: 1 Zeile NR/tierfrei + Versand + Bündelrabatt
- Letzte Zeile: 8-12 Hashtags (#produkttyp #farbe #stil #vinted #y2k #zara etc.)
- Tonalität: TikTok-Vinted-Mädchen Stil, locker aber clean, kein Gestottere
- KEIN "Hey ihr Lieben", KEINE Werbe-Floskeln

Antworte AUSSCHLIESSLICH als JSON, ohne Markdown-Codeblock:
{"title": "<titel>", "description": "<beschreibung>"}`;

  const user = `Produkt-Daten:
- Typ: ${p.productType}
- Farbe: ${p.color}
- Features: ${p.features.length > 0 ? p.features.join(', ') : '(keine spezifischen)'}
- Saison: ${p.season}
- Stil: ${p.style}
- Größe: ${size}
- Preis: ${priceEur.toFixed(2)}€
- Original-Slug: "${p.slug}"`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODELS[MODEL_INDEX] ?? 'claude-3-5-sonnet-latest',
        max_tokens: 800,
        system: sys,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text();
      // Modell unbekannt? → nächstes Modell ab nun
      if (res.status === 404 && MODEL_INDEX + 1 < ANTHROPIC_MODELS.length) {
        MODEL_INDEX++;
        console.warn(`  ↪ Switching to model ${ANTHROPIC_MODELS[MODEL_INDEX]}`);
        return null;
      }
      console.warn(`  ⚠ ${p.slug.slice(0, 40)}: HTTP ${res.status} — ${text.slice(0, 100)}`);
      return null;
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const txt = data.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
    const json = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = (() => {
      try { return JSON.parse(json) as Record<string, unknown>; } catch {
        const m = json.match(/\{[\s\S]*\}/);
        if (m) try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* */ }
        return null;
      }
    })();
    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.description !== 'string') return null;
    return {
      title: (parsed.title as string).slice(0, 80),
      description: (parsed.description as string).slice(0, 1900),
    };
  } catch (err) {
    console.warn(`  ⚠ exception: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Fallback (echte Vinted-Verkäuferinnen-Tonalität, mit Variation) ──────

// Deterministisches Pseudo-Random aus folder-num damit gleiches Produkt
// bei mehrfachem Generate dasselbe Listing bekommt
function seedRandom(seed: number): () => number {
  // Mulberry32 — gute Verteilung auch für kleine + benachbarte Seeds
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function fallbackTitle(p: ParsedProduct, _size: string, rand: () => number): string {
  const colorPart = p.color !== 'Mehrfarbig' && p.color !== 'Unifarben' && p.color !== 'Blumenmuster'
    ? p.color : '';

  // Brand-Vibe-Tags die auf Vinted als Suchbegriffe gut performen
  const brandVibes = ['Zara Stil', 'Mango Stil', '& Other Stories Style', 'COS Vibe', 'Reserved Stil'];

  // Aesthetic/Trend-Tags (echte Suchbegriffe auf Vinted Q1-Q2 2026)
  const aesthetics = ['Y2K', 'Coquette', 'Soft Girl', 'Cottagecore', 'Clean Girl', 'Old Money', 'Pinterest', 'Balletcore'];

  // Anlass-Tags
  const occasions: Record<string, string[]> = {
    'Elegant': ['Hochzeit', 'Cocktail', 'Date Night', 'Festlich'],
    'Strand & Urlaub': ['Strand', 'Urlaub', 'Mallorca', 'Vacay'],
    'Party': ['Going Out', 'Club', 'Festival'],
    'Casual': ['Alltag', 'Office', 'Streetstyle'],
    'Business Casual': ['Office', 'Business', 'Smart Casual'],
    'Alltag': ['Alltag', 'Casual'],
  };
  const occasion = pick(rand, occasions[p.style] ?? ['Alltag']);

  // Beschreibendes Feature (das stärkste Verkaufsargument)
  const headline = p.features[0] ?? (p.season === 'Sommer' ? 'Sommer' : '');

  // Mehrere Format-Varianten - rand wählt
  const formats: Array<() => string> = [
    // Format 1: "Schwarzes Minikleid V-Ausschnitt Hochzeit"
    () => [colorPart && colorize(colorPart, p.productType), p.productType, headline, occasion]
      .filter(Boolean).join(' '),
    // Format 2: "Y2K Minikleid Schwarz Bodycon"
    () => [pick(rand, aesthetics), p.productType, colorPart, headline].filter(Boolean).join(' '),
    // Format 3: "Coquette Floral Sommerkleid Mango Stil"
    () => [pick(rand, aesthetics), headline, p.productType, pick(rand, brandVibes)].filter(Boolean).join(' '),
    // Format 4: "Schwarzes Bandeau Minikleid - Going Out"
    () => {
      const left = [colorize(colorPart, p.productType), headline, p.productType].filter(Boolean).join(' ');
      return `${left} ${occasion}`;
    },
    // Format 5: pure descriptive
    () => [colorize(colorPart, p.productType), p.productType, headline, pick(rand, brandVibes)].filter(Boolean).join(' '),
  ];

  let title = pick(rand, formats)()
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  // Capitalize first letter, kill double-spaces, max 75 chars
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title.slice(0, 75);
}

// Genus pro Produkt: das/die/der bestimmt die Adjektiv-Endung
function nounGender(noun: string): 'm' | 'f' | 'n' {
  // feminin: die Hose, die Jeans, die Leggings, die Bluse, die Jacke etc.
  if (/^(Hose|Jeans|Leggings|Cargohose|Jogginghose|Wide-Leg-Hose|Strandhose|Sporthose|Sport-Leggings|Bluse|Jacke|Sportjacke|Nachtwäsche|Tasche)/i.test(noun)) return 'f';
  // maskulin: der Rock, der Pullover, der Hoodie, der Mantel, der Bikini, der Badeanzug, der Skort, der Jumpsuit
  if (/^(Rock|Minirock|Midirock|Maxirock|Skort|Pullover|Hoodie|Sweatshirt|Mantel|Bikini|Badeanzug|Jumpsuit|Overall)/i.test(noun)) return 'm';
  // alles andere neutrum (das Kleid, das Top, das T-Shirt, das Hemd, das Set)
  return 'n';
}

// "Schwarz" + Genus → "Schwarzes" / "Schwarze" / "Schwarzer"
function colorize(color: string, noun: string): string {
  if (!color) return '';
  const g = nounGender(noun);
  const masc: Record<string, string> = {
    'Schwarz': 'Schwarzer', 'Weiß': 'Weißer', 'Beige': 'Beiger', 'Grau': 'Grauer',
    'Braun': 'Brauner', 'Rot': 'Roter', 'Orange': 'Oranger', 'Gelb': 'Gelber',
    'Grün': 'Grüner', 'Blau': 'Blauer', 'Lila': 'Lila', 'Rosa': 'Rosa',
    'Türkis': 'Türkiser', 'Gold': 'Goldener', 'Silber': 'Silberner',
    'Weinrot': 'Weinroter', 'Khaki': 'Khakifarbener',
  };
  const fem: Record<string, string> = {
    'Schwarz': 'Schwarze', 'Weiß': 'Weiße', 'Beige': 'Beige', 'Grau': 'Graue',
    'Braun': 'Braune', 'Rot': 'Rote', 'Orange': 'Orange', 'Gelb': 'Gelbe',
    'Grün': 'Grüne', 'Blau': 'Blaue', 'Lila': 'Lila', 'Rosa': 'Rosa',
    'Türkis': 'Türkise', 'Gold': 'Goldene', 'Silber': 'Silberne',
    'Weinrot': 'Weinrote', 'Khaki': 'Khakifarbene',
  };
  const neu: Record<string, string> = {
    'Schwarz': 'Schwarzes', 'Weiß': 'Weißes', 'Beige': 'Beiges', 'Grau': 'Graues',
    'Braun': 'Braunes', 'Rot': 'Rotes', 'Orange': 'Oranges', 'Gelb': 'Gelbes',
    'Grün': 'Grünes', 'Blau': 'Blaues', 'Lila': 'Lila', 'Rosa': 'Rosa',
    'Türkis': 'Türkises', 'Gold': 'Goldenes', 'Silber': 'Silbernes',
    'Weinrot': 'Weinrotes', 'Khaki': 'Khakifarbenes',
  };
  const dict = g === 'm' ? masc : g === 'f' ? fem : neu;
  return dict[color] ?? color;
}

function fallbackDescription(p: ParsedProduct, size: string, _priceEur: number, num: number): string {
  const rand = seedRandom(num);
  const lines: string[] = [];
  const colorAdj = p.color !== 'Mehrfarbig' && p.color !== 'Unifarben' && p.color !== 'Blumenmuster'
    ? colorize(p.color, p.productType) + ' ' : '';
  const article = nounGender(p.productType) === 'f' ? 'Süße ' : nounGender(p.productType) === 'm' ? 'Süßer ' : 'Süßes ';

  // ── Hook (warum verkauft) ──
  const hooks = [
    `mein absolutes Lieblingsstück, leider ist es mir zu eng geworden`,
    `hab's gekauft und gehyped, aber dann doch nie richtig getragen`,
    `passt mir leider nicht mehr - ist eigentlich noch viel zu schön zum aussortieren`,
    `mache gerade Kleiderschrank-Detox und gebe meine Schätze günstiger ab`,
    `war ein Fehlkauf - Größe stimmt nicht ganz, deshalb gebe ich's günstig weiter`,
    `hab's nur 1-2 mal getragen, einfach zu viel gekauft`,
    `Stil hat sich geändert - gebe meine alten Lieblingsstücke ab`,
    `super Teil aber leider nicht mehr meins, hat noch viel Liebe verdient`,
  ];

  // ── Outfit-Tipps abhängig von Produkttyp + Style ──
  let tipPool: string[];
  if (isPantsLike(p.productType)) {
    tipPool = isSportLike(p.productType) ? [
      'perfekt fürs Workout, Yoga oder zum Joggen - sitzt überall ohne zu drücken',
      'kombi mit Sport-BH und du bist Gym-ready, sieht aber auch zu Cropped-Hoodie casual aus',
      'super als Athleisure-Look mit Oversized-Tee und Sneakern',
    ] : [
      'kombi mit Crop Top und Sneakern für den Streetstyle-Look',
      'zu schlichten Tees oder Blusen kombinierbar - vom Office bis Wochenende',
      'mit Oversized-Pullover und Loafern sieht das nach Pinterest-Outfit aus',
      'sitzt richtig schmeichelhaft, kombi mit Heels und Body für eine elegante Vibe',
    ];
  } else if (isSkirtLike(p.productType)) {
    tipPool = [
      'kombi mit Crop Top und Sneakern für den Y2K-Look',
      'zu Strumpfhose und Stiefeln in der Übergangszeit super tragbar',
      'mit Oversized-Pulli und Boots wird das ein cleaner Pinterest-Look',
      'high heels + Body und du bist ready für jede Going-Out-Night',
    ];
  } else if (isTopLike(p.productType)) {
    tipPool = [
      'sieht zu High-Waist-Jeans und Sneakern wie aus dem TikTok-Feed aus',
      'mit Wide-Leg-Hose und Loafern hast du den Clean-Girl-Look ready',
      'kombi mit Blazer und Mom-Jeans und du gehst sofort als Office-Pinterest-Girl durch',
      'super zu Mini-Rock und Knee-High-Boots - voll der Going-Out-Vibe',
    ];
  } else if (isJacketLike(p.productType)) {
    tipPool = [
      'das perfekte Layering-Teil: über Tees, Hoodies oder Kleider',
      'kombi mit Jeans und Sneakern - mein go-to Übergangslook gewesen',
      'mit Mini-Rock und Boots wird daraus sofort ein cooler Streetstyle',
    ];
  } else if (isSetLike(p.productType)) {
    tipPool = p.productType === 'Pyjama-Set' || p.productType === 'Nachtwäsche' ? [
      'super angenehm zum Schlafen oder als Loungewear daheim',
      'sieht zu Hause cute aus, fühlt sich aber an wie nichts',
      'perfekt für entspannte Sundays oder als Geschenk',
    ] : [
      'das perfekte zusammen-Outfit, kein Stress beim Kombinieren',
      'super easy ein komplettes Set, einfach Sneaker oder Sandalen dazu und fertig',
      'super als matchy-Set oder einzeln getragen, geht beides',
    ];
  } else if (p.productType === 'Bikini' || p.productType === 'Badeanzug') {
    tipPool = [
      'getragen am Pool und Strand - super Vacay-Stück',
      'sieht zu Strohhut und Sarong nach Bali-Vibe aus',
      'unter weiten Hosen oder Strandkleid auch easy als Top tragbar',
    ];
  } else if (isDressLike(p.productType)) {
    const dressTips: Record<string, string[]> = {
      'Elegant': [
        'sieht wahnsinnig schön aus zu Heels und einer Mini-Bag, perfekt für Dates oder Hochzeiten',
        'mit Pumps und Statement-Ohrringen ein absoluter Eyecatcher',
        'kombi mit Goldschmuck und High Heels und du bist ready für jeden festlichen Anlass',
        'minimaler Schmuck, dazu schwarze Pumps und das Outfit steht',
      ],
      'Strand & Urlaub': [
        'perfekt zu Sandalen am Strand oder mit Bikini drunter',
        'in Mallorca getragen, alle Komplimente bekommen - super Vacay-Stück',
        'easy zu Sneakern für tagsüber, Sandalen abends - vielseitig im Urlaub',
        'sieht zu Strohhut und Sandalen wie aus dem Reisekatalog aus',
      ],
      'Party': [
        'mit High Heels und Statement-Schmuck ready für jede Club-Night',
        'Going-out-Vibes pur, kombi mit hohen Boots oder Pumps',
        'das perfekte Teil wenn du im Club auffallen willst, ohne overdressed zu sein',
      ],
      'Casual': [
        'easy zu Sneakers oder Boots, sieht clean und soft aus',
        'perfekt zum Layern: Cardigan drüber, weiße Sneaker und du hast den Soft-Girl-Look',
        'kombi mit Jeansjacke und Adidas Sambas und du bist Pinterest-ready',
      ],
      'Business Casual': [
        'cleaner Look fürs Office, mit Blazer und Loafers richtig elegant',
        'minimaler Office-Style mit Blazer drüber - sieht wie aus einem Mood-Board aus',
        'mit Loafern und Goldschmuck wirkt das Teil sofort nach Old-Money-Aesthetic',
      ],
      'Alltag': [
        'easy zu Sneakers für Alltag oder Heels für mehr Glow',
        'super vielseitig - dressed up oder dressed down, geht beides',
        'mein go-to-Teil gewesen, kombi-tauglich zu fast allem',
      ],
    };
    tipPool = dressTips[p.style] ?? dressTips['Alltag']!;
  } else {
    tipPool = [
      'super vielseitig kombi-tauglich',
      'lässt sich easy stylen, dressed up oder dressed down',
      'mein go-to-Teil gewesen, kombi mit fast allem aus dem Schrank',
    ];
  }

  // ── Material-Hint aus Features + Produkttyp ──
  let materialHint = '';
  if (isSportLike(p.productType)) {
    materialHint = 'atmungsaktives Stretch-Material, sitzt eng aber drückt nicht';
  } else if (p.productType === 'Jeans' || p.productType === 'Jeansshorts') {
    materialHint = 'fester Denim mit leichtem Stretch';
  } else if (isPantsLike(p.productType)) {
    materialHint = 'angenehm fließender Stoff, sitzt locker ohne zu rutschen';
  } else if (p.features.includes('Satin-Look')) {
    materialHint = 'Stoff fühlt sich seidig und glatt an, fällt richtig schön';
  } else if (p.features.includes('Spitze')) {
    materialHint = 'zarte Spitzendetails, edler Look';
  } else if (p.features.includes('Plissee')) {
    materialHint = 'plissierter Stoff der weich fällt und Bewegung hat';
  } else if (p.season === 'Sommer') {
    materialHint = 'leichter atmungsaktiver Stoff, perfekt für warme Tage';
  } else {
    materialHint = 'angenehm weicher Stoff der nicht knittert';
  }

  // ── Aufbau ──
  lines.push(`${article}${colorAdj}${p.productType}`);
  lines.push('');
  const hook = pick(rand, hooks);
  lines.push(hook.charAt(0).toUpperCase() + hook.slice(1) + '.');
  lines.push('');

  // Features-Block
  if (p.features.length > 0) {
    const featureSentence = p.features.length === 1
      ? `Das ${p.productType} hat ${p.features[0]!.toLowerCase()}, ${materialHint}.`
      : `Features: ${p.features.slice(0, 4).join(', ')}${p.features.length > 4 ? ' und mehr' : ''}. ${materialHint.charAt(0).toUpperCase() + materialHint.slice(1)}.`;
    lines.push(featureSentence);
    lines.push('');
  } else {
    lines.push(`${materialHint.charAt(0).toUpperCase() + materialHint.slice(1)}, sitzt schmeichelhaft.`);
    lines.push('');
  }

  // Outfit-Tipp
  const tip = pick(rand, tipPool);
  lines.push(`Styling: ${tip.charAt(0).toUpperCase() + tip.slice(1)}.`);
  lines.push('');

  // Specs-Block (kein Emoji)
  lines.push(`Größe: ${size} (auch passend für ${alternativeSize(size)})`);
  lines.push(`Aus tierfreiem Nichtraucherhaushalt`);
  lines.push(`Versand am nächsten Werktag`);
  lines.push(`Bündelrabatt - schaue gerne in mein Profil`);
  lines.push('');

  // Hashtags (Discoverability) — Produkttyp-spezifisch
  const tags = new Set<string>();
  // Produkttyp-Tag (normalisiert)
  const typeTag = p.productType.toLowerCase()
    .replace(/[ä]/g, 'ae').replace(/[ö]/g, 'oe').replace(/[ü]/g, 'ue').replace(/[ß]/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
  tags.add(`#${typeTag}`);

  // Pants/Sport Tags
  if (isPantsLike(p.productType)) {
    if (isSportLike(p.productType)) {
      tags.add('#sportwear'); tags.add('#yoga'); tags.add('#fitness'); tags.add('#athleisure');
    } else if (p.productType === 'Skort') {
      tags.add('#skort'); tags.add('#tennisrock'); tags.add('#preppy');
    } else if (p.productType === 'Jeans' || p.productType === 'Jeansshorts') {
      tags.add('#jeans'); tags.add('#denim'); tags.add('#streetstyle');
    } else if (p.productType === 'Wide-Leg-Hose') {
      tags.add('#widelegpants'); tags.add('#widelegjeans'); tags.add('#oldmoney');
    } else {
      tags.add('#hose'); tags.add('#streetstyle');
    }
  }
  if (isTopLike(p.productType)) {
    tags.add('#top'); tags.add('#streetwear'); tags.add('#cleangirl');
  }
  if (isJacketLike(p.productType)) {
    tags.add('#jacke'); tags.add('#layering'); tags.add('#uebergangsjacke');
  }
  if (isSetLike(p.productType)) {
    if (p.productType === 'Pyjama-Set' || p.productType === 'Nachtwäsche') {
      tags.add('#pyjama'); tags.add('#loungewear'); tags.add('#homewear'); tags.add('#schlafanzug');
    } else {
      tags.add('#set'); tags.add('#twopiece'); tags.add('#matchingset');
    }
  }
  if (p.productType === 'Bikini' || p.productType === 'Badeanzug') {
    tags.add('#bikini'); tags.add('#bademode'); tags.add('#strand'); tags.add('#mallorca');
  }
  if (isDressLike(p.productType)) tags.add('#kleid');

  // Farbe
  if (p.color !== 'Mehrfarbig' && p.color !== 'Unifarben' && p.color !== 'Blumenmuster') {
    tags.add(`#${p.color.toLowerCase().replace('ß', 'ss')}`);
  }
  // Saison
  if (p.season === 'Sommer') { tags.add('#sommer'); tags.add('#vacay'); }
  // Style
  if (p.style === 'Elegant') { tags.add('#elegant'); tags.add('#cocktail'); tags.add('#hochzeit'); }
  if (p.style === 'Strand & Urlaub') { tags.add('#strand'); tags.add('#urlaub'); tags.add('#mallorca'); }
  if (p.style === 'Party') { tags.add('#goingout'); tags.add('#party'); }
  if (p.style === 'Business Casual') { tags.add('#office'); tags.add('#oldmoney'); }
  // Features
  if (p.features.includes('Spitze')) tags.add('#spitze');
  if (p.features.includes('Blumenmuster')) { tags.add('#floral'); tags.add('#cottagecore'); }
  if (p.features.includes('Figurbetont')) tags.add('#bodycon');
  if (p.features.includes('Schulterfrei')) tags.add('#offshoulder');
  if (p.features.includes('Rückenfrei')) tags.add('#backless');
  // Trend-Basics
  tags.add('#y2k');
  tags.add('#zara');
  tags.add('#mango');
  tags.add('#vinted');
  tags.add('#pinterest');
  lines.push(Array.from(tags).slice(0, 14).join(' '));

  return lines.join('\n');
}

function alternativeSize(size: string): string {
  const map: Record<string, string> = {
    'XXS': 'XS', 'XS': 'S', 'S': 'XS-M', 'M': 'S-L', 'L': 'M-XL', 'XL': 'L-XXL',
  };
  return map[size] ?? size;
}

// ── Main ──────────────────────────────────────────────────────────────────

interface FolderInfo {
  num: number;
  name: string;
  parsed: ParsedProduct | null;
  size: string;
  price: number;
  category: string;
  temuUrl: string | null;
}

async function readTemuLinks(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const text = await fs.readFile(TEMU_LINKS, 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^(\d+)\.\s+(https?:\/\/[^\s]+)/);
      if (m && m[1] && m[2]) out.set(Number(m[1]), m[2]);
    }
  } catch (err) { console.warn('Temu-Links not readable:', String(err)); }
  return out;
}

function extractSlug(url: string): string {
  const m = url.match(/temu\.com\/(?:[a-z]{2}\/)?([^?]+)/i);
  return m && m[1] ? m[1] : '';
}

async function readListingJson(folderPath: string): Promise<{ size?: string; price_eur?: number; category?: string } | null> {
  try {
    const raw = await fs.readFile(path.join(folderPath, 'listing.json'), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

function categoryFor(productType: string): string {
  const map: Record<string, string> = {
    // Kleider
    'Minikleid':         'Damen > Kleider > Minikleider',
    'Midikleid':         'Damen > Kleider > Midikleider',
    'Maxikleid':         'Damen > Kleider > Maxikleider',
    'Sommerkleid':       'Damen > Kleider > Sommerkleider',
    'Cocktailkleid':     'Damen > Kleider > Cocktailkleider',
    'Abendkleid':        'Damen > Kleider > Abendkleider',
    'Alltagskleid':      'Damen > Kleider > Alltagskleider',
    'Strandkleid':       'Damen > Kleider > Sommerkleider',
    'Trägerkleid':       'Damen > Kleider > Sommerkleider',
    'Wickelkleid':       'Damen > Kleider > Alltagskleider',
    'A-Linien-Kleid':    'Damen > Kleider > Alltagskleider',
    'Vintage-Kleid':     'Damen > Kleider > Alltagskleider',
    'Hemdblusenkleid':   'Damen > Kleider > Alltagskleider',
    'Kleid':             'Damen > Kleider > Alltagskleider',

    // Oberteile
    'T-Shirt':           'Damen > Oberteile > T-Shirts',
    'Crop Top':          'Damen > Oberteile > Crop Tops',
    'Cami-Top':          'Damen > Oberteile > Crop Tops',
    'Bandeau-Top':       'Damen > Oberteile > Crop Tops',
    'Tanktop':           'Damen > Oberteile > T-Shirts',
    'Top':               'Damen > Oberteile > T-Shirts',
    'Bluse':             'Damen > Oberteile > Blusen',
    'Hemd':              'Damen > Oberteile > Blusen',
    'Longsleeve':        'Damen > Oberteile > T-Shirts',
    'Sweatshirt':        'Damen > Oberteile > Sweatshirts',
    'Hoodie':            'Damen > Oberteile > Kapuzenpullover',
    'Pullover':          'Damen > Oberteile > Sweatshirts',

    // Hosen
    'Jeans':             'Damen > Hosen > Jeans',
    'Jeansshorts':       'Damen > Hosen > Jeans',
    'Shorts':            'Damen > Sportkleidung > Shorts',
    'Cargohose':         'Damen > Hosen > Jogginghosen',
    'Jogginghose':       'Damen > Hosen > Jogginghosen',
    'Leggings':          'Damen > Hosen > Leggings',
    'Wide-Leg-Hose':     'Damen > Hosen > Jogginghosen',
    'Strandhose':        'Damen > Hosen > Jogginghosen',
    'Hose':              'Damen > Hosen > Jogginghosen',

    // Röcke
    'Minirock':          'Damen > Röcke > Miniröcke',
    'Midirock':          'Damen > Röcke > Midiröcke',
    'Maxirock':          'Damen > Röcke > Midiröcke',
    'Skort':             'Damen > Röcke > Miniröcke',
    'Rock':              'Damen > Röcke > Miniröcke',

    // Sport
    'Sport-Top':         'Damen > Sportkleidung > Tops',
    'Sport-Leggings':    'Damen > Sportkleidung > Leggings',
    'Sport-Shorts':      'Damen > Sportkleidung > Shorts',
    'Sporthose':         'Damen > Sportkleidung > Leggings',
    'Sportjacke':        'Damen > Jacken & Mäntel > Übergangsjacken',

    // Sets / Jumpsuits / Bademode / Pyjama
    'Set':               'Damen > Kleider > Alltagskleider',
    '2-Teiler Set':      'Damen > Kleider > Alltagskleider',
    '3-Teiler Set':      'Damen > Kleider > Alltagskleider',
    'Jumpsuit':          'Damen > Kleider > Alltagskleider',
    'Pyjama-Set':        'Damen > Kleider > Alltagskleider',
    'Nachtwäsche':       'Damen > Kleider > Alltagskleider',
    'Bikini':            'Damen > Bademode > Bikinis',
    'Badeanzug':         'Damen > Bademode > Badeanzüge',

    // Jacken
    'Jacke':             'Damen > Jacken & Mäntel > Übergangsjacken',
    'Mantel':            'Damen > Jacken & Mäntel > Übergangsjacken',

    'Tuch':              'Damen > Kleidung',
    'Kleidungsstück':    'Damen > Kleidung',
  };
  return map[productType] ?? 'Damen > Kleidung';
}

// Welche Outfit-Tipps passen zu welchem Produkt-Typ
function isPantsLike(t: string): boolean {
  // Skort ist hybrid Rock/Hose — wir behandeln als Rock (siehe Outfit-Tipps)
  return /^(Hose|Jeans|Jeansshorts|Shorts|Leggings|Cargohose|Jogginghose|Wide-Leg-Hose|Strandhose|Sport-Leggings|Sport-Shorts|Sporthose)$/i.test(t);
}
function isSkirtLike(t: string): boolean {
  return /^(Rock|Minirock|Midirock|Maxirock|Skort)$/i.test(t);
}
function isTopLike(t: string): boolean {
  return /Top|Bluse|Hemd|Shirt|Tanktop|Bandeau|Cami|Crop|Sweatshirt|Hoodie|Pullover|Longsleeve/i.test(t);
}
function isDressLike(t: string): boolean {
  return /kleid/i.test(t);
}
function isSetLike(t: string): boolean {
  return /Set|Pyjama|Jumpsuit|Nachtwäsche/i.test(t);
}
function isSportLike(t: string): boolean {
  return /Sport|Yoga|Fitness/i.test(t);
}
function isJacketLike(t: string): boolean {
  return /Jacke|Mantel/i.test(t);
}

async function processBatch<T, R>(
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const useApi = !!ANTHROPIC_API_KEY;
  console.log(useApi ? '🤖 Using Claude API for individual listings' : '⚙️  No ANTHROPIC_API_KEY — using template fallback');

  const links = await readTemuLinks();
  console.log(`📎 Loaded ${links.size} Temu-Links`);

  const entries = (await fs.readdir(VINTED_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^Neuer Ordner/.test(e.name));

  const folders: FolderInfo[] = [];
  for (const entry of entries) {
    const num = entry.name === 'Neuer Ordner' ? 1 : Number(entry.name.match(/(\d+)$/)?.[1] ?? -1);
    if (num < 1) continue;
    const folderPath = path.join(VINTED_ROOT, entry.name);
    const url = links.get(num) ?? null;
    const existing = await readListingJson(folderPath);
    const parsed = url ? parseProduct(extractSlug(url)) : null;

    folders.push({
      num,
      name: entry.name,
      parsed,
      size: existing?.size ?? 'S',
      price: existing?.price_eur && existing.price_eur >= MIN_PRICE_EUR ? existing.price_eur : 24.99,
      category: parsed ? categoryFor(parsed.productType) : (existing?.category ?? 'Damen > Kleider > Alltagskleider'),
      temuUrl: url,
    });
  }
  folders.sort((a, b) => a.num - b.num);

  console.log(`📂 ${folders.length} folders, ${folders.filter((f) => f.parsed).length} mit Temu-Slug`);
  console.log(`🚀 Generating listings (${useApi ? 'Claude' : 'Templates'})…`);

  const t0 = Date.now();
  const results = await processBatch(folders, async (f, i) => {
    const tag = `[${i + 1}/${folders.length}] #${f.num}`;
    const rand = seedRandom(f.num);
    if (!f.parsed) {
      // Generisch aber trotzdem mit Verkaufs-Vibe
      const generic = parseProduct('kleid');
      return {
        ...f,
        title: fallbackTitle(generic, f.size, rand),
        description: fallbackDescription(generic, f.size, f.price, f.num),
      };
    }
    if (useApi) {
      const llm = await callClaude(f.parsed, f.size, f.price);
      if (llm) {
        process.stdout.write(`  ✓ ${tag}\n`);
        return { ...f, title: llm.title, description: llm.description };
      }
      process.stdout.write(`  ⚙ ${tag} (fallback)\n`);
    }
    return {
      ...f,
      title: fallbackTitle(f.parsed, f.size, rand),
      description: fallbackDescription(f.parsed, f.size, f.price, f.num),
    };
  }, useApi ? CONCURRENCY : 1);

  const seconds = Math.round((Date.now() - t0) / 1000);
  console.log(`✓ Generated in ${seconds}s`);

  // Markdown
  const md: string[] = [];
  md.push('# Vinted-Listings');
  md.push('');
  md.push(`Generiert ${new Date().toLocaleString('de-DE')} · ${results.length} Ordner`);
  md.push(useApi ? '🤖 Claude individuell pro Kleid' : '⚙️ Template-basiert (keine ANTHROPIC_API_KEY)');
  md.push('');
  md.push('---');
  md.push('');

  for (const f of results) {
    md.push(`## #${f.num} — ${f.name}`);
    md.push('');
    md.push(`\`${f.category}\` · Größe **${f.size}** · **€${f.price.toFixed(2)}**`);
    md.push('');
    md.push('**Titel:**');
    md.push('```');
    md.push(f.title);
    md.push('```');
    md.push('');
    md.push('**Beschreibung:**');
    md.push('```');
    md.push(f.description);
    md.push('```');
    if (f.temuUrl) {
      md.push('');
      md.push(`<sub>[Temu](${f.temuUrl.split('?')[0]})</sub>`);
    }
    md.push('');
    md.push('---');
    md.push('');
  }

  await fs.writeFile(OUT, md.join('\n'));
  console.log(`📄 ${results.length} Listings → ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
