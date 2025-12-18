import { Metadata } from 'next'

// ============================================
// SEO CONFIGURATION - GovConnect
// ============================================

export const siteConfig = {
  name: 'GovConnect',
  title: 'GovConnect - Platform Layanan Pemerintahan Digital Berbasis AI',
  description: 'Platform AI untuk layanan pemerintahan digital Indonesia. Laporkan keluhan, ajukan surat, reservasi layanan, dan dapatkan informasi pemerintah langsung melalui WhatsApp, Telegram, dan webchat. Cepat, mudah, dan terpercaya 24/7.',
  url: process.env.NEXT_PUBLIC_APP_URL || 'https://govconnect.id',
  ogImage: '/dashboard.png',
  logo: '/logo-dashboard.png',
  locale: 'id_ID',
  language: 'id',
  
  // Contact Info
  email: 'genfity@gmail.com',
  phone: '+6285174314023', // Ganti dengan nomor asli
  address: 'Indonesia', // Ganti dengan alamat asli
  
  // Social Media
  social: {
    instagram: '@genfity.id',
    linkedin: 'company/genfity',
  },
  
  // Keywords untuk SEO
  keywords: [
    // Primary Keywords
    'govconnect',
    'layanan pemerintahan digital',
    'e-government indonesia',
    'layanan kelurahan online',
    'layanan kecamatan digital',
    'smart government',
    'digitalisasi pemerintahan',
    
    // Feature Keywords
    'lapor keluhan online',
    'pengaduan masyarakat',
    'surat online kelurahan',
    'reservasi layanan pemerintah',
    'antrian online kelurahan',
    'chatbot pemerintah',
    'ai layanan publik',
    
    // Location Keywords
    'layanan publik indonesia',
    'e-kelurahan',
    'e-kecamatan',
    'smart city indonesia',
    
    // Service Keywords
    'whatsapp kelurahan',
    'layanan 24 jam pemerintah',
    'tracking pengaduan',
    'status pengajuan surat',
    
    // Problem-Solution Keywords
    'solusi antrian panjang',
    'layanan pemerintah cepat',
    'akses informasi pemerintah',
  ],
  
  // Authors
  authors: [
    { name: 'GovConnect Team', url: 'https://genfity.com' }
  ],
  
  // Creator
  creator: 'GovConnect',
  publisher: 'GovConnect',
}

// ============================================
// DEFAULT METADATA
// ============================================

export const defaultMetadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  authors: siteConfig.authors,
  creator: siteConfig.creator,
  publisher: siteConfig.publisher,
  
  // Robots
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  
  // Open Graph
  openGraph: {
    type: 'website',
    locale: siteConfig.locale,
    url: siteConfig.url,
    title: siteConfig.title,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: `${siteConfig.name} - Platform Layanan Pemerintahan Digital`,
        type: 'image/png',
      },
    ],
  },
  
  // Twitter
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: siteConfig.social.twitter,
    site: siteConfig.social.twitter,
  },
  
  // Icons
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/logo-dashboard.png',
    other: [
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        url: '/logo-dashboard.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        url: '/logo-dashboard.png',
      },
    ],
  },
  
  // Manifest
  manifest: '/manifest.json',
  
  // Verification (Isi setelah setup)
  verification: {
    google: 'YOUR_GOOGLE_VERIFICATION_CODE', // Dari Google Search Console
    yandex: 'YOUR_YANDEX_VERIFICATION_CODE',
    yahoo: 'YOUR_YAHOO_VERIFICATION_CODE',
    other: {
      'msvalidate.01': 'YOUR_BING_VERIFICATION_CODE', // Dari Bing Webmaster
      'facebook-domain-verification': 'YOUR_FACEBOOK_VERIFICATION_CODE',
    },
  },
  
  // Alternate Languages (jika ada multi-language)
  alternates: {
    canonical: siteConfig.url,
    languages: {
      'id-ID': siteConfig.url,
      // 'en-US': `${siteConfig.url}/en`, // Uncomment jika ada versi English
    },
  },
  
  // Category
  category: 'Government Services',
  
  // Classification
  classification: 'Government, Public Services, Digital Services',
  
  // Other
  other: {
    'google-site-verification': 'YOUR_GOOGLE_VERIFICATION_CODE',
    'msapplication-TileColor': '#16a34a',
    'theme-color': '#16a34a',
  },
}

// ============================================
// STRUCTURED DATA (JSON-LD)
// ============================================

export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteConfig.name,
    alternateName: 'GovConnect Indonesia',
    url: siteConfig.url,
    logo: `${siteConfig.url}${siteConfig.logo}`,
    description: siteConfig.description,
    email: siteConfig.email,
    telephone: siteConfig.phone,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'ID',
      addressLocality: siteConfig.address,
    },
    sameAs: [
      `https://twitter.com/${siteConfig.social.twitter.replace('@', '')}`,
      `https://instagram.com/${siteConfig.social.instagram.replace('@', '')}`,
      `https://facebook.com/${siteConfig.social.facebook}`,
      `https://linkedin.com/${siteConfig.social.linkedin}`,
      `https://youtube.com/${siteConfig.social.youtube}`,
    ],
    foundingDate: '2024',
    founders: [
      {
        '@type': 'Person',
        name: 'GovConnect Team',
      },
    ],
    areaServed: {
      '@type': 'Country',
      name: 'Indonesia',
    },
    serviceType: [
      'Government Digital Services',
      'AI Chatbot Services',
      'Public Service Platform',
    ],
  }
}

export function generateWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteConfig.name,
    alternateName: 'GovConnect - Layanan Pemerintahan Digital',
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: siteConfig.language,
    publisher: {
      '@type': 'Organization',
      name: siteConfig.name,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.url}${siteConfig.logo}`,
      },
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteConfig.url}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

export function generateSoftwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    applicationCategory: 'GovernmentApplication',
    operatingSystem: 'Web, WhatsApp, Telegram',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'IDR',
      description: 'Layanan gratis untuk masyarakat',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '1000',
      bestRating: '5',
      worstRating: '1',
    },
    featureList: [
      'AI-Powered Chatbot 24/7',
      'Multi-Channel Support (WhatsApp, Telegram, Web)',
      'Real-time Tracking',
      'Online Document Request',
      'Service Reservation',
      'Complaint Reporting with GPS',
    ],
  }
}

export function generateLocalBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'GovernmentService',
    name: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    logo: `${siteConfig.url}${siteConfig.logo}`,
    image: `${siteConfig.url}${siteConfig.ogImage}`,
    telephone: siteConfig.phone,
    email: siteConfig.email,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'ID',
    },
    areaServed: {
      '@type': 'Country',
      name: 'Indonesia',
    },
    serviceType: 'Digital Government Services',
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceUrl: siteConfig.url,
      availableLanguage: {
        '@type': 'Language',
        name: 'Indonesian',
        alternateName: 'id',
      },
    },
    hoursAvailable: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 
        'Friday', 'Saturday', 'Sunday'
      ],
      opens: '00:00',
      closes: '23:59',
    },
  }
}

export function generateFAQSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}

export function generateBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function generatePageMetadata(
  title: string,
  description: string,
  path: string = '',
  image?: string
): Metadata {
  const url = `${siteConfig.url}${path}`
  const ogImage = image || siteConfig.ogImage

  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${siteConfig.name}`,
      description,
      url,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      title: `${title} | ${siteConfig.name}`,
      description,
      images: [ogImage],
    },
    alternates: {
      canonical: url,
    },
  }
}

// Combine all schemas for homepage
export function generateHomePageSchemas() {
  return [
    generateOrganizationSchema(),
    generateWebsiteSchema(),
    generateSoftwareApplicationSchema(),
    generateLocalBusinessSchema(),
  ]
}
