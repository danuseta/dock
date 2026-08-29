# Catatan Teknis: Alur GitHub Service

## Tanggung Jawab
Layanan ini bertanggung jawab atas segala sesuatu yang berkaitan dengan pencarian dan pemeriksaan status Pull Request di seluruh repository GitHub yang telah dikonfigurasi oleh pengguna.

## Alur Pencocokan Pull Request terhadap Ticket

Ketika pengguna membuka detail sebuah ticket, lapisan penghubung akan meneruskan ticket key dari ticket tersebut kepada layanan ini. Layanan kemudian melakukan pencarian ke seluruh repository yang telah dikonfigurasi, mencari Pull Request yang judul atau nama branch-nya mengandung ticket key tersebut.

Karena kebiasaan penulisan branch dan judul Pull Request di lingkungan pengguna selalu menyertakan ticket key, proses pencocokan ini dapat dilakukan sepenuhnya secara otomatis tanpa membutuhkan input atau penautan manual dari pengguna. Seluruh Pull Request yang ditemukan — baik satu maupun lebih dari satu, dan baik berasal dari repository yang sama maupun berbeda — akan dikembalikan sebagai satu kumpulan yang berkaitan dengan ticket tersebut.

## Alur Pemeriksaan Status Dasar

Untuk setiap Pull Request yang ditemukan, layanan akan memeriksa status dasarnya, yaitu apakah Pull Request tersebut masih terbuka, sudah digabungkan, masih berupa draft, atau memiliki indikasi conflict terhadap branch tujuannya. Pemeriksaan status dasar ini bersifat ringan dan dapat dilakukan setiap kali data diperbarui tanpa membebani sistem.

## Alur Pemeriksaan Detail Conflict

Pemeriksaan detail conflict berbeda perlakuannya dari pemeriksaan status dasar. Alur ini tidak berjalan otomatis bersamaan dengan pengambilan data biasa, melainkan hanya dipicu ketika pengguna secara eksplisit membuka atau meminta detail dari sebuah Pull Request yang telah diketahui berstatus conflict.

Ketika dipicu, layanan akan mengambil salinan ringan dari branch Pull Request tersebut beserta branch tujuannya, kemudian melakukan simulasi penggabungan tanpa benar-benar mengubah, menyimpan, atau memengaruhi repository asli dengan cara apapun. Hasil simulasi ini kemudian diperiksa untuk menemukan berkas-berkas mana saja yang menjadi penyebab conflict, dan daftar berkas tersebut dikembalikan kepada pengguna sebagai informasi tambahan.

Pendekatan ini sengaja dipisahkan agar proses yang lebih berat secara komputasi tidak membebani pengalaman penggunaan sehari-hari, dan hanya dijalankan pada saat benar-benar dibutuhkan.

## Batasan Alur
Layanan ini murni bersifat pembaca data (read-only) terhadap GitHub. Tidak ada alur yang membuat, mengubah, atau menggabungkan Pull Request dari sisi aplikasi ini.
