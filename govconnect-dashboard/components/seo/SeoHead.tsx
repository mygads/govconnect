'use client'

import { usePathname } from 'next/navigation'
import { siteConfig } from '@/lib/seo'

// ============================================
// SEO HEAD COMPONENT
// Additional meta tags for enhanced SEO
// ============================================

interface SeoHeadProps {
  title?: string
  description?: string
  image?: string
  type?: 'website' | 'article' | 'product'
  publishedTime?: string
  modifiedTime?: string
  author?: string
  section?: string
  tags?: string[]
}

export function SeoHead({
  title,
  description,
  image,
  type = 'website',
  publishedTime,
  modifiedTime,
  author,
  section,
  tags,
}: SeoHeadProps) {
  const pathname = usePathname()
  const currentUrl = `${siteConfig.url}${pathname}`
  const pageTitle = title || siteConfig.title
  const pageDescription = description || siteConfig.description
  const pageImage = image || `${siteConfig.url}${siteConfig.ogImage}`

  return (
    <>
      {/* Dublin Core Meta Tags */}
      <meta name="DC.title" content={pageTitle} />
      <meta name="DC.creator" content={siteConfig.author.name} />
      <meta name="DC.subject" content="Government Digital Services, E-Government, Smart Government" />
      <meta name="DC.description" content={pageDescription} />
      <meta name="DC.publisher" content={siteConfig.brand.name} />
      <meta name="DC.contributor" content={siteConfig.author.name} />
      <meta name="DC.date" content={new Date().toISOString()} />
      <meta name="DC.type" content={type} />
      <meta name="DC.format" content="text/html" />
      <meta name="DC.identifier" content={currentUrl} />
      <meta name="DC.language" content={siteConfig.language} />
      <meta name="DC.coverage" content="Indonesia" />
      <meta name="DC.rights" content={`Copyright ${new Date().getFullYear()} ${siteConfig.brand.name}`} />

      {/* Article specific meta tags */}
      {type === 'article' && (
        <>
          <meta property="article:author" content={author || siteConfig.author.name} />
          {publishedTime && <meta property="article:published_time" content={publishedTime} />}
          {modifiedTime && <meta property="article:modified_time" content={modifiedTime} />}
          {section && <meta property="article:section" content={section} />}
          {tags?.map((tag, index) => (
            <meta key={index} property="article:tag" content={tag} />
          ))}
        </>
      )}

      {/* Additional Open Graph tags */}
      <meta property="og:locale:alternate" content="en_US" />
      <meta property="og:see_also" content={siteConfig.brand.url} />

      {/* Business/Contact info */}
      <meta property="business:contact_data:street_address" content={siteConfig.address} />
      <meta property="business:contact_data:country_name" content="Indonesia" />
      <meta property="business:contact_data:email" content={siteConfig.email} />
      <meta property="business:contact_data:phone_number" content={siteConfig.phone} />
      <meta property="business:contact_data:website" content={siteConfig.url} />

      {/* Pinterest */}
      <meta name="pinterest-rich-pin" content="true" />

      {/* Apple specific */}
      <meta name="apple-itunes-app" content={`app-id=, app-argument=${currentUrl}`} />

      {/* Windows/IE specific */}
      <meta name="msapplication-config" content="/browserconfig.xml" />
      <meta name="msapplication-TileImage" content={`${siteConfig.url}${siteConfig.logo}`} />

      {/* Preload critical resources */}
      <link rel="preload" href={pageImage} as="image" />
    </>
  )
}

export default SeoHead
