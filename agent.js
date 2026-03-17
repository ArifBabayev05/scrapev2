'use strict';

/**
 * ESOCIAL BOT - LOCAL AGENT
 * This version uses separate browser instances for E-Social and IMEI checks
 * as requested to ensure maximum stability and zero interference.
 */

try { require('dotenv').config(); } catch {}

process.on('uncaughtException',  (err) => console.error('CRITICAL ERROR:', err));
process.on('unhandledRejection', (err) => console.error('UNHANDLED PROMISE:', err));

const { WebSocket }             = require('ws');
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }
const fs                        = require('fs');
const path                      = require('path');
const os                        = require('os');

// ── Config ───────────────────────────────────────────────────
const RELAY_URL           = (process.env.RELAY_URL    || 'ws://localhost:3000').replace(/\/$/, '');
const AGENT_SECRET        = process.env.AGENT_SECRET  || 'bot-secret-2024';
const AGENT_LABEL         = process.env.AGENT_LABEL   || os.hostname();
const ESOCIAL_PORT        = parseInt(process.env.ESOCIAL_DEBUG_PORT || '9222');
const IMEI_PORT           = parseInt(process.env.IMEI_DEBUG_PORT    || '9223');

// ── Chrome path ──────────────────────────────────────────────
const getChromePath = () => {
    const pf86    = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf64    = process.env['ProgramFiles']       || 'C:\\Program Files';
    const appdata = process.env['LOCALAPPDATA']       || path.join(os.homedir(), 'AppData', 'Local');

    const candidates = [
        path.join(pf86,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf64,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(appdata, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf86,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf64,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(appdata, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
};

const getBaseDir = () => path.join(os.homedir(), 'AppData', 'Local', 'ESocialBot');

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// ── Single Instance Lock ─────────────────────────────────────
const lockFile = path.join(getBaseDir(), 'agent.lock');
const checkSingleInstance = () => {
    ensureDir(getBaseDir());
    if (fs.existsSync(lockFile)) {
        try {
            const pid = parseInt(fs.readFileSync(lockFile, 'utf8'));
            process.kill(pid, 0); 
            console.error(`⚠️ Agent artiq basqa pencederede isleyir (PID: \${pid}).`);
            process.exit(0);
        } catch {
            fs.unlinkSync(lockFile);
        }
    }
    fs.writeFileSync(lockFile, process.pid.toString());
    process.on('exit', () => { try { fs.unlinkSync(lockFile); } catch {} });
};
checkSingleInstance();

// ── Browser Management ───────────────────────────────────────
let globalEsocialBrowser = null;
let globalImeiBrowser    = null;
let globalEsocialPage    = null;
let globalImeiPage       = null;
let isLaunchingEsocial   = false;
let isLaunchingImei      = false;

const cleanSingletonFiles = (profilePath) => {
    ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']
        .forEach(f => {
            try { fs.unlinkSync(path.join(profilePath, f)); } catch {}
        });
};

async function ensureBrowser(service) {
    const isEsocial = service === 'esocial';
    const port      = isEsocial ? ESOCIAL_PORT : IMEI_PORT;
    const profile   = isEsocial ? 'esocial_profile' : 'imei_profile';
    
    if (isEsocial ? isLaunchingEsocial : isLaunchingImei) {
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (isEsocial ? globalEsocialBrowser : globalImeiBrowser) break;
        }
    }

    let browser = isEsocial ? globalEsocialBrowser : globalImeiBrowser;
    if (browser) {
        try {
            await browser.version();
            return browser;
        } catch {
            if (isEsocial) globalEsocialBrowser = null; else globalImeiBrowser = null;
        }
    }

    if (isEsocial) isLaunchingEsocial = true; else isLaunchingImei = true;
    try {
        // Try connect first
        try {
            browser = await puppeteer.connect({ browserURL: `http://localhost:\${port}`, defaultViewport: null });
            if (isEsocial) globalEsocialBrowser = browser; else globalImeiBrowser = browser;
            console.log(`✅ [\${service}] Movcud brauzere qosuldu (Port: \${port})`);
            return browser;
        } catch {}

        // Launch new
        const executablePath = getChromePath();
        const userDataDir = path.join(getBaseDir(), profile);
        ensureDir(userDataDir);
        cleanSingletonFiles(userDataDir);

        browser = await puppeteer.launch({
            executablePath,
            headless: false,
            defaultViewport: null,
            userDataDir,
            args: [
                `--remote-debugging-port=\${port}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--start-maximized',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        if (isEsocial) globalEsocialBrowser = browser; else globalImeiBrowser = browser;
        console.log(`🚀 [\${service}] Yeni brauzer acildi (Port: \${port})`);
        return browser;
    } finally {
        if (isEsocial) isLaunchingEsocial = false; else isLaunchingImei = false;
    }
}

async function ensureEsocialPage() {
    if (globalEsocialPage) {
        try { await globalEsocialPage.evaluate(() => true); return globalEsocialPage; }
        catch { globalEsocialPage = null; }
    }
    const browser = await ensureBrowser('esocial');
    const pages = await browser.pages();
    globalEsocialPage = pages.find(p => p.url().includes('e-social.gov.az'));
    if (!globalEsocialPage) {
        const blank = pages.find(p => p.url() === 'about:blank' || p.url() === '');
        globalEsocialPage = blank || await browser.newPage();
    }
    const targetUrl = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';
    if (!globalEsocialPage.url().includes('e-social.gov.az')) {
        await globalEsocialPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    }
    try { await globalEsocialPage.bringToFront(); } catch {}
    return globalEsocialPage;
}

async function ensureImeiPage() {
    if (globalImeiPage) {
        try { await globalImeiPage.evaluate(() => true); return globalImeiPage; }
        catch { globalImeiPage = null; }
    }
    const browser = await ensureBrowser('imei');
    const pages = await browser.pages();
    globalImeiPage = pages.find(p => p.url().includes('ins.mcqs.az'));
    if (!globalImeiPage) {
        const blank = pages.find(p => p.url() === 'about:blank' || p.url() === '');
        globalImeiPage = blank || await browser.newPage();
    }
    if (!globalImeiPage.url().includes('ins.mcqs.az')) {
        await globalImeiPage.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'domcontentloaded' });
    }
    try { await globalImeiPage.bringToFront(); } catch {}
    return globalImeiPage;
}

// ── Scrape Job ───────────────────────────────────────────────
async function runScrapeJob(body) {
    const { fin, sv } = body;
    if (!fin || !sv) throw new Error('FIN ve SV daxil edilmelidir');
    
    let formattedSv = sv.trim();
    if (formattedSv.toUpperCase().startsWith('AZE')) formattedSv = formattedSv.slice(3);

    const page = await ensureEsocialPage();
    if (page.url().includes('mygovid.gov.az') || page.url().includes('auth')) {
        return { error: 'LOGIN_REQUIRED', message: 'Zehmet olmasa Asan Imza ile daxil olun.' };
    }

    // Modal cleaning
    await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button,.q-btn,.btn,span,div,a'));
        const close = buttons.find(el => {
            const t = (el.innerText || '').trim();
            return (t === 'Bağla' || t === 'BAĞLA' || t === 'Bağla.') && (el.offsetWidth > 0 || el.offsetHeight > 0);
        });
        if (close) close.click();
    });

    // Fill form
    await page.evaluate((finVal, svVal) => {
        const finInput = document.querySelector('input[placeholder*="FİN"]');
        const svInput  = document.querySelector('input[placeholder*="ŞV"]');
        if (finInput) { finInput.value = finVal; finInput.dispatchEvent(new Event('input', { bubbles: true })); }
        if (svInput)  { svInput.value  = svVal;  svInput.dispatchEvent(new Event('input', { bubbles: true }));  }
        
        const btn = Array.from(document.querySelectorAll('button, .q-btn')).find(el => el.innerText?.includes('Axtar'));
        if (btn) btn.click();
    }, fin, formattedSv);

    // Wait result
    await new Promise(r => setTimeout(r, 2000));
    
    const resultData = await page.evaluate(() => {
        const data = {};
        document.querySelectorAll('.q-field, .input-group, .row').forEach(container => {
            const labelEl = container.querySelector('label, .q-field__label, .text-subtitle2');
            if (!labelEl) return;
            const label = labelEl.innerText.trim().toLowerCase();
            const input = container.querySelector('input, .q-field__native');
            if (input) data[label] = input.value || input.innerText;
        });
        return data;
    });

    return { success: true, data: resultData };
}

// ── IMEI Job ─────────────────────────────────────────────────
async function runImeiJob(body) {
    const { imei } = body;
    if (!imei) throw new Error('IMEI daxil edilmeyib');

    const page = await ensureImeiPage();
    
    if (page.url().includes('LogIn')) {
        await page.type('#username', 'aziza_nasirova');
        await page.type('#password', 'leqal2025');
        await page.click('#loginbutton');
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
    }

    if (!page.url().includes('CheckImeiStatus')) {
        await page.goto('https://ins.mcqs.az/CreditApplication/Index', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 10000 });
        await page.click('li[data-url*="CheckImeiStatus"] a');
    }

    await page.waitForSelector('#getimeicode', { timeout: 10000 });
    await page.evaluate((val) => {
        const el = document.querySelector('#getimeicode');
        if (el) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, imei);

    await page.click('#checkimeistatus');
    
    try {
        await page.waitForFunction(() => {
            const el = document.querySelector('#imeiStatus b');
            return el && el.innerText.trim().length > 5;
        }, { timeout: 15000 });
    } catch {}

    const statusText = await page.$eval('#imeiStatus b', el => el.innerText.trim()).catch(() => 'RESULT_NOT_FOUND');

    return {
        imeiFee: statusText.endsWith('deaktiv olunub.'),
        message: statusText
    };
}

// ── Dispatcher ───────────────────────────────────────────────
async function handleJob(jobType, payload) {
    if (jobType === 'scrape')      return runScrapeJob(payload);
    if (jobType === 'check-imei') return runImeiJob(payload);
    throw new Error(`Namalum is tipi: \${jobType}`);
}

// ── WebSocket ────────────────────────────────────────────────
let ws = null;
let reconnectTimer = null;

function connect() {
    const wsUrl = `\${RELAY_URL}?secret=\${encodeURIComponent(AGENT_SECRET)}&label=\${encodeURIComponent(AGENT_LABEL)}`;
    console.log(`🔌 Relay servere qosulur: \${RELAY_URL}`);

    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
        console.log('✅ Relay servere qosuldu!');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
    });

    ws.on('message', async (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'job') {
            console.log(`📥 Is alindi: \${msg.jobType} [\${msg.jobId}]`);
            try {
                const result = await handleJob(msg.jobType, msg.payload);
                ws.send(JSON.stringify({ type: 'job_result', jobId: msg.jobId, result }));
            } catch (err) {
                console.error(`❌ Is xetasi [\${msg.jobId}]:`, err.message);
                ws.send(JSON.stringify({ type: 'job_result', jobId: msg.jobId, error: err.message }));
            }
        }
    });

    ws.on('close', () => {
        console.log('⚠️ Baglanti kesildi. 5s sonra yeniden cehd...');
        reconnectTimer = setTimeout(connect, 5000);
    });

    ws.on('error', (err) => console.error('WebSocket xetasi:', err.message));
}

console.log('🤖 E-SOCIAL AGENT BASLADI');
connect();
setInterval(() => {}, 1000);
