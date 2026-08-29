# Skenario Penggunaan End-to-End (User Journey)

## Tujuan
Dokumen ini menceritakan alur pemakaian aplikasi dari sudut pandang pengguna, dari awal membuka aplikasi hingga rangkuman pekerjaan berhasil dikirimkan ke Discord. Berbeda dengan PRD yang berisi kebutuhan produk, dokumen ini berfokus pada cerita pemakaian sehari-hari.

## Skenario: Menyelesaikan Satu Ticket dari Awal hingga Selesai

Pagi hari, pengguna membuka aplikasi. Karena kredensial sudah dikonfigurasi sebelumnya, aplikasi langsung menampilkan dashboard berisi seluruh ticket yang ditugaskan kepadanya, terkelompok berdasarkan status. Pengguna melihat ada satu ticket baru dengan status belum dikerjakan.

Pengguna membuka ticket tersebut untuk melihat detailnya, lalu berpindah ke Jira secara langsung untuk mengubah status ticket tersebut menjadi sedang dikerjakan, sebagaimana kebiasaan kerja yang sudah berjalan. Aplikasi akan mencerminkan perubahan status ini pada pembaruan data berikutnya.

Pengguna kemudian mulai mengerjakan ticket tersebut, membuat branch dan Pull Request di repository Backend, dengan menyertakan ticket key pada judul Pull Request sesuai kebiasaan yang selama ini dilakukan. Pengguna juga membuat Pull Request kedua di repository Frontend untuk ticket yang sama, juga menyertakan ticket key yang sama pada judulnya.

Setelah kedua Pull Request tersebut dibuat, pengguna kembali membuka aplikasi dan menekan tombol pembaruan data. Aplikasi menampilkan bahwa ticket tersebut kini memiliki dua Pull Request tertaut, satu dari repository Backend dan satu dari repository Frontend, lengkap dengan status masing-masing yang menunjukkan keduanya masih terbuka dan menunggu review.

Pengguna kemudian merekam sesi demo singkat menggunakan Loom untuk menunjukkan hasil pekerjaannya, dan menempelkan link rekaman tersebut ke dalam field yang tersedia pada ticket di aplikasi.

Dengan seluruh informasi telah lengkap — ticket, dua Pull Request, dan link rekaman demo — pengguna menekan tombol untuk memposting rangkuman. Aplikasi menyusun pesan dengan format yang konsisten dan langsung mengirimkannya ke thread Discord yang sudah dikonfigurasi, tanpa pengguna perlu menyalin atau menyusun teks apapun secara manual.

## Skenario: Memeriksa Pull Request yang Bermasalah

Di kesempatan lain, pengguna membuka bagian yang menyoroti pekerjaan yang membutuhkan perhatian. Di sana terlihat satu Pull Request dengan indikasi conflict. Pengguna membuka detail Pull Request tersebut, dan aplikasi menjalankan pemeriksaan tambahan untuk menemukan berkas-berkas mana saja yang menyebabkan conflict tersebut, lalu menampilkannya kepada pengguna, sehingga pengguna dapat langsung mengetahui bagian mana yang perlu diselesaikan tanpa harus memeriksa satu per satu secara manual di GitHub.

## Skenario: Menjalankan Aplikasi sebagai Aplikasi Desktop

Di lain waktu, pengguna memilih menjalankan aplikasi ini dalam bentuk aplikasi desktop yang telah terpasang di komputer Windows miliknya, alih-alih membukanya melalui browser. Pengalaman yang dirasakan pengguna tidak berbeda sama sekali dari versi web app — seluruh ticket, Pull Request, dan fitur posting ke Discord tetap berfungsi dengan cara yang sama persis, hanya saja kini berjalan dalam jendela aplikasi tersendiri.
