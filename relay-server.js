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

// Agent kodunu servis et — agent həmişə ən son versiyanı yükləyir
app.get('/api/agent-code', async (_req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const r = await fetch('https://raw.githubusercontent.com/ArifBabayev05/scrapev2/main/agent.js');
        if (!r.ok) throw new Error('GitHub cavab vermədi');
        const code = await r.text();
        res.type('application/javascript').send(code);
    } catch (err) {
        res.status(500).json({ error: 'Agent kodu yüklənə bilmədi: ' + err.message });
    }
});

// Node.js setup script — Defender-ə ilişmir (PowerShell irm|iex əvəzi)
// User BİR DƏFƏ işlədir: node -e "fetch('https://...../api/install').then(r=>r.text()).then(s=>{require('fs').writeFileSync(require('os').tmpdir()+'/s.js',s);require(require('os').tmpdir()+'/s.js')})"
app.get('/api/install', (_req, res) => {
    const host = _req.headers.host;
    const script = `
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

const DIR  = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ESocialBot');
const RELAY_HOST = '${host}';

console.log('');
console.log('  ======================================');
console.log('   ESocial Bot Agent - Qurasdirilir...');
console.log('  ======================================');
console.log('');

// 1. Qovluq yarat
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
console.log('  [OK] Qovluq:', DIR);

// 2. .env yarat (yalniz ilk defe)
const envFile = path.join(DIR, '.env');
if (!fs.existsSync(envFile)) {
    fs.writeFileSync(envFile, [
        'RELAY_URL=wss://' + RELAY_HOST,
        'AGENT_SECRET=bot-secret-2024',
        'AGENT_LABEL=' + os.hostname(),
        'ESOCIAL_DEBUG_PORT=9222',
        'IMEI_DEBUG_PORT=9223',
    ].join('\\n') + '\\n');
    console.log('  [OK] .env yaradildi (agent:', os.hostname() + ')');
} else {
    console.log('  [OK] .env artiq movcuddur');
}

// 3. package.json yarat
const pkgFile = path.join(DIR, 'package.json');
fs.writeFileSync(pkgFile, JSON.stringify({
    name: 'esocial-agent',
    private: true,
    dependencies: { ws: '^8', 'puppeteer-core': '^24', dotenv: '^16' }
}, null, 2));
console.log('  [OK] package.json hazirdir');

// 4. npm install (node_modules yoxdursa)
if (!fs.existsSync(path.join(DIR, 'node_modules'))) {
    console.log('  [..] Paketler yuklenilir (1-2 deqiqe)...');
    execSync('npm install --production --no-fund --no-audit', {
        cwd: DIR, stdio: 'inherit'
    });
    console.log('  [OK] Paketler yuklendi');
} else {
    console.log('  [OK] Paketler artiq movcuddur');
}

// 5. launcher.js yarat — həmişə Railway-dən ən son kodu yükləyir
const launcherCode = \`
'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const dir   = path.join(process.env.LOCALAPPDATA || '', 'ESocialBot');

// .env yüklə
try { require(path.join(dir, 'node_modules', 'dotenv')).config({ path: path.join(dir, '.env') }); } catch {}

const agentUrl = 'https://\${RELAY_HOST}/api/agent-code';
console.log('Agent kodu yuklenilir...');

https.get(agentUrl, { rejectUnauthorized: false }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
        const agentPath = path.join(dir, 'agent.js');
        fs.writeFileSync(agentPath, body);
        console.log('Agent basladi!');
        require(agentPath);
    });
}).on('error', e => {
    console.error('Yukleme xetasi:', e.message);
    // Əgər yükləmə uğursuz olarsa, köhnə versiya varsa onu işlət
    const agentPath = path.join(dir, 'agent.js');
    if (fs.existsSync(agentPath)) {
        console.log('Kohne versiya istifade olunur...');
        require(agentPath);
    } else {
        process.exit(1);
    }
});
\`;

fs.writeFileSync(path.join(DIR, 'launcher.js'), launcherCode.trim());
console.log('  [OK] launcher.js yaradildi');

// 6. Windows Scheduled Task — hər login-də avtomatik başlasın
try {
    const launcherPath = path.join(DIR, 'launcher.js');
    // .cmd wrapper yaradırıq — schtasks ilə quoting problemi olmur
    const cmdPath = path.join(DIR, 'start-agent.cmd');
    fs.writeFileSync(cmdPath, '@echo off\\r\\nnode "' + launcherPath + '"\\r\\n');
    execSync(
        'schtasks /create /tn "ESocialBot" /tr "\\"' + cmdPath + '\\"" /sc onlogon /f /rl limited',
        { stdio: 'pipe' }
    );
    console.log('  [OK] Scheduled Task yaradildi (her login-de avtomatik)');
} catch (e) {
    console.log('  [!] Scheduled Task yaradila bilmedi:', e.message);
    console.log('  [!] Agent manual baslada bilersiniz: node "' + path.join(DIR, 'launcher.js') + '"');
}

console.log('');
console.log('  ======================================');
console.log('  [OK] Qurasdirilma tamam!');
console.log('  [..] Agent basladilir...');
console.log('  ======================================');
console.log('');

// 7. Dərhal başlat
require(path.join(DIR, 'launcher.js'));
`.trim();

    res.type('application/javascript').send(script);
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

// IMEI check — lokal agent-ə yönləndirilir (sertifikat lazımdır)
app.post('/api/check-imei', async (req, res) => {
    try {
        const result = await sendJobToAgent('check-imei', req.body);
        res.json(result);
    } catch (err) {
        res.status(err.code || 500).json({ error: err.message });
    }
});

// ── 404 və global xəta handler ──────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: `Route tapilmadi: ${req.method} ${req.url}` });
});

app.use((err, req, res, _next) => {
    console.error('Express xətası:', err.message);
    res.status(500).json({ error: err.message || 'Daxili server xətası' });
});

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
   POST /api/scrape    (→ lokal agent)
   POST /api/check-imei (→ lokal agent)
***************************************************
`);
});
