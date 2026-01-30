# ADR-20260130 Status Final Seragam

Status: Accepted

## Konteks
Diperlukan status seragam untuk layanan dan laporan agar alur bisnis konsisten lintas WA/Webchat, menghindari delete fisik, serta memastikan setiap perubahan tercatat sebagai update status dengan metadata (catatan admin/alasan).

## Keputusan
Menetapkan status final seragam untuk layanan dan laporan: **OPEN**, **PROCESS**, **DONE**, **CANCELED**, **REJECT**. Tidak ada status lain dan tidak ada delete fisik. Status `DONE`, `CANCELED`, dan `REJECT` wajib menyertakan catatan admin/alasan. Pembatalan oleh warga menyimpan keterangan pembatalan di catatan.

## Konsekuensi
- Semua service dan UI harus menggunakan status yang sama.
- API update status wajib memvalidasi catatan admin/alasan pada status final.
- Dokumentasi dan prompt AI wajib mengikuti aturan status ini.
