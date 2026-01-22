# ADR-20260122: Sinkronisasi Profil Desa ke Knowledge Base

Status: Accepted

## Konteks
Profil desa berisi data teks penting (nama, alamat, jam operasional) yang harus tersedia bagi AI. Sebelumnya profil tersimpan di tabel `village_profiles` tanpa otomatis masuk ke knowledge base, sehingga AI tidak selalu menemukan konteks profil saat menjawab pertanyaan warga.

## Keputusan
Setiap update profil desa akan menambahkan atau memperbarui entri `knowledge_base` dengan kategori "Profil Desa". Konten disusun dari data profil dan disinkronkan ke AI Service melalui API vektor.

## Konsekuensi
- AI selalu mendapatkan konteks profil desa tanpa perlu query tabel khusus.
- Ada sinkronisasi tambahan ke AI Service setiap kali profil diubah.
- Knowledge base menyimpan satu entri profil per desa dengan prioritas tinggi.
