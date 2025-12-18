'use client'

import { 
  generateOrganizationSchema,
  generateWebsiteSchema,
  generateSoftwareApplicationSchema,
  generateLocalBusinessSchema,
  generateFAQSchema,
  generateBreadcrumbSchema,
} from '@/lib/seo'

interface JsonLdProps {
  type: 'organization' | 'website' | 'software' | 'government' | 'faq' | 'breadcrumb' | 'all'
  faqs?: { question: string; answer: string }[]
  breadcrumbs?: { name: string; url: string }[]
}

export function JsonLd({ type, faqs, breadcrumbs }: JsonLdProps) {
  let schemas: object[] = []

  switch (type) {
    case 'organization':
      schemas = [generateOrganizationSchema()]
      break
    case 'website':
      schemas = [generateWebsiteSchema()]
      break
    case 'software':
      schemas = [generateSoftwareApplicationSchema()]
      break
    case 'government':
      schemas = [generateLocalBusinessSchema()]
      break
    case 'faq':
      if (faqs) schemas = [generateFAQSchema(faqs)]
      break
    case 'breadcrumb':
      if (breadcrumbs) schemas = [generateBreadcrumbSchema(breadcrumbs)]
      break
    case 'all':
      schemas = [
        generateOrganizationSchema(),
        generateWebsiteSchema(),
        generateSoftwareApplicationSchema(),
        generateLocalBusinessSchema(),
      ]
      break
  }

  return (
    <>
      {schemas.map((schema, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  )
}

// Pre-built FAQ data untuk GovConnect
export const govconnectFAQs = [
  {
    question: 'Apa itu GovConnect?',
    answer: 'GovConnect adalah platform layanan pemerintahan digital berbasis AI yang memungkinkan masyarakat mengakses layanan pemerintah seperti pengajuan surat, pelaporan keluhan, reservasi layanan, dan informasi publik melalui WhatsApp, Telegram, dan webchat 24/7.',
  },
  {
    question: 'Bagaimana cara menggunakan GovConnect?',
    answer: 'Anda dapat menggunakan GovConnect dengan menghubungi nomor WhatsApp resmi pemerintah daerah yang sudah terintegrasi dengan GovConnect, atau melalui webchat di website resmi pemerintah. AI assistant akan membantu Anda 24 jam sehari, 7 hari seminggu.',
  },
  {
    question: 'Apakah GovConnect gratis?',
    answer: 'Ya, GovConnect gratis untuk masyarakat. Platform ini disediakan oleh pemerintah daerah untuk memudahkan akses layanan publik.',
  },
  {
    question: 'Layanan apa saja yang tersedia di GovConnect?',
    answer: 'GovConnect menyediakan berbagai layanan termasuk: pengajuan surat (KTP, KK, SKCK, dll), pelaporan keluhan infrastruktur, reservasi antrian layanan, informasi jadwal dan prosedur, tracking status pengajuan, dan pengaduan pelayanan publik.',
  },
  {
    question: 'Apakah data saya aman di GovConnect?',
    answer: 'Ya, GovConnect menggunakan enkripsi dan protokol keamanan standar untuk melindungi data pribadi Anda. Data hanya digunakan untuk keperluan layanan pemerintahan dan tidak dibagikan ke pihak ketiga.',
  },
  {
    question: 'Bagaimana cara melaporkan masalah infrastruktur?',
    answer: 'Anda dapat melaporkan masalah infrastruktur seperti jalan rusak, lampu mati, atau banjir melalui GovConnect. Cukup kirim pesan dengan deskripsi masalah dan lokasi, AI akan membantu memproses laporan Anda dan memberikan nomor tracking.',
  },
  {
    question: 'Berapa lama waktu response GovConnect?',
    answer: 'GovConnect memberikan response instan dalam hitungan detik untuk pertanyaan informasi. Untuk pengajuan layanan, waktu proses tergantung pada jenis layanan dan kebijakan pemerintah daerah setempat.',
  },
  {
    question: 'Apakah GovConnect tersedia 24 jam?',
    answer: 'Ya, GovConnect tersedia 24 jam sehari, 7 hari seminggu. AI assistant siap melayani kapan saja Anda membutuhkan informasi atau layanan pemerintahan.',
  },
]

// Component untuk FAQ dengan Schema
export function FAQJsonLd() {
  return <JsonLd type="faq" faqs={govconnectFAQs} />
}

// Component untuk Homepage dengan semua Schema
export function HomePageJsonLd() {
  return (
    <>
      <JsonLd type="all" />
      <JsonLd type="faq" faqs={govconnectFAQs} />
    </>
  )
}
