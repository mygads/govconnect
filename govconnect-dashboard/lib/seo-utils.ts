import { Metadata } from 'next'
import { siteConfig } from './seo'

// ============================================
// SEO UTILITIES - Helper Functions
// ============================================

/**
 * Generate metadata untuk halaman spesifik
 */
export function createPageMetadata({
  title,
  description,
  path = '',
  image,
  noIndex = false,
  keywords = [],
}: {
  title: string
  description: string
  path?: string
  image?: string
  noIndex?: boolean
  keywords?: string[]
}): Metadata {
  const url = `${siteConfig.url}${path}`
  const ogImage = image || siteConfig.ogImage
  const fullTitle = `${title} | ${siteConfig.name}`
  const allKeywords = [...siteConfig.keywords.slice(0, 20), ...keywords]

  return {
    title,
    description,
    keywords: allKeywords,
    authors: siteConfig.authors,
    creator: siteConfig.creator,
    publisher: siteConfig.publisher,
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      type: 'website',
      images: [
        {
          url: ogImage.startsWith('http') ? ogImage : `${siteConfig.url}${ogImage}`,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImage.startsWith('http') ? ogImage : `${siteConfig.url}${ogImage}`],
      creator: siteConfig.social.twitter,
      site: siteConfig.social.twitter,
    },
    alternates: {
      canonical: url,
    },
  }
}

/**
 * Generate keywords string untuk meta tag
 */
export function generateKeywordsString(additionalKeywords: string[] = []): string {
  return [...siteConfig.keywords, ...additionalKeywords].join(', ')
}

/**
 * Generate canonical URL
 */
export function getCanonicalUrl(path: string = ''): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${siteConfig.url}${cleanPath}`
}

/**
 * Generate absolute URL untuk images
 */
export function getAbsoluteImageUrl(imagePath: string): string {
  if (imagePath.startsWith('http')) return imagePath
  const cleanPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`
  return `${siteConfig.url}${cleanPath}`
}

/**
 * Truncate text untuk meta description (max 160 chars)
 */
export function truncateDescription(text: string, maxLength: number = 160): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

/**
 * Generate title dengan format yang konsisten
 */
export function formatPageTitle(title: string, includeBrand: boolean = true): string {
  if (!includeBrand) return title
  return `${title} | ${siteConfig.name}`
}

/**
 * Check if URL is internal
 */
export function isInternalUrl(url: string): boolean {
  if (url.startsWith('/')) return true
  if (url.startsWith('#')) return true
  try {
    const urlObj = new URL(url)
    return urlObj.hostname === new URL(siteConfig.url).hostname
  } catch {
    return false
  }
}

/**
 * Generate hreflang tags untuk multi-language (future use)
 */
export function generateHreflangTags(path: string = '') {
  return {
    'id-ID': `${siteConfig.url}${path}`,
    'x-default': `${siteConfig.url}${path}`,
  }
}

/**
 * SEO-friendly slug generator
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/--+/g, '-') // Replace multiple - with single -
    .trim()
}

/**
 * Generate reading time estimate
 */
export function calculateReadingTime(text: string): number {
  const wordsPerMinute = 200
  const wordCount = text.split(/\s+/).length
  return Math.ceil(wordCount / wordsPerMinute)
}

/**
 * Predefined page metadata untuk halaman umum
 */
export const pageMetadataPresets = {
  home: createPageMetadata({
    title: 'Platform Layanan Pemerintahan Digital Berbasis AI',
    description: siteConfig.description,
    path: '/',
  }),
  
  about: createPageMetadata({
    title: 'Tentang Tanggapin AI',
    description: 'Tanggapin AI adalah sistem AI Agent khusus pemerintah berbasis LLM untuk mempercepat pelayanan publik dan pengaduan warga.',
    path: '/#tentang',
    keywords: ['tentang tanggapin ai', 'ai pemerintah', 'transformasi digital'],
  }),
  
  features: createPageMetadata({
    title: 'Fitur Tanggapin AI',
    description: 'Fitur utama Tanggapin AI: respons cepat layanan warga, akurasi data layanan, dan pengelolaan laporan/pengaduan terintegrasi.',
    path: '/#fitur',
    keywords: ['fitur tanggapin ai', 'chatbot pemerintah', 'layanan digital'],
  }),
  
  faq: createPageMetadata({
    title: 'FAQ - Pertanyaan Umum',
    description: 'Pertanyaan yang sering diajukan tentang Tanggapin AI - Platform Layanan Pemerintahan Digital.',
    path: '/#faq',
    keywords: ['faq tanggapin ai', 'pertanyaan umum', 'bantuan'],
  }),
  
  contact: createPageMetadata({
    title: 'Hubungi Kami',
    description: 'Hubungi tim Tanggapin AI untuk informasi lebih lanjut. WhatsApp: 0812-3378-4490, Email: genfity@gmail.com',
    path: '/#kontak',
    keywords: ['kontak tanggapin ai', 'hubungi kami', 'customer service'],
  }),
  
  login: createPageMetadata({
    title: 'Masuk Dashboard',
    description: 'Login ke dashboard Tanggapin AI untuk mengelola layanan pemerintahan digital.',
    path: '/login',
    noIndex: true,
  }),
  
  dashboard: createPageMetadata({
    title: 'Dashboard',
    description: 'Dashboard pengelolaan layanan Tanggapin AI.',
    path: '/dashboard',
    noIndex: true,
  }),
}

export default {
  createPageMetadata,
  generateKeywordsString,
  getCanonicalUrl,
  getAbsoluteImageUrl,
  truncateDescription,
  formatPageTitle,
  isInternalUrl,
  generateHreflangTags,
  generateSlug,
  calculateReadingTime,
  pageMetadataPresets,
}
