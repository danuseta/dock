# Glosarium Istilah

Dokumen ini berisi daftar istilah yang digunakan secara konsisten di seluruh dokumen PRD, SRS, dan catatan alur teknis, agar tidak terjadi perbedaan pemahaman antar dokumen.

**Ticket key** — Penanda unik yang diberikan Jira pada setiap ticket, biasanya berupa kombinasi singkatan proyek dan nomor urut. Penanda inilah yang digunakan sebagai kunci pencocokan otomatis antara sebuah ticket dan Pull Request yang berkaitan dengannya.

**Pull Request (PR)** — Permintaan penggabungan perubahan kode pada GitHub. Satu ticket dapat memiliki lebih dari satu Pull Request yang tertaut, misalnya satu dari repository Backend dan satu dari repository Frontend.

**Conflict** — Kondisi ketika perubahan pada sebuah Pull Request tidak dapat digabungkan secara otomatis ke branch tujuannya karena adanya perubahan lain yang saling bertabrakan pada berkas yang sama.

**BFF (Backend for Frontend)** — Lapisan penghubung yang menjadi satu-satunya titik komunikasi antara antarmuka pengguna dan seluruh layanan internal lainnya. Lapisan ini yang mengumpulkan dan menggabungkan data dari berbagai layanan sebelum dikembalikan kepada antarmuka pengguna.

**Jira Service** — Layanan internal yang bertanggung jawab atas seluruh komunikasi dengan Jira, termasuk pengambilan data ticket.

**GitHub Service** — Layanan internal yang bertanggung jawab atas seluruh komunikasi dengan GitHub, termasuk pencarian Pull Request dan pemeriksaan status maupun detail conflict-nya.

**Discord Service** — Layanan internal yang bertanggung jawab menyusun pesan rangkuman dan mengirimkannya ke Discord.

**Storage Service** — Layanan internal yang menyimpan data yang tidak tersedia secara otomatis dari sistem eksternal, seperti link rekaman demo, serta menyimpan data cache dari layanan-layanan lain.

**Cache** — Salinan data yang disimpan sementara agar sistem tidak perlu selalu memanggil layanan eksternal secara berulang setiap kali data yang sama dibutuhkan.

**Schema-per-service** — Pendekatan penyimpanan data di mana seluruh layanan berbagi satu instance basis data yang sama, namun masing-masing layanan memiliki area penyimpanan data (schema) sendiri yang terpisah secara logis dari layanan lainnya.

**Webhook Discord** — Alamat khusus yang disediakan Discord untuk menerima pesan yang dikirimkan secara otomatis dari sistem luar, tanpa memerlukan proses login secara langsung.

**Rangkuman (post)** — Pesan yang disusun dari gabungan informasi ticket, seluruh Pull Request yang tertaut, dan link rekaman demo, yang kemudian dikirimkan ke Discord untuk meminta review dari rekan tim.

**Needs Attention** — Tampilan khusus dalam aplikasi yang menyoroti Pull Request yang berstatus conflict atau yang telah menunggu review dalam jangka waktu yang cukup lama.
