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
function getAvailableAgent() {
    for (const [agentId, agent] of agents) {
        if (!agent.busy && agent.ws.readyState === WebSocket.OPEN) {
            return { agentId, agent };
        }
    }
    return null;
}

function sendJobToAgent(jobType, payload) {
    const available = getAvailableAgent();

    if (!available) {
        const err = new Error(
            'NO_AGENT: Aktiv lokal agent tapılmadı. ' +
            'Zəhmət olmasa kompüterdə "node agent.js" işlədilsin.'
        );
        err.code = 503;
        return Promise.reject(err);
    }

    const { agentId, agent } = available;
    const jobId = uuidv4();
    agent.busy  = true;

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

// IMEI check
app.post('/api/check-imei', async (req, res) => {
    try {
        const result = await sendJobToAgent('check-imei', req.body);
        res.json(result);
    } catch (err) {
        res.status(err.code || 500).json({ error: err.message });
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

// ── Server Start ─────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`
***************************************************
🚀 RELAY SERVER BAŞLADI!
📍 Port   : ${PORT}
🔑 Secret : ${AGENT_SECRET}
⚙️  Endpoints:
   GET  /            (health check)
   GET  /api/status  (agent list)
   POST /api/scrape
   POST /api/check-imei
***************************************************
`);
});
