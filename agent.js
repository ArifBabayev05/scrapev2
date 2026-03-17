'use strict';

// ============================================================
// ESOCIAL BOT — LOCAL AGENT
// Her userin oz PC-sinde isleyir.
// LOCAL HTTP server (port 3001) — user oz kompunda istek gonderir.
// Relay WebSocket — monitoring ucun.
// ============================================================

try { require('dotenv').config(); } catch (e) {}

process.on('uncaughtException',  function(err) { console.error('CRITICAL ERROR:', err); });
process.on('unhandledRejection', function(err) { console.error('UNHANDLED PROMISE:', err); });

var WebSocket  = require('ws').WebSocket;
var puppeteer;
try { puppeteer = require('puppeteer'); } catch (e) { puppeteer = require('puppeteer-core'); }
var fs   = require('fs');
var path = require('path');
var os   = require('os');
var http = require('http');

// ── Config ───────────────────────────────────────────────────
var RELAY_URL    = (process.env.RELAY_URL    || 'ws://localhost:3000').replace(/\/$/, '');
var AGENT_SECRET = process.env.AGENT_SECRET  || 'bot-secret-2024';
var AGENT_LABEL  = process.env.AGENT_LABEL   || os.hostname();
var ESOCIAL_PORT = parseInt(process.env.ESOCIAL_DEBUG_PORT || '9222');
var IMEI_PORT    = parseInt(process.env.IMEI_DEBUG_PORT    || '9223');
var LOCAL_PORT   = parseInt(process.env.LOCAL_PORT || '3001');

// ── Chrome path ──────────────────────────────────────────────
function getChromePath() {
    var pf86    = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    var pf64    = process.env['ProgramFiles']       || 'C:\\Program Files';
    var appdata = process.env['LOCALAPPDATA']       || path.join(os.homedir(), 'AppData', 'Local');

    var candidates = [
        path.join(pf86,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf64,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(appdata, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf86,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf64,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(appdata, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (fs.existsSync(candidates[i])) return candidates[i];
    }
    return null;
}

function getBaseDir() {
    return path.join(os.homedir(), 'AppData', 'Local', 'ESocialBot');
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Single Instance Lock ─────────────────────────────────────
var lockFile = path.join(getBaseDir(), 'agent.lock');
function checkSingleInstance() {
    ensureDir(getBaseDir());
    if (fs.existsSync(lockFile)) {
        try {
            var pid = parseInt(fs.readFileSync(lockFile, 'utf8'));
            process.kill(pid, 0);
            console.error('Agent artiq basqa pencerede isleyir (PID: ' + pid + ').');
            process.exit(0);
        } catch (e) {
            fs.unlinkSync(lockFile);
        }
    }
    fs.writeFileSync(lockFile, process.pid.toString());
    process.on('exit', function() { try { fs.unlinkSync(lockFile); } catch (e) {} });
}
checkSingleInstance();

// ── Browser Management ───────────────────────────────────────
var globalEsocialBrowser = null;
var globalImeiBrowser    = null;
var globalEsocialPage    = null;
var globalImeiPage       = null;
var isLaunchingEsocial   = false;
var isLaunchingImei      = false;

function cleanSingletonFiles(profilePath) {
    var files = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];
    for (var i = 0; i < files.length; i++) {
        try { fs.unlinkSync(path.join(profilePath, files[i])); } catch (e) {}
    }
}

async function ensureBrowser(service) {
    var isEsocial = service === 'esocial';
    var port      = isEsocial ? ESOCIAL_PORT : IMEI_PORT;
    var profile   = isEsocial ? 'esocial_profile' : 'imei_profile';

    // Basqa cagirish artiq acirsa, gozle
    if (isEsocial ? isLaunchingEsocial : isLaunchingImei) {
        for (var i = 0; i < 30; i++) {
            await new Promise(function(r) { setTimeout(r, 500); });
            if (isEsocial ? globalEsocialBrowser : globalImeiBrowser) break;
        }
    }

    var browser = isEsocial ? globalEsocialBrowser : globalImeiBrowser;
    if (browser) {
        try {
            await browser.version();
            return browser;
        } catch (e) {
            if (isEsocial) globalEsocialBrowser = null; else globalImeiBrowser = null;
        }
    }

    if (isEsocial) isLaunchingEsocial = true; else isLaunchingImei = true;
    try {
        // Movcud brauzere qosulma cehdi
        try {
            browser = await puppeteer.connect({
                browserURL: 'http://localhost:' + port,
                defaultViewport: null
            });
            if (isEsocial) globalEsocialBrowser = browser; else globalImeiBrowser = browser;
            console.log('[' + service + '] Movcud brauzere qosuldu (Port: ' + port + ')');
            return browser;
        } catch (e) {}

        // Yeni acilish
        var executablePath = getChromePath();
        var userDataDir = path.join(getBaseDir(), profile);
        ensureDir(userDataDir);
        cleanSingletonFiles(userDataDir);

        browser = await puppeteer.launch({
            executablePath: executablePath,
            headless: false,
            defaultViewport: null,
            userDataDir: userDataDir,
            args: [
                '--remote-debugging-port=' + port,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--start-maximized',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        if (isEsocial) globalEsocialBrowser = browser; else globalImeiBrowser = browser;
        console.log('[' + service + '] Yeni brauzer acildi (Port: ' + port + ')');

        browser.on('disconnected', function() {
            console.log('[' + service + '] Brauzer baglandi');
            if (isEsocial) { globalEsocialBrowser = null; globalEsocialPage = null; }
            else { globalImeiBrowser = null; globalImeiPage = null; }
        });

        return browser;
    } finally {
        if (isEsocial) isLaunchingEsocial = false; else isLaunchingImei = false;
    }
}

async function ensureEsocialPage() {
    if (globalEsocialPage) {
        try { await globalEsocialPage.evaluate(function() { return true; }); return globalEsocialPage; }
        catch (e) { globalEsocialPage = null; }
    }
    var browser = await ensureBrowser('esocial');
    var pages = await browser.pages();
    globalEsocialPage = pages.find(function(p) { return p.url().indexOf('e-social.gov.az') >= 0; });
    if (!globalEsocialPage) {
        var blank = pages.find(function(p) { return p.url() === 'about:blank' || p.url() === ''; });
        globalEsocialPage = blank || await browser.newPage();
    }
    var targetUrl = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';
    if (globalEsocialPage.url().indexOf('e-social.gov.az') < 0) {
        await globalEsocialPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    }
    try { await globalEsocialPage.bringToFront(); } catch (e) {}
    return globalEsocialPage;
}

async function ensureImeiPage() {
    if (globalImeiPage) {
        try { await globalImeiPage.evaluate(function() { return true; }); return globalImeiPage; }
        catch (e) { globalImeiPage = null; }
    }
    var browser = await ensureBrowser('imei');
    var pages = await browser.pages();
    globalImeiPage = pages.find(function(p) { return p.url().indexOf('ins.mcqs.az') >= 0; });
    if (!globalImeiPage) {
        var blank = pages.find(function(p) { return p.url() === 'about:blank' || p.url() === ''; });
        globalImeiPage = blank || await browser.newPage();
    }
    if (globalImeiPage.url().indexOf('ins.mcqs.az') < 0) {
        await globalImeiPage.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'domcontentloaded' });
    }
    try { await globalImeiPage.bringToFront(); } catch (e) {}
    return globalImeiPage;
}

// ── Scrape Job ───────────────────────────────────────────────
async function runScrapeJob(body) {
    var fin = body.fin;
    var sv  = body.sv;
    if (!fin || !sv) throw new Error('FIN ve SV daxil edilmelidir');

    var formattedSv = sv.trim();
    if (formattedSv.toUpperCase().startsWith('AZE')) formattedSv = formattedSv.slice(3);

    var page = await ensureEsocialPage();
    if (page.url().indexOf('mygovid.gov.az') >= 0 || page.url().indexOf('auth') >= 0) {
        return { error: 'LOGIN_REQUIRED', message: 'Zehmet olmasa Asan Imza ile daxil olun.' };
    }

    // Modal cleaning
    await page.evaluate(function() {
        var buttons = Array.from(document.querySelectorAll('button,.q-btn,.btn,span,div,a'));
        var close = buttons.find(function(el) {
            var t = (el.innerText || '').trim();
            return (t === 'Bağla' || t === 'BAĞLA' || t === 'Bağla.') && (el.offsetWidth > 0 || el.offsetHeight > 0);
        });
        if (close) close.click();
    });

    // Fill form
    await page.evaluate(function(finVal, svVal) {
        var finInput = document.querySelector('input[placeholder*="FİN"]');
        var svInput  = document.querySelector('input[placeholder*="ŞV"]');
        if (finInput) { finInput.value = finVal; finInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (svInput)  { svInput.value  = svVal;  svInput.dispatchEvent(new Event('input', { bubbles: true }));  }

        var btn = Array.from(document.querySelectorAll('button, .q-btn')).find(function(el) {
            return el.innerText && el.innerText.indexOf('Axtar') >= 0;
        });
        if (btn) btn.click();
    }, fin, formattedSv);

    await new Promise(function(r) { setTimeout(r, 2000); });

    var resultData = await page.evaluate(function() {
        var data = {};
        document.querySelectorAll('.q-field, .input-group, .row').forEach(function(container) {
            var labelEl = container.querySelector('label, .q-field__label, .text-subtitle2');
            if (!labelEl) return;
            var label = labelEl.innerText.trim().toLowerCase();
            var input = container.querySelector('input, .q-field__native');
            if (input) data[label] = input.value || input.innerText;
        });
        return data;
    });

    return { success: true, data: resultData };
}

// ── IMEI Job ─────────────────────────────────────────────────
async function runImeiJob(body) {
    var imei = body.imei;
    if (!imei) throw new Error('IMEI daxil edilmeyib');

    var page = await ensureImeiPage();

    if (page.url().indexOf('LogIn') >= 0) {
        await page.type('#username', 'aziza_nasirova');
        await page.type('#password', 'leqal2025');
        await page.click('#loginbutton');
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(function() {});
    }

    if (page.url().indexOf('CheckImeiStatus') < 0) {
        await page.goto('https://ins.mcqs.az/CreditApplication/Index', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 10000 });
        await page.click('li[data-url*="CheckImeiStatus"] a');
    }

    await page.waitForSelector('#getimeicode', { timeout: 10000 });
    await page.evaluate(function(val) {
        var el = document.querySelector('#getimeicode');
        if (el) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, imei);

    await page.click('#checkimeistatus');

    try {
        await page.waitForFunction(function() {
            var el = document.querySelector('#imeiStatus b');
            return el && el.innerText.trim().length > 5;
        }, { timeout: 15000 });
    } catch (e) {}

    var statusText = await page.$eval('#imeiStatus b', function(el) { return el.innerText.trim(); }).catch(function() { return 'RESULT_NOT_FOUND'; });

    return {
        imeiFee: statusText.endsWith('deaktiv olunub.'),
        message: statusText
    };
}

// ── Dispatcher + Retry ───────────────────────────────────────
async function handleJob(jobType, payload) {
    if (jobType === 'scrape')      return runScrapeJob(payload);
    if (jobType === 'check-imei') return runImeiJob(payload);
    throw new Error('Namalum is tipi: ' + jobType);
}

async function handleJobWithRetry(jobType, payload, attempt) {
    attempt = attempt || 1;
    try {
        return await handleJob(jobType, payload);
    } catch (err) {
        var isClosed = err.message.indexOf('Target closed') >= 0 || err.message.indexOf('Protocol error') >= 0;
        if (isClosed && attempt === 1) {
            console.log('[' + jobType + '] Target closed. Yeniden cehd...');
            if (jobType === 'scrape') { globalEsocialBrowser = null; globalEsocialPage = null; }
            else { globalImeiBrowser = null; globalImeiPage = null; }
            return handleJobWithRetry(jobType, payload, 2);
        }
        throw err;
    }
}

// ══════════════════════════════════════════════════════════════
// LOCAL HTTP SERVER — User oz PC-sinde localhost:3001 ile isleyir
// Hec bir relay/agentLabel lazim deyil, birbasha yerli isleyir
// ══════════════════════════════════════════════════════════════

var localServer = http.createServer(function(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // POST endpoints
    if (req.method === 'POST') {
        var body = '';
        req.on('data', function(c) { body += c; });
        req.on('end', function() {
            var payload;
            try { payload = JSON.parse(body); } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Yanlish JSON' }));
                return;
            }

            var jobType = null;
            if (req.url === '/api/scrape') jobType = 'scrape';
            else if (req.url === '/api/check-imei') jobType = 'check-imei';

            if (!jobType) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Route tapilmadi: ' + req.url }));
                return;
            }

            console.log('[LOCAL] Is alindi: ' + jobType);
            handleJobWithRetry(jobType, payload).then(function(result) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            }).catch(function(err) {
                console.error('[LOCAL] Xeta: ' + err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
        });
        return;
    }

    // GET endpoints
    if (req.url === '/' || req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            agent: AGENT_LABEL,
            status: 'online',
            relay: ws && ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
            esocialBrowser: !!globalEsocialBrowser,
            imeiBrowser: !!globalImeiBrowser
        }));
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route tapilmadi' }));
});

localServer.listen(LOCAL_PORT, function() {
    console.log('LOCAL SERVER: http://localhost:' + LOCAL_PORT);
    console.log('   POST /api/scrape       - E-Social scrape');
    console.log('   POST /api/check-imei   - IMEI yoxlama');
    console.log('   GET  /api/status       - Agent durumu');
});

// ══════════════════════════════════════════════════════════════
// WebSocket — Relay serverle baglanti (monitoring + uzaqdan is)
// ══════════════════════════════════════════════════════════════
var ws = null;
var reconnectTimer = null;

function connect() {
    var wsUrl = RELAY_URL + '?secret=' + encodeURIComponent(AGENT_SECRET) + '&label=' + encodeURIComponent(AGENT_LABEL);
    console.log('Relay servere qosulur: ' + RELAY_URL);

    ws = new WebSocket(wsUrl);

    ws.on('open', function() {
        console.log('Relay servere qosuldu!');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        setInterval(function() {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
    });

    ws.on('message', function(raw) {
        var msg;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
        if (msg.type === 'job') {
            console.log('[RELAY] Is alindi: ' + msg.jobType + ' [' + msg.jobId + ']');
            handleJobWithRetry(msg.jobType, msg.payload).then(function(result) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'job_result', jobId: msg.jobId, result: result }));
                }
            }).catch(function(err) {
                console.error('[RELAY] Xeta [' + msg.jobId + ']: ' + err.message);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'job_result', jobId: msg.jobId, error: err.message }));
                }
            });
        }
    });

    ws.on('close', function() {
        console.log('Relay baglanti kesildi. 5s sonra yeniden cehd...');
        reconnectTimer = setTimeout(connect, 5000);
    });

    ws.on('error', function(err) { console.error('WebSocket xetasi: ' + err.message); });
}

// ── Start ─────────────────────────────────────────────────────
console.log('');
console.log('***************************************************');
console.log('  E-SOCIAL LOCAL AGENT');
console.log('  PC: ' + AGENT_LABEL);
console.log('  Local: http://localhost:' + LOCAL_PORT);
console.log('  Relay: ' + RELAY_URL);
console.log('***************************************************');
console.log('');

connect();
setInterval(function() {}, 1000);
