# Catatan Teknis: Alur BFF (Backend for Frontend)

## Tanggung Jawab
Lapisan ini menjadi satu-satunya titik yang dihubungi oleh antarmuka pengguna. Tidak ada satu pun layanan internal lain (Jira Service, GitHub Service, Discord Service, layanan penyimpanan) yang dihubungi secara langsung oleh antarmuka pengguna — semuanya melewati lapisan ini terlebih dahulu.

## Alasan Keberadaan Lapisan Ini

Karena informasi yang ditampilkan kepada pengguna merupakan gabungan dari beberapa sumber berbeda (ticket dari Jira, Pull Request dari GitHub, dan link video dari penyimpanan lokal), antarmuka pengguna tidak perlu mengetahui atau mengurus dari mana saja data tersebut berasal. Lapisan ini yang mengurus seluruh koordinasi tersebut, sehingga antarmuka pengguna cukup meminta satu permintaan data dan menerima satu hasil yang sudah lengkap dan tergabung.

## Alur Permintaan Data Dashboard

Ketika pengguna membuka dashboard, antarmuka mengirimkan satu permintaan kepada lapisan ini yang menyatakan data apa saja yang ingin ditampilkan. Lapisan ini kemudian meneruskan permintaan pengambilan ticket kepada Jira Service, menunggu hasilnya, dan menyusun data tersebut sesuai kebutuhan tampilan sebelum dikembalikan ke antarmuka.

## Alur Permintaan Detail Ticket

Ketika pengguna membuka detail sebuah ticket tertentu, lapisan ini akan menghubungi lebih dari satu layanan sekaligus: meminta detail ticket dari Jira Service, meminta daftar Pull Request terkait dari GitHub Service, dan meminta link rekaman demo yang tersimpan dari layanan penyimpanan. Setelah seluruh hasil tersebut diterima, lapisan ini menggabungkannya menjadi satu struktur data yang utuh, kemudian mengembalikannya sebagai satu jawaban kepada antarmuka pengguna.

## Alur Pemicu Aksi Pengguna

Untuk aksi seperti melengkapi link rekaman demo atau memicu pengiriman rangkuman ke Discord, lapisan ini bertindak sebagai penerus permintaan pengguna kepada layanan yang relevan (layanan penyimpanan untuk penyimpanan link video, atau Discord Service untuk pengiriman pesan), lalu mengembalikan hasil dari aksi tersebut kepada antarmuka sebagai konfirmasi.

## Sifat Komunikasi

Permintaan dari antarmuka pengguna menuju lapisan ini bersifat satu permintaan untuk satu kebutuhan tampilan, sekalipun di baliknya lapisan ini mungkin perlu menghubungi beberapa layanan internal sekaligus untuk memenuhi kebutuhan tersebut. Dengan demikian, kompleksitas penggabungan berbagai sumber data sepenuhnya tersembunyi dari sisi antarmuka pengguna.
