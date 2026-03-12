# Bot Xidməti (API) Təlimatı

Bu layihə bütün funksiyaları (E-Social scraping və IMEI yoxlanışı) bir yerdə toplayan vahid bir web-servisdir.

## 1. Necə işlətməli?
- `bot_service.exe` faylını iki dəfə klikləyərək açın.
- Proqram `http://localhost:4000` portunda bir API server açacaq.
- **Pəncərəni bağlamayın!** Bağlasanız, xidmət dayanacaq.

---

## 2. API Endpoint-ləri

### A. E-Social Məlumatlarını Çəkmək
Bu endpoint `e-social.gov.az` saytından müştəri məlumatlarını çəkir.

- **URL:** `http://localhost:4000/api/scrape`
- **Method:** `POST`
- **Body (JSON):**
```json
{
  "fin": "7EMHZ9L",
  "sv": "AA3748461"
}
```
- **Cavab (JSON):** Müştərinin bütün datalarını obyekt formatında qaytaracaq.

### B. IMEI Yoxlanışı
Bu endpoint `ins.mcqs.az` üzərindən IMEI statusunu yoxlayır.

- **URL:** `http://localhost:4000/api/check-imei`
- **Method:** `POST`
- **Body (JSON):**
```json
{
  "imei": "351785570338096"
}
```
- **Cavab (JSON):** IMEI-nin statusunu və lazımi məlumatları qaytarır.

---

## ⚠️ Vacib Qeydlər
*   **Google Chrome:** Proqramın işləməsi üçün kompüterdə Google Chrome quraşdırılmış olmalıdır.
*   **E-Social Girişi:** Əgər E-Social tərəfində sessiya bitibsə, proqram xəta qaytaracaq. Bu halda avtomatik açılan Chrome pəncərəsində "Asan İmza" ilə bir dəfə daxil olmaq lazımdır.
*   **Port 4000:** Əgər bu portda başqa proqram işləyirsə, xidmət başlaya bilməyəcək.
