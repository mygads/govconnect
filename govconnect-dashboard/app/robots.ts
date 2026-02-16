import { MetadataRoute } from 'next'

// ============================================
// ROBOTS.TS - Optimized for Search Engine Crawling
// Tanggapin AI - Platform Layanan Pemerintahan Digital
// ============================================

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tanggapin.ai'

  return {
    rules: [
      // Default rule untuk semua crawler
      {
        userAgent: '*',
        allow: [
          '/',
          '/#tentang',
          '/#fitur',
          '/#layanan',
          '/#demo',
          '/#manfaat',
          '/#use-case',
          '/#testimoni',
          '/#faq',
          '/#kontak',
        ],
        disallow: [
          '/api/',
          '/dashboard/',
          '/login',
          '/_next/',
          '/generated/',
          '/*.json$',
          '/private/',
        ],
      },
      // Google Bot - Prioritas tinggi
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/login', '/_next/', '/generated/'],
      },
      // Google Image Bot
      {
        userAgent: 'Googlebot-Image',
        allow: ['/dashboard.png', '/logo-dashboard.png', '/favicon.ico'],
        disallow: ['/api/', '/dashboard/', '/_next/'],
      },
      // Bing Bot
      {
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/login', '/_next/', '/generated/'],
      },
      // Yahoo Slurp
      {
        userAgent: 'Slurp',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/login'],
      },
      // DuckDuckGo
      {
        userAgent: 'DuckDuckBot',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/login'],
      },
      // Yandex
      {
        userAgent: 'YandexBot',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/login'],
      },
      // Baidu
      {
        userAgent: 'Baiduspider',
        allow: '/',
        disallow: ['/api/', '/dashboard/', '/login'],
      },
      // Social Media Bots - Allow untuk preview
      {
        userAgent: 'facebookexternalhit',
        allow: '/',
      },
      {
        userAgent: 'Twitterbot',
        allow: '/',
      },
      {
        userAgent: 'LinkedInBot',
        allow: '/',
      },
      {
        userAgent: 'WhatsApp',
        allow: '/',
      },
      // Pinterest
      {
        userAgent: 'Pinterest',
        allow: '/',
      },
      // Block bad bots
      {
        userAgent: 'AhrefsBot',
        disallow: '/',
      },
      {
        userAgent: 'SemrushBot',
        disallow: '/',
      },
      {
        userAgent: 'MJ12bot',
        disallow: '/',
      },
      {
        userAgent: 'DotBot',
        disallow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
