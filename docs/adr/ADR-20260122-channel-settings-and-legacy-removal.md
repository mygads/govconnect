# ADR-20260122 - Konsolidasi Channel Settings dan Penghapusan Fitur Legacy

Status: Accepted

## Konteks
Kebutuhan terbaru menegaskan bahwa koneksi WhatsApp dikelola melalui **Channel Connect** (token + nomor), dan seluruh fitur lama berbasis sesi (QR/pairphone) tidak lagi digunakan. Selain itu, scope layanan saat ini hanya desa/kelurahan sehingga modul reservasi/tiket legacy perlu dihapus agar arsitektur dan UI konsisten.

## Keputusan
1. Menghapus endpoint dan UI legacy untuk WhatsApp session (QR, pairphone, connect/disconnect/logout, settings).
2. Menegaskan **Channel Connect** sebagai satu-satunya sumber konfigurasi token dan nomor WA, dengan toggle enable/disable WA/Webchat.
3. Menonaktifkan dan menghapus modul legacy reservasi/tiket di dashboard dan API.
4. Memastikan AI tidak memproses pesan ketika channel dimatikan (WA/Webchat).

## Konsekuensi
- Dokumentasi dan koleksi Postman diperbarui agar hanya menampilkan endpoint yang aktif.
- Integrasi lama yang mengandalkan QR/pairphone perlu dimigrasikan ke Channel Connect.
- Sistem menjadi lebih sederhana dan konsisten dengan desain desa/kelurahan saat ini.
