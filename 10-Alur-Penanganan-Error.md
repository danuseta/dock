# Catatan Teknis: Alur Penanganan Error & Kegagalan

## Tujuan
Karena sistem ini bergantung pada tiga layanan eksternal yang berada di luar kendali aplikasi (Jira, GitHub, Discord), alur ini menjelaskan bagaimana sistem bersikap ketika salah satu atau lebih dari layanan tersebut mengalami gangguan, sehingga kegagalan pada satu bagian tidak melumpuhkan keseluruhan aplikasi.

## Prinsip Umum

Kegagalan pada satu layanan eksternal seharusnya hanya memengaruhi bagian yang berkaitan dengan layanan tersebut, tidak menjalar ke bagian lain yang sebenarnya tidak bermasalah. Misalnya, apabila GitHub sedang mengalami gangguan, pengguna tetap dapat melihat daftar ticket dari Jira seperti biasa, hanya saja bagian Pull Request pada ticket tersebut akan menampilkan indikasi bahwa datanya sedang tidak dapat diambil.

## Alur Kegagalan Mengambil Data dari Jira

Apabila permintaan ke Jira gagal, baik karena gangguan layanan maupun karena kredensial yang sudah tidak valid, layanan terkait akan memberi tahu lapisan penghubung bahwa data ticket tidak dapat diperbarui saat ini. Lapisan penghubung kemudian akan tetap menampilkan data ticket yang terakhir kali berhasil diambil dari cache, disertai penanda bahwa data tersebut mungkin sudah tidak sepenuhnya terbaru, alih-alih menampilkan halaman kosong atau error yang menghentikan seluruh tampilan.

## Alur Kegagalan Mengambil Data dari GitHub

Apabila pencarian Pull Request ke GitHub gagal, baik karena gangguan layanan maupun karena batas jumlah permintaan yang diperbolehkan telah terlampaui, bagian Pull Request pada ticket yang sedang dibuka akan menampilkan indikasi bahwa informasi tersebut sedang tidak dapat diambil, sementara bagian lain dari ticket (seperti informasi dari Jira dan link video) tetap ditampilkan seperti biasa.

Khusus untuk keterbatasan jumlah permintaan pada GitHub, sistem akan menunggu hingga batas tersebut pulih kembali sebelum mencoba mengambil data ulang, dan tidak akan terus-menerus mencoba memanggil ulang secara agresif selama batas tersebut belum pulih.

## Alur Kegagalan Mengirim Pesan ke Discord

Apabila pengiriman rangkuman ke Discord gagal, misalnya karena alamat webhook sudah tidak valid atau layanan Discord sedang bermasalah, pengguna akan diberi tahu bahwa pengiriman tidak berhasil, dan diberikan kesempatan untuk mencoba mengirim ulang tanpa perlu menyusun ulang rangkuman pesan dari awal.

## Alur Kegagalan pada Pemeriksaan Detail Conflict

Karena pemeriksaan detail berkas yang conflict melibatkan proses tambahan berupa simulasi penggabungan, apabila proses ini gagal dilakukan (misalnya karena branch tidak dapat diakses), sistem akan tetap menampilkan status dasar bahwa Pull Request tersebut memiliki conflict, hanya saja detail berkas yang bentrok tidak dapat ditampilkan, disertai keterangan bahwa detail tersebut sedang tidak tersedia.

## Alur Notifikasi Kesalahan kepada Pengguna

Setiap kali terjadi kegagalan pada salah satu alur di atas, kesalahan tersebut ditampilkan secara jelas dan spesifik pada bagian yang bermasalah di antarmuka, bukan sebagai pesan kesalahan umum yang membingungkan, sehingga pengguna dapat memahami bagian mana yang bermasalah dan langkah apa yang bisa diambil selanjutnya (misalnya mencoba lagi, atau memeriksa kembali kredensial di halaman pengaturan).
