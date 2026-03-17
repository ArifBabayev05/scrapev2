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
const puppeteer                 = require('puppeteer');
const { spawn, exec }           = require('child_process');
const fs                        = require('fs');
const path                      = require('path');
const os                        = require('os');

// ── Config ───────────────────────────────────────────────────
const RELAY_URL           = (process.env.RELAY_URL    || 'ws://localhost:3000').replace(/\/$/, '');
const AGENT_SECRET        = process.env.AGENT_SECRET  || 'bot-secret-2024';
const AGENT_LABEL         = process.env.AGENT_LABEL   || require('os').hostname();
const ESOCIAL_DEBUG_PORT  = parseInt(process.env.ESOCIAL_DEBUG_PORT || '9222');
const IMEI_DEBUG_PORT     = parseInt(process.env.IMEI_DEBUG_PORT    || '9223');

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
    return path.join(home, 'AppData', 'Local', 'BotChromeProfiles');
};

const ensureDir = (dir) => {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Yazma icazəsini yoxla
        fs.accessSync(dir, fs.constants.W_OK);
        console.log('📁 Profil qovluğu hazırdır:', dir);
        return true;
    } catch (e) {
        // Kritik xəta — istifadəçinin Chrome-nun pozulmaması üçün throw et
        throw new Error(`Profil qovluğu yaradıla bilmədi: ${dir} — ${e.message}`);
    }
};

// ── Profile cleaner (YALNIZ lock faylları) ───────────────────
// LOCAL STATE VƏ PREFERENCES SİLİNMƏMƏLİDİR —
// onlar sessiyaları, Asan İmza loginini, cookie-ləri saxlayır.
const cleanSingletonFiles = (profilePath) => {
    ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']
        .forEach(f => {
            try { fs.unlinkSync(path.join(profilePath, f)); } catch {}
        });
};

// ── connectOrLaunchEdge ────────────────────────────────────
// Variant A — PowerShell Start-Process (GUI pencere garantiyası)
// Fallback — cmd /c start (nəticə eynidər, bir az fərqli məntiq)
async function connectOrLaunchEdge({ executablePath, userDataDir, startUrl, debugPort, profilePath }) {
    // Adım 1: Mövcud Edge instansına qoşulmağa cəhd et
    try {
        console.log(`🔌 Mövcud Edge-ə qoşulur (port ${debugPort})...`);
        const browser = await puppeteer.connect({
            browserURL: `http://localhost:${debugPort}`,
            defaultViewport: null,
        });
        console.log(`✅ Mövcud Edge-ə qoşuldu (port ${debugPort})`);
        return browser;
    } catch {
        console.log(`ℹ️ Port ${debugPort}-də Edge tapılmadı, yeni instans açılır...`);
    }

    // Adım 2: Stale lock faylları təmizlə
    cleanSingletonFiles(profilePath);

    // Adım 3: Edge-i PowerShell Start-Process ilə aç (en etibaerlı Windows yolu)
    const edgeArgs = [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--start-maximized',
        startUrl,
    ];

    // Variant A: PowerShell Start-Process — Session-a bağlı, tam görünən pencərə
    await launchViaPowerShell(executablePath, edgeArgs, debugPort);

    // Adım 4: Edge debug portunu açıb hazır olanadek gözlə (max 40s)
    console.log('⏳ Edge-in debug portunu açması gözlənilir...');
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const browser = await puppeteer.connect({
                browserURL: `http://localhost:${debugPort}`,
                defaultViewport: null,
            });
            console.log(`✅ Edge hazırdır və qoşuldu (port ${debugPort})`);
            return browser;
        } catch {
            console.log(`⏳ Gözlənilir... (${i + 1}/20)`);
        }
    }
    throw new Error(`Edge port ${debugPort} 40 saniyə ərzində hazır olmadı`);
}

// PowerShell Start-Process köməkçi
// Windows-da GUI pencərəsi açmağın ən etibaerlı yolu budur.
async function launchViaPowerShell(executablePath, args, debugPort) {
    // Bat faylı temp qovluğunda yarat — arg quoting problemini həll edir
    const batPath = path.join(os.tmpdir(), `bot_edge_${debugPort}.bat`);
    const quotedArgs = args.map(a =>
        (a.startsWith('http') || a.includes('&') || a.includes(' '))
            ? `"${a}"`
            : a
    ).join(' ');

    // .bat fərdi: start "" = yeni, müstəqil, görünən pencərə
    const batContent = `@echo off\r\nstart "" "${executablePath}" ${quotedArgs}\r\n`;
    fs.writeFileSync(batPath, batContent, 'latin1');

    await new Promise((resolve, reject) => {
        // PowerShell vasitəsilə .bat faylını işlət
        exec(`powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c \"${batPath.replace(/"/g, '\\"')}\"' -WindowStyle Hidden"`,
            (err) => {
                if (err) {
                    // PowerShell uğursuz olarsa cmd ilə birbaşa cəhd et
                    console.log('⚠️ PowerShell cəhdi uğursuz, cmd ilə birbaşa cəhd...');
                    exec(`cmd /c ""${batPath}""`, () => resolve());
                } else {
                    resolve();
                }
            }
        );
    });

    // Bat faylını 10s sonra təmizlə
    setTimeout(() => { try { fs.unlinkSync(batPath); } catch {} }, 10_000);
    console.log(`🚀 Edge başladılma köməndə verildi (port ${debugPort})`);
}


let globalBrowser    = null;
let globalEsocialPage = null;   // E-Social üçün sabit tab
let isLaunching      = false;
let imeiBrowser      = null;
let globalImeiPage   = null;    // IMEI üçün sabit tab
let isImeiLaunching  = false;


// ── E-Social Browser ─────────────────────────────────────────
// Brauzer + persistent tab qaytarır.
// Tab yalnız 1 dəfə açılır; sonrakı çağırışlar mövcud tab-ı istifadə edir.
async function ensureEsocialPage() {
    // Mövcud page-i yoxla
    if (globalEsocialPage) {
        try {
            await globalEsocialPage.evaluate(() => document.title); // crash test
            return globalEsocialPage;
        } catch {
            console.log('⚠️ [E-Social] Köhnə tab bağlanıb, yenisi açılır...');
            globalEsocialPage = null;
            globalBrowser     = null;
        }
    }

    // Browser yoxlanışı
    if (globalBrowser) {
        try { await globalBrowser.version(); }
        catch { globalBrowser = null; }
    }

    if (isLaunching) {
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            if (globalEsocialPage) return globalEsocialPage;
        }
        return null;
    }

    isLaunching = true;
    try {
        const targetUrl = 'https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1';

        if (!globalBrowser) {
            const executablePath = getChromePath();
            if (!executablePath) throw new Error('Edge/Chrome tapılmadı. Zəhmət olmasa Microsoft Edge quraşdırın.');

            const userDataDir = path.join(getBaseDir(), 'esocial_profile');
            ensureDir(userDataDir);

            globalBrowser = await connectOrLaunchEdge({
                executablePath,
                userDataDir,
                startUrl   : targetUrl,
                debugPort  : ESOCIAL_DEBUG_PORT,
                profilePath: userDataDir,
            });
        }

        // İlk tab-ı götür (brauzer targetUrl ilə açılır)
        const pages = await globalBrowser.pages();
        globalEsocialPage = pages[0];

        if (globalEsocialPage) {
            await globalEsocialPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            if (globalEsocialPage.url() === 'about:blank' || globalEsocialPage.url() === '') {
                await globalEsocialPage.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            }
        }

        // Tab bağlananda referansı sıfırla
        globalEsocialPage.on('close', () => {
            console.log('⚠️ [E-Social] Tab bağlandı — növbəti sorğuda yenidən açılacaq');
            globalEsocialPage = null;
        });

        console.log('✅ [E-Social] Tab hazırdır:', globalEsocialPage.url());
        return globalEsocialPage;
    } catch (err) {
        console.error('❌ [E-Social] Tab açma xətası:', err.message);
        globalEsocialPage = null;
        globalBrowser = null;
        return null;
    } finally {
        isLaunching = false;
    }
}

// ── IMEI Browser ─────────────────────────────────────────────
// Brauzer + persistent tab qaytarır.
// Tab yalnız 1 dəfə açılır; sonrakı çağırışlar mövcud tab-ı istifadə edir.
async function ensureImeiPage() {
    // Mövcud page-i yoxla
    if (globalImeiPage) {
        try {
            await globalImeiPage.evaluate(() => document.title); // crash test
            return globalImeiPage;
        } catch {
            console.log('⚠️ [IMEI] Köhnə tab bağlanıb, yenisi açılır...');
            globalImeiPage = null;
            imeiBrowser    = null;
        }
    }

    // Browser yoxlanışı
    if (imeiBrowser) {
        try { await imeiBrowser.version(); }
        catch { imeiBrowser = null; }
    }

    if (isImeiLaunching) {
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            if (globalImeiPage) return globalImeiPage;
        }
        return null;
    }

    isImeiLaunching = true;
    try {
        if (!imeiBrowser) {
            const executablePath = getChromePath();
            if (!executablePath) throw new Error('Edge/Chrome tapılmadı. Zəhmət olmasa Microsoft Edge quraşdırın.');

            const userDataDir = path.join(getBaseDir(), 'imei_profile');
            ensureDir(userDataDir);

            imeiBrowser = await connectOrLaunchEdge({
                executablePath,
                userDataDir,
                startUrl   : 'https://ins.mcqs.az/User/LogIn',
                debugPort  : IMEI_DEBUG_PORT,
                profilePath: userDataDir,
            });
        }

        // İlk tab-ı götür (brauzer Login URL ilə açılır)
        const pages = await imeiBrowser.pages();
        globalImeiPage = pages[0];

        if (globalImeiPage) {
            await globalImeiPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            if (globalImeiPage.url() === 'about:blank' || globalImeiPage.url() === '') {
                await globalImeiPage.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'networkidle2', timeout: 60000 });
            }
        }

        // Tab bağlananda referansı sıfırla
        globalImeiPage.on('close', () => {
            console.log('⚠️ [IMEI] Tab bağlandı — növbəti sorğuda yenidən açılacaq');
            globalImeiPage = null;
        });

        console.log('✅ [IMEI] Tab hazırdır:', globalImeiPage.url());
        return globalImeiPage;
    } catch (err) {
        console.error('❌ [IMEI] Tab açma xətası:', err.message);
        globalImeiPage = null;
        imeiBrowser    = null;
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
