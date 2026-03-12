# Quraşdırma Təlimatı

Bu proqram `e-social.gov.az` saytından məlumatların çıxarılması və IMEI yoxlanışı üçün nəzərdə tutulmuşdur. Proqramın düzgün işləməsi üçün aşağıdakı addımları izləyin.

## 1. Google Chrome-un quraşdırılması (MƏCBURİ)
Proqramın məlumatları avtomatik çəkməsi üçün kompüterdə **Google Chrome** brauzeri mütləq olmalıdır.
*   Əgər yoxdursa, buradan yükləyin: [Google Chrome Yüklə](https://www.google.com/chrome/)
*   Chrome-un standart qovluqda (`C:\Program Files\Google\Chrome\Application\chrome.exe`) quraşdırıldığından əmin olun.

## 2. Proqramın başladılması
*   Qovluqdakı `bot_service.exe` faylını iki dəfə klikləyərək açın.
*   Qara pəncərə (terminal) açılacaq və "BOT XİDMƏTİ START GÖTÜRDÜ!" yazısı görünəcək.
*   **BU PƏNCƏRƏNİ BAĞLAMAYIN!** Proqram işlədiyi müddətdə bu pəncərə açıq qalmalıdır.

## 3. İlk istifadə və Giriş (E-Social)
*   Proqram ilk dəfə açıldıqda avtomatik olaraq Chrome brauzerini başladacaq.
*   Əgər E-Social saytına giriş edilməyibsə, açılan brauzer pəncərəsində **Asan İmza** ilə bir dəfə daxil olun.
*   Giriş etdikdən sonra artıq proqram sorğulara cavab verə biləcək.

## 4. Xüsusi Qeydlər
*   **Port 4000:** Proqram kompüterin 4000-ci portunu istifadə edir. Başqa proqram bu portu istifadə etməməlidir.
*   **İnternet:** Proqramın işləməsi üçün aktiv internet bağlantısı lazımdır.
*   **Node.js:** Əgər yalnız `.exe` faylını işlədirsinizsə, Node.js quraşdırmağa ehtiyac yoxdur. Lakin proqramın kodlarını (`main_service.js`) dəyişib yenidən yığmaq istəsəniz, [Node.js v18+](https://nodejs.org/) quraşdırmalısınız.

## 5. Proqramı EXE formasına salmaq (Developerlər üçün)
Əgər `main_service.js` faylında hər hansı dəyişiklik etmisinizsə və yeni `.exe` faylı yaratmaq istəyirsinizsə, aşağıdakı addımları izləyin:
1. Terminalı (PowerShell və ya CMD) bu qovluqda açın.
2. `npm install` komandası ilə bütün kitabxanaların yükləndiyindən əmin olun.
3. Aşağıdakı komandanı işlədin:
   ```bash
   npm run build-exe
   ```
4. Proses bitdikdən sonra qovluqda yeni `bot_service.exe` faylı yaranacaq.

---
**Dəstək:** Hər hansı texniki problem yaranarsa, proqramı bağlayıb yenidən açmağınız tövsiyə olunur.
