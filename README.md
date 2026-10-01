# BACKOFFICE-APIKU 🚀
### Real-Time Transaction Dashboard & Bapenda Monitor for Olsera POS

Aplikasi dashboard modern untuk memantau data laporan transaksi kasir dari **Olsera Backoffice** secara **realtime** dan otomatis. Dilengkapi integrasi API langsung ke sistem Olsera, rekapitulasi pendapatan, grafik tren 7 hari, distribusi pembayaran, serta rincian pajak PB1 10% (Bapenda).

---

## 🌟 Fitur Utama

- ⚡ **Integrasi Real-time ke Olsera Backoffice API**: Menarik data transaksi kasir langsung dari Olsera POS tanpa jeda manual.
- 🔄 **Auto-Sync / Live Polling**: Pilihan interval pembaruan otomatis (15 detik, 30 detik, 1 menit) dengan tombol sinkronisasi manual instan.
- 📊 **Model Desain Premium (Sesuai Mockup HTML)**:
  - **KPI Cards**: Total Pendapatan, Total Transaksi, Rata-rata Penjualan per Struk, dan Total Pajak Daerah PB1 (10%).
  - **Persentase Tren**: Perbandingan otomatis pendapatan terhadap hari kemarin (`vs kemarin`).
  - **Grafik Tren Pendapatan 7 Hari**: Line Chart dengan smooth gradient curve berbasis Chart.js.
  - **Distribusi Pembayaran**: Diagram donat (QRIS BCA, Tunai/CASH, dll.).
- 📋 **Tabel Transaksi Lengkap**:
  - Nomor struk / Order ID
  - Waktu transaksi (WIB)
  - Metode pembayaran dengan badge khusus
  - Subtotal & Pajak
  - Total bayar
  - Status (Sukses / Void / Batal)
  - Modal rincian transaksi instan
- 🔍 **Filter & Pencarian**:
  - Filter cepat: Hari Ini, Kemarin, atau Custom Date Picker.
  - Pencarian instan berdasarkan nomor order atau metode pembayaran.
- 📥 **Ekspor Laporan**: Tombol Ekspor CSV untuk kebutuhan pelaporan & audit pajak Bapenda.

---

## 🛠️ Arsitektur & Teknologi

- **Frontend**: HTML5, Vanilla JavaScript, Tailwind CSS, Lucide Icons, Chart.js.
- **Backend API**: Node.js Serverless Functions (`/api/dashboard`, `/api/transactions`, `/api/sync`).
- **Olsera OAuth2 Client**: Otomatisasi login dengan OAuth2 password grant & caching access token selama masa aktif (30 hari).
- **Deployment**: Vercel Serverless Platform.

---

## 🚀 Menjalankan Secara Lokal

1. **Clone repository**:
   ```bash
   git clone https://github.com/siput-bersenjata/BACKOFFICE-APIKU.git
   cd BACKOFFICE-APIKU
   ```

2. **Jalankan server lokal**:
   ```bash
   npm start
   ```

3. **Buka di browser**:
   Akses `http://localhost:3000`

---

## 🌐 Deployment ke Vercel

Proyek ini telah dikonfigurasi dengan `vercel.json` dan siap dideploy langsung ke Vercel:
```bash
vercel --prod --yes --name backoffice-apiku
```

---

## 🔒 Konfigurasi Akun

Akun yang terhubung ke Olsera Backoffice:
- **Akun**: `bapendapedua@gmail.com`
- **Toko / Outlet**: Naiki Cafe (`naikicafe`)
- **Role**: Perpajakan (`PJ`)
- **Base Endpoint**: `https://api-dash.olsera.co.id/`
