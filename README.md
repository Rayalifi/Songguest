# Songgest

Songgest adalah game tebak lagu dengan potongan audio bertahap dan impor playlist Spotify. Proyek ini dibangun dalam monorepo TypeScript menggunakan Fastify, Prisma (SQLite), dan React (Vite).

## Cara Kerja Game

Pada setiap ronde, pemain mulai mendengar potongan lagu sepanjang 0.1 detik. Jika judul atau artis belum tertebak, pemain bisa melewati tahap tersebut untuk membuka potongan yang lebih panjang hingga 15.0 detik. Semakin cepat lagu ditebak, semakin besar pengali skornya.

| Tahap | Durasi Audio | Keterangan | Pengali Skor |
|---|---|---|---|
| 1 | 0.1 detik | Instant attack | 5.0x |
| 2 | 0.5 detik | Rhythm groove | 3.0x |
| 3 | 2.0 detik | Melodic hook | 1.8x |
| 4 | 8.0 detik | Full phrase | 1.2x |
| 5 | 15.0 detik | Extended passage | 0.8x |

## Mode Permainan

### Quick Play
Bermain langsung menggunakan katalog lagu bawaan. Sebelum sesi dimulai, pemain dapat mengatur tingkat kesulitan berdasarkan skor popularitas lagu, genre, dekade rilis, pencarian nama artis, dan jumlah lagu (5, 10, atau 20 lagu).

| Tingkat Kesulitan | Rentang Popularitas | Pengali Dasar |
|---|---|---|
| Easy | 80 sampai 100 | 1.0x |
| Medium | 60 sampai 79 | 1.5x |
| Hard | 40 sampai 59 | 2.2x |
| Expert | 20 sampai 39 | 3.2x |
| Impossible | 0 sampai 19 | 4.5x |

### Spotify Playlist Import
Tempel URL playlist publik Spotify, misalnya `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`. Aplikasi memvalidasi format URL, mengambil metadata playlist, memetakan lagu ke pool khusus sesi (`spotifyPlaylistId`), lalu menjalankan alur tebak lagu bertahap dari pool tersebut.

## Prasyarat

Pastikan perangkat sudah memiliki:
- Node.js versi 20 atau lebih baru
- npm versi 10 atau lebih baru

## Cara Menjalankan Secara Lokal

Ikuti langkah berikut secara berurutan dari direktori utama proyek.

### Langkah 1: Clone Repository

```bash
git clone <URL_REPOSITORY_ANDA>
cd Songgest
```

### Langkah 2: Install Dependencies

```bash
npm install
```

### Langkah 3: Siapkan File Environment

Salin `.env.example` menjadi `.env`:

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

**macOS / Linux:**
```bash
cp .env.example .env
```

Penjelasan variabel di `.env`:

| Variabel | Nilai Default | Fungsi |
|---|---|---|
| `DATABASE_URL` | `"file:./packages/server/prisma/dev.db"` | Lokasi file database SQLite untuk Prisma |
| `PORT` | `3001` | Port server backend Fastify |
| `NODE_ENV` | `development` | Mode environment aplikasi |
| `CORS_ORIGIN` | `"http://localhost:5173"` | Origin frontend yang diizinkan mengakses API |
| `MUSIC_METADATA_PROVIDER` | `"local-fixtures"` | Sumber katalog Quick Play (`local-fixtures` untuk offline, atau `deezer` untuk API publik Deezer) |
| `SPOTIFY_CLIENT_ID` | `""` | Opsional, Client ID aplikasi dari Spotify Developer Dashboard |
| `SPOTIFY_CLIENT_SECRET` | `""` | Opsional, Client Secret aplikasi Spotify |
| `SPOTIFY_REDIRECT_URI` | `"http://127.0.0.1:3001/api/spotify/callback"` | Callback OAuth Spotify lokal |

Jika `SPOTIFY_CLIENT_ID` dan `SPOTIFY_CLIENT_SECRET` dibiarkan kosong, aplikasi berjalan dalam mode mock lokal sehingga seluruh alur game dan impor playlist tetap bisa dicoba secara offline.

### Langkah 4: Build Package Shared

Package `@songgest/shared` menyediakan tipe data, konstanta, dan rumus skor yang dipakai oleh server dan client. Build terlebih dahulu:

```bash
npm run build --workspace=@songgest/shared
```

### Langkah 5: Inisialisasi dan Isi Database

Buat tabel SQLite sesuai skema Prisma dan masukkan data lagu awal:

```bash
npm run db:push --workspace=@songgest/server
npm run db:seed --workspace=@songgest/server
```

### Langkah 6: Jalankan Backend dan Frontend

Buka **2 terminal terpisah** di folder root `Songgest`, karena script `npm run dev` pada `package.json` root hanya menjalankan frontend (`packages/client`).

**Terminal 1 (Backend Fastify di port 3001):**
```bash
npm run dev:server
```

**Terminal 2 (Frontend Vite + React di port 5173):**
```bash
npm run dev:client
```

Buka `http://localhost:5173` di browser. Vite otomatis meneruskan request `/api` ke `http://localhost:3001`.

## Pengujian dan Build Produksi

### Menjalankan Seluruh Unit dan Integrasi Test

```bash
npm test
```

Total terdapat 130 test otomatis di tiga workspace:
- `@songgest/client`: 7 test (siklus audio engine, state machine Zustand, konfigurasi kesulitan, reset halaman utama)
- `@songgest/server`: 110 test (provider Deezer, migrasi dan OAuth Spotify, tebak lagu bertahap, validasi tiket, rate limiting, streaming HTTP 206)
- `@songgest/shared`: 13 test (fuzzy matching dan perhitungan skor)

### Menjalankan Smoke Test End-to-End

```bash
npm run smoke
```

Script ini menguji alur penuh mulai dari membuat sesi Quick Play, melewati clue 0.1 detik ke 0.5 detik, streaming audio HTTP 206, mengirim tebakan, memajukan ronde, mengimpor playlist Spotify, mengisolasi pool lagu, hingga menyimpan riwayat permainan.

### Build Produksi

```bash
npm run build
```

## Struktur Proyek

```text
Songgest/
├── packages/
│   ├── client/               # Frontend React 19 + Vite + Zustand
│   │   ├── src/
│   │   │   ├── App.tsx       # Antarmuka game (Home, Settings, Game, Result, History)
│   │   │   ├── services/     # HTML5 AudioEngine dengan pemotongan durasi
│   │   │   ├── store/        # Store Zustand untuk state permainan bertahap
│   │   │   └── styles/       # Stylesheet aplikasi
│   │   └── package.json
│   ├── server/               # Backend Fastify + Prisma SQLite
│   │   ├── fixtures/audio/   # 4 file audio lokal (.wav)
│   │   ├── prisma/           # Skema database SQLite
│   │   ├── src/
│   │   │   ├── db/           # Prisma client dan seed katalog awal
│   │   │   ├── middleware/   # Rate limiter API
│   │   │   ├── providers/    # Integrasi Spotify, Deezer, dan local fixtures
│   │   │   ├── routes/       # Endpoint session, audio, song, history, dan spotify
│   │   │   ├── services/     # Logika sesi, katalog, dan streaming audio
│   │   │   └── index.ts      # Entry point server Fastify
│   │   └── package.json
│   └── shared/               # Tipe TypeScript, konstanta, dan utilitas bersama
│       ├── src/
│       │   ├── constants/    # PROGRESSIVE_STAGES dan DIFFICULTY_CONFIGS
│       │   ├── types/        # Kontrak API, lagu, provider, dan game
│       │   └── utils/        # Fuzzy string matching dan rumus skor
│       └── package.json
├── .env.example              # Template variabel environment
├── package.json              # Konfigurasi npm workspaces
├── tsconfig.base.json        # Konfigurasi dasar TypeScript
└── vitest.config.ts          # Konfigurasi root Vitest
```

## Keamanan Game dan Integrasi Spotify

Perhitungan skor, status ronde, dan validasi tebakan dijalankan di server agar client tidak dapat memanipulasi skor maupun urutan tahap. Setiap ronde menerbitkan tiket sekali pakai (`tkt_...`) dengan batas waktu kedaluwarsa dan validasi lintas sesi sehingga tiket yang sudah dipakai atau berasal dari sesi lain akan ditolak.

Audio dikirim melalui endpoint streaming HTTP 206 Partial Content yang terikat ke tiket aktif, sedangkan judul dan artis lagu ditahan dari respons API sampai ronde selesai. Untuk integrasi Spotify, aplikasi hanya mengambil metadata playlist dan lagu melalui endpoint resmi Spotify Web API, lalu memetakan pemutaran audio ke fixture atau preview resmi tanpa mengunduh audio penuh Spotify.

## Keterbatasan yang Diketahui

1. Presisi potongan 0.1 detik di browser bergantung pada timer event loop HTML5 Audio.
2. Audio lokal bawaan memakai 4 file fixture (`fixture_synth_pop.wav`, `fixture_rock_riff.wav`, `fixture_funk_groove.wav`, dan `fixture_jazz_chords.wav`).
3. Browser memblokir pemutaran audio otomatis sebelum ada interaksi pengguna, sehingga audio diputar setelah klik tombol atau menekan tombol Spasi.
4. Spotify Web API tidak menyediakan stream MP3 penuh untuk semua lagu komersial, sehingga pemutaran tetap diarahkan ke sumber preview yang diizinkan atau fixture lokal.
