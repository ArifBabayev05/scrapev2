# E-Social Bot — API Docs & Quraşdırma

## 🏗️ Arxitektura

```
  Web Tətbiq ─── HTTP POST ──→  Railway Relay Server
                                   │
                              WebSocket bağlantı
                                   │
                         ┌─────────┴──────────┐
                     Agent-1 (PC-1)     Agent-2 (PC-2)  ...  Agent-N
                     Edge brauzer       Edge brauzer
```

**Hər userin öz PC-sində agent işləyir.** API request-ə `agentLabel` əlavə edərək sorğu konkret userin agentinə yönləndirilir.

---

## 📋 Bütün API Endpoints

**Base URL:** `https://scrape-production-5d7a.up.railway.app`

| Metod | Endpoint | Təsvir |
|-------|----------|--------|
| `GET` | `/` | Health check |
| `GET` | `/api/status` | Qoşulu agentlər siyahısı |
| `GET` | `/api/setup-command` | Quraşdırma komutunu qaytarır (copy-paste) |
| `GET` | `/api/install` | Agent quraşdırma script-i (node ilə işlədilir) |
| `GET` | `/api/agent-code` | Ən son agent.js kodunu qaytarır |
| `POST` | `/api/scrape` | E-Social əmək müqaviləsi sorğusu |
| `POST` | `/api/check-imei` | IMEI yoxlama |

---

## 🖥️ Agent Quraşdırması (User üçün — BİR DƏFƏ)

**Tələb:** Node.js quraşdırılmalıdır → [nodejs.org](https://nodejs.org)

User **cmd** açıb bu komutu yapışdırır:

```
node -e "fetch('https://scrape-production-5d7a.up.railway.app/api/install').then(r=>r.text()).then(s=>{require('fs').writeFileSync(require('os').tmpdir()+'/s.js',s);require(require('os').tmpdir()+'/s.js')})"
```

> 💡 Bu komutu brauzerdən həmişə almaq olar: [/api/setup-command](https://scrape-production-5d7a.up.railway.app/api/setup-command)

**Bu komut avtomatik:**
1. `%LOCALAPPDATA%\ESocialBot` qovluğu yaradır
2. Paketləri yükləyir (ws, puppeteer-core, dotenv)
3. Agent kodunu Railway-dən yükləyir
4. Windows Startup-a əlavə edir (hər login-də avtomatik)
5. Edge açır — user sertifikatla 1 dəfə login olur

**Sonra heç nə etmək lazım deyil — PC açılanda agent avtomatik başlayır.**

---

## 📡 API İstifadəsi

### 1. Health Check

```http
GET /
```

```json
{
  "service": "E-Social Bot Relay Server",
  "status": "online",
  "agents": 2,
  "pendingJobs": 0,
  "uptime": "3600s"
}
```

### 2. Qoşulu Agentlər

```http
GET /api/status
```

```json
{
  "agents": [
    { "id": "e9512533", "label": "Ofis-PC", "busy": false },
    { "id": "7cde5835", "label": "MURADB-DATA", "busy": false }
  ],
  "pendingJobs": 0
}
```

### 3. E-Social Sorğusu

```http
POST /api/scrape
Content-Type: application/json
```

**Request:**
```json
{
  "fin": "5XXXXXX",
  "sv": "AZE12345678",
  "agentLabel": "Ofis-PC"
}
```

> `agentLabel` — userin PC-sinin adı (hostname). Göndərilməzsə random boş agentə gedir.

**Response (uğurlu):**
```json
{
  "data": {
    "fullName": "BABAYEV ARİF",
    "gender": "Kişi",
    "birthDate": "01.01.1990",
    "address": "Bakı şəhəri ...",
    "passportSeries": "AZE12345678"
  }
}
```

**Response (login lazım):**
```json
{
  "data": {
    "error": "LOGIN_REQUIRED",
    "message": "Zəhmət olmasa Asan İmza ilə daxil olun."
  }
}
```

### 4. IMEI Yoxlama

```http
POST /api/check-imei
Content-Type: application/json
```

**Request:**
```json
{
  "imei": "867493062290548",
  "agentLabel": "Ofis-PC"
}
```

**Response:**
```json
{
  "imeiFee": false,
  "message": "Daxil etdiyiniz IMEI nömrə Beynəlxalq GSM Assosiasiyası tərəfindən təyin olunmuş qaydalara uyğun deyil."
}
```

### 5. Quraşdırma Komutu

```http
GET /api/setup-command
```

**Response (plain text):**
```
node -e "fetch('https://scrape-production-5d7a.up.railway.app/api/install')..."
```

Bu komutu userin cmd-sinə copy-paste etmək üçün istifadə edin.

---

## 📱 Frontend İnteqrasiya

```javascript
const BASE = 'https://scrape-production-5d7a.up.railway.app';

// E-Social sorğusu
const scrapeRes = await fetch(`${BASE}/api/scrape`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fin: '5XXXXXX',
    sv: 'AZE12345678',
    agentLabel: 'Ofis-PC'  // userin PC adı
  })
});
const scrapeData = await scrapeRes.json();

// IMEI yoxlama
const imeiRes = await fetch(`${BASE}/api/check-imei`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imei: '867493062290548',
    agentLabel: 'Ofis-PC'
  })
});
const imeiData = await imeiRes.json();
```

---

## 🔄 Kod Güncəlləmə

Agent kodu **həmişə Railway-dən yüklənir:**

```bash
git add agent.js
git commit -m "fix: ..."
git push origin main
```

**Bütün agentlər növbəti restart-da avtomatik güncəllənir.** Manual müdaxilə lazım deyil.

---

## ⚙️ Railway Environment Variables

| Dəyişən | Dəyər |
|---------|-------|
| `AGENT_SECRET` | `bot-secret-2024` |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` |
| `PUPPETEER_SKIP_DOWNLOAD` | `true` |

---

## 🛠️ Troubleshooting

| Problem | Həll |
|---------|------|
| `NO_AGENT` xətası | User-in PC-sində agent işləmir. Install komutunu yenidən işlədin. |
| `"XYZ" agenti tapılmadı` | `agentLabel` yoxlayın — `/api/status` ilə qoşulu agentləri görün |
| `LOGIN_REQUIRED` | Edge-də Asan İmza ilə login olun |
| `TIMEOUT` | Sayt cavab vermir, yenidən cəhd edin |
| Edge açılmır | `cd %LOCALAPPDATA%\ESocialBot && node launcher.js` işlədin |
| PC açılanda agent başlamır | Install komutunu yenidən işlədin (Startup-a əlavə olunacaq) |
