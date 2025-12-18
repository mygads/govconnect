'use client'

import { generateHomePageSchemas, generateFAQSchema, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo'

// ============================================
// JSON-LD COMPONENT - For Structured Data
// ============================================

interface JsonLdProps {
  type?: 'homepage' | 'faq' | 'breadcrumb' | 'article' | 'custom'
  data?: Record<string, unknown> | Record<string, unknown>[]
  faqs?: { question: string; answer: string }[]
  breadcrumbs?: { name: string; url: string }[]
  article?: {
    title: string
    description: string
    image?: string
    datePublished: string
    dateModified?: string
    url: string
  }
}

export function JsonLd({ type = 'homepage', data, faqs, breadcrumbs, article }: JsonLdProps) {
  let schemas: Record<string, unknown>[] = []

  switch (type) {
    case 'homepage':
      schemas = generateHomePageSchemas()
      break
    case 'faq':
      if (faqs) {
        schemas = [generateFAQSchema(faqs)]
      }
      break
    case 'breadcrumb':
      if (breadcrumbs) {
        schemas = [generateBreadcrumbSchema(breadcrumbs)]
      }
      break
    case 'article':
      if (article) {
        schemas = [generateArticleSchema(article)]
      }
      break
    case 'custom':
      if (data) {
        schemas = Array.isArray(data) ? data : [data]
      }
      break
  }

  if (schemas.length === 0) return null

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

// Homepage JSON-LD dengan semua schema
export function HomePageJsonLd() {
  return <JsonLd type="homepage" />
}

// FAQ Page JSON-LD
export function FAQJsonLd({ faqs }: { faqs: { question: string; answer: string }[] }) {
  return <JsonLd type="faq" faqs={faqs} />
}

// Breadcrumb JSON-LD
export function BreadcrumbJsonLd({ items }: { items: { name: string; url: string }[] }) {
  return <JsonLd type="breadcrumb" breadcrumbs={items} />
}

// Article JSON-LD
export function ArticleJsonLd({ article }: { article: JsonLdProps['article'] }) {
  return <JsonLd type="article" article={article} />
}

export default JsonLd
