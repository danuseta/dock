# Catatan Teknis: Alur Discord Service

## Tanggung Jawab
Layanan ini bertanggung jawab atas penyusunan pesan rangkuman serta pengirimannya ke saluran Discord yang telah dikonfigurasi oleh pengguna.

## Alur Penyusunan Pesan

Alur ini dipicu ketika pengguna menekan tombol untuk memposting rangkuman sebuah ticket. Lapisan penghubung akan mengumpulkan seluruh informasi yang dibutuhkan dari berbagai layanan lain — informasi ticket dari Jira Service, daftar Pull Request beserta statusnya dari GitHub Service, dan link rekaman demo yang telah dilampirkan pengguna sebelumnya dari layanan penyimpanan.

Seluruh informasi tersebut kemudian diteruskan kepada layanan ini, yang bertugas menyusunnya menjadi satu pesan teks dengan format yang konsisten dan sudah baku — mencakup identitas ticket, judul, link Jira, link setiap Pull Request yang tertaut (dibedakan sesuai asal repository seperti Frontend atau Backend), serta link rekaman demo apabila tersedia.

## Alur Pengiriman ke Discord

Setelah pesan tersusun, layanan akan mengirimkan pesan tersebut ke saluran Discord yang telah dikonfigurasi menggunakan mekanisme webhook, sehingga proses pengiriman terjadi otomatis tanpa pengguna perlu menyalin atau menempelkan teks secara manual. Pengguna hanya perlu memicu pengiriman ini melalui satu aksi pada antarmuka.

## Hubungan dengan Notifikasi Discord yang Sudah Ada

Alur ini berjalan secara independen dan tidak menggantikan notifikasi otomatis yang selama ini sudah dikirimkan langsung oleh Jira maupun oleh GitHub ke Discord. Pesan rangkuman dari layanan ini bersifat tambahan, disusun khusus untuk memudahkan proses meminta review, dan dikirim ke saluran atau thread yang dapat dikonfigurasi secara terpisah dari notifikasi bawaan tersebut.

## Batasan Alur
Layanan ini tidak membaca atau memproses pesan apapun yang masuk ke Discord. Alurnya bersifat satu arah, yaitu hanya mengirimkan pesan keluar berdasarkan data yang telah dikumpulkan dari layanan lain.
