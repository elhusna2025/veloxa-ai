import type { BusinessCategory } from './veloxa-types';

export const BUSINESS_CATEGORIES: readonly { value: BusinessCategory; label: string; keywords: string }[] = [
  {
    "value": "cafe_fnb",
    "label": "Makanan & minuman",
    "keywords": "kuliner kafe restoran catering"
  },
  {
    "value": "running_event",
    "label": "Acara & olahraga",
    "keywords": "event kebugaran lari"
  },
  {
    "value": "clinic_beauty",
    "label": "Kesehatan & kecantikan",
    "keywords": "klinik salon spa"
  },
  {
    "value": "fashion_retail",
    "label": "Fashion & retail",
    "keywords": "busana pakaian toko"
  },
  {
    "value": "education",
    "label": "Pendidikan",
    "keywords": "kursus sekolah bimbingan belajar"
  },
  {
    "value": "software_saas",
    "label": "Software & SaaS",
    "keywords": "aplikasi ERP POS teknologi perangkat lunak"
  },
  {
    "value": "professional_services",
    "label": "Jasa profesional",
    "keywords": "konsultan hukum akuntan"
  },
  {
    "value": "creative_agency",
    "label": "Agensi & jasa kreatif",
    "keywords": "desain pemasaran fotografi"
  },
  {
    "value": "retail_wholesale",
    "label": "Ritel & grosir",
    "keywords": "distributor toko perdagangan"
  },
  {
    "value": "ecommerce",
    "label": "Toko online & e-commerce",
    "keywords": "marketplace"
  },
  {
    "value": "manufacturing",
    "label": "Manufaktur & produksi",
    "keywords": "pabrik industri"
  },
  {
    "value": "hotel_hospitality",
    "label": "Hotel & penginapan",
    "keywords": "vila resort hospitality"
  },
  {
    "value": "travel_tourism",
    "label": "Travel & pariwisata",
    "keywords": "wisata perjalanan tur"
  },
  {
    "value": "property",
    "label": "Properti",
    "keywords": "rumah apartemen agen real estat"
  },
  {
    "value": "construction",
    "label": "Konstruksi & interior",
    "keywords": "kontraktor bangunan arsitek"
  },
  {
    "value": "automotive",
    "label": "Otomotif & bengkel",
    "keywords": "mobil motor servis"
  },
  {
    "value": "logistics",
    "label": "Logistik & transportasi",
    "keywords": "kurir ekspedisi pengiriman"
  },
  {
    "value": "finance",
    "label": "Keuangan & asuransi",
    "keywords": "pembiayaan perbankan"
  },
  {
    "value": "agriculture",
    "label": "Pertanian & peternakan",
    "keywords": "perkebunan perikanan"
  },
  {
    "value": "home_services",
    "label": "Jasa rumah tangga",
    "keywords": "laundry kebersihan perawatan"
  },
  {
    "value": "entertainment",
    "label": "Hiburan & rekreasi",
    "keywords": "taman bermain tempat hiburan"
  },
  {
    "value": "media",
    "label": "Media & penerbitan",
    "keywords": "berita buku kreator"
  },
  {
    "value": "nonprofit",
    "label": "Organisasi & komunitas",
    "keywords": "yayasan sosial nirlaba"
  },
  {
    "value": "custom",
    "label": "Lainnya / umum",
    "keywords": "lain umum"
  }
];

export function businessCategoryLabel(value: string): string {
  return BUSINESS_CATEGORIES.find(item => item.value === value)?.label || 'Lainnya / umum';
}
