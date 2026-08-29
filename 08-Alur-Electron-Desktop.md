# Catatan Teknis: Alur Pembungkusan Aplikasi Desktop (Electron)

## Tujuan
Alur ini menjelaskan bagaimana aplikasi yang pada dasarnya berjalan sebagai web app dapat juga digunakan sebagai aplikasi desktop di lingkungan Windows, tanpa perlu menulis ulang logika aplikasi yang sudah ada.

## Alur Menjalankan Aplikasi sebagai Aplikasi Desktop

Ketika pengguna membuka aplikasi dalam bentuk desktop, proses utama Electron akan berjalan terlebih dahulu di latar belakang. Proses utama ini bertugas menjalankan seluruh layanan internal (lapisan penghubung beserta layanan-layanan pendukungnya) secara lokal di mesin pengguna, sama persis seperti ketika aplikasi dijalankan sebagai web app biasa.

Setelah seluruh layanan internal siap berjalan, Electron akan membuka sebuah jendela aplikasi yang menampilkan antarmuka pengguna, yang secara fungsional tidak berbeda dari tampilan web app, namun kini dibungkus dalam jendela aplikasi native yang dapat dipasang dan dijalankan layaknya aplikasi Windows pada umumnya.

## Alur Interaksi Pengguna dalam Mode Desktop

Seluruh interaksi pengguna dalam mode desktop mengikuti alur yang sama persis dengan mode web app — permintaan dari antarmuka tetap diteruskan ke lapisan penghubung, yang kemudian berkoordinasi dengan layanan-layanan internal lainnya. Perbedaannya hanya terletak pada bagaimana aplikasi dijalankan dan dibuka oleh pengguna, bukan pada bagaimana data diproses di dalamnya.

## Alur Penutupan Aplikasi

Ketika pengguna menutup jendela aplikasi desktop, proses utama Electron turut menghentikan seluruh layanan internal yang berjalan di latar belakang, sehingga tidak ada proses yang tertinggal berjalan setelah aplikasi ditutup sepenuhnya.

## Alasan Pendekatan Ini Dipilih

Karena seluruh logika layanan internal aplikasi ini dibangun menggunakan teknologi yang sama dengan yang didukung secara native oleh Electron, seluruh logika tersebut dapat dijalankan apa adanya di dalam proses utama Electron tanpa perlu penulisan ulang ke bahasa atau teknologi lain, sehingga versi web app dan versi desktop dapat berbagi logika inti yang sama persis.
