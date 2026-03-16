'use strict';

// ============================================================
// LOCAL AGENT — İstifadəçinin öz kompüterində işləyir
// Relay serverə WebSocket ilə qoşulur,
// gələn işləri Puppeteer ilə icra edir.
// ============================================================

// .env dəstəyi (əgər dotenv quraşdırılıbsa)
try { require('dotenv').config(); } catch {}

process.on('uncaughtException',  (err) => console.error('CRITICAL ERROR:', err));
process.on('unhandledRejection', (err) => console.error('UNHANDLED PROMISE:', err));

const { WebSocket } = require('ws');
const puppeteer     = require('puppeteer');
const fs            = require('fs');
const path          = require('path');

// ── Config ───────────────────────────────────────────────────
const RELAY_URL    = (process.env.RELAY_URL    || 'ws://localhost:3000').replace(/\/$/, '');
const AGENT_SECRET = process.env.AGENT_SECRET  || 'bot-secret-2024';
const AGENT_LABEL  = process.env.AGENT_LABEL   || require('os').hostname();

// ── Chrome path ──────────────────────────────────────────────
const getChromePath = () => {
    const home  = require('os').homedir();
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) { console.log('✅ Chrome tapıldı:', p); return p; }
    }
    return null;
};

// ── Base dir ─────────────────────────────────────────────────
const getBaseDir = () => 'C:\\bot';

const ensureDir = (dir) => {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return true;
    } catch (e) {
        console.error('⚠️ Qovluq yaradıla bilmədi:', dir, e.message);
        return false;
    }
};

// ── Profile cleaner ──────────────────────────────────────────
const cleanProfileCorruptFiles = (profilePath) => {
    const files = [
        'Local State', 'DevToolsActivePort',
        path.join('Default', 'Preferences'),
        'SingletonLock', 'SingletonSocket', 'SingletonCookie'
    ];
    files.forEach(f => {
        try { fs.unlinkSync(path.join(profilePath, f)); } catch {}
    });
};

// ── Browser instances ────────────────────────────────────────
let globalBrowser  = null;
let isLaunching    = false;
let imeiBrowser    = null;
let isImeiLaunching = false;


// ── E-Social Browser ─────────────────────────────────────────
async function ensureBrowser() {
    if (globalBrowser) {
        try { await globalBrowser.version(); return globalBrowser; }
        catch { globalBrowser = null; }
    }
    if (isLaunching) {
        // Poll until ready
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            if (globalBrowser) return globalBrowser;
        }
        return null;
    }

    isLaunching = true;
    try {
        const chromePath = getChromePath();
        if (!chromePath) throw new Error('Chrome tapılmadı. Google Chrome quraşdırın.');

        const profilePath = path.join(getBaseDir(), 'bot_profile');
        ensureDir(profilePath);
        // Yalnız singleton lock fayllarını sil (mövcud Chrome sesiyalarına toxunma)
        cleanProfileCorruptFiles(profilePath);

        const targetUrl = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';

        globalBrowser = await puppeteer.launch({
            headless: false,
            executablePath: chromePath,
            defaultViewport: null,
            pipe: false,
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--test-type',
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-infobars',
                '--disable-features=TranslateUI',
                targetUrl
            ],
            userDataDir: profilePath
        });

        const pages = await globalBrowser.pages();
        const page  = pages[0];
        if (page) {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            if (page.url() === 'about:blank' || page.url() === '') {
                await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            }
        }
        console.log('✅ [E-Social] Brauzer hazırdır:', (page?.url() || 'N/A'));
        return globalBrowser;
    } catch (err) {
        console.error('❌ [E-Social] Brauzer başlatma xətası:', err.message);
        globalBrowser = null;
        return null;
    } finally {
        isLaunching = false;
    }
}

// ── IMEI Browser ─────────────────────────────────────────────
async function ensureImeiBrowser() {
    if (imeiBrowser) {
        try { await imeiBrowser.version(); return imeiBrowser; }
        catch { imeiBrowser = null; }
    }
    if (isImeiLaunching) {
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            if (imeiBrowser) return imeiBrowser;
        }
        return null;
    }

    isImeiLaunching = true;
    try {
        const chromePath = getChromePath();
        if (!chromePath) throw new Error('Chrome tapılmadı. Google Chrome quraşdırın.');

        const profilePath = path.join(getBaseDir(), 'imei_profile');
        ensureDir(profilePath);
        cleanProfileCorruptFiles(profilePath);

        imeiBrowser = await puppeteer.launch({
            headless: false,
            executablePath: chromePath,
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--test-type',
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-infobars',
                '--disable-features=TranslateUI',
                '--password-store=basic',
                '--use-mock-keychain',
                'https://ins.mcqs.az/User/LogIn'
            ],
            userDataDir: profilePath
        });

        const pages = await imeiBrowser.pages();
        const page  = pages[0];
        if (page) {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            if (page.url() === 'about:blank' || page.url() === '') {
                await page.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'networkidle2', timeout: 60000 });
            }
        }
        console.log('✅ [IMEI] Brauzer hazırdır:', (page?.url() || 'N/A'));
        return imeiBrowser;
    } catch (err) {
        console.error('❌ [IMEI] Brauzer başlatma xətası:', err.message);
        imeiBrowser = null;
        return null;
    } finally {
        isImeiLaunching = false;
    }
}

// ── Scrape Job ───────────────────────────────────────────────
async function runScrapeJob(body) {
    let { fin, sv } = body;
    if (!fin || !sv) throw new Error('FİN və ŞV nömrəsi daxil edilməlidir');

    let formattedSv = sv.trim();
    if (formattedSv.toUpperCase().startsWith('AZE')) formattedSv = formattedSv.slice(3);

    const browser = await ensureBrowser();
    if (!browser) throw new Error('Brauzer başladıla bilmədi');

    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('e-social.gov.az')) || pages[0];

    const url = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';
    const cur = page.url();
    if (cur === 'about:blank' || cur === '' || !cur.includes('AppEmploymentContractOnline')) {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    }

    if (page.url().includes('mygovid.gov.az') || page.url().includes('auth')) {
        return { error: 'LOGIN_REQUIRED', message: 'Zəhmət olmasa Asan İmza ilə daxil olun.' };
    }

    const clearModals = async () => {
        try {
            await page.evaluate(() => {
                const buttons  = Array.from(document.querySelectorAll('button,.q-btn,.btn,span,div,a'));
                const closeBtn = buttons.find(el => {
                    const t = (el.innerText || '').trim();
                    return (t === 'Bağla' || t === 'BAĞLA' || t === 'Bağla.') &&
                           (el.offsetWidth > 0 || el.offsetHeight > 0);
                });
                if (closeBtn) ['mousedown','click','mouseup'].forEach(ev =>
                    closeBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
                );
                ['.modal','.popup','.dialog','.q-dialog','.q-notification',
                 '.modal-backdrop','.overlay','.mask','.ui-widget-overlay',
                 '.v-modal','.v-overlay'].forEach(sel =>
                    document.querySelectorAll(sel).forEach(el => {
                        if (el.innerText?.includes('Bağla')) el.remove();
                    })
                );
                document.body.style.overflow = 'auto';
            });
        } catch {}
    };

    await clearModals();
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
        const table = document.querySelector('#documentListTable') || document.querySelector('table');
        const row   = table?.querySelector('tbody tr');
        if (row) {
            row.scrollIntoView();
            ['mousedown','click','mouseup'].forEach(ev =>
                row.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window, buttons: 1 }))
            );
        }
    });
    await new Promise(r => setTimeout(r, 2000));
    await clearModals();

    await page.evaluate((finVal, svVal) => {
        const finInput = document.querySelector('input[placeholder*="FİN"]') ||
                         document.querySelector('input[placeholder*="fin"]');
        const svInput  = document.querySelector('input[placeholder*="ŞV"]') ||
                         document.querySelector('input[placeholder*="nömrəsi"]');

        const fillInput = (el, val) => {
            if (!el) return;
            if (el.disabled) el.disabled = false;
            el.focus(); el.value = val;
            ['input','change','blur'].forEach(ev =>
                el.dispatchEvent(new Event(ev, { bubbles: true }))
            );
        };
        fillInput(finInput, finVal);
        fillInput(svInput, svVal);

        const btn = (() => {
            if (svInput) {
                const p = svInput.closest('.input-group') || svInput.parentElement;
                const b = p?.querySelector('button,.q-btn,i.q-icon,.btn');
                if (b) return b;
            }
            return Array.from(document.querySelectorAll('button,.q-btn,.btn')).find(b => {
                const s = window.getComputedStyle(b);
                return s.backgroundColor.includes('rgb(0, 51, 153)') ||
                       s.backgroundColor.includes('rgb(0, 41, 114)') ||
                       s.backgroundColor.includes('rgb(2, 123, 227)') ||
                       b.innerHTML.includes('search') || b.querySelector('i');
            });
        })();

        if (btn) ['mousedown','click','mouseup'].forEach(ev =>
            btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
        );
    }, fin, formattedSv);

    await new Promise(r => setTimeout(r, 5000));

    const resultData = await page.evaluate(() => {
        const data       = {};
        const cleanText  = t => t.trim().toLowerCase().replace(/:$/, '').trim();

        document.querySelectorAll('.form-group,.q-field,div.row>div').forEach(container => {
            const labelEl = container.querySelector('label,.q-field__label');
            if (!labelEl) return;
            const label = cleanText(labelEl.innerText);
            if (!label || label.length > 50) return;
            let value = '';

            const input = container.querySelector('input,select,textarea');
            if (input) value = input.value || '';
            if (!value) { const v = container.querySelector('.vs__selected,.vs__selected-options'); if (v) value = v.innerText; }
            if (!value) { const v = container.querySelector('.mx-input');               if (v) value = v.value; }
            if (!value) { const v = container.querySelector('.q-field__native,.q-field__control-container'); if (v) value = v.innerText; }
            if (value && value.trim() !== '...' && value.trim() !== '') data[label] = value.trim();
        });

        document.querySelectorAll('input').forEach(input => {
            const val = input.value;
            if (!val) return;
            let label = '';
            if (input.placeholder) label = cleanText(input.placeholder);
            if (!label && input.id) {
                const l = document.querySelector(`label[for="${input.id}"]`);
                if (l) label = cleanText(l.innerText);
            }
            if (label && val && !data[label]) data[label] = val.trim();
        });

        return data;
    });

    return {
        success  : true,
        data     : resultData,
        gender   : resultData['cinsi'] || resultData['cins'] || '',
        birthDate: resultData['doğum tarixi'] || resultData['doğum'] || ''
    };
}

// ── IMEI Job ─────────────────────────────────────────────────
async function runImeiJob(body) {
    const { imei } = body;
    if (!imei) throw new Error('IMEI daxil edilməyib');

    const b = await ensureImeiBrowser();
    if (!b) throw new Error('IMEI brauzeri açmaq mümkün olmadı');

    const pages = await b.pages();
    let page = pages.find(p => p.url().includes('ins.mcqs.az')) || null;
    if (!page) page = await b.newPage();
    await page.setDefaultNavigationTimeout(90000);

    const cur = page.url();
    if (!cur.includes('ins.mcqs.az') || cur.includes('LogIn') || cur === 'about:blank') {
        await page.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'networkidle2' });
        const isLogin = await page.$('#username');
        if (isLogin) {
            await page.type('#username', 'aziza_nasirova');
            await page.type('#password', 'leqal2025');
            await page.click('#loginbutton');
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
            if (await page.$('#username')) throw new Error('Login uğursuz oldu');
        }
    }

    if (!page.url().includes('CreditApplication/Index') && !page.url().includes('CheckImeiStatus')) {
        await page.goto('https://ins.mcqs.az/CreditApplication/Index', { waitUntil: 'networkidle2' });
    }

    await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 10000 });
    await page.click('li[data-url*="CheckImeiStatus"] a');
    await new Promise(r => setTimeout(r, 1000));

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

    return {
        imeiFee: statusText.endsWith('deaktiv olunub.'),
        message: statusText
    };
}

// ── Job dispatcher ───────────────────────────────────────────
async function handleJob(jobType, payload) {
    if (jobType === 'scrape')      return runScrapeJob(payload);
    if (jobType === 'check-imei') return runImeiJob(payload);
    throw new Error(`Naməlum iş tipi: ${jobType}`);
}

// ── WebSocket Client ─────────────────────────────────────────
let ws             = null;
let reconnectTimer = null;
let pingInterval   = null;

function connect() {
    const wsUrl = `${RELAY_URL}?secret=${encodeURIComponent(AGENT_SECRET)}&label=${encodeURIComponent(AGENT_LABEL)}`;
    console.log(`🔌 Relay serverə qoşulur: ${RELAY_URL} (agent: ${AGENT_LABEL})`);

    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
        console.log('✅ Relay serverə qoşuldu!');
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

        // Heartbeat
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
            }
        }, 30_000);
    });

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'job') {
            console.log(`📥 İş alındı: ${msg.jobType} [${msg.jobId}]`);
            try {
                const result = await handleJob(msg.jobType, msg.payload);
                safeSend({ type: 'job_result', jobId: msg.jobId, result });
            } catch (err) {
                console.error(`❌ İş xətası [${msg.jobId}]:`, err.message);
                safeSend({ type: 'job_result', jobId: msg.jobId, error: err.message });
            }
        }
    });

    ws.on('close', (code, reason) => {
        clearInterval(pingInterval);
        console.log(`⚠️ Bağlantı kəsildi (${code}). 5s sonra yenidən cəhd...`);
        reconnectTimer = setTimeout(connect, 5_000);
    });

    ws.on('error', (err) => {
        console.error('WebSocket xətası:', err.message);
    });
}

function safeSend(obj) {
    try {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    } catch (e) {
        console.error('Göndərmə xətası:', e.message);
    }
}

// ── Start ─────────────────────────────────────────────────────
console.log(`
***************************************************
🤖 E-SOCIAL LOCAL AGENT BAŞLADI
🔗 Relay: ${RELAY_URL}
👤 Label: ${AGENT_LABEL}
***************************************************
`);

connect();
setInterval(() => {}, 1000); // Keep alive
