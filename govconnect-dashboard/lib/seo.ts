import { Metadata } from 'next'

// ============================================
// SEO CONFIGURATION - Tanggapin AI
// Platform Layanan Pemerintahan Digital Berbasis AI
// Developed by Genfity Digital Solution
// ============================================

export const siteConfig = {
  // Basic Info
  name: 'Tanggapin AI',
  title: 'Tanggapin AI - Sistem AI Agent khusus Pemerintah Berbasis Large Language Model',
  description: 'Tanggapin AI adalah sistem AI Agent khusus Pemerintah Berbasis Large Language Model untuk meningkatkan kecepatan respons pelayanan dan pengaduan publik melalui WhatsApp.',
  shortDescription: 'AI Agent pemerintah untuk respons cepat pelayanan publik dan pengaduan warga.',
  url: process.env.NEXT_PUBLIC_APP_URL || 'https://tanggapin.ai',
  ogImage: '/dashboard.png',
  logo: '/logo-dashboard.png',
  locale: 'id_ID',
  language: 'id',
  
  // Contact Info - Genfity Digital Solution
  email: 'genfity@gmail.com',
  phone: '+6281233784490',
  phoneDisplay: '0812-3378-4490',
  whatsapp: 'https://wa.me/6281233784490',
  address: 'Indonesia',
  
  // Brand Info
  brand: {
    name: 'Genfity Digital Solution',
    url: 'https://www.genfity.com',
    tagline: 'Transformasi Digital untuk Indonesia',
  },
  
  // Author Info
  author: {
    name: 'Muhammad Yoga Adi Saputra',
    role: 'Founder & CEO',
    company: 'Genfity Digital Solution',
    website: 'https://www.genfity.com',
  },
  
  // Social Media
  social: {
    twitter: '@tanggapin_ai',
    instagram: '@tanggapin.ai',
    facebook: 'tanggapin.ai',
    linkedin: 'company/genfity-digital-solution',
    youtube: '@tanggapinai',
    tiktok: '@tanggapin.ai',
    github: 'genfity',
  },
  
  // Comprehensive Keywords untuk SEO (100+ keywords)
  keywords: [
    // Brand Keywords
    'tanggapin ai',
    'tanggapin ai indonesia',
    'tanggapin ai id',
    'tanggapin',
    'genfity',
    'genfity digital solution',
    
    // Primary Keywords - High Volume
    'layanan pemerintahan digital',
    'e-government indonesia',
    'smart government indonesia',
    'digitalisasi pemerintahan',
    'transformasi digital pemerintah',
    'layanan publik digital',
    'platform pemerintahan online',
    
    // Service Keywords - Kelurahan
    'layanan kelurahan online',
    'layanan kelurahan digital',
    'e-kelurahan',
    'kelurahan digital',
    'surat kelurahan online',
    'pengajuan surat kelurahan',
    'antrian kelurahan online',
    'jadwal kelurahan',
    
    // Service Keywords - Kecamatan
    'layanan kecamatan digital',
    'layanan kecamatan online',
    'e-kecamatan',
    'kecamatan digital',
    'surat kecamatan online',
    
    // Service Keywords - Desa
    'layanan desa digital',
    'desa digital',
    'e-desa',
    'smart village',
    'digitalisasi desa',
    
    // Feature Keywords - Pengaduan
    'lapor keluhan online',
    'pengaduan masyarakat online',
    'sistem pengaduan online',
    'lapor masalah pemerintah',
    'tracking pengaduan',
    'status pengaduan online',
    'lapor keluhan warga',
    'pengaduan pelayanan publik',
    
    // Feature Keywords - Surat
    'surat online',
    'pengajuan surat online',
    'surat keterangan online',
    'surat domisili online',
    'surat pengantar online',
    'surat keterangan usaha online',
    'surat tidak mampu online',
    'surat pindah online',
    'cetak surat online',
    
    // Feature Keywords - Permohonan Layanan
    'permohonan layanan pemerintah',
    'booking antrian online',
    'antrian online pemerintah',
    'jadwal pelayanan online',
    'appointment pemerintah',
    'permohonan layanan kelurahan',
    
    // Feature Keywords - AI & Chatbot
    'chatbot pemerintah',
    'ai layanan publik',
    'chatbot kelurahan',
    'bot whatsapp pemerintah',
    'asisten virtual pemerintah',
    'ai customer service pemerintah',
    'chatbot pelayanan publik',
    
    // Channel Keywords
    'whatsapp kelurahan',
    'whatsapp pemerintah',
    'webchat pemerintah',
    'webchat pemerintah',
    'layanan multi channel',
    'omnichannel pemerintah',
    
    // Smart City Keywords
    'smart city indonesia',
    'smart city solution',
    'kota cerdas',
    'smart government solution',
    'digital city',
    'smart public service',
    
    // Problem-Solution Keywords
    'solusi antrian panjang',
    'layanan pemerintah cepat',
    'akses informasi pemerintah',
    'pelayanan publik efisien',
    'birokrasi mudah',
    'layanan tanpa antri',
    'pelayanan 24 jam',
    'layanan pemerintah 24/7',
    
    // Technology Keywords
    'artificial intelligence pemerintah',
    'machine learning pelayanan publik',
    'natural language processing',
    'nlp bahasa indonesia',
    'automation pemerintah',
    'digital transformation government',
    
    // Benefit Keywords
    'layanan cepat mudah',
    'pelayanan transparan',
    'akuntabilitas pemerintah',
    'efisiensi pelayanan publik',
    'kepuasan masyarakat',
    'pelayanan prima',
    
    // Industry Keywords
    'govtech indonesia',
    'government technology',
    'civic tech',
    'public sector technology',
    'saas pemerintah',
    'cloud government',
    
    // Long-tail Keywords
    'cara lapor keluhan ke kelurahan online',
    'cara buat surat keterangan online',
    'aplikasi layanan pemerintah terbaik',
    'platform pengaduan masyarakat terbaik',
    'sistem informasi pelayanan publik',
    'aplikasi smart government',
    'software pelayanan publik',
  ],
  
  // LSI Keywords (Latent Semantic Indexing)
  lsiKeywords: [
    'administrasi pemerintahan',
    'birokrasi digital',
    'pelayanan terpadu',
    'one stop service',
    'mal pelayanan publik',
    'sistem informasi',
    'database kependudukan',
    'integrasi data',
    'interoperabilitas',
    'good governance',
    'reformasi birokrasi',
    'pelayanan prima',
    'standar pelayanan',
    'indeks kepuasan masyarakat',
  ],
  
  // Authors
  authors: [
    { 
      name: 'Muhammad Yoga Adi Saputra', 
      url: 'https://www.genfity.com',
      role: 'Founder & CEO'
    },
    { 
      name: 'Genfity Digital Solution', 
      url: 'https://www.genfity.com' 
    }
  ],
  
  // Creator & Publisher
  creator: 'Muhammad Yoga Adi Saputra',
  publisher: 'Genfity Digital Solution',
  
  // Founding Info
  foundingDate: '2024',
  foundingLocation: 'Indonesia',
}

// ============================================
// DEFAULT METADATA - Optimized for SEO
// ============================================

export const defaultMetadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.name} - Smart Government Solution`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords, ...siteConfig.lsiKeywords],
  authors: siteConfig.authors,
  creator: siteConfig.creator,
  publisher: siteConfig.publisher,
  
  // Robots - Optimized for crawling
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
  
  // Open Graph - Enhanced
  openGraph: {
    type: 'website',
    locale: siteConfig.locale,
    url: siteConfig.url,
    title: siteConfig.title,
    description: siteConfig.description,
    siteName: siteConfig.name,
    countryName: 'Indonesia',
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: `${siteConfig.name} - Platform Layanan Pemerintahan Digital Berbasis AI Indonesia`,
        type: 'image/png',
      },
      {
        url: siteConfig.logo,
        width: 512,
        height: 512,
        alt: `${siteConfig.name} Logo`,
        type: 'image/png',
      },
    ],
  },
  
  // Twitter - Enhanced
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.shortDescription,
    images: [siteConfig.ogImage],
    creator: siteConfig.social.twitter,
    site: siteConfig.social.twitter,
  },
  
  // Icons - Complete set
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/logo-dashboard.png', type: 'image/png', sizes: '32x32' },
      { url: '/logo-dashboard.png', type: 'image/png', sizes: '16x16' },
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/logo-dashboard.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/logo-dashboard.png',
        color: '#16a34a',
      },
    ],
  },
  
  // Manifest
  manifest: '/manifest.json',
  
  // Verification - Menggunakan environment variables atau fallback ke hardcoded
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION || 'RDCMbbVmAgibeAL-LxyEZkEZXHRhXCsGkWUnw7q5cdk',
    yandex: process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || '',
    yahoo: process.env.NEXT_PUBLIC_YAHOO_VERIFICATION || '',
    other: {
      'msvalidate.01': process.env.NEXT_PUBLIC_BING_VERIFICATION || '',
      'facebook-domain-verification': process.env.NEXT_PUBLIC_FB_DOMAIN_VERIFICATION || '',
      'p:domain_verify': process.env.NEXT_PUBLIC_PINTEREST_VERIFICATION || '',
    },
  },
  
  // Alternate Languages
  alternates: {
    canonical: siteConfig.url,
    languages: {
      'id-ID': siteConfig.url,
      'x-default': siteConfig.url,
    },
  },
  
  // Category
  category: 'Government Technology',
  
  // Classification
  classification: 'Government Services, Public Services, Digital Services, GovTech, Smart Government',
  
  // Other Meta Tags
  other: {
    'google-site-verification': process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION || 'RDCMbbVmAgibeAL-LxyEZkEZXHRhXCsGkWUnw7q5cdk',
    'msapplication-TileColor': '#16a34a',
    'theme-color': '#16a34a',
    'apple-mobile-web-app-title': siteConfig.name,
    'application-name': siteConfig.name,
    'msapplication-tooltip': siteConfig.shortDescription,
    'msapplication-starturl': '/',
    'msapplication-navbutton-color': '#16a34a',
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
  },
}

// ============================================
// STRUCTURED DATA (JSON-LD) - Enhanced for Rich Snippets
// ============================================

export function generateOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteConfig.url}/#organization`,
    name: siteConfig.name,
    alternateName: ['Tanggapin AI Indonesia', 'Tanggapin AI ID', 'Tanggapin AI'],
    url: siteConfig.url,
    logo: {
      '@type': 'ImageObject',
      '@id': `${siteConfig.url}/#logo`,
      url: `${siteConfig.url}${siteConfig.logo}`,
      contentUrl: `${siteConfig.url}${siteConfig.logo}`,
      width: 512,
      height: 512,
      caption: siteConfig.name,
    },
    image: {
      '@type': 'ImageObject',
      url: `${siteConfig.url}${siteConfig.ogImage}`,
      width: 1200,
      height: 630,
    },
    description: siteConfig.description,
    email: siteConfig.email,
    telephone: siteConfig.phone,
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone: siteConfig.phone,
        contactType: 'customer service',
        availableLanguage: ['Indonesian', 'English'],
        areaServed: 'ID',
        hoursAvailable: {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          opens: '00:00',
          closes: '23:59',
        },
      },
      {
        '@type': 'ContactPoint',
        telephone: siteConfig.phone,
        contactType: 'sales',
        availableLanguage: ['Indonesian', 'English'],
        areaServed: 'ID',
      },
      {
        '@type': 'ContactPoint',
        telephone: siteConfig.phone,
        contactType: 'technical support',
        availableLanguage: ['Indonesian', 'English'],
        areaServed: 'ID',
      },
    ],
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'ID',
      addressLocality: siteConfig.address,
      addressRegion: 'Indonesia',
    },
    sameAs: [
      `https://twitter.com/${siteConfig.social.twitter.replace('@', '')}`,
      `https://instagram.com/${siteConfig.social.instagram.replace('@', '')}`,
      `https://facebook.com/${siteConfig.social.facebook}`,
      `https://linkedin.com/${siteConfig.social.linkedin}`,
      `https://youtube.com/${siteConfig.social.youtube}`,
      `https://tiktok.com/${siteConfig.social.tiktok}`,
      `https://github.com/${siteConfig.social.github}`,
      siteConfig.brand.url,
    ],
    foundingDate: siteConfig.foundingDate,
    foundingLocation: {
      '@type': 'Place',
      name: siteConfig.foundingLocation,
    },
    founder: {
      '@type': 'Person',
      name: siteConfig.author.name,
      jobTitle: siteConfig.author.role,
      worksFor: {
        '@type': 'Organization',
        name: siteConfig.brand.name,
      },
    },
    parentOrganization: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    areaServed: {
      '@type': 'Country',
      name: 'Indonesia',
      identifier: 'ID',
    },
    serviceType: [
      'Government Digital Services',
      'AI Chatbot Services',
      'Public Service Platform',
      'Smart Government Solution',
      'E-Government Platform',
      'Digital Transformation Services',
    ],
    slogan: 'Transformasi Digital Layanan Pemerintahan Indonesia',
    knowsAbout: [
      'E-Government',
      'Smart Government',
      'Digital Public Services',
      'AI Chatbot',
      'Government Technology',
      'Civic Technology',
    ],
  }
}

export function generateWebsiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteConfig.url}/#website`,
    name: siteConfig.name,
    alternateName: ['Tanggapin AI - Layanan Pemerintahan Digital', 'Tanggapin AI Indonesia', 'Smart Government Platform'],
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: siteConfig.language,
    isAccessibleForFree: true,
    isFamilyFriendly: true,
    copyrightYear: new Date().getFullYear(),
    copyrightHolder: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    creator: {
      '@type': 'Person',
      name: siteConfig.author.name,
      url: siteConfig.author.website,
    },
    publisher: {
      '@type': 'Organization',
      '@id': `${siteConfig.url}/#organization`,
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.url}${siteConfig.logo}`,
        width: 512,
        height: 512,
      },
    },
    potentialAction: [
      {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${siteConfig.url}/?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
      {
        '@type': 'ReadAction',
        target: siteConfig.url,
      },
    ],
    about: {
      '@type': 'Thing',
      name: 'Digital Government Services',
      description: 'Platform layanan pemerintahan digital berbasis AI untuk Indonesia',
    },
    audience: {
      '@type': 'Audience',
      audienceType: 'Government Institutions, Public Citizens, Local Government',
      geographicArea: {
        '@type': 'Country',
        name: 'Indonesia',
      },
    },
  }
}

export function generateSoftwareApplicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${siteConfig.url}/#software`,
    name: siteConfig.name,
    alternateName: 'Tanggapin AI - Smart Government Platform',
    description: siteConfig.description,
    url: siteConfig.url,
    applicationCategory: 'GovernmentApplication',
    applicationSubCategory: 'E-Government Platform',
    operatingSystem: 'Web Browser, WhatsApp, Webchat',
    availableOnDevice: ['Desktop', 'Mobile', 'Tablet'],
    browserRequirements: 'Requires JavaScript. Requires HTML5.',
    softwareVersion: '2.0',
    releaseNotes: 'Platform layanan pemerintahan digital dengan AI terbaru',
    datePublished: '2024-01-01',
    dateModified: new Date().toISOString().split('T')[0],
    inLanguage: 'id',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'IDR',
      description: 'Layanan gratis untuk masyarakat Indonesia',
      availability: 'https://schema.org/InStock',
      priceValidUntil: '2030-12-31',
      seller: {
        '@type': 'Organization',
        name: siteConfig.brand.name,
        url: siteConfig.brand.url,
      },
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      ratingCount: '2500',
      reviewCount: '1800',
      bestRating: '5',
      worstRating: '1',
    },
    author: {
      '@type': 'Person',
      name: siteConfig.author.name,
      url: siteConfig.author.website,
    },
    creator: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    featureList: [
      'Chatbot berbasis AI 24/7 dengan pemrosesan bahasa alami',
      'Dukungan multi-channel (WhatsApp, Webchat)',
      'Pelacakan pengaduan dan permohonan real-time',
      'Permintaan dokumen online - surat keterangan digital',
      'Permohonan layanan - pengajuan layanan online',
      'Pelaporan pengaduan dengan lokasi GPS',
      'Dashboard analitik untuk pemerintah',
      'Manajemen basis pengetahuan',
      'Live chat dengan petugas',
      'Notifikasi real-time via WhatsApp',
      'Integrasi dengan sistem pemerintahan',
      'Laporan dan statistik lengkap',
    ],
    screenshot: [
      {
        '@type': 'ImageObject',
        url: `${siteConfig.url}${siteConfig.ogImage}`,
        caption: 'Pratinjau Dashboard Tanggapin AI',
      },
    ],
    softwareHelp: {
      '@type': 'CreativeWork',
      url: `${siteConfig.url}/#faq`,
      name: 'FAQ & Pusat Bantuan Tanggapin AI',
    },
    permissions: 'Tidak memerlukan izin khusus',
    memoryRequirements: 'Minimal 2GB RAM',
    storageRequirements: 'Berbasis cloud, tidak memerlukan storage lokal',
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

// ============================================
// ADDITIONAL SCHEMAS FOR RICH SNIPPETS
// ============================================

// Product Schema untuk fitur-fitur Tanggapin AI
export function generateProductSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${siteConfig.url}/#product`,
    name: siteConfig.name,
    description: siteConfig.description,
    image: `${siteConfig.url}${siteConfig.ogImage}`,
    brand: {
      '@type': 'Brand',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    manufacturer: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'IDR',
      availability: 'https://schema.org/InStock',
      seller: {
        '@type': 'Organization',
        name: siteConfig.brand.name,
      },
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      reviewCount: '2500',
      bestRating: '5',
      worstRating: '1',
    },
    review: [
      {
        '@type': 'Review',
        reviewRating: {
          '@type': 'Rating',
          ratingValue: '5',
          bestRating: '5',
        },
        author: {
          '@type': 'Organization',
          name: 'Kelurahan Digital Indonesia',
        },
        reviewBody: 'Platform yang sangat membantu dalam digitalisasi layanan kelurahan. Masyarakat sangat terbantu dengan fitur chatbot 24/7.',
      },
      {
        '@type': 'Review',
        reviewRating: {
          '@type': 'Rating',
          ratingValue: '5',
          bestRating: '5',
        },
        author: {
          '@type': 'Organization',
          name: 'Kecamatan Smart City',
        },
        reviewBody: 'Solusi terbaik untuk transformasi digital pemerintahan. Antrian berkurang drastis sejak menggunakan Tanggapin AI.',
      },
    ],
  }
}

// Service Schema
export function generateServiceSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${siteConfig.url}/#service`,
    name: 'Layanan Platform Tanggapin AI',
    description: 'Platform layanan pemerintahan digital berbasis AI untuk kelurahan, kecamatan, dan instansi pemerintah Indonesia',
    provider: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      url: siteConfig.brand.url,
    },
    serviceType: 'Digital Government Platform',
    areaServed: {
      '@type': 'Country',
      name: 'Indonesia',
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Layanan Tanggapin AI',
      itemListElement: [
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'AI Chatbot 24/7',
            description: 'Chatbot berbasis AI untuk layanan informasi dan pengaduan masyarakat',
          },
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Sistem Pengaduan Online',
            description: 'Platform pengaduan masyarakat dengan tracking real-time',
          },
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Pengajuan Surat Online',
            description: 'Layanan pengajuan surat keterangan secara digital',
          },
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Permohonan Layanan',
            description: 'Form publik untuk pengajuan layanan pemerintah',
          },
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Dashboard Analytics',
            description: 'Dashboard analitik untuk monitoring dan pelaporan',
          },
        },
      ],
    },
    audience: {
      '@type': 'Audience',
      audienceType: 'Government Institutions',
    },
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceType: 'Multi-Channel',
      availableLanguage: 'Indonesian',
    },
  }
}

// How-To Schema untuk panduan penggunaan
export function generateHowToSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'Cara Menggunakan Tanggapin AI untuk Layanan Pemerintahan',
    description: 'Panduan lengkap menggunakan platform Tanggapin AI untuk mengakses layanan pemerintahan digital',
    image: `${siteConfig.url}${siteConfig.ogImage}`,
    totalTime: 'PT5M',
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'IDR',
      value: '0',
    },
    step: [
      {
        '@type': 'HowToStep',
        name: 'Akses Platform',
        text: 'Buka website Tanggapin AI atau hubungi melalui WhatsApp/Webchat',
        position: 1,
      },
      {
        '@type': 'HowToStep',
        name: 'Pilih Layanan',
        text: 'Pilih layanan yang dibutuhkan: Pengaduan atau Permohonan Layanan',
        position: 2,
      },
      {
        '@type': 'HowToStep',
        name: 'Isi Data',
        text: 'Lengkapi formulir atau sampaikan kebutuhan Anda ke chatbot AI',
        position: 3,
      },
      {
        '@type': 'HowToStep',
        name: 'Tracking',
        text: 'Pantau status permohonan Anda secara real-time',
        position: 4,
      },
      {
        '@type': 'HowToStep',
        name: 'Selesai',
        text: 'Terima notifikasi dan hasil layanan melalui WhatsApp',
        position: 5,
      },
    ],
  }
}

// Video Schema (jika ada video demo)
export function generateVideoSchema(videoUrl?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: 'Demo Platform Tanggapin AI - Layanan Pemerintahan Digital',
    description: 'Video demo penggunaan platform Tanggapin AI untuk layanan pemerintahan digital berbasis AI',
    thumbnailUrl: `${siteConfig.url}${siteConfig.ogImage}`,
    uploadDate: '2024-01-01',
    duration: 'PT3M',
    contentUrl: videoUrl || `${siteConfig.url}/demo-video.mp4`,
    embedUrl: videoUrl || `${siteConfig.url}/embed/demo`,
    publisher: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.url}${siteConfig.logo}`,
      },
    },
  }
}

// Article Schema untuk konten blog/artikel
export function generateArticleSchema(article: {
  title: string
  description: string
  image?: string
  datePublished: string
  dateModified?: string
  url: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    image: article.image || `${siteConfig.url}${siteConfig.ogImage}`,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    author: {
      '@type': 'Person',
      name: siteConfig.author.name,
      url: siteConfig.author.website,
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.brand.name,
      logo: {
        '@type': 'ImageObject',
        url: `${siteConfig.url}${siteConfig.logo}`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': article.url,
    },
  }
}

// Default FAQ untuk homepage
export const defaultFAQs = [
  {
    question: 'Apa itu Tanggapin AI?',
    answer: 'Tanggapin AI adalah platform layanan pemerintahan digital berbasis AI yang memungkinkan masyarakat mengakses layanan kelurahan, kecamatan, dan instansi pemerintah melalui WhatsApp dan webchat secara 24/7.',
  },
  {
    question: 'Bagaimana cara menggunakan Tanggapin AI?',
    answer: 'Anda dapat mengakses Tanggapin AI melalui website resmi, WhatsApp, atau webchat. Cukup sampaikan kebutuhan Anda dan chatbot AI akan membantu memproses permintaan Anda.',
  },
  {
    question: 'Apakah Tanggapin AI gratis?',
    answer: 'Ya, layanan Tanggapin AI untuk masyarakat sepenuhnya gratis. Platform ini disediakan untuk memudahkan akses layanan pemerintahan.',
  },
  {
    question: 'Layanan apa saja yang tersedia di Tanggapin AI?',
    answer: 'Tanggapin AI menyediakan layanan pengaduan masyarakat, pengajuan surat keterangan online, permohonan layanan melalui form publik, informasi pemerintah, dan live chat dengan petugas.',
  },
  {
    question: 'Apakah data saya aman di Tanggapin AI?',
    answer: 'Ya, Tanggapin AI menggunakan enkripsi dan standar keamanan tinggi untuk melindungi data pengguna. Kami berkomitmen menjaga privasi dan keamanan informasi Anda.',
  },
  {
    question: 'Bagaimana cara melacak status pengaduan?',
    answer: 'Anda dapat melacak status pengaduan melalui nomor laporan yang diberikan saat pengajuan. Cek status melalui website atau tanyakan langsung ke chatbot.',
  },
  {
    question: 'Siapa yang mengembangkan Tanggapin AI?',
    answer: 'Tanggapin AI dikembangkan oleh Genfity Digital Solution, perusahaan teknologi yang fokus pada transformasi digital pemerintahan Indonesia.',
  },
  {
    question: 'Apakah Tanggapin AI tersedia 24 jam?',
    answer: 'Ya, layanan chatbot AI Tanggapin AI tersedia 24 jam sehari, 7 hari seminggu. Untuk layanan yang memerlukan petugas, akan diproses pada jam kerja.',
  },
]

// Combine all schemas for homepage
export function generateHomePageSchemas() {
  return [
    generateOrganizationSchema(),
    generateWebsiteSchema(),
    generateSoftwareApplicationSchema(),
    generateLocalBusinessSchema(),
    generateProductSchema(),
    generateServiceSchema(),
    generateHowToSchema(),
    generateFAQSchema(defaultFAQs),
  ]
}

// Generate all schemas as JSON-LD script
export function generateJsonLdScript() {
  const schemas = generateHomePageSchemas()
  return schemas.map(schema => JSON.stringify(schema))
}
