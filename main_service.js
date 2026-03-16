// Global error handling
process.on('uncaughtException', (err) => {
    console.error('\x1b[31m%s\x1b[0m', 'CRITICAL ERROR:');
    console.error(err);
});

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 4000;

// Helper to find local Chrome (system + user-level installs)
const getChromePath = () => {
    const homedir = require('os').homedir();
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(homedir, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) {
            console.log('✅ Chrome tapıldı:', p);
            return p;
        }
    }
    return null;
};

// EXE-nin yanında deyil, C:\bot\ qovluğunu istifadə edirik (bütün userlərdə mövcuddur)
const getBaseDir = () => {
    return 'C:\\bot';
};

// Qovluğun mövcud olduğundan əmin ol
const ensureDir = (dirPath) => {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return true;
    } catch (err) {
        console.error('⚠️ Qovluq yaradıla bilmədi:', dirPath, err.message);
        return false;
    }
};

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Path logging
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url}`);
    next();
});

// ================================
// LEGALBOT PROTOCOL HANDLER FIX
// ================================

console.log("------------------------------------------------");
console.log("🚀 LegalBot Service Starting...");
console.log("Executable:", process.execPath);
console.log("Arguments:", process.argv);
console.log("------------------------------------------------");

// protocol URL tutulur
let protocolUrl = null;

if (process.argv.length > 2) {
    protocolUrl = process.argv[2];

    if (protocolUrl && protocolUrl.startsWith("legalbot://")) {
        console.log("🔗 Protocol ilə açıldı:", protocolUrl);
    }
}

// Process crash etməsin
process.on("uncaughtException", (err) => {
    console.error("CRITICAL ERROR:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("UNHANDLED PROMISE:", err);
});

// Node process bağlanmasın
setInterval(() => { }, 1000);

// ============================================
// Profil qovluğunu təmizlə (korrupt faylları sil)
// about:blank-da ilişib qalma problemini həll edir
// ============================================
const cleanProfileCorruptFiles = (profilePath) => {
    const filesToClean = [
        'Local State',
        'DevToolsActivePort',
        path.join('Default', 'Preferences'),
        'SingletonLock',
        'SingletonSocket',
        'SingletonCookie'
    ];

    filesToClean.forEach(file => {
        const fullPath = path.join(profilePath, file);
        try {
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
                console.log('🧹 Korrupt fayl silindi:', fullPath);
            }
        } catch (err) {
            console.log('⚠️ Fayl silinmədi (problem deyil):', fullPath, err.message);
        }
    });
};

// ============================================
// Köhnə profil qovluqlarını təmizlə (bir dəfə)
// ============================================
const cleanupOldProfiles = () => {
    // Əvvəlki exe-nin yanındakı profilləri sil (əgər varsa)
    const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
    const oldPaths = [
        path.join(exeDir, 'bot_profile'),
        path.join(exeDir, 'imei_profile')
    ];
    oldPaths.forEach(oldPath => {
        try {
            if (oldPath !== path.join(getBaseDir(), 'bot_profile') &&
                oldPath !== path.join(getBaseDir(), 'imei_profile')) {
                if (fs.existsSync(oldPath)) {
                    fs.rmSync(oldPath, { recursive: true, force: true });
                    console.log('🧹 Köhnə profil silindi:', oldPath);
                }
            }
        } catch (err) {
            console.log('⚠️ Köhnə profil silinmədi (problem deyil):', oldPath);
        }
    });
};
cleanupOldProfiles();

let isLaunching = false;
let globalBrowser = null;

// The core function to ensure browser is open (for E-Social)
async function ensureBrowser() {
    if (globalBrowser) {
        try {
            await globalBrowser.version();
            return globalBrowser;
        } catch (e) {
            globalBrowser = null;
        }
    }

    if (isLaunching) return null;
    isLaunching = true;

    try {
        console.log("🚀 [E-Social] Brauzer başladılır...");
        const chromePath = getChromePath();

        if (!chromePath) {
            throw new Error("Chrome brauzeri tapılmadı. Zəhmət olmasa Google Chrome quraşdırın.");
        }

        // C:\bot\ altında profil qovluğu
        const baseDir = getBaseDir();
        const profilePath = path.join(baseDir, 'bot_profile');
        ensureDir(profilePath);

        // Korrupt faylları təmizlə (about:blank probleminin həlli)
        cleanProfileCorruptFiles(profilePath);

        // Chrome-un artıq açıq olan instansını öldür (port/lock konflikti olmasın)
        try {
            await new Promise((resolve) => {
                exec('taskkill /f /im chrome.exe /t', (err) => {
                    if (err) console.log('ℹ️ Chrome prosesi tapılmadı (normaldır)');
                    resolve();
                });
            });
            // Chrome-un tam bağlanmasını gözlə
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { }

        // Singleton fayllarını yenidən təmizlə (Chrome bağlandıqdan sonra)
        ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].forEach(f => {
            try { fs.unlinkSync(path.join(profilePath, f)); } catch (e) { }
        });

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
                '--disable-setuid-sandbox',   // açıq şəkildə əlavə — xəbərdarlıq mesajını aradan qaldırır
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-blink-features=AutomationControlled',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-infobars',          // info bar-ları gizlət
                '--disable-features=TranslateUI', // tərcümə popup-ını söndür
                targetUrl                       // birbaşa hədəf URL-i aç
            ],
            userDataDir: profilePath
        });

        // Brauzerin URL-i yükləməsini gözlə
        console.log("⏳ [E-Social] Səhifənin yüklənməsi gözlənilir...");
        const pages = await globalBrowser.pages();
        const page = pages[0];

        if (page) {
            try {
                // Əgər hələ about:blank-dadırsa, naviqasiya et
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });

                if (page.url() === 'about:blank' || page.url() === '') {
                    console.log("⚠️ [E-Social] about:blank-da qaldı, manual naviqasiya edilir...");
                    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                }

                console.log("✅ [E-Social] Səhifə yükləndi:", page.url());
            } catch (navErr) {
                console.log("⚠️ [E-Social] İlk naviqasiya xətası (sonra yenidən cəhd ediləcək):", navErr.message);
            }
        }

        console.log("✅ [E-Social] Brauzer hazır və qoşuldu.");
        return globalBrowser;
    } catch (err) {
        console.error("❌ [E-Social] Brauzer başlatma xətası:", err.message);
        return null;
    } finally {
        isLaunching = false;
    }
}

// --------------------------------------------------------------------------
// ENDPOINT 1: E-Social Scraper (/api/scrape)
// --------------------------------------------------------------------------
app.post('/api/scrape', async (req, res) => {
    let browser = await ensureBrowser();
    if (!browser) {
        return res.status(500).json({ error: "Brauzer hazır deyil və ya başladıla bilmədi." });
    }

    try {
        let { fin, sv } = req.body;
        if (!fin || !sv) return res.status(400).json({ error: "FİN və ŞV nömrəsi daxil edilməlidir" });

        // ŞV nömrəsinin formatlanması: AZE ilə başlayırsa, AZE hissəsini silirik
        let formattedSv = sv.trim();
        if (formattedSv.toUpperCase().startsWith("AZE")) {
            formattedSv = formattedSv.substring(3);
        }

        const pages = await browser.pages();
        let page = pages.find(p => p.url().includes('e-social.gov.az')) || pages[0];

        const url = "https://eroom.e-social.gov.az/runApp?doc=project.AppEmploymentContractOnline&type=1&menu=AppEmploymentContractOnline_1";

        // about:blank yoxlaması — əgər hələ boş səhifədədirsə, naviqasiya et
        const currentUrl = page.url();
        if (currentUrl === 'about:blank' || currentUrl === '' || !currentUrl.includes('AppEmploymentContractOnline')) {
            console.log("🔄 [E-Social] Səhifəyə yönləndirilir...");
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        }

        if (page.url().includes('mygovid.gov.az') || page.url().includes('auth')) {
            return res.status(401).json({ error: "LOGIN_REQUIRED", message: "Zəhmət olmasa Asan İmza ilə daxil olun." });
        }

        // Modalları təmizləmək
        const clearModals = async () => {
            try {
                await page.evaluate(() => {
                    // 1. "Bağla" düyməsini tap və kliklə
                    const buttons = Array.from(document.querySelectorAll('button, .q-btn, .btn, span, div, a'));
                    const closeBtn = buttons.find(el => {
                        const t = (el.innerText || "").trim();
                        return (t === "Bağla" || t === "BAĞLA" || t === "Bağla.") && (el.offsetWidth > 0 || el.offsetHeight > 0);
                    });

                    if (closeBtn) {
                        console.log("Bağla düyməsi kliklənir...");
                        ['mousedown', 'click', 'mouseup'].forEach(eventType => {
                            closeBtn.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window }));
                        });
                    }

                    // 2. Məcburi təmizləmə
                    const modalSelectors = [
                        '.modal', '.popup', '.dialog', '.q-dialog', '.q-notification',
                        '.modal-backdrop', '.overlay', '.mask', '.ui-widget-overlay',
                        '.v-modal', '.v-overlay'
                    ];

                    modalSelectors.forEach(selector => {
                        document.querySelectorAll(selector).forEach(el => {
                            if (el.innerText && el.innerText.includes('Bağla')) {
                                el.remove();
                            }
                        });
                    });

                    document.body.style.overflow = 'auto';
                    if (document.documentElement) document.documentElement.style.overflow = 'auto';
                });
            } catch (e) {
                console.log("Modal təmizləmə xətası:", e.message);
            }
        };

        await clearModals();
        await new Promise(r => setTimeout(r, 1000));

        // İlk sətir seçimi (Daha etibarlı klik simulyasiyası)
        await page.evaluate(() => {
            const table = document.querySelector('#documentListTable') || document.querySelector('table');
            const row = table ? table.querySelector('tbody tr') : null;

            if (row) {
                console.log("Sətir tapıldı, seçilir...");
                row.scrollIntoView();
                ['mousedown', 'click', 'mouseup'].forEach(eventType => {
                    row.dispatchEvent(new MouseEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 1
                    }));
                });
            } else {
                console.log("Sətir tapılmadı!");
            }
        });
        await new Promise(r => setTimeout(r, 2000));
        await clearModals();

        // Axtarış (FİN və ŞV daxil edilməsi)
        await page.evaluate((finVal, svVal) => {
            console.log("Məlumatlar daxil edilir...");

            const finInput = document.querySelector('input[placeholder*="FİN"]') ||
                document.querySelector('input[placeholder*="fin"]');
            const svInput = document.querySelector('input[placeholder*="ŞV"]') ||
                document.querySelector('input[placeholder*="nömrəsi"]');

            const fillInput = (el, val) => {
                if (!el) return;
                if (el.disabled) el.disabled = false;
                el.focus();
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            };

            if (finInput) {
                fillInput(finInput, finVal);
                console.log("FİN yazıldı:", finVal);
            }

            if (svInput) {
                fillInput(svInput, svVal);
                console.log("ŞV yazıldı:", svVal);
            }

            // Axtarış düyməsini tapmaq və klikləmək
            const btn = (() => {
                if (svInput) {
                    const parent = svInput.closest('.input-group') || svInput.parentElement;
                    const b = parent.querySelector('button, .q-btn, i.q-icon, .btn');
                    if (b) return b;
                }
                return Array.from(document.querySelectorAll('button, .q-btn, .btn')).find(b => {
                    const s = window.getComputedStyle(b);
                    const isBlue = s.backgroundColor.includes('rgb(0, 51, 153)') ||
                        s.backgroundColor.includes('rgb(0, 41, 114)') ||
                        s.backgroundColor.includes('rgb(2, 123, 227)');
                    return isBlue || b.innerHTML.includes('search') || b.querySelector('i');
                });
            })();

            if (btn) {
                console.log("Axtarış düyməsi basılır...");
                ['mousedown', 'click', 'mouseup'].forEach(eventType => {
                    btn.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window }));
                });
            } else {
                console.log("Axtarış düyməsi tapılmadı!");
            }
        }, fin, formattedSv);

        console.log("Axtarış verildi, 5 saniyə gözlənilir...");
        await new Promise(r => setTimeout(r, 5000));

        // Məlumatları götürmək (Robust Extraction)
        const resultData = await page.evaluate(() => {
            const data = {};
            const cleanText = (t) => t.trim().toLowerCase().replace(/:$/, "").trim();

            const containers = document.querySelectorAll('.form-group, .q-field, div.row > div');

            containers.forEach(container => {
                const labelEl = container.querySelector('label, .q-field__label');
                if (!labelEl) return;

                const label = cleanText(labelEl.innerText);
                if (!label || label.length > 50) return;

                let value = "";

                const input = container.querySelector('input, select, textarea');
                if (input) value = input.value || "";

                if (!value || value.trim() === "") {
                    const vsSelected = container.querySelector('.vs__selected, .vs__selected-options');
                    if (vsSelected) value = vsSelected.innerText;
                }

                if (!value || value.trim() === "") {
                    const dateInput = container.querySelector('.mx-input');
                    if (dateInput) value = dateInput.value;
                }

                if (!value || value.trim() === "") {
                    const native = container.querySelector('.q-field__native, .q-field__control-container');
                    if (native) value = native.innerText;
                }

                if (value && value.trim() !== "..." && value.trim() !== "") {
                    data[label] = value.trim();
                }
            });

            document.querySelectorAll('input').forEach(input => {
                const val = input.value;
                if (!val) return;

                let label = "";
                if (input.placeholder) label = cleanText(input.placeholder);
                if (!label && input.id) {
                    const l = document.querySelector(`label[for="${input.id}"]`);
                    if (l) label = cleanText(l.innerText);
                }

                if (label && val && !data[label]) {
                    data[label] = val.trim();
                }
            });

            return data;
        });

        // Response formatı
        const responseData = {
            success: true,
            data: resultData,
            gender: resultData['cinsi'] || resultData['cins'] || "",
            birthDate: resultData['doğum tarixi'] || resultData['doğum'] || ""
        };

        res.json(responseData);

    } catch (error) {
        console.error("Scraping error:", error);
        res.status(500).json({ error: error.message });
    }
});

let imeiBrowser = null;
let isImeiLaunching = false;

async function ensureImeiBrowser() {
    if (imeiBrowser) {
        try {
            await imeiBrowser.version();
            return imeiBrowser;
        } catch (e) {
            imeiBrowser = null;
        }
    }
    if (isImeiLaunching) return null;
    isImeiLaunching = true;

    try {
        console.log("🚀 [IMEI] Brauzer başladılır (Persistent)...");
        const chromePath = getChromePath();

        if (!chromePath) {
            throw new Error("Chrome brauzeri tapılmadı. Zəhmət olmasa Google Chrome quraşdırın.");
        }

        // C:\bot\ altında profil qovluğu
        const baseDir = getBaseDir();
        const profilePath = path.join(baseDir, 'imei_profile');
        ensureDir(profilePath);

        // Korrupt faylları təmizlə
        cleanProfileCorruptFiles(profilePath);

        // Singleton fayllarını təmizlə
        ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].forEach(f => {
            try { fs.unlinkSync(path.join(profilePath, f)); } catch (e) { }
        });

        imeiBrowser = await puppeteer.launch({
            headless: false,
            executablePath: chromePath,
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--test-type',
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',   // açıq şəkildə əlavə
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
                'https://ins.mcqs.az/User/LogIn'   // birbaşa hədəf URL
            ],
            userDataDir: profilePath
        });

        // Səhifənin yüklənməsini gözlə
        const pages = await imeiBrowser.pages();
        const page = pages[0];
        if (page) {
            try {
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
                if (page.url() === 'about:blank' || page.url() === '') {
                    console.log("⚠️ [IMEI] about:blank-da qaldı, manual naviqasiya edilir...");
                    await page.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'networkidle2', timeout: 60000 });
                }
                console.log("✅ [IMEI] Səhifə yükləndi:", page.url());
            } catch (navErr) {
                console.log("⚠️ [IMEI] İlk naviqasiya xətası:", navErr.message);
            }
        }

        return imeiBrowser;
    } catch (err) {
        console.error("❌ [IMEI] Brauzer başlatma xətası:", err.message);
        return null;
    } finally {
        isImeiLaunching = false;
    }
}

// --------------------------------------------------------------------------
// ENDPOINT 2: IMEI Checker (/api/check-imei)
// --------------------------------------------------------------------------
app.post('/api/check-imei', async (req, res) => {
    const { imei } = req.body;
    if (!imei) return res.status(400).json({ error: 'IMEI daxil edilməyib' });

    console.log(`🔍 IMEI yoxlanılır: ${imei}`);

    try {
        const b = await ensureImeiBrowser();
        if (!b) throw new Error("IMEI Brauzeri açmaq mümkün olmadı");

        // Mövcud səhifələri yoxla, lazım olsa yenisini aç
        const pages = await b.pages();
        let page = pages.find(p => p.url().includes('ins.mcqs.az')) || null;

        if (!page) {
            page = await b.newPage();
        }
        await page.setDefaultNavigationTimeout(90000);

        // ============ 1. LOGIN ============
        const currentUrl = page.url();
        if (!currentUrl.includes('ins.mcqs.az') || currentUrl.includes('LogIn') || currentUrl === 'about:blank') {
            console.log('🌐 [IMEI] Login səhifəsinə giriş...');
            await page.goto('https://ins.mcqs.az/User/LogIn', { waitUntil: 'networkidle2' });

            const isLoginPage = await page.$('#username');
            if (isLoginPage) {
                console.log('✍️ [IMEI] Login olunur...');
                await page.type('#username', 'aziza_nasirova');
                await page.type('#password', 'leqal2025');
                await page.click('#loginbutton');

                // Sertifikat seçimi və ya naviqasiya gözlənilir
                console.log('⏳ [IMEI] Sertifikat seçimi / naviqasiya gözlənilir...');
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => { });

                // Login uğurlu oldumu?
                const stillOnLogin = await page.$('#username');
                if (stillOnLogin) {
                    return res.status(401).json({ error: 'Login uğursuz oldu. Sertifikat seçilmədi.' });
                }
                console.log('✅ [IMEI] Login uğurlu.');
            }
        }

        // ============ 2. INDEX SƏHİFƏSİNƏ KEÇ ============
        if (!page.url().includes('CreditApplication/Index') && !page.url().includes('CheckImeiStatus')) {
            console.log('🌐 [IMEI] Index səhifəsinə keçilir...');
            await page.goto('https://ins.mcqs.az/CreditApplication/Index', { waitUntil: 'networkidle2' });
        }

        // ============ 3. "IMEI Status yoxlanışı" TAB-ına KLİK ET ============
        console.log('🔘 [IMEI] "IMEI Status yoxlanışı" tabına klik edilir...');

        await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 10000 });
        await page.click('li[data-url*="CheckImeiStatus"] a');

        // Tab yüklənməsini gözlə
        await new Promise(r => setTimeout(r, 1000));

        // ============ 4 + 5: IMEI YAZ VƏ KLİK ET ============
        console.log('✍️ [IMEI] IMEI kodu daxil edilir...');

        await page.click('#getimeicode', { clickCount: 3 }); // mövcud mətni seç
        await page.keyboard.type(imei); // klaviatura ilə yaz

        console.log('🔍 [IMEI] Butona klik edilir...');
        await page.click('#checkimeistatus');

        // ============ 6: NƏTİCƏNİ GÖZLƏ ============
        console.log('⏳ [IMEI] Nəticə gözlənilir...');

        var statusText = '';

        // Hər 1 saniyə yoxla, max 20 saniyə
        for (var attempt = 0; attempt < 20; attempt++) {
            await new Promise(function (r) { setTimeout(r, 1000); });

            try {
                statusText = await page.$eval('#imeiStatus b', function (el) {
                    return el.innerText.trim();
                });
                if (statusText && statusText.length > 5) {
                    break;
                }
            } catch (e) {
                statusText = '';
            }
        }

        if (!statusText) statusText = 'RESULT_NOT_FOUND';

        console.log('📄 [IMEI] Nəticə:', statusText);

        var imeiFee = statusText.endsWith('deaktiv olunub.');

        res.json({
            imeiFee: imeiFee,
            message: statusText
        });

    } catch (err) {
        console.error('❌ [IMEI] XƏTA:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Listen
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
***************************************************
🚀 BOT XİDMƏTİ START GÖTÜRDÜ!
📍 URL: http://localhost:${PORT}
⚙️ Endpoints:
   - POST /api/scrape (E-Social)
   - POST /api/check-imei (IMEI)
--- BU PƏNCƏRƏNİ BAĞLAMAYIN ---
***************************************************
    `);
});