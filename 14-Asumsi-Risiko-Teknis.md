# Asumsi & Risiko Teknis

## Tujuan
Dokumen ini memperdalam asumsi yang telah disinggung pada PRD dan SRS, serta menguraikan risiko teknis yang mungkin muncul akibat asumsi tersebut, beserta dampaknya terhadap sistem apabila asumsi itu tidak lagi terpenuhi di kemudian hari.

## Asumsi 1: Konsistensi Penulisan Ticket Key pada Branch dan Pull Request

Seluruh mekanisme pencocokan otomatis antara ticket dan Pull Request bergantung sepenuhnya pada kebiasaan menuliskan ticket key pada judul atau nama branch. Selama kebiasaan ini konsisten dijalankan, deteksi otomatis dapat diandalkan sepenuhnya tanpa perlu penautan manual.

**Risiko:** Apabila suatu saat kebiasaan penulisan ini berubah, terlewat, atau tidak konsisten (misalnya karena anggota tim baru yang belum terbiasa, atau Pull Request yang dibuat terburu-buru), maka Pull Request yang bersangkutan tidak akan terdeteksi secara otomatis oleh sistem, dan ticket tersebut akan terlihat seolah belum memiliki Pull Request sama sekali padahal sebenarnya sudah ada.

**Dampak:** Risiko ini murni bersifat operasional (kebiasaan kerja), bukan kegagalan sistem. Karena sistem generasi pertama ini tidak menyediakan mekanisme penautan manual sebagai jalan keluar, apabila risiko ini dianggap cukup mungkin terjadi, perlu dipertimbangkan penambahan fitur penautan manual sebagai pelengkap pada versi berikutnya.

## Asumsi 2: Kredensial Pribadi Aman Disimpan Secara Lokal

Sistem mengasumsikan bahwa karena aplikasi berjalan di mesin milik pengguna sendiri, penyimpanan kredensial secara lokal sudah cukup aman tanpa memerlukan enkripsi tambahan atau pengelolaan rahasia (secret management) yang lebih kompleks.

**Risiko:** Apabila mesin pengguna diakses oleh pihak lain, atau file konfigurasi secara tidak sengaja ikut tersalin atau terunggah ke tempat lain (misalnya tanpa sadar ikut ter-commit ke repository), kredensial tersebut berpotensi bocor.

**Dampak:** Perlu dipastikan berkas yang menyimpan kredensial selalu masuk daftar berkas yang diabaikan dari version control, dan tidak pernah disertakan secara tidak sengaja ke tempat manapun di luar mesin pengguna.

## Asumsi 3: Ketergantungan pada Ketersediaan Tiga Layanan Eksternal

Fungsi utama sistem bergantung penuh pada ketersediaan Jira, GitHub, dan Discord. Sistem tidak memiliki sumber data cadangan apabila salah satu layanan tersebut benar-benar tidak dapat diakses dalam waktu lama.

**Risiko:** Apabila salah satu layanan eksternal mengalami gangguan berkepanjangan, perubahan kebijakan akses API, atau perubahan struktur data yang signifikan, bagian sistem yang bergantung pada layanan tersebut akan terdampak hingga penyesuaian dilakukan.

**Dampak:** Selama gangguan berlangsung, sistem tetap dapat menampilkan data dari cache terakhir yang berhasil diambil, namun tidak dapat menampilkan data terbaru sampai layanan yang bersangkutan kembali normal.

## Asumsi 4: Volume Data yang Rendah

Desain penyimpanan data (termasuk pemilihan satu instance basis data dengan pemisahan schema per layanan) mengasumsikan bahwa jumlah ticket dan Pull Request yang diproses tetap dalam skala penggunaan personal, bukan skala tim besar atau organisasi.

**Risiko:** Apabila di kemudian hari sistem ini diperluas untuk digunakan oleh lebih dari satu orang sekaligus, asumsi mengenai volume data rendah dan tidak adanya kebutuhan concurrent write yang tinggi tidak lagi berlaku, dan desain penyimpanan data perlu ditinjau ulang.

**Dampak:** Karena hal ini di luar scope produk saat ini (yang memang ditujukan untuk penggunaan personal), risiko ini hanya relevan apabila arah pengembangan produk berubah di masa depan.

## Asumsi 5: Pemeriksaan Detail Conflict Bersifat On-Demand

Sistem mengasumsikan bahwa pengguna tidak membutuhkan informasi detail berkas yang conflict secara instan dan real-time, melainkan cukup diperiksa saat dibutuhkan.

**Risiko:** Apabila suatu saat kebutuhan berubah menjadi ingin mengetahui conflict secara instan tanpa perlu membuka detail ticket terlebih dahulu, pendekatan on-demand ini tidak akan memenuhi kebutuhan tersebut, dan akan membutuhkan mekanisme pemeriksaan otomatis di latar belakang yang tentunya membutuhkan sumber daya komputasi lebih besar.

**Dampak:** Selama kebutuhan pengguna masih sesuai dengan asumsi awal, pendekatan ini tetap menjadi pilihan yang paling efisien dan tidak membebani penggunaan aplikasi sehari-hari.
