# Software Requirements Specification (SRS)
## Dev Task & PR Tracker Dashboard

---

## 1. Deskripsi Umum Sistem

Sistem ini adalah aplikasi personal berbasis arsitektur microservice yang menghubungkan tiga sistem eksternal — Jira, GitHub, dan Discord — ke dalam satu antarmuka terpadu. Sistem terdiri dari sebuah lapisan antarmuka pengguna, sebuah lapisan penghubung yang menggabungkan data dari berbagai sumber, dan beberapa layanan internal yang masing-masing bertanggung jawab atas satu sistem eksternal tertentu. Sistem dapat dijalankan sebagai aplikasi web lokal maupun dibungkus menjadi aplikasi desktop.

## 2. Aktor Sistem

- **Pengguna (Developer)**: satu-satunya aktor manusia dalam sistem ini. Berinteraksi langsung dengan antarmuka untuk melihat ticket, memeriksa status Pull Request, melengkapi link rekaman demo, dan memicu pengiriman rangkuman ke Discord.
- **Sistem Jira**: sumber data ticket, diakses oleh sistem melalui kredensial milik pengguna.
- **Sistem GitHub**: sumber data Pull Request, diakses oleh sistem melalui kredensial milik pengguna.
- **Sistem Discord**: penerima pesan rangkuman yang dikirim oleh sistem.

## 3. Kebutuhan Fungsional

### 3.1 Pengelolaan Ticket
Sistem harus mampu menampilkan seluruh ticket yang di-assign kepada pengguna, mengelompokkannya berdasarkan status pengerjaan (misalnya belum dikerjakan, sedang dikerjakan, sedang direview, dan selesai), serta memperbarui data tersebut baik atas permintaan pengguna maupun secara berkala.

### 3.2 Pencocokan Pull Request terhadap Ticket
Sistem harus mampu menemukan seluruh Pull Request yang berkaitan dengan sebuah ticket tertentu, berdasarkan kecocokan penanda ticket key yang muncul pada judul atau nama branch Pull Request, tanpa membutuhkan input manual dari pengguna untuk melakukan penautan tersebut. Satu ticket harus dapat memiliki lebih dari satu Pull Request yang tertaut, termasuk Pull Request yang berasal dari repository yang berbeda-beda.

### 3.3 Status Pull Request
Sistem harus mampu menampilkan status terkini dari setiap Pull Request yang tertaut, termasuk apakah Pull Request tersebut masih terbuka, sudah digabungkan, masih berupa draft, atau memiliki conflict. Ketika sebuah Pull Request diketahui memiliki conflict, pengguna harus dapat meminta sistem menampilkan detail berkas mana saja yang menyebabkan conflict tersebut, dan pemeriksaan ini hanya dilakukan ketika diminta, bukan berjalan otomatis secara terus-menerus.

### 3.4 Pengelolaan Link Rekaman Demo
Sistem harus menyediakan tempat pada setiap ticket bagi pengguna untuk melampirkan sebuah link rekaman demo, yang kemudian tersimpan secara permanen dan dapat diperbarui kapan saja.

### 3.5 Penyusunan dan Pengiriman Rangkuman
Sistem harus mampu menyusun sebuah rangkuman informasi dari sebuah ticket — mencakup informasi ticket, seluruh Pull Request yang tertaut, dan link rekaman demo — menjadi satu pesan dengan format yang konsisten, dan mengirimkannya secara otomatis ke saluran Discord yang telah dikonfigurasi, dipicu oleh satu aksi dari pengguna.

### 3.6 Penyorotan Pekerjaan yang Membutuhkan Perhatian
Sistem harus menyediakan sebuah tampilan khusus yang menyoroti Pull Request yang memiliki conflict atau yang telah menunggu review dalam jangka waktu yang cukup lama, sehingga pengguna dapat memprioritaskan pekerjaan tersebut.

### 3.7 Pembaruan Data
Sistem harus mendukung dua cara pembaruan data: pembaruan yang dipicu langsung oleh pengguna, dan pembaruan otomatis yang berjalan secara berkala selama antarmuka sedang dibuka.

### 3.8 Konfigurasi
Sistem harus menyediakan tempat bagi pengguna untuk mengatur kredensial akses ke Jira, daftar repository GitHub yang ingin dipantau, kredensial akses ke GitHub, serta tujuan pengiriman pesan Discord.

## 4. Kebutuhan Non-Fungsional

### 4.1 Kinerja
Proses pengambilan data ticket dan Pull Request harus terasa responsif bagi satu pengguna. Proses yang lebih berat, seperti pemeriksaan detail conflict, tidak boleh berjalan sebagai proses latar belakang yang terus-menerus aktif, melainkan dijalankan hanya ketika pengguna membutuhkannya, agar aplikasi tetap ringan digunakan sehari-hari.

### 4.2 Keamanan
Seluruh kredensial yang digunakan untuk mengakses Jira dan GitHub disimpan secara lokal di lingkungan milik pengguna sendiri dan tidak pernah dikirimkan atau disimpan di luar lingkungan tersebut.

### 4.3 Ketersediaan
Karena merupakan aplikasi personal yang berjalan lokal, sistem tidak perlu memenuhi standar ketersediaan tingkat produksi seperti redundansi server atau penanganan banyak pengguna bersamaan.

### 4.4 Portabilitas
Sistem harus dapat dijalankan baik sebagai aplikasi web lokal maupun dibungkus menjadi aplikasi desktop yang dapat dipasang dan dijalankan di lingkungan sistem operasi Windows.

### 4.5 Pemeliharaan
Karena sistem dibangun dengan pendekatan arsitektur microservice, setiap bagian tanggung jawab (pengambilan data Jira, pengambilan data GitHub, pengiriman pesan Discord, penyimpanan data tambahan) harus terpisah secara jelas satu sama lain, sehingga masing-masing bagian dapat dipahami, diuji, dan diperbaiki secara independen tanpa memengaruhi bagian lainnya secara langsung.

### 4.6 Kompatibilitas dengan Sistem Lama
Sistem notifikasi Discord yang sudah berjalan saat ini (pengiriman notifikasi terpisah dari Jira dan dari GitHub) harus tetap dapat berjalan berdampingan tanpa terganggu oleh keberadaan sistem baru ini.

## 5. Batasan Desain

- Penautan antara ticket dan Pull Request sepenuhnya bergantung pada konsistensi penulisan ticket key pada judul atau nama branch Pull Request. Sistem tidak menyediakan mekanisme penautan manual sebagai cara utama, karena kebiasaan penulisan yang sudah konsisten menjadikan deteksi otomatis dapat diandalkan.
- Informasi rekaman demo tidak dapat diperoleh secara otomatis dari sumber manapun dan akan selalu membutuhkan input manual dari pengguna.

## 6. Ketergantungan Eksternal

Sistem bergantung pada ketersediaan dan kestabilan tiga layanan eksternal, yaitu layanan Jira Cloud, layanan GitHub, dan layanan Discord. Apabila salah satu layanan tersebut mengalami gangguan atau perubahan kebijakan akses, bagian sistem yang berkaitan dengan layanan tersebut akan terdampak secara langsung.
