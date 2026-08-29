# Catatan Teknis: Alur Storage Service & Penyimpanan Data

## Tanggung Jawab
Layanan ini bertanggung jawab menyimpan informasi yang tidak dapat diperoleh secara otomatis dari Jira maupun GitHub, khususnya link rekaman demo yang dilampirkan pengguna pada sebuah ticket, serta menyimpan data cache dari layanan-layanan lain agar tidak perlu selalu memanggil sistem eksternal secara berulang.

## Prinsip Pemisahan Data Antar Layanan

Meskipun seluruh data disimpan dalam satu instance basis data yang sama, setiap layanan (Jira Service, GitHub Service, Discord Service, dan layanan penyimpanan itu sendiri) memiliki area penyimpanan data masing-masing yang terpisah secara logis satu sama lain. Pemisahan ini memastikan bahwa setiap layanan hanya mengelola dan mengakses datanya sendiri, sejalan dengan prinsip bahwa setiap layanan dalam arsitektur ini memiliki tanggung jawab dan batasan datanya sendiri, tanpa perlu mencampur seluruh data ke dalam satu area penyimpanan yang sama.

## Alur Penyimpanan Link Rekaman Demo

Ketika pengguna melampirkan atau memperbarui link rekaman demo pada sebuah ticket melalui antarmuka, permintaan tersebut diteruskan oleh lapisan penghubung kepada layanan ini. Layanan akan menyimpan link tersebut dengan mengaitkannya pada identitas ticket yang bersangkutan, sehingga di kemudian hari, setiap kali ticket tersebut dibuka kembali, link yang sama akan selalu muncul tanpa perlu dimasukkan ulang.

## Alur Penyimpanan Data Cache

Setiap kali Jira Service atau GitHub Service berhasil mengambil data terbaru dari sistem eksternal, hasil tersebut disimpan sementara pada area penyimpanan milik masing-masing layanan. Tujuannya adalah agar permintaan berikutnya dalam rentang waktu yang berdekatan tidak perlu selalu memanggil ulang sistem eksternal, sehingga pengalaman penggunaan tetap terasa cepat. Data cache ini akan diperbarui atau ditimpa setiap kali proses pembaruan data terjadi, baik yang dipicu manual maupun otomatis secara berkala.

## Alur Konfigurasi

Informasi konfigurasi seperti daftar repository GitHub yang dipantau turut disimpan melalui layanan ini, sehingga pengaturan yang telah dimasukkan pengguna melalui halaman pengaturan akan tetap tersimpan dan digunakan pada penggunaan aplikasi berikutnya, tanpa perlu dikonfigurasi ulang setiap kali aplikasi dibuka.

## Batasan Alur
Layanan ini tidak pernah berkomunikasi langsung dengan Jira, GitHub, maupun Discord. Seluruh data yang tersimpan di layanan ini murni berasal dari input pengguna secara langsung atau dari hasil pengambilan data yang dilakukan oleh layanan lain.
