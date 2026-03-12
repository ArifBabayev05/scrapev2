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

// Helper to find local Chrome
const getChromePath = () => {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
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

        // EXE daxilində yolun düzgün tapılması üçün
        const baseDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
        const profilePath = 'C:\\bot\\bot_profile';

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
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-extensions',
                '--disable-blink-features=AutomationControlled'
            ],
            userDataDir: profilePath
        });

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
        if (!page.url().includes('AppEmploymentContractOnline')) {
            await page.goto(url, { waitUntil: 'networkidle2' });
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
                            // Əgər modalın içində "Bağla" yazısı varsa, onu silirik
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
                // Birdən çox hadisə göndəririk ki, saytın klik listeneri tutsun
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
                // 1. Placeholder-in yanındakı düymə
                if (svInput) {
                    const parent = svInput.closest('.input-group') || svInput.parentElement;
                    const b = parent.querySelector('button, .q-btn, i.q-icon, .btn');
                    if (b) return b;
                }
                // 2. Rəng və ikonaya görə
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

            // Səhifədəki bütün form qruplarını və ya div-ləri gəzirik
            const containers = document.querySelectorAll('.form-group, .q-field, div.row > div');

            containers.forEach(container => {
                const labelEl = container.querySelector('label, .q-field__label');
                if (!labelEl) return;

                const label = cleanText(labelEl.innerText);
                if (!label || label.length > 50) return;

                // Dəyəri tapmaq üçün müxtəlif yollar:
                let value = "";

                // 1. Standart Inputlar
                const input = container.querySelector('input, select, textarea');
                if (input) value = input.value || "";

                // 2. v-select (Cinsi üçün)
                if (!value || value.trim() === "") {
                    const vsSelected = container.querySelector('.vs__selected, .vs__selected-options');
                    if (vsSelected) value = vsSelected.innerText;
                }

                // 3. mx-datepicker (Doğum tarixi üçün)
                if (!value || value.trim() === "") {
                    const dateInput = container.querySelector('.mx-input');
                    if (dateInput) value = dateInput.value;
                }

                // 4. Q-field və ya sadə div daxilindəki mətn
                if (!value || value.trim() === "") {
                    const native = container.querySelector('.q-field__native, .q-field__control-container');
                    if (native) value = native.innerText;
                }

                if (value && value.trim() !== "..." && value.trim() !== "") {
                    data[label] = value.trim();
                }
            });

            // Əgər hansısa labellər qaçıbsa, bütün inputları bir daha yoxla
            document.querySelectorAll('input').forEach(input => {
                const val = input.value;
                if (!val) return;

                // Placeholder və ya yaxınlıqdakı label-ə bax
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
        const baseDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
        const profilePath = 'C:\\bot\\imei_profile';

        imeiBrowser = await puppeteer.launch({
            headless: false,
            executablePath: chromePath,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-extensions',
                '--password-store=basic',
                '--use-mock-keychain'
            ],
            userDataDir: profilePath
        });
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
        if (!currentUrl.includes('ins.mcqs.az') || currentUrl.includes('LogIn')) {
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

        // data-url atributuna görə tap (şəkil 1-dən)
        await page.waitForSelector('li[data-url*="CheckImeiStatus"] a', { timeout: 15000 });
        await page.click('li[data-url*="CheckImeiStatus"] a');

        // Tab yüklənməsini gözlə
        await new Promise(r => setTimeout(r, 1500));

        // ============ 4 + 5: IMEI YAZ VƏ KLİK ET ============
        console.log('✍️ [IMEI] IMEI kodu daxil edilir...');

        // Əvvəlcə IMEI-ni URL-ə yazırıq ki evaluate daxilindən oxuya bilək
        await page.evaluateOnNewDocument('window.__IMEI__ = "' + imei + '"');

        // Yox, daha sadə — addExposeFunction və ya keyboard ilə yazaq
        // Birbaşa keyboard istifadə edək, heç evaluate lazım deyil:

        await page.click('#getimeicode', { clickCount: 3 }); // mövcud mətni seç
        await page.keyboard.type(imei); // klaviatura ilə yaz

        console.log('🔍 [IMEI] Butona klik edilir...');
        await page.click('#checkimeistatus');

        // ============ 6: NƏTİCƏNİ GÖZLƏ ============
        console.log('⏳ [IMEI] Nəticə gözlənilir...');

        await new Promise(function (r) { setTimeout(r, 1500); });

        var statusText = '';

        try {
            // Əvvəlcə b tag-ından oxu (şəkildən görünən struktur)
            statusText = await page.$eval('#imeiStatus b', function (el) {
                return el.innerText.trim();
            });
        } catch (e1) {
            try {
                // b tapılmasa, div-in özündən oxu
                statusText = await page.$eval('#imeiStatus', function (el) {
                    return el.innerText.trim();
                });
            } catch (e2) {
                statusText = 'ELEMENT_NOT_FOUND';
            }
        }

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
