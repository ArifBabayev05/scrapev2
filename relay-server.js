'use strict';

// ============================================================
// RELAY SERVER — Railway-də işləyir
// Lokal agent(lər) WebSocket ilə qoşulur,
// gələn HTTP sorğuları agent-ə yönləndirilir.
// ============================================================

const express    = require('express');
const http       = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors       = require('cors');
const { v4: uuidv4 } = require('uuid');
const puppeteer  = require('puppeteer');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT         = process.env.PORT         || 3000;
const AGENT_SECRET = process.env.AGENT_SECRET || 'bot-secret-2024';

// ── Middleware ──────────────────────────────────────────────
// ── CORS — browser tərəfindən gondərilən preflight OPTIONS-ı də həll et
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));  // preflight üçün bütün route-lar

// JSON body parser + parse xətasını JSON olaraq qaytar (HTML deyil)
app.use(express.json());
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.status === 400) {
        return res.status(400).json({ error: 'Yararlısız JSON body', detail: err.message });
    }
    next(err);
});

// Request log
app.use((req, _res, next) => {
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url}`);
    next();
});

// ── In-memory stores ────────────────────────────────────────
// agentId → { ws, busy, connectedAt, label }
const agents = new Map();
// jobId   → { resolve, reject, timeout, agentId }
const pendingJobs = new Map();

// ── Helpers ─────────────────────────────────────────────────
// ATOM\u0130K agent tap+rezerv funksiyası.
// tap() + busy=true eyni sinxron blokda olur —
// paralel sorğular eyni agenti əldə edə bilməz (JS single-thread).
function tryClaimAgent() {
    for (const [agentId, agent] of agents) {
        if (!agent.busy && agent.ws.readyState === WebSocket.OPEN) {
            agent.busy = true; // ← atom: tap + rezerv eyni addımda
            return { agentId, agent };
        }
    }
    return null;
}

// Yalnız status üçün (busy=true etmir)
function getAvailableAgentCount() {
    let count = 0;
    for (const [, agent] of agents) {
        if (!agent.busy && agent.ws.readyState === WebSocket.OPEN) count++;
    }
    return count;
}

async function sendJobToAgent(jobType, payload) {
    // 1. Dərhal atomik əldə cəhdi
    let claimed = tryClaimAgent();

    // 2. Boş agent yoxdursa — 15s gözlə, hər 300ms-də atomik yoxla
    if (!claimed) {
        console.log(`⏳ [${jobType}] Boş agent yoxdur (${agents.size} agent, gözlənilir...)`);

        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 300));
            claimed = tryClaimAgent(); // hər dəfə atomik
            if (claimed) break;
        }
    }

    if (!claimed) {
        const boş = getAvailableAgentCount();
        const err = new Error(
            `NO_AGENT: Aktiv lokal agent tapılmadı (${agents.size} agent qoşuludur, ${boş} boşdur). ` +
            'Zəhmət olmasa kompüterdə "node agent.js" işlədilsin.'
        );
        err.code = 503;
        return Promise.reject(err);
    }

    const { agentId, agent } = claimed;
    const jobId = uuidv4();


    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingJobs.delete(jobId);
            if (agents.has(agentId)) agents.get(agentId).busy = false;
            const err = new Error('TIMEOUT: İş 2 dəqiqə ərzində tamamlanmadı');
            err.code  = 504;
            reject(err);
        }, 120_000);

        pendingJobs.set(jobId, { resolve, reject, timeout, agentId });

        agent.ws.send(JSON.stringify({ type: 'job', jobId, jobType, payload }));
        console.log(
            `📤 İş göndərildi: ${jobType} ` +
            `[${jobId.slice(0,8)}] → Agent [${agentId.slice(0,8)}] ` +
            `(${agent.label})`
        );
    });
}

// ── WebSocket Server ─────────────────────────────────────────
wss.on('connection', (ws, req) => {
    // Auth
    const url    = new URL(req.url, 'http://localhost');
    const secret = url.searchParams.get('secret');
    const label  = url.searchParams.get('label') || 'unnamed';

    if (secret !== AGENT_SECRET) {
        console.warn(`⛔ Etibarsız agent qoşulmaq istədi (secret: ${secret})`);
        ws.close(4001, 'Unauthorized');
        return;
    }

    const agentId = uuidv4();
    agents.set(agentId, { ws, busy: false, connectedAt: new Date(), label });
    console.log(
        `✅ Agent qoşuldu: [${agentId.slice(0,8)}] "${label}" ` +
        `| Cəmi: ${agents.size}`
    );

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); }
        catch { return; }

        // Job result
        if (msg.type === 'job_result') {
            const job = pendingJobs.get(msg.jobId);
            if (!job) return;

            clearTimeout(job.timeout);
            pendingJobs.delete(msg.jobId);
            if (agents.has(agentId)) agents.get(agentId).busy = false;

            if (msg.error) {
                job.reject(new Error(msg.error));
            } else {
                job.resolve(msg.result);
            }
            console.log(`✅ Nəticə alındı: [${msg.jobId.slice(0,8)}]`);
        }

        // Ping / pong
        if (msg.type === 'ping') {
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        }
    });

    ws.on('close', () => {
        // Pending jobs-ı ləğv et
        for (const [jobId, job] of pendingJobs) {
            if (job.agentId === agentId) {
                clearTimeout(job.timeout);
                const err = new Error('AGENT_DISCONNECT: Agent bağlantısı kəsildi');
                err.code  = 503;
                job.reject(err);
                pendingJobs.delete(jobId);
            }
        }
        agents.delete(agentId);
        console.log(
            `❌ Agent ayrıldı: [${agentId.slice(0,8)}] "${label}" ` +
            `| Cəmi: ${agents.size}`
        );
    });

    ws.on('error', (err) =>
        console.error(`Agent WS xətası [${agentId.slice(0,8)}]:`, err.message)
    );
});

// ── REST Endpoints ───────────────────────────────────────────

// Health / root
app.get('/', (_req, res) => {
    res.json({
        service    : 'E-Social Bot Relay Server',
        status     : 'online',
        agents     : agents.size,
        pendingJobs: pendingJobs.size,
        uptime     : Math.round(process.uptime()) + 's'
    });
});

// Agent status
app.get('/api/status', (_req, res) => {
    const list = [];
    for (const [id, agent] of agents) {
        list.push({
            id         : id.slice(0, 8),
            label      : agent.label,
            busy       : agent.busy,
            connectedAt: agent.connectedAt,
            wsState    : agent.ws.readyState   // 1 = OPEN
        });
    }
    res.json({ agents: list, pendingJobs: pendingJobs.size });
});

// E-Social scrape
app.post('/api/scrape', async (req, res) => {
    try {
        const result = await sendJobToAgent('scrape', req.body);
        res.json(result);
    } catch (err) {
        res.status(err.code || 500).json({ error: err.message });
    }
});

// IMEI check — CLOUD HEADLESS (heç bir lokal agent lazım deyil)
app.post('/api/check-imei', async (req, res) => {
    try {
        const { imei } = req.body;
        if (!imei) return res.status(400).json({ error: 'IMEI daxil edilməyib' });
        console.log(`🔍 [IMEI] Cloud headless başladı: ${imei}`);
        const result = await runImeiCloud(imei);
        res.json(result);
    } catch (err) {
        console.error('❌ [IMEI] Cloud xətası:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── 404 və global xəta handler ──────────────────────────────
// Railway-nin HTML səhifələri əvəzinə həmişə JSON qaytar
app.use((req, res) => {
    res.status(404).json({ error: `Route tapilmadi: ${req.method} ${req.url}` });
});

app.use((err, req, res, _next) => {
    console.error('Express xətası:', err.message);
    res.status(500).json({ error: err.message || 'Daxili server xətası' });
});

// ── IMEI Cloud Headless Logic ─────────────────────────────
// Railway-də headless Chromium işləyir, lokal agent lazım deyil.
let imeiBrowser = null;
let imeiPage    = null;

const IMEI_USER = process.env.IMEI_USERNAME || 'aziza_nasirova';
const IMEI_PASS = process.env.IMEI_PASSWORD || 'leqal2025';

async function getImeiBrowser() {
    if (imeiBrowser) {
        try { await imeiBrowser.version(); return imeiBrowser; }
        catch { imeiBrowser = null; imeiPage = null; }
    }
    imeiBrowser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
        ],
    });
    console.log('✅ [IMEI] Headless brauzer başladı');
    return imeiBrowser;
}

async function ensureImeiLoggedIn(page) {
    const cur = page.url();
    if (cur.includes('CreditApplication') || cur.includes('CheckImeiStatus')) return;

    await page.goto('https://ins.mcqs.az/User/LogIn', {
        waitUntil: 'networkidle2',
        timeout: 60000,
    });

    const loginField = await page.$('#username');
    if (loginField) {
        console.log('🔐 [IMEI] Login olunur...');
        await page.type('#username', IMEI_USER);
        await page.type('#password', IMEI_PASS);
        await page.click('#loginbutton');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
        if (await page.$('#username')) throw new Error('IMEI login uğursuz oldu');
        console.log('✅ [IMEI] Login uğurlu');
    }
}

async function runImeiCloud(imei) {
    const browser = await getImeiBrowser();

    // Persistent page istifadə et
    if (imeiPage) {
        try { await imeiPage.evaluate(() => document.title); }
        catch { imeiPage = null; }
    }
    if (!imeiPage) {
        imeiPage = await browser.newPage();
        await imeiPage.setDefaultNavigationTimeout(60000);
    }
    const page = imeiPage;

    // Login
    await ensureImeiLoggedIn(page);

    // CheckImeiStatus səhifəsinə keç
    if (!page.url().includes('CreditApplication') && !page.url().includes('CheckImeiStatus')) {
        await page.goto('https://ins.mcqs.az/CreditApplication/Index', { waitUntil: 'networkidle2' });
    }

    await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 10000 });
    await page.click('li[data-url*="CheckImeiStatus"] a');
    await new Promise(r => setTimeout(r, 1000));

    // IMEI daxil et və yoxla
    await page.click('#getimeicode', { clickCount: 3 });
    await page.keyboard.type(imei);
    await page.click('#checkimeistatus');

    let statusText = '';
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            statusText = await page.$eval('#imeiStatus b', el => el.innerText.trim());
            if (statusText && statusText.length > 5) break;
        } catch {}
    }

    if (!statusText) statusText = 'RESULT_NOT_FOUND';
    console.log(`✅ [IMEI] Nəticə: ${statusText.slice(0, 60)}...`);

    return {
        imeiFee: statusText.endsWith('deaktiv olunub.'),
        message: statusText,
    };
}

// ── Server Start ─────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`
***************************************************
🚀 RELAY SERVER BAŞLADI!
📍 Port   : ${PORT}
🔑 Secret : ${AGENT_SECRET}
⚙️  Endpoints:
   GET  /              (health check)
   GET  /api/status    (agent list)
   POST /api/scrape    (→ lokal agent, Asan İmza lazım)
   POST /api/check-imei (→ cloud headless, lazım deyil)
***************************************************
`);

    // Headless brauzeri əvvəlcədən başlat
    getImeiBrowser().catch(e => console.error('IMEI brauzer xətası:', e.message));
});
