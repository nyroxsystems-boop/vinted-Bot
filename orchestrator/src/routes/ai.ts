// ──────────────────────────────────────────────────────────────────────────────
// AI Routes — Crosslisting Intelligence Endpoints
//
// Provides AI-powered features for the multi-marketplace system:
//   POST /api/ai/generate-description   → AI description for a specific marketplace
//   POST /api/ai/crosslist              → Generate listings for ALL marketplaces
//   POST /api/ai/analyze-image          → Vision AI: photo → listing data (JSON)
//   POST /api/ai/optimize-title         → SEO-optimize title for a marketplace
//   GET  /api/ai/templates              → List all supported marketplace templates
//   GET  /api/ai/templates/:mp          → Preview template for a marketplace
//
// Prompt engineering inspired by Liberty-Emporium/list-it-everywhere,
// ported to our TypeScript stack with Anthropic Claude as primary LLM.
// ──────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger, getDb, vintedRoot } from '@vinted-system/shared';
import {
  generateCrosslisting,
  generateAllCrosslistings,
  supportedMarketplaces,
  type CrosslistingInput,
} from '../crosslisting-templates.js';

const log = createLogger('ai-routes');

export const aiRouter = Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const VINTED_ROOT = vintedRoot();

// ── Helper: Call Anthropic Claude ────────────────────────────────────────────

async function callClaude(opts: {
  messages: Array<{ role: string; content: unknown }>;
  maxTokens?: number;
}): Promise<{ text: string; model: string } | { error: string }> {
  if (!ANTHROPIC_API_KEY) {
    return { error: 'ANTHROPIC_API_KEY not configured' };
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens ?? 1024,
        messages: opts.messages,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return { error: `Claude API ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find((c) => c.type === 'text');
    return { text: textBlock?.text?.trim() ?? '', model: ANTHROPIC_MODEL };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function parseJsonFromLlm(raw: string): unknown | null {
  // Strip markdown fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first {…} block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fallthrough */ }
    }
    return null;
  }
}

// ── POST /api/ai/generate-description ────────────────────────────────────────

aiRouter.post('/generate-description', async (req, res) => {
  try {
    const body = req.body as {
      title: string;
      marketplace: string;
      brand?: string;
      category?: string;
      size?: string;
      condition?: string;
      colors?: string[];
      material?: string;
      price_eur?: number;
    };

    if (!body.title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const mp = body.marketplace || 'vinted';
    const systemPrompt = `You are an expert reseller copywriter who knows ${mp} inside out.
You write authentic, compelling listing descriptions that SELL.
Write in the language and tone appropriate for ${mp}:
- Vinted/Kleinanzeigen: German, casual, personal, like a real young woman selling clothes
- eBay DE: German, semi-formal, structured
- eBay UK/Depop/Mercari/Grailed/Etsy: English, platform-appropriate tone
- Wallapop: Spanish, casual
- Facebook Marketplace: German, direct

Return ONLY valid JSON with these exact fields:
{"title":"SEO-optimized title under 80 chars","description":"2-3 paragraphs, highlight condition and appeal","tags":"comma-separated search keywords"}`;

    const prompt = `Item: ${body.title}
Category: ${body.category || 'Fashion'}
Brand: ${body.brand || 'Unknown'}
Condition: ${body.condition || 'Good'}
Size: ${body.size || 'N/A'}
Color: ${(body.colors || []).join(', ') || 'N/A'}
Material: ${body.material || 'N/A'}
Price: €${body.price_eur || 'TBD'}
Target marketplace: ${mp}

Write a reseller listing optimized for ${mp}:`;

    const result = await callClaude({
      messages: [
        { role: 'user', content: `${systemPrompt}\n\n${prompt}` },
      ],
      maxTokens: 1500,
    });

    if ('error' in result) {
      return res.status(503).json({ error: result.error });
    }

    const parsed = parseJsonFromLlm(result.text);
    if (!parsed) {
      return res.status(500).json({ error: 'AI returned invalid format', raw: result.text.slice(0, 300) });
    }

    res.json({ ok: true, data: parsed, model: result.model, marketplace: mp });
  } catch (e) {
    log.error('generate-description failed', { err: String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/ai/crosslist ───────────────────────────────────────────────────

aiRouter.post('/crosslist', (req, res) => {
  try {
    const body = req.body as CrosslistingInput & {
      marketplaces?: string[];
    };

    if (!body.title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const input: CrosslistingInput = {
      title: body.title,
      description: body.description || '',
      brand: body.brand || 'Ohne Marke',
      category: body.category || '',
      size: body.size || '',
      condition: body.condition || 'Sehr gut',
      colors: body.colors || [],
      material: body.material || '',
      price_eur: body.price_eur || 0,
      shipping: body.shipping || 'Klein',
      tags: body.tags,
      sku: body.sku,
    };

    let results: Record<string, unknown>;

    if (body.marketplaces && body.marketplaces.length > 0) {
      // Generate for specific marketplaces
      results = {};
      for (const mp of body.marketplaces) {
        results[mp] = generateCrosslisting(mp, input);
      }
    } else {
      // Generate for ALL marketplaces
      results = generateAllCrosslistings(input);
    }

    res.json({
      ok: true,
      source: input,
      crosslistings: results,
      count: Object.keys(results).length,
    });
  } catch (e) {
    log.error('crosslist failed', { err: String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/ai/crosslist/:folderNum ────────────────────────────────────────

aiRouter.post('/crosslist/:folderNum', (req, res) => {
  try {
    const folderNum = parseInt(req.params.folderNum, 10);
    if (isNaN(folderNum)) return res.status(400).json({ error: 'invalid folderNum' });

    const folderName = folderNum === 1 ? 'Neuer Ordner' : `Neuer Ordner ${folderNum}`;
    const listingPath = path.join(VINTED_ROOT, folderName, 'listing.json');

    if (!fs.existsSync(listingPath)) {
      return res.status(404).json({ error: 'listing.json not found' });
    }

    const listing = JSON.parse(fs.readFileSync(listingPath, 'utf-8'));

    const input: CrosslistingInput = {
      title: listing.title || '',
      description: listing.description || '',
      brand: listing.brand || 'Ohne Marke',
      category: listing.category || '',
      size: listing.size || '',
      condition: listing.condition || 'Sehr gut',
      colors: listing.colors || [],
      material: listing.material || '',
      price_eur: listing.price_eur || 0,
      shipping: listing.shipping || 'Klein',
    };

    const body = req.body as { marketplaces?: string[] };
    let results: Record<string, unknown>;

    if (body.marketplaces && body.marketplaces.length > 0) {
      results = {};
      for (const mp of body.marketplaces) {
        results[mp] = generateCrosslisting(mp, input);
      }
    } else {
      results = generateAllCrosslistings(input);
    }

    res.json({
      ok: true,
      folderNum,
      source: input,
      crosslistings: results,
      count: Object.keys(results).length,
    });
  } catch (e) {
    log.error('crosslist folder failed', { err: String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/ai/analyze-image ───────────────────────────────────────────────

aiRouter.post('/analyze-image', async (req, res) => {
  try {
    const body = req.body as { image?: string; imagePath?: string };

    let imageData: string | null = null;
    let mediaType = 'image/jpeg';

    if (body.image) {
      // Base64 image from request body
      imageData = body.image.includes(',') ? (body.image.split(',')[1] ?? body.image) : body.image;
    } else if (body.imagePath && fs.existsSync(body.imagePath)) {
      // Read from filesystem
      const buf = fs.readFileSync(body.imagePath);
      if (buf.byteLength > 4_500_000) {
        return res.status(400).json({ error: 'Image too large (max 4.5MB)' });
      }
      imageData = buf.toString('base64');
      const ext = path.extname(body.imagePath).toLowerCase();
      mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    }

    if (!imageData) {
      return res.status(400).json({ error: 'No image provided. Send base64 in "image" or filesystem path in "imagePath".' });
    }

    const systemPrompt = `You are an expert reseller who can identify items from photos.
Analyze this image and return ONLY valid JSON with these fields:
{
  "title": "concise product title under 80 chars for reselling",
  "brand": "brand name or empty string if unknown",
  "category": "one of: Clothing, Shoes, Electronics, Jewelry, Home & Garden, Toys, Books, Sports, Collectibles, Other",
  "condition": "one of: Neu mit Etikett, Neu, Sehr gut, Gut, Befriedigend",
  "color": "primary color(s) in German",
  "size": "size if visible, or empty string",
  "material": "material if identifiable, or empty string",
  "description": "2 paragraph reseller description in German, highlighting key features",
  "tags": "comma-separated search keywords",
  "estimated_price_eur": suggested selling price as a number e.g. 24.99,
  "details": "any other notable details: size markings, model numbers, materials"
}
Return ONLY the JSON object, nothing else.`;

    const result = await callClaude({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageData,
            },
          },
        ],
      }],
      maxTokens: 1000,
    });

    if ('error' in result) {
      return res.status(503).json({ error: result.error });
    }

    const parsed = parseJsonFromLlm(result.text);
    if (!parsed) {
      return res.status(500).json({ error: 'Could not parse AI response', raw: result.text.slice(0, 300) });
    }

    res.json({ ok: true, data: parsed, model: result.model });
  } catch (e) {
    log.error('analyze-image failed', { err: String(e) });
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /api/ai/optimize-title ──────────────────────────────────────────────

aiRouter.post('/optimize-title', async (req, res) => {
  try {
    const body = req.body as { title: string; marketplace?: string };
    if (!body.title) return res.status(400).json({ error: 'title required' });

    const mp = body.marketplace || 'vinted';
    const prompt = `Optimize this product title for ${mp} SEO. Make it under 80 characters, keyword-rich, and compelling.

Current title: "${body.title}"

Return ONLY valid JSON: {"title":"optimized title","keywords":["keyword1","keyword2"]}`;

    const result = await callClaude({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
    });

    if ('error' in result) {
      return res.status(503).json({ error: result.error });
    }

    const parsed = parseJsonFromLlm(result.text);
    res.json({ ok: true, data: parsed ?? { title: body.title }, model: result.model });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── GET /api/ai/templates ────────────────────────────────────────────────────

aiRouter.get('/templates', (_req, res) => {
  const mps = supportedMarketplaces();
  res.json({
    count: mps.length,
    marketplaces: mps,
    description: 'Supported marketplace template IDs for crosslisting',
  });
});

// ── GET /api/ai/templates/:mp — Preview template with sample data ────────────

aiRouter.get('/templates/:mp', (req, res) => {
  const mp = req.params.mp;
  const sample: CrosslistingInput = {
    title: 'Schwarzes Minikleid mit Spitze Größe S',
    description: 'Wunderschönes schwarzes Minikleid mit Spitzen-Details. Nur einmal getragen, Zustand wie neu. Perfekt für Abende aus oder besondere Anlässe.',
    brand: 'Zara',
    category: 'Damen > Kleider > Minikleider',
    size: 'S',
    condition: 'Sehr gut',
    colors: ['Schwarz'],
    material: 'Polyester',
    price_eur: 29.99,
    shipping: 'Klein',
    tags: 'minikleid, schwarz, spitze, zara, abendkleid, party',
  };

  const result = generateCrosslisting(mp, sample);
  res.json({ marketplace: mp, sample_input: sample, output: result });
});
