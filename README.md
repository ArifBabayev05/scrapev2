# E-Social Bot — API Docs

## 🏗️ Arxitektura

```
                    ┌─────────────────────────┐
  Web Tətbiq  ───→  │  Railway Relay Server    │
  (HTTP POST)       │  relay-server.js         │
                    └───────────┬─────────────┘
                                │ WebSocket
                    ┌───────────┴─────────────┐
                    │  Lokal Agent (user PC)    │
                    │  agent.js                 │
                    │  ├── Edge (E-Social tab)  │
                    │  └── Edge (IMEI tab)      │
                    └──────────────────────────┘
```

---

## 📋 API Endpoints

**Base URL:** `https://scrape-production-5d7a.up.railway.app`

### 1. Health Check

```http
GET /
```

**Response:**
```json
{
  "service": "E-Social Bot Relay Server",
  "status": "online",
  "agents": 1,
  "pendingJobs": 0,
  "uptime": "3600s"
}
```

---

### 2. Agent Status

```http
GET /api/status
```

**Response:**
```json
{
  "agents": [
    {
      "id": "41eb3554",
      "label": "Ofis-PC",
      "busy": false,
      "connectedAt": "2026-03-17T06:30:00.000Z",
      "wsState": 1
    }
  ],
  "pendingJobs": 0
}
```

---

### 3. E-Social Əmək Müqaviləsi Sorğusu

```http
POST /api/scrape
Content-Type: application/json
```

**Request body:**
```json
{
  "fin": "5XXXXXX",
  "sv": "AZE12345678"
}
```

**Uğurlu response:**
```json
{
  "data": {
    "fullName": "BABAYEV ARİF",
    "gender": "Kişi",
    "birthDate": "01.01.1990",
    "address": "Bakı şəhəri ...",
    "actualAddress": "...",
    "passportSeries": "AZE12345678",
    "passportNumber": "...",
    "issueDate": "01.01.2020",
    "authority": "..."
  }
}
```

**Login lazım olanda:**
```json
{
  "data": {
    "error": "LOGIN_REQUIRED",
    "message": "Zəhmət olmasa Asan İmza ilə daxil olun."
  }
}
```

**Agent tapılmadıqda (503):**
```json
{
  "error": "NO_AGENT: Aktiv lokal agent tapılmadı..."
}
```

---

### 4. IMEI Yoxlama

```http
POST /api/check-imei
Content-Type: application/json
```

**Request body:**
```json
{
  "imei": "867493062290548"
}
```

**Uğurlu response:**
```json
{
  "imeiFee": true,
  "message": "867493062290548 IMEI kodlu cihaz deaktiv olunub."
}
```

```json
{
  "imeiFee": false,
  "message": "867493062290548 IMEI kodlu cihaz aktivdir."
}
```

---

## 🖥️ User Quraşdırma (Bir dəfəlik)

**Tələblər:** Node.js quraşdırılmalıdır (nodejs.org)

User **bir dəfə** bu komutu terminalda (cmd/powershell) işlədir:

```
node -e "fetch('https://scrape-production-5d7a.up.railway.app/api/install').then(r=>r.text()).then(s=>{require('fs').writeFileSync(require('os').tmpdir()+'/s.js',s);require(require('os').tmpdir()+'/s.js')})"
```

**Bu komut avtomatik olaraq:**
1. `%LOCALAPPDATA%\ESocialBot` qovluğu yaradır
2. Lazımi paketləri yükləyir (ws, puppeteer-core, dotenv)
3. Agent kodunu Railway-dən yükləyir
4. Windows Scheduled Task yaradır (hər login-də avtomatik başlayır)
5. Edge brauzeri açır

**İlk dəfə user manual etməli:**
- E-Social Edge pəncərəsində Asan İmza sertifikatını seçir
- IMEI Edge pəncərəsində sertifikat seçib login olur (aziza_nasirova / leqal2025)

Bundan sonra API sorğuları avtomatik işləyir.

---

## 🔄 Güncəlləmə

Agent kodu **həmişə Railway-dən yüklənir** — dəyişiklik etdikdə:

```bash
# Kodu dəyişdir, push et
git add agent.js
git commit -m "fix: ..."
git push origin main
```

**20 user-in hamısı növbəti restart-da avtomatik güncəllənir.** Heç bir manual müdaxilə lazım deyil.

---

## ⚙️ Railway Environment Variables

| Dəyişən | Dəyər | Məcburi |
|---------|-------|---------|
| `AGENT_SECRET` | `bot-secret-2024` | ✅ |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` | ✅ |
| `PUPPETEER_SKIP_DOWNLOAD` | `true` | ✅ |

---

## 📱 Frontend İnteqrasiya Nümunəsi

```javascript
// E-Social sorğusu
const response = await fetch('https://scrape-production-5d7a.up.railway.app/api/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fin: '5XXXXXX', sv: 'AZE12345678' })
});
const data = await response.json();

// IMEI yoxlama
const imeiRes = await fetch('https://scrape-production-5d7a.up.railway.app/api/check-imei', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imei: '867493062290548' })
});
const imeiData = await imeiRes.json();
```

---

## 🛠️ Troubleshooting

| Problem | Həll |
|---------|------|
| `NO_AGENT` xətası | User-in PC-sində agent işləmir. `node -e "fetch..."` komutunu yenidən işlədin. |
| `LOGIN_REQUIRED` | Edge-də Asan İmza ilə login olun |
| `TIMEOUT` | Sayt cavab vermir, yenidən cəhd edin |
| Edge açılmır | Taskbar-da Edge ikonuna baxın, manual açın |
| Dublikat tablar | Agent-i restart edin |
