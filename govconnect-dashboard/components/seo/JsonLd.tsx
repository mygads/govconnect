'use client'

import { generateHomePageSchemas } from '@/lib/seo'

export function HomePageJsonLd() {
  const schemas = generateHomePageSchemas()

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
