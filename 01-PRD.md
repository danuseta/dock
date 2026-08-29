# Product Requirements Document (PRD)
## Dev Task & PR Tracker Dashboard

---

## 1. Latar Belakang

Sebagai developer, pekerjaan sehari-hari melibatkan dua sistem yang tidak saling terintegrasi: Jira (untuk tracking ticket) dan GitHub (untuk tracking Pull Request). Saat ini, kedua sistem tersebut hanya terhubung secara tidak langsung melalui notifikasi terpisah yang dikirim ke Discord — Jira mengirim notifikasi sendiri, GitHub mengirim notifikasi sendiri, dan keduanya tidak saling mengenal.

Akibatnya, setiap kali sebuah ticket selesai dikerjakan dan menghasilkan lebih dari satu Pull Request (misalnya satu untuk Backend dan satu untuk Frontend), developer harus secara manual mengumpulkan seluruh informasi terkait (link Jira, link PR Frontend, link PR Backend, link rekaman demo) dan menyusun satu pesan rangkuman untuk diposting ke thread Discord. Proses ini repetitif dan memakan waktu, terutama karena informasi yang dibutuhkan tersebar di beberapa tempat berbeda.

## 2. Tujuan Produk

Membangun sebuah dashboard personal yang berfungsi sebagai penghubung antara Jira dan GitHub, sehingga developer bisa:
- Melihat seluruh ticket yang di-assign kepadanya dalam satu tempat, dikelompokkan berdasarkan status pengerjaan.
- Melihat status seluruh Pull Request yang berkaitan dengan sebuah ticket tanpa perlu mencari manual satu per satu di GitHub.
- Mengetahui Pull Request mana yang sudah merge, mana yang masih terbuka, dan mana yang memiliki conflict.
- Menyusun dan mengirim rangkuman pekerjaan ke Discord secara otomatis, dengan format pesan yang konsisten setiap saat.

## 3. Target Pengguna

Produk ini ditujukan untuk penggunaan personal oleh satu orang developer, bukan sebagai produk multi-tenant atau SaaS. Tidak ada kebutuhan manajemen banyak pengguna, role, atau permission bertingkat pada versi ini.

## 4. Ruang Lingkup (Scope)

### 4.1 Termasuk dalam Scope
- Menampilkan ticket Jira yang di-assign ke pengguna, dikelompokkan berdasarkan status pengerjaan.
- Mendeteksi Pull Request yang berkaitan dengan sebuah ticket secara otomatis, berdasarkan kesamaan penanda unik (ticket key) yang muncul di judul atau nama branch Pull Request.
- Menampilkan status tiap Pull Request, termasuk indikasi apabila terjadi conflict, lengkap dengan detail berkas yang bentrok apabila pengguna ingin memeriksa lebih dalam.
- Menyediakan tempat bagi pengguna untuk melampirkan link rekaman demo pada sebuah ticket.
- Menyusun rangkuman informasi ticket dan mengirimkannya secara otomatis ke saluran Discord yang telah dikonfigurasi.
- Menyediakan tampilan khusus yang menyoroti pekerjaan yang membutuhkan perhatian segera, seperti Pull Request yang conflict atau menunggu review dalam waktu lama.
- Kemampuan untuk memperbarui data secara manual maupun otomatis secara berkala.
- Kemampuan untuk berjalan sebagai aplikasi desktop di lingkungan Windows.

### 4.2 Tidak Termasuk dalam Scope
- Manajemen banyak pengguna atau tim dalam satu instance aplikasi.
- Penggantian atau penghapusan sistem notifikasi Discord yang sudah berjalan saat ini — sistem lama tetap dipertahankan berdampingan.
- Integrasi langsung antara Jira dan GitHub di luar apa yang disediakan oleh masing-masing penyedia layanan.
- Fitur analitik atau pelaporan historis jangka panjang di luar kebutuhan tracking harian.

## 5. Masalah yang Diselesaikan

Produk ini secara khusus menjawab tiga kebutuhan utama pengguna:
1. Kebutuhan untuk mengetahui seluruh pekerjaan yang sedang ditugaskan tanpa harus berpindah-pindah antar aplikasi.
2. Kebutuhan untuk mengetahui hubungan antara satu ticket dengan Pull Request-nya, mengingat satu ticket bisa menghasilkan lebih dari satu Pull Request di repository berbeda.
3. Kebutuhan untuk menghilangkan proses manual berulang dalam menyusun dan mengirim rangkuman pekerjaan ke Discord.

## 6. Asumsi

- Penulisan nama branch dan judul Pull Request selalu menyertakan penanda ticket key, sehingga pencocokan otomatis antara ticket dan Pull Request dapat diandalkan.
- Pengguna memiliki akses kredensial pribadi ke Jira Cloud dan GitHub yang dapat digunakan aplikasi untuk mengambil data.
- Aplikasi dijalankan pada mesin milik pengguna sendiri, sehingga penyimpanan kredensial secara lokal dianggap aman dalam konteks ini.

## 7. Batasan (Constraints)

- Karena ini merupakan proyek personal, prioritas utama adalah kecepatan penggunaan sehari-hari, bukan skalabilitas untuk banyak pengguna.
- Proses yang berat secara komputasi (seperti pemeriksaan detail file yang conflict) sebaiknya dilakukan hanya ketika dibutuhkan, bukan berjalan terus-menerus di latar belakang, untuk menjaga aplikasi tetap ringan.
- Informasi rekaman demo tidak dapat dideteksi secara otomatis dari sistem manapun, sehingga tetap membutuhkan input manual dari pengguna.

## 8. Indikator Keberhasilan

- Pengguna tidak perlu lagi membuka Jira dan GitHub secara terpisah untuk mengetahui status pekerjaannya sehari-hari.
- Proses menyusun pesan rangkuman untuk Discord berkurang dari proses manual menjadi satu kali klik.
- Pull Request yang bermasalah (conflict atau menunggu review terlalu lama) dapat diketahui lebih cepat dibanding sebelumnya.
