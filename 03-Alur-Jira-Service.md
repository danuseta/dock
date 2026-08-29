# Catatan Teknis: Alur Jira Service

## Tanggung Jawab
Layanan ini bertanggung jawab penuh atas segala sesuatu yang berkaitan dengan pengambilan data ticket dari Jira. Tidak ada layanan lain dalam sistem yang berkomunikasi langsung dengan Jira selain melalui layanan ini.

## Alur Kerja

Ketika pengguna membuka dashboard atau menekan tombol pembaruan data, permintaan akan diteruskan dari lapisan penghubung ke layanan ini. Layanan kemudian melakukan autentikasi menggunakan kredensial pribadi pengguna yang telah dikonfigurasi sebelumnya, lalu mengambil seluruh ticket yang saat ini ditugaskan kepada pengguna tersebut.

Setelah data ticket diterima, layanan melakukan pengelompokan berdasarkan status pengerjaan masing-masing ticket. Pengelompokan ini mengikuti status yang memang sudah berlaku di lingkungan Jira milik pengguna, tanpa perlu pemetaan status yang kaku, karena setiap proyek bisa memiliki penamaan status yang sedikit berbeda.

Data yang telah diambil dan dikelompokkan kemudian disimpan sementara sebagai data cache pada penyimpanan milik layanan ini, dengan tujuan agar permintaan berikutnya dalam rentang waktu singkat tidak perlu selalu memanggil Jira secara langsung. Data cache ini akan diperbarui setiap kali ada pemicu pembaruan, baik yang dilakukan secara manual oleh pengguna maupun yang berjalan otomatis secara berkala.

Ketika pengguna membuka detail sebuah ticket tertentu, layanan ini menyediakan informasi lengkap ticket tersebut kepada lapisan penghubung, yang kemudian akan digabungkan dengan data dari layanan lain (seperti Pull Request terkait) sebelum ditampilkan secara utuh kepada pengguna.

## Batasan Alur
Layanan ini murni bersifat pembaca data (read-only) terhadap Jira. Tidak ada alur yang mengubah status ticket dari sisi aplikasi ini — perubahan status ticket tetap dilakukan pengguna secara langsung di Jira, sebagaimana kebiasaan kerja yang sudah berjalan.
