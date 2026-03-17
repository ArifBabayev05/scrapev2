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

const { WebSocket }             = require('ws');
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }
const fs                        = require('fs');
const path                      = require('path');
const os                        = require('os');

// ── Config ───────────────────────────────────────────────────
const RELAY_URL           = (process.env.RELAY_URL    || 'ws://localhost:3000').replace(/\/$/, '');
const AGENT_SECRET        = process.env.AGENT_SECRET  || 'bot-secret-2024';
const AGENT_LABEL         = process.env.AGENT_LABEL   || require('os').hostname();
const DEBUG_PORT          = parseInt(process.env.DEBUG_PORT || '9222');

// ── Chrome path ──────────────────────────────────────────────
// Edge — Windows 10/11-də həmişə quraşdırılmış gəlir.
// Chrome — Edge tapılmasa fallback kimi.
// Sabit yol yazmaq əvəzinə Windows mühit dəyişənlərindən istifadə edirik —
// disk hərfi (C:\ deyil D:\) fərqli olan sistemlərdə də işləyir.
const getChromePath = () => {
    const home    = require('os').homedir();
    const pf86    = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const pf64    = process.env['ProgramFiles']       || 'C:\\Program Files';
    const appdata = process.env['LOCALAPPDATA']       || path.join(home, 'AppData', 'Local');

    const candidates = [
        // ── Microsoft Edge (priority — Windows-da default quraşdırılır) ──
        path.join(pf86,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf64,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(appdata, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),

        // ── Google Chrome (fallback — əgər Edge tapılmasa) ──
        path.join(pf64,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf86,    'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(appdata, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            const name = p.toLowerCase().includes('msedge') ? '🟦 Edge' : '🟡 Chrome';
            console.log(`✅ ${name} tapıldı: ${p}`);
            return p;
        }
    }
    console.error('❌ Nə Edge, nə də Chrome tapıldı! Yollar yoxlanılmış:', candidates);
    return null;
};



// ── Base dir ─────────────────────────────────────────────────
// AppData\Local — admin icazəsi lazım deyil, həmişə yazıla bilir.
// C:\bot admin icazəsi tələb edə bilər; ensureDir fail edərsə
// Chrome default profili (istifadəçinin açıq Chrome-u) istifadə edir!
const getBaseDir = () => {
    const home = require('os').homedir();
    return path.join(home, 'AppData', 'Local', 'ESocialBot'); // Bot qovluğunda saxla
};

// ── Single Instance Lock ─────────────────────────────────────
const lockFile = path.join(getBaseDir(), 'agent.lock');
const checkSingleInstance = () => {
    if (!fs.existsSync(getBaseDir())) fs.mkdirSync(getBaseDir(), { recursive: true });
    if (fs.existsSync(lockFile)) {
        try {
            const pid = parseInt(fs.readFileSync(lockFile, 'utf8'));
            process.kill(pid, 0); // PID varmı yoxla
            console.error(`⚠️ Agenti artıq başqa bir pəncərədə işləyir (PID: ${pid}). Bu instansiya bağlanır.`);
            process.exit(0);
        } catch {
            fs.unlinkSync(lockFile); // Köhnə pid ölüdürsə faylı sil
        }
    }
    fs.writeFileSync(lockFile, process.pid.toString());
    process.on('exit', () => { try { fs.unlinkSync(lockFile); } catch {} });
};
checkSingleInstance();

const ensureDir = (dir) => {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
    } catch (e) {
        throw new Error(`Profil qovluğu yaradıla bilmədi: ${dir} — ${e.message}`);
    }
};

// ── Profile cleaner (YALNIZ lock faylları) ───────────────────
const cleanSingletonFiles = (profilePath) => {
    ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']
        .forEach(f => {
            try { fs.unlinkSync(path.join(profilePath, f)); } catch {}
        });
};

// ═══════════════════════════════════════════════════════════════
// BRAUZER İDARƏETMƏSİ — Yalnız 1 Edge pəncərəsi, 2 tab
// ═══════════════════════════════════════════════════════════════

let globalBrowser      = null;   // Tək brauzer instansiyası
let globalEsocialPage  = null;   // E-Social üçün sabit tab
let globalImeiPage     = null;   // IMEI üçün sabit tab
let isLaunching        = false;
let _esocialCloseRegistered = false;
let _imeiCloseRegistered    = false;

// ── ensureBrowser ────────────────────────────────────────────
// HEÇ VAXT yeni Edge açmır əgər artıq birisi varsa.
async function ensureBrowser() {
    // Başqa bir çağırış artıq brauzer açırsa, gözlə
    if (isLaunching) {
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (globalBrowser) return globalBrowser;
        }
        throw new Error('Brauzer açılması timeout oldu');
    }

    // 1. Mövcud bağlantı işləyir?
    if (globalBrowser) {
        try {
            await globalBrowser.version();
            return globalBrowser;
        } catch {
            console.log('⚠️ Brauzer bağlantısı kəsilib...');
            globalBrowser = null;
            globalEsocialPage = null;
            globalImeiPage = null;
            _esocialCloseRegistered = false;
            _imeiCloseRegistered = false;
        }
    }

    isLaunching = true;
    try {
        // 2. Bəlkə Edge hələ açıqdır (agent restart halı) — qoşulmağa çalış
        try {
            console.log(`🔌 Port ${DEBUG_PORT}-ə qoşulur...`);
            globalBrowser = await puppeteer.connect({
                browserURL: `http://localhost:${DEBUG_PORT}`,
                defaultViewport: null,
            });
            console.log('✅ Mövcud Edge-ə qoşuldu');
            _setupDisconnectHandler();
            return globalBrowser;
        } catch {
            console.log('ℹ️ Port boşdur, yeni Edge açılır...');
        }

        // 3. Yeni Edge — YALNIZ heç bir mövcud Edge yoxdursa
        const executablePath = getChromePath();
        if (!executablePath) throw new Error('Edge/Chrome tapılmadı');
        const userDataDir = path.join(getBaseDir(), 'bot_profile');
        ensureDir(userDataDir);
        cleanSingletonFiles(userDataDir);

        globalBrowser = await puppeteer.launch({
            executablePath,
            headless: false,
            defaultViewport: null,
            userDataDir,
            args: [
                `--remote-debugging-port=${DEBUG_PORT}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--start-maximized',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        console.log('✅ Yeni Edge açıldı');
        _setupDisconnectHandler();
        return globalBrowser;
    } finally {
        isLaunching = false;
    }
}

// Brauzer bağlantısı kəsiləndə düzgün təmizlə
function _setupDisconnectHandler() {
    if (!globalBrowser) return;
    globalBrowser.on('disconnected', () => {
        console.log('⚠️ Edge bağlantısı kəsildi (pəncərə bağlandı?)');
        globalBrowser = null;
        globalEsocialPage = null;
        globalImeiPage = null;
        _esocialCloseRegistered = false;
        _imeiCloseRegistered = false;
    });
}

// Art botları təmizlə — yalnız E-Social və IMEI tablarını saxla
async function _cleanExtraTabs(browser) {
    try {
        const pages = await browser.pages();
        for (const p of pages) {
            if (p === globalEsocialPage || p === globalImeiPage) continue;
            const url = p.url();
            if (url.includes('e-social.gov.az') || url.includes('ins.mcqs.az') ||
                url.includes('mygovid.gov.az') || url.includes('auth')) continue;
            try { await p.close(); } catch {}
        }
    } catch {}
}

// ── ensureEsocialPage ────────────────────────────────────────
async function ensureEsocialPage() {
    // Mövcud tab işləyirsə, onu qaytar
    if (globalEsocialPage) {
        try {
            await globalEsocialPage.evaluate(() => true);
            return globalEsocialPage;
        } catch {
            globalEsocialPage = null;
            _esocialCloseRegistered = false;
        }
    }

    const browser = await ensureBrowser();
    const targetUrl = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';

    // Mövcud tablardan tap
    const pages = await browser.pages();
    globalEsocialPage = pages.find(p => p.url().includes('e-social.gov.az'));

    if (!globalEsocialPage) {
        // Boş tab varsa onu istifadə et, yoxsa yenisini aç
        const blank = pages.find(p => p !== globalImeiPage && (p.url() === 'about:blank' || p.url() === ''));
        globalEsocialPage = blank || await browser.newPage();
    }

    await _cleanExtraTabs(browser);

    // Lazım olsa navigate et
    const curUrl = globalEsocialPage.url();
    if (!curUrl.includes('e-social.gov.az')) {
        console.log('🔄 [E-Social] Tab yönləndirilir...');
        await globalEsocialPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // Close handler — yalnız 1 dəfə
    if (!_esocialCloseRegistered) {
        globalEsocialPage.on('close', () => {
            globalEsocialPage = null;
            _esocialCloseRegistered = false;
        });
        _esocialCloseRegistered = true;
    }

    try { await globalEsocialPage.bringToFront(); } catch {}
    return globalEsocialPage;
}

// ── ensureImeiPage ───────────────────────────────────────────
async function ensureImeiPage() {
    // Mövcud tab işləyirsə, onu qaytar
    if (globalImeiPage) {
        try {
            await globalImeiPage.evaluate(() => true);
            return globalImeiPage;
        } catch {
            globalImeiPage = null;
            _imeiCloseRegistered = false;
        }
    }

    const browser = await ensureBrowser();

    // Mövcud tablardan tap
    const pages = await browser.pages();
    globalImeiPage = pages.find(p => p.url().includes('ins.mcqs.az'));

    if (!globalImeiPage) {
        const blank = pages.find(p => p !== globalEsocialPage && (p.url() === 'about:blank' || p.url() === ''));
        globalImeiPage = blank || await browser.newPage();
    }

    await _cleanExtraTabs(browser);

    // Lazım olsa navigate et
    const curUrl = globalImeiPage.url();
    if (!curUrl.includes('ins.mcqs.az')) {
        console.log('🔄 [IMEI] Tab yönləndirilir...');
        await globalImeiPage.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // Close handler — yalnız 1 dəfə
    if (!_imeiCloseRegistered) {
        globalImeiPage.on('close', () => {
            globalImeiPage = null;
            _imeiCloseRegistered = false;
        });
        _imeiCloseRegistered = true;
    }

    try { await globalImeiPage.bringToFront(); } catch {}
    return globalImeiPage;
}

// ── Scrape Job ───────────────────────────────────────────────
async function runScrapeJob(body) {
    let { fin, sv } = body;
    if (!fin || !sv) throw new Error('FİN və ŞV nömrəsi daxil edilməlidir');

    let formattedSv = sv.trim();
    if (formattedSv.toUpperCase().startsWith('AZE')) formattedSv = formattedSv.slice(3);

    // Persistent tab — yalnız 1 dəfə açılır
    const page = await ensureEsocialPage();
    if (!page) throw new Error('E-Social tab açıla bilmədi');

    const url = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';
    const cur = page.url();
    if (cur === 'about:blank' || cur === '' || !cur.includes('AppEmploymentContractOnline')) {
        console.log('🔄 [E-Social] Səhifəyə yönləndirilir...');
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

    // Persistent tab — yalnız 1 dəfə açılır
    const page = await ensureImeiPage();
    if (!page) throw new Error('IMEI tab açıla bilmədi');
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

    // Əgər artıq IMEI yoxlama səhifəsindəyiksə (form görünürsə), təkrar klikləmə
    const isAlreadyOnCheck = await page.$('#getimeicode');
    if (!isAlreadyOnCheck) {
        console.log('🔄 [IMEI] Yoxlama bölməsinə keçilir...');
        await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 15000 });
        await page.click('li[data-url*="CheckImeiStatus"] a');
    }

    // Input-un hazır olmasını gözlə və dərhal yaz (typing-dən sürətlidir)
    await page.waitForSelector('#getimeicode', { timeout: 10000 });
    await page.evaluate((val) => {
        const el = document.querySelector('#getimeicode');
        if (el) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, imei);

    // Axtarış düyməsi
    await page.click('#checkimeistatus');

    // Nəticənin gəlməsini monitor et (timeout-suz, dərhal)
    console.log('⏳ [IMEI] Nəticə gözlənilir...');
    let statusText = '';
    try {
        await page.waitForFunction(() => {
            const el = document.querySelector('#imeiStatus b');
            return el && el.innerText.trim().length > 5;
        }, { timeout: 15000 });
        statusText = await page.$eval('#imeiStatus b', el => el.innerText.trim());
    } catch (e) {
        console.log('⚠️ [IMEI] Nəticə vaxtında gəlmədi, son cəhd...');
        statusText = await page.$eval('#imeiStatus b', el => el.innerText.trim()).catch(() => '');
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

        // ══ Əvvəlcədən brauzerləri başlat ══
        // Relay-ə qoşulduqdan 3 saniyə sonra hər iki Chrome-u aç.
        // Bu səbəbdən ilk API sorğusu gələndə artıq hazır olur,
        // soyuq başlatma mövcud Chrome pencərələrinə toxunmur.
        setTimeout(() => {
            console.log('🔄 Brauzerlər əvvəlcədən başladılır...');
            ensureEsocialPage()
                .then(p => p
                    ? console.log('✅ [E-Social] Brauzer hazırdır — ilk API sorğusu anında cavablanacaq')
                    : console.log('⚠️ [E-Social] Brauzer hazırlanırken problem oldu')
                )
                .catch(e => console.error('❌ [E-Social] ƍn-başlatma xətası:', e.message));

            // IMEI brauzeri 5 saniyə sonra başlat (eyni anda 2 Chrome açılmasın)
            setTimeout(() => {
                ensureImeiPage()
                    .then(p => p
                        ? console.log('✅ [IMEI] Brauzer hazırdır — ilk API sorğusu anında cavablanacaq')
                        : console.log('⚠️ [IMEI] Brauzer hazırlanırken problem oldu')
                    )
                    .catch(e => console.error('❌ [IMEI] ƍn-başlatma xətası:', e.message));
            }, 5000); // E-Social-dan 5s sonra
        }, 3000); // Relay-ə qoşulduqdan 3s sonra
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
