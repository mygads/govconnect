import { MetadataRoute } from 'next'

// ============================================
// SITEMAP - Optimized for Google Crawling
// Tanggapin AI - Platform Layanan Pemerintahan Digital
// ============================================

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tanggapin.ai'
  const currentDate = new Date()

  // Main pages dengan prioritas tinggi
  const mainPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ]

  // Section pages (anchor links yang penting untuk SEO)
  const sectionPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/#tentang`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/#fitur`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/#layanan`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/#demo`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/#manfaat`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/#use-case`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/#testimoni`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/#faq`,
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/#kontak`,
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ]

  // Utility pages (prioritas rendah, tidak perlu di-index terlalu sering)
  const utilityPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/login`,
      lastModified: currentDate,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]

  // Future pages (uncomment ketika halaman sudah dibuat)
  // const futurePages: MetadataRoute.Sitemap = [
  //   {
  //     url: `${baseUrl}/blog`,
  //     lastModified: currentDate,
  //     changeFrequency: 'daily',
  //     priority: 0.8,
  //   },
  //   {
  //     url: `${baseUrl}/pricing`,
  //     lastModified: currentDate,
  //     changeFrequency: 'weekly',
  //     priority: 0.7,
  //   },
  //   {
  //     url: `${baseUrl}/about`,
  //     lastModified: currentDate,
  //     changeFrequency: 'monthly',
  //     priority: 0.6,
  //   },
  //   {
  //     url: `${baseUrl}/contact`,
  //     lastModified: currentDate,
  //     changeFrequency: 'monthly',
  //     priority: 0.6,
  //   },
  //   {
  //     url: `${baseUrl}/privacy-policy`,
  //     lastModified: currentDate,
  //     changeFrequency: 'yearly',
  //     priority: 0.3,
  //   },
  //   {
  //     url: `${baseUrl}/terms-of-service`,
  //     lastModified: currentDate,
  //     changeFrequency: 'yearly',
  //     priority: 0.3,
  //   },
  // ]

  return [
    ...mainPages,
    ...sectionPages,
    ...utilityPages,
    // ...futurePages,
  ]
}
