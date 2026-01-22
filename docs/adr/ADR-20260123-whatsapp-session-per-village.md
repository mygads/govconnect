# ADR-20260123 - Session WhatsApp per Desa (QR, Token Internal)

Status: Accepted

## Konteks
Kebutuhan terbaru mengubah mekanisme koneksi WhatsApp. Token tidak lagi diinput manual. Setiap admin desa membuat session sendiri, sistem meminta ke server WhatsApp, menyimpan token di database internal, dan menampilkan QR untuk login. Jika session sudah ada, cukup reconnect QR tanpa membuat session baru. Session juga harus bisa dihapus.

## Keputusan
1. Menyimpan token sesi WhatsApp di database Channel Service (internal-only).
2. Menambahkan endpoint internal untuk create, connect, status, QR, dan delete session.
3. Mengubah UI Channel Settings menjadi manajemen session (QR + status).
4. Menjadikan nomor WA dan status bersumber dari session aktif, bukan input manual.

## Konsekuensi
- Token tidak disimpan di dashboard dan tidak perlu input manual.
- Channel Service menjadi sumber kebenaran untuk status koneksi dan nomor WA.
- UI dashboard perlu akses API session untuk menampilkan QR dan status.
