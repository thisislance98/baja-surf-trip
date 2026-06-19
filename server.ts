import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { spawn, ChildProcess } from 'child_process';
import { Pool } from 'pg';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5174', 10);
const MODEL = 'claude-opus-4-8';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// Local dev: use cached npx path. Railway: playwright-mcp is on PATH after postinstall.
const PLAYWRIGHT_MCP_BIN = process.env.PLAYWRIGHT_MCP_BIN
  || '/Users/I850333/.npm/_npx/9833c18b2d85bc59/node_modules/.bin/playwright-mcp';

// ────────────────────────────────────────────────────────────
// Playwright MCP client — stdio transport, persistent session
// ────────────────────────────────────────────────────────────
class PlaywrightMCP {
  private proc: ChildProcess | null = null;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private nextId = 1;
  private initialized = false;
  private buffer = '';

  start() {
    this.proc = spawn('node', [PLAYWRIGHT_MCP_BIN, '--isolated', '--headless'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      // JSON-RPC messages are newline-delimited
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch {}
      }
    });
    this.proc.stderr!.on('data', () => {}); // suppress stderr noise
    this.proc.on('exit', () => {
      this.proc = null;
      this.initialized = false;
    });
  }

  private send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc) throw new Error('Playwright MCP not running');
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin!.write(msg);
      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Playwright MCP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async ensureReady() {
    if (!this.proc) this.start();
    if (!this.initialized) {
      await this.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mexico-trip', version: '1' },
      });
      await this.send('notifications/initialized', {}).catch(() => {}); // fire-and-forget
      this.initialized = true;
    }
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
    await this.ensureReady();
    const result = await this.send('tools/call', { name, arguments: args });
    // Extract text content from MCP response
    const content = result?.content || [];
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n') || JSON.stringify(result);
  }

  async navigate(url: string): Promise<string> {
    return this.callTool('browser_navigate', { url });
  }

  async snapshot(): Promise<string> {
    return this.callTool('browser_snapshot', {});
  }

  async click(element: string, ref: string): Promise<string> {
    return this.callTool('browser_click', { element, ref });
  }

  async screenshot(): Promise<string> {
    return this.callTool('browser_take_screenshot', {});
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
    this.initialized = false;
  }
}

const playwright = new PlaywrightMCP();

function apiKey(): string {
  // Prefer the shell environment over .env so we use the key that works
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return key;
}

function anthropicHeaders() {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey(),
    'anthropic-version': '2023-06-01',
  };
}

async function claudeCall(body: Record<string, any>): Promise<any> {
  const r = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: anthropicHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Claude API ${r.status}: ${err}`);
  }
  return r.json();
}

async function claudeText(body: Record<string, any>): Promise<string> {
  const data = await claudeCall(body);
  return (data.content as any[]).find((b: any) => b.type === 'text')?.text || '';
}

function parseJson(text: string | undefined, fallback: any): any {
  if (!text) return fallback;
  const cleaned = text.trim();
  try { return JSON.parse(cleaned); } catch {}
  try {
    const m = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (m) return JSON.parse(m[1]);
  } catch {}
  return fallback;
}

async function fetchPageText(url: string): Promise<{ text: string; title: string; url: string }> {
  if (!url.startsWith('http')) url = 'https://' + url;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const $ = cheerio.load(html);
  $('script,style,nav,footer,iframe,noscript').remove();
  const title = $('title').text().trim() || url;
  const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000);
  return { text, title, url };
}

// ────────────────────────────────────────────────────────────
// Postgres — itinerary persistence
// ────────────────────────────────────────────────────────────
interface ItineraryItem {
  id: string;
  date: string;
  time: string;
  title: string;
  notes: string;
  location: string;
  category: 'surf' | 'food' | 'fun' | 'ride';
}

const SEED_ITEMS: ItineraryItem[] = [
  { id: 'a1', date: '2026-06-19', time: '3:20 PM', title: 'Land at SJD · Pick up rental car', notes: 'Fill gas, grab pesos at ATM. Turn LEFT out of airport for toll road (~$10 cash).', location: 'Los Cabos International Airport', category: 'ride' },
  { id: 'a2', date: '2026-06-19', time: '7:30 PM', title: 'Dinner — Barracuda Cantina or Shaka\'s', notes: 'Fish tacos, settle in. Early night — surf lesson tomorrow morning.', location: 'Cerritos Beach', category: 'food' },
  { id: 'a3', date: '2026-06-20', time: '8:30 AM', title: 'Surf Lesson — Cerritos Surf Academy', notes: 'Glassy morning conditions. 2-hour group lesson, boards + rashguards included.', location: 'Cerritos Beach', category: 'surf' },
  { id: 'a4', date: '2026-06-21', time: '9:30 AM', title: 'El Arco + Snorkel Boat', notes: 'Roger\'s Glass Bottom Boat from marina. Sea lions, Lover\'s Beach, Pelican Rock. Bring $1 for marina gate.', location: 'Cabo San Lucas Marina', category: 'fun' },
  { id: 'a5', date: '2026-06-22', time: '9:00 AM', title: 'Wild Canyon Adventures — Zip + UTV', notes: 'Book ahead. Closed shoes. 8-line 4.5 km zipline + Can-Am UTVs.', location: 'Tourist Corridor, Cabo', category: 'fun' },
  { id: 'a6', date: '2026-06-23', time: '10:00 AM', title: 'Todos Santos Town Day', notes: 'Hotel California margarita + photo, galleries, mission, boutiques.', location: 'Todos Santos', category: 'fun' },
  { id: 'a7', date: '2026-06-24', time: '11:00 AM', title: 'Leave for SJD · Flight 3:00 PM', notes: '~1h15 drive + rental return + 2hr international check-in. Depart Cerritos by 11 AM.', location: 'SJD → Home', category: 'ride' },
];

// Pool is null when DATABASE_URL isn't set (local dev without Postgres — falls back to in-memory)
let pool: Pool | null = null;
let memItinerary: ItineraryItem[] = [...SEED_ITEMS];

function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log('No DATABASE_URL — using in-memory itinerary (changes lost on restart)');
    return;
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log('Postgres connected');
}

async function dbSetup() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS itinerary (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'fun',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Seed only if empty
  const { rowCount } = await pool.query('SELECT 1 FROM itinerary LIMIT 1');
  if (!rowCount) {
    for (const item of SEED_ITEMS) {
      await pool.query(
        'INSERT INTO itinerary(id,date,time,title,notes,location,category) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [item.id, item.date, item.time, item.title, item.notes, item.location, item.category]
      );
    }
    console.log('Itinerary seeded with default trip');
  }
}

async function dbGetItinerary(dateFilter?: string): Promise<ItineraryItem[]> {
  if (!pool) {
    return dateFilter ? memItinerary.filter(i => i.date === dateFilter) : [...memItinerary];
  }
  const q = dateFilter
    ? 'SELECT * FROM itinerary WHERE date=$1 ORDER BY date,time'
    : 'SELECT * FROM itinerary ORDER BY date,time';
  const { rows } = await pool.query(q, dateFilter ? [dateFilter] : []);
  return rows as ItineraryItem[];
}

async function dbAddItem(item: ItineraryItem): Promise<void> {
  if (!pool) { memItinerary.push(item); return; }
  await pool.query(
    'INSERT INTO itinerary(id,date,time,title,notes,location,category) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [item.id, item.date, item.time, item.title, item.notes, item.location, item.category]
  );
}

async function dbUpdateItem(id: string, fields: Partial<ItineraryItem>): Promise<ItineraryItem | null> {
  if (!pool) {
    const idx = memItinerary.findIndex(i => i.id === id);
    if (idx === -1) return null;
    Object.assign(memItinerary[idx], fields);
    return memItinerary[idx];
  }
  const keys = ['time', 'title', 'notes', 'location', 'category'].filter(k => fields[k as keyof typeof fields] !== undefined);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  const vals = keys.map(k => fields[k as keyof typeof fields]);
  const { rows } = await pool.query(`UPDATE itinerary SET ${sets} WHERE id=$1 RETURNING *`, [id, ...vals]);
  return rows[0] || null;
}

async function dbDeleteItem(id: string): Promise<boolean> {
  if (!pool) {
    const before = memItinerary.length;
    memItinerary = memItinerary.filter(i => i.id !== id);
    return memItinerary.length < before;
  }
  const { rowCount } = await pool.query('DELETE FROM itinerary WHERE id=$1', [id]);
  return (rowCount ?? 0) > 0;
}

let mapPins: any[] = [
  { id: 'surf-cerritos', title: 'Cerritos Beach', lat: 23.3197, lng: -110.1772, category: 'surf', description: 'World-class beginner beach break. Sandy bottom, lifeguards.', difficulty: 'Beginner', priceRange: 'Free', rating: 4.9 },
  { id: 'surf-academy', title: 'Cerritos Surf Academy', lat: 23.3200, lng: -110.1770, category: 'surf', description: 'Pablo & Holly\'s school. Highest rated on the beach. ~$95–100pp.', difficulty: 'All levels', priceRange: '$$', rating: 5.0 },
  { id: 'dining-barracuda', title: 'Barracuda Cantina', lat: 23.3204, lng: -110.1715, category: 'dining', description: 'Netflix-featured fish tacos on the sand. Closed Wed.', difficulty: 'N/A', priceRange: '$$', rating: 4.7 },
  { id: 'dining-hierbabuena', title: 'Hierbabuena', lat: 23.3050, lng: -110.1600, category: 'dining', description: 'Farm-to-table, wood-fired pizza, organic garden. Closed Tue.', difficulty: 'N/A', priceRange: '$$', rating: 4.7 },
  { id: 'tourist-arch', title: 'El Arco', lat: 22.8758, lng: -109.8944, category: 'tourist', description: 'Iconic arch — Pacific meets Gulf. Water-taxi access.', difficulty: 'N/A', priceRange: '$$', rating: 4.9 },
  { id: 'tourist-wildcanyon', title: 'Wild Canyon Adventures', lat: 22.9500, lng: -109.9200, category: 'tourist', description: '8-line zipline (47 mph) + Can-Am UTV canyon tours.', difficulty: 'N/A', priceRange: '$$$', rating: 4.7 },
  { id: 'dining-gardenias', title: 'Tacos Gardenias', lat: 22.8839, lng: -109.9126, category: 'dining', description: '30-year Cabo marina staple. Shrimp & fish tacos ~70 pesos.', difficulty: 'N/A', priceRange: '$', rating: 4.6 },
  { id: 'tourist-hotelcal', title: 'Hotel California', lat: 23.4503, lng: -110.2286, category: 'tourist', description: 'The famous Todos Santos landmark. Best margarita in town.', difficulty: 'N/A', priceRange: '$$', rating: 4.5 },
  { id: 'hotel-cerritos', title: 'Cerritos Beach Hotel', lat: 23.3218, lng: -110.1768, category: 'tourist', description: 'Home base for the trip. Beachfront hotel steps from the surf break. Pool, restaurant on site.', difficulty: 'N/A', priceRange: '$$$', rating: 4.6 },
];

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const TOOLS: any[] = [
  {
    name: 'read_itinerary',
    description: 'Read the current trip itinerary. Always do this before adding or modifying items to avoid duplicates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_filter: { type: 'string', description: 'Optional: filter by date YYYY-MM-DD' },
      },
      required: [],
    },
  },
  {
    name: 'add_itinerary_item',
    description: 'Add a new activity to the shared trip schedule.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Date YYYY-MM-DD, e.g. 2026-06-20' },
        time: { type: 'string', description: 'Time string e.g. "9:00 AM"' },
        title: { type: 'string', description: 'Activity title' },
        notes: { type: 'string', description: 'Description or planning notes' },
        location: { type: 'string', description: 'Location name' },
        category: { type: 'string', description: 'One of: surf, food, fun, ride' },
      },
      required: ['date', 'time', 'title', 'notes', 'location', 'category'],
    },
  },
  {
    name: 'update_itinerary_item',
    description: 'Update an existing itinerary item by ID. Call read_itinerary first to get IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The item ID to update' },
        time: { type: 'string', description: 'New time (optional)' },
        title: { type: 'string', description: 'New title (optional)' },
        notes: { type: 'string', description: 'New notes (optional)' },
        location: { type: 'string', description: 'New location (optional)' },
        category: { type: 'string', description: 'New category (optional)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_itinerary_item',
    description: 'Delete an itinerary item by ID. Call read_itinerary first to get IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The item ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_map_pins',
    description: 'Get all map pins for surf spots, restaurants, and attractions in the Baja area.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Filter: surf, dining, tourist, or all' },
      },
      required: [],
    },
  },
  {
    name: 'add_map_pin',
    description: 'Add a custom pin to the interactive Google Map. Use when user mentions a place they want to track.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Name of the place' },
        lat: { type: 'number', description: 'Latitude (Baja range: 22.8–23.5)' },
        lng: { type: 'number', description: 'Longitude (Baja range: -109.6 to -110.3)' },
        category: { type: 'string', description: 'surf, dining, or tourist' },
        description: { type: 'string', description: 'Brief description' },
        rating: { type: 'number', description: 'Rating 1-5 (optional)' },
      },
      required: ['title', 'lat', 'lng', 'category', 'description'],
    },
  },
  {
    name: 'navigate_map',
    description: 'Pan and zoom the Google Map to a specific location or coordinate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number', description: 'Latitude to center on' },
        lng: { type: 'number', description: 'Longitude to center on' },
        zoom: { type: 'number', description: 'Zoom level 8-18 (default 12)' },
        label: { type: 'string', description: 'What we are navigating to (for user feedback)' },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'browse_web',
    description: 'Fetch and read any URL using a real browser — surf reports, restaurant sites, booking pages, NHC weather, etc. Returns the page text content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Full URL to fetch' },
        goal: { type: 'string', description: 'What specific info you need from this page' },
      },
      required: ['url', 'goal'],
    },
  },
  {
    name: 'browser_use',
    description: 'Control a real browser via Playwright MCP — navigate, click, fill forms, take screenshots, interact with dynamic pages. Use this for anything that requires JavaScript rendering, multi-step flows, or real browser interaction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', description: 'One of: navigate, snapshot, click, screenshot' },
        url: { type: 'string', description: 'URL for navigate action' },
        element: { type: 'string', description: 'Human-readable element description for click action' },
        ref: { type: 'string', description: 'Element ref from snapshot for click action' },
      },
      required: ['action'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Answer questions about Cabo/Cerritos using Claude knowledge — transport, surf conditions, restaurants, tips, costs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The question or topic to research' },
        category: { type: 'string', description: 'surf, dining, transport, weather, or general' },
      },
      required: ['query'],
    },
  },
  {
    name: 'translate',
    description: 'Translate text between English and Mexican Spanish.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to translate' },
        direction: { type: 'string', description: 'en-es, es-en, or auto' },
      },
      required: ['text'],
    },
  },
];

// ────────────────────────────────────────────────────────────
// Execute a tool call
// ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {

    case 'read_itinerary': {
      const items = await dbGetItinerary(args.date_filter);
      return { items, count: items.length };
    }

    case 'add_itinerary_item': {
      const item: ItineraryItem = {
        id: 'item-' + Date.now(),
        date: args.date,
        time: args.time,
        title: args.title,
        notes: args.notes,
        location: args.location,
        category: args.category as any,
      };
      await dbAddItem(item);
      return { success: true, item, action: 'added' };
    }

    case 'update_itinerary_item': {
      const updated = await dbUpdateItem(args.id, {
        time: args.time, title: args.title, notes: args.notes,
        location: args.location, category: args.category,
      });
      if (!updated) return { error: `Item ${args.id} not found` };
      return { success: true, item: updated, action: 'updated' };
    }

    case 'delete_itinerary_item': {
      const deleted = await dbDeleteItem(args.id);
      return deleted
        ? { success: true, action: 'deleted', id: args.id }
        : { error: `Item ${args.id} not found` };
    }

    case 'get_map_pins': {
      const filtered = args.category && args.category !== 'all'
        ? mapPins.filter(p => p.category === args.category)
        : mapPins;
      return { pins: filtered, count: filtered.length };
    }

    case 'add_map_pin': {
      const pin = { id: 'pin-' + Date.now(), ...args };
      mapPins.push(pin);
      return { success: true, pin, action: 'added' };
    }

    case 'navigate_map': {
      // The frontend polls for map commands
      return { action: 'navigate', lat: args.lat, lng: args.lng, zoom: args.zoom || 12, label: args.label || '' };
    }

    case 'browse_web': {
      // Use Playwright MCP for real browser rendering
      const navResult = await playwright.navigate(args.url);
      const pageText = await playwright.snapshot();
      const extracted = await claudeText({
        model: MODEL,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `URL: ${args.url}\n\nPage content:\n${pageText.slice(0, 6000)}\n\nGoal: ${args.goal}\n\nExtract the relevant info concisely.`,
        }],
      });
      return { url: args.url, content: extracted || pageText.slice(0, 500) };
    }

    case 'browser_use': {
      try {
        switch (args.action) {
          case 'navigate': {
            const result = await playwright.navigate(args.url);
            const snap = await playwright.snapshot();
            return { action: 'navigate', url: args.url, snapshot: snap.slice(0, 3000) };
          }
          case 'snapshot': {
            const snap = await playwright.snapshot();
            return { action: 'snapshot', snapshot: snap.slice(0, 4000) };
          }
          case 'click': {
            const result = await playwright.click(args.element || '', args.ref || '');
            return { action: 'click', result };
          }
          case 'screenshot': {
            const result = await playwright.screenshot();
            return { action: 'screenshot', result: result.slice(0, 200) + '...' };
          }
          default:
            return { error: `Unknown browser action: ${args.action}` };
        }
      } catch (err: any) {
        return { error: `Browser error: ${err.message}` };
      }
    }

    case 'search_knowledge': {
      const answer = await claudeText({
        model: MODEL,
        max_tokens: 512,
        system: `You are a concierge for a Baja California surf trip (Cerritos + Cabo, June 2026). Category: ${args.category || 'general'}. Give specific, practical answers with real prices and names.`,
        messages: [{ role: 'user', content: args.query }],
      });
      return { answer };
    }

    case 'translate': {
      const raw = await claudeText({
        model: MODEL,
        max_tokens: 256,
        system: 'Bilingual translator — Baja California Mexican Spanish. Return JSON only.',
        messages: [{
          role: 'user',
          content: `Translate: "${args.text}". Direction: ${args.direction || 'auto'}. JSON: {"translatedText":string,"detectedLanguage":string}`,
        }],
      });
      return parseJson(raw, {});
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ────────────────────────────────────────────────────────────
// Server
// ────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();

  // Init DB (no-op if no DATABASE_URL)
  initDb();
  await dbSetup().catch(err => console.error('DB setup error:', err));

  // Start Playwright MCP eagerly so first browse is fast
  playwright.start();
  playwright.ensureReady().catch(() => {});
  app.use(express.json({ limit: '20mb' }));

  // Health
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', model: MODEL }));

  // Current Baja time (useful for debugging)
  app.get('/api/now', (_req, res) => {
    const now = new Date();
    const bajaMs = now.getTime() + (now.getTimezoneOffset() + -7 * 60) * 60000;
    const baja = new Date(bajaMs);
    res.json({
      baja: baja.toISOString().replace('T', ' ').slice(0, 19) + ' MST',
      iso: `${baja.getFullYear()}-${String(baja.getMonth()+1).padStart(2,'0')}-${String(baja.getDate()).padStart(2,'0')}`,
    });
  });

  // Get current itinerary
  app.get('/api/itinerary', async (_req, res) => {
    const items = await dbGetItinerary();
    res.json({ items });
  });

  // Get map pins
  app.get('/api/pins', (_req, res) => res.json({ pins: mapPins }));

  // Serper place details — photos + reviews for a map pin
  app.get('/api/place-details', async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: 'q required' });

    try {
      // Try the places endpoint first for richer place data
      const placesRes = await fetch('https://google.serper.dev/places', {
        method: 'POST',
        headers: {
          'X-API-KEY': 'c3e3131754d6c5b47f446c055363776fd73b4149',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, gl: 'mx', hl: 'en' }),
      });
      const placesData = await placesRes.json() as any;
      const place = (placesData.places || [])[0] || null;

      // Also fetch organic results for review snippets
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': 'c3e3131754d6c5b47f446c055363776fd73b4149',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, gl: 'mx', hl: 'en', num: 5 }),
      });
      const searchData = await searchRes.json() as any;
      const kg = searchData.knowledgeGraph || null;
      const organic = (searchData.organic || []).slice(0, 3);

      const reviews = organic.map((item: any) => ({
        source: item.source || item.displayLink || '',
        title: item.title || '',
        snippet: item.snippet || '',
        link: item.link || '',
      }));

      res.json({
        title: place?.title || kg?.title || query,
        type: place?.type || kg?.type || '',
        description: kg?.description || place?.address || '',
        rating: place?.rating ?? kg?.rating,
        reviewCount: place?.reviewCount || kg?.reviewCount || '',
        address: place?.address || kg?.address || '',
        phone: place?.phoneNumber || kg?.phone || '',
        website: place?.website || kg?.website || '',
        imageUrl: place?.thumbnailUrl || kg?.imageUrl || null,
        attributes: kg?.attributes || {},
        reviews,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SSE-based streaming agent endpoint
  app.post('/api/agent', async (req, res) => {
    const { messages: history } = req.body as { messages: Array<{ role: string; text: string }> };
    if (!history?.length) return res.status(400).json({ error: 'messages required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Build a rich time context so the agent always knows where we are in the trip
    const now = new Date();
    // Baja California Sur is MST = UTC-7 (no DST)
    const bajaOffset = -7 * 60;
    const bajaMs = now.getTime() + (now.getTimezoneOffset() + bajaOffset) * 60000;
    const baja = new Date(bajaMs);
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const bajaDateStr = `${DAYS[baja.getDay()]}, ${MONTHS[baja.getMonth()]} ${baja.getDate()}, ${baja.getFullYear()}`;
    const bajaTimeStr = baja.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const bajaIso = `${baja.getFullYear()}-${String(baja.getMonth()+1).padStart(2,'0')}-${String(baja.getDate()).padStart(2,'0')}`;

    // Figure out trip status — use explicit UTC-7 offset to match baja time calculation
    const tripStart = new Date('2026-06-19T00:00:00-07:00');
    const tripEnd   = new Date('2026-06-24T23:59:59-07:00');
    const bajaTime  = baja.getTime();
    const tripStatus = bajaTime < tripStart.getTime()
      ? `Trip starts in ${Math.ceil((tripStart.getTime() - bajaTime) / 86400000)} days`
      : bajaTime > tripEnd.getTime()
        ? 'Trip has ended'
        : `Day ${Math.floor((bajaTime - tripStart.getTime()) / 86400000) + 1} of 6`;

    // Build itinerary snapshot for system prompt
    const sortedItinerary = [...itinerary].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const itineraryByDay = sortedItinerary.reduce((acc, item) => {
      (acc[item.date] = acc[item.date] || []).push(item);
      return acc;
    }, {} as Record<string, typeof itinerary>);
    const itineraryText = Object.entries(itineraryByDay).map(([date, items]) =>
      `${date}:\n` + items.map(i => `  [${i.id}] ${i.time} — ${i.title} @ ${i.location} (${i.category})${i.notes ? '\n    Notes: ' + i.notes : ''}`).join('\n')
    ).join('\n\n');

    const SYSTEM = `You are the AI concierge for a Baja California surf trip — dad, 16-yr-old, and friend, June 19–24 2026. You fly into SJD, base at Cerritos Beach Hotel (~1h15 north via Hwy 19), day-trip to Cabo (~1h south).

HOTEL: Cerritos Beach Hotel — beachfront home base, steps from the surf break, pool + on-site restaurant. GPS: 23.3218°N, 110.1768°W. Address: Km 64 Carr. Todos Santos–Cabo San Lucas, Pescadero, BCS.

CURRENT TIME (Baja California Sur, MST UTC-7): ${bajaDateStr} at ${bajaTimeStr}
TODAY'S DATE: ${bajaIso}
TRIP STATUS: ${tripStatus}

CURRENT ITINERARY:
${itineraryText || '(empty)'}

When asked what's next or what's coming up, look at today (${bajaIso}) in the itinerary above for items after ${bajaTimeStr}, or if nothing remains today, the next day with items. You do NOT need to call read_itinerary unless the user asks you to modify it — you already have the full current itinerary above.

For directions, give the Google Maps URL: https://www.google.com/maps/dir/?api=1&destination=<place+name> — always include a clickable link. Also tell them: drive time, route (Hwy 19 is the main corridor), and any parking/entry notes.

Trip facts: Beginners learning to surf at Cerritos (sandy bottom, slow waves). June is hot 82–84°F, sunny. SW groundswell peaks Sun–Mon at 5–6ft. Water ~71°F. Key spots: Cerritos Surf Academy ($95–100/pp), Mario Surf School ($80–100), Barracuda Cantina (fish tacos, closed Wed), Hierbabuena (farm-to-table Pescadero, closed Tue), Jazamango (Todos Santos, closed Tue), Tacos Gardenias (Cabo marina, $), Wild Canyon Adventures (zip/UTV), El Arco boat tour (~$20–25/pp).

You control the entire app: read/add/update/delete itinerary items, navigate the map, add pins, browse the web with a real Playwright browser (use browse_web for pages, browser_use for multi-step interactions), translate Spanish.

Be direct. Skip preambles. When asked to add something, do it immediately. Chain tool calls. After itinerary changes, confirm concisely.`;

    try {
      type Msg = { role: 'user' | 'assistant'; content: any };
      let apiMessages: Msg[] = history.map(m => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text,
      }));

      const sideEffects: any[] = [];
      let iterations = 0;

      while (iterations < 10) {
        iterations++;

        const r = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: anthropicHeaders(),
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2048,
            thinking: { type: 'adaptive' },
            system: SYSTEM,
            tools: TOOLS,
            messages: apiMessages,
          }),
        });

        if (!r.ok) {
          const errText = await r.text();
          throw new Error(`Claude API ${r.status}: ${errText}`);
        }

        const response = await r.json() as any;

        // Stream any text blocks
        for (const block of (response.content || [])) {
          if (block.type === 'text') {
            send('text', { text: block.text });
          }
        }

        if (response.stop_reason === 'end_turn') break;
        if (response.stop_reason !== 'tool_use') break;

        const toolCalls = (response.content || []).filter((b: any) => b.type === 'tool_use');
        if (!toolCalls.length) break;

        apiMessages.push({ role: 'assistant', content: response.content });

        const toolResultBlocks: any[] = [];

        for (const tc of toolCalls) {
          const args = tc.input as Record<string, any>;
          send('tool_start', { name: tc.name, args });

          let result: any;
          try {
            result = await executeTool(tc.name, args);
          } catch (err: any) {
            result = { error: err.message };
          }

          send('tool_done', { name: tc.name, result });

          if (['add_itinerary_item', 'update_itinerary_item', 'delete_itinerary_item'].includes(tc.name)) {
            sideEffects.push({ type: 'itinerary_change', action: result.action, item: result.item, id: args.id });
          }
          if (['add_map_pin', 'navigate_map'].includes(tc.name)) {
            sideEffects.push({ type: tc.name === 'navigate_map' ? 'map_navigate' : 'map_pin_added', ...result });
          }

          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify(result),
          });
        }

        apiMessages.push({ role: 'user', content: toolResultBlocks });
      }

      send('done', { sideEffects });
      res.end();
    } catch (err: any) {
      send('error', { message: err.message });
      res.end();
    }
  });

  // Serve the original trip guide HTML as a static page at /guide
  app.get('/guide', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'trip-guide.html'));
  });

  // Vite dev middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏄 Baja Surf Trip Concierge running at http://localhost:${PORT}\n`);
  });
}

startServer();
