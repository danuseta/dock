# Catatan Teknis: Alur Deployment & Menjalankan Sistem (Docker Compose)

## Tujuan
Alur ini menjelaskan urutan dan cara seluruh bagian sistem dijalankan bersama-sama di lingkungan lokal pengguna menggunakan Docker Compose, mengingat sistem terdiri dari beberapa layanan terpisah yang saling bergantung satu sama lain.

## Prinsip Umum

Karena sistem ini menganut arsitektur microservice dengan beberapa layanan berdiri sendiri-sendiri, seluruh layanan tersebut perlu dijalankan secara bersamaan agar sistem dapat berfungsi secara utuh. Docker Compose digunakan untuk menyederhanakan proses ini menjadi satu perintah, alih-alih pengguna harus menjalankan setiap layanan satu per satu secara manual.

## Alur Urutan Penyalaan Layanan

Ketika perintah untuk menjalankan seluruh sistem dieksekusi, layanan basis data (Postgres) akan dinyalakan terlebih dahulu, karena seluruh layanan lain yang membutuhkan penyimpanan data bergantung pada ketersediaan basis data ini. Sistem menunggu hingga basis data benar-benar siap menerima koneksi sebelum melanjutkan menyalakan layanan-layanan lainnya.

Setelah basis data siap, layanan-layanan internal (Jira Service, GitHub Service, Discord Service, dan layanan penyimpanan) dinyalakan. Karena masing-masing layanan ini bersifat independen satu sama lain, urutan penyalaan di antara mereka tidak terlalu memengaruhi satu sama lain, hanya saja seluruhnya harus sudah aktif sebelum lapisan penghubung dijalankan.

Setelah seluruh layanan internal siap, lapisan penghubung (BFF) dinyalakan, karena lapisan ini perlu dapat menghubungi seluruh layanan internal tersebut. Terakhir, aplikasi antarmuka pengguna (frontend) dinyalakan dan siap diakses oleh pengguna.

## Alur Layanan Saling Menemukan Satu Sama Lain

Di dalam lingkungan Docker Compose, setiap layanan dapat saling menemukan satu sama lain menggunakan nama layanan yang telah didefinisikan, tanpa perlu mengetahui alamat jaringan yang sesungguhnya. Dengan demikian, lapisan penghubung cukup mengetahui nama layanan Jira Service, GitHub Service, dan seterusnya untuk dapat berkomunikasi dengannya, tanpa bergantung pada alamat yang bisa berubah-ubah.

## Alur Penghentian Sistem

Ketika pengguna ingin menghentikan seluruh sistem, seluruh layanan akan dihentikan secara bersamaan melalui satu perintah, memastikan tidak ada layanan yang tertinggal berjalan di latar belakang setelah sistem dihentikan.

## Alur Menjalankan Ulang Setelah Perubahan

Apabila terjadi perubahan pada salah satu layanan (misalnya perubahan kode pada GitHub Service), hanya layanan yang bersangkutan yang perlu dibangun ulang dan dinyalakan kembali, tanpa perlu mengulang seluruh proses penyalaan dari awal untuk layanan-layanan lain yang tidak mengalami perubahan.

## Hubungan dengan Mode Desktop (Electron)

Ketika sistem dijalankan dalam bentuk aplikasi desktop, urutan penyalaan layanan pada dasarnya mengikuti prinsip yang sama seperti pada Docker Compose, hanya saja seluruh proses penyalaan tersebut dikelola secara otomatis oleh proses utama Electron di latar belakang, sehingga pengguna tidak perlu menjalankan perintah apapun secara manual seperti pada mode pengembangan.
