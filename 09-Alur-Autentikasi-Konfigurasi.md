# Catatan Teknis: Alur Autentikasi & Konfigurasi Awal

## Tujuan
Alur ini menjelaskan bagaimana pengguna menghubungkan aplikasi dengan Jira, GitHub, dan Discord untuk pertama kalinya, serta bagaimana sistem memastikan kredensial yang dimasukkan benar-benar valid sebelum digunakan.

## Alur Konfigurasi Pertama Kali

Saat aplikasi dibuka untuk pertama kali, pengguna diarahkan menuju halaman pengaturan untuk melengkapi kredensial yang dibutuhkan. Untuk Jira, pengguna memasukkan alamat domain Jira Cloud miliknya, alamat email akun, dan API token yang sudah dibuat sebelumnya dari akun Atlassian miliknya. Untuk GitHub, pengguna memasukkan Personal Access Token beserta daftar repository yang ingin dipantau. Untuk Discord, pengguna memasukkan alamat webhook milik saluran atau thread tujuan pengiriman rangkuman.

## Alur Validasi Kredensial

Setelah pengguna memasukkan kredensial dan menyimpannya, sistem tidak langsung menerima kredensial tersebut begitu saja, melainkan melakukan satu kali pemanggilan percakapan sederhana ke masing-masing layanan eksternal untuk memastikan kredensial tersebut benar dan memiliki akses yang cukup. Untuk Jira dan GitHub, validasi dilakukan dengan mencoba mengambil informasi dasar milik pengguna sendiri. Untuk Discord, validasi dilakukan dengan memastikan alamat webhook yang dimasukkan valid dan dapat dituju.

Apabila validasi berhasil, kredensial disimpan dan pengguna dapat langsung melanjutkan ke tampilan dashboard. Apabila validasi gagal, sistem memberi tahu pengguna bagian mana yang bermasalah, agar pengguna dapat memperbaikinya tanpa harus menebak-nebak letak kesalahannya.

## Alur Penyimpanan Kredensial

Kredensial yang telah divalidasi disimpan secara lokal di lingkungan milik pengguna sendiri, tidak pernah dikirimkan atau disimpan di luar lingkungan tersebut. Setiap layanan internal yang membutuhkan akses ke sistem eksternal tertentu akan membaca kredensial yang relevan dari penyimpanan lokal ini setiap kali dibutuhkan.

## Alur Penggunaan Sehari-hari Setelah Konfigurasi Awal

Setelah konfigurasi awal selesai dan tersimpan, pengguna tidak perlu mengulangi proses ini setiap kali membuka aplikasi. Kredensial akan terus digunakan secara otomatis oleh layanan-layanan internal sampai pengguna mengubahnya sendiri melalui halaman pengaturan, misalnya ketika token yang lama sudah tidak berlaku dan perlu diganti dengan yang baru.

## Alur Perubahan atau Pembaruan Kredensial

Apabila suatu saat kredensial yang tersimpan sudah tidak valid lagi (misalnya token yang kedaluwarsa), sistem akan mendeteksi hal ini pada saat mencoba mengambil data dan memberi tahu pengguna bahwa diperlukan pembaruan kredensial, mengarahkan pengguna kembali ke halaman pengaturan untuk memasukkan kredensial yang baru, tanpa memengaruhi bagian lain dari data yang sudah tersimpan sebelumnya.
