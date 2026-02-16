import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Toaster } from "@/components/ui/toaster";
import { defaultMetadata, siteConfig } from "@/lib/seo";
import { GoogleAnalytics, GoogleTagManager, GTMNoScript } from "@/components/analytics";

// SEO Metadata
export const metadata: Metadata = {
  ...defaultMetadata,
  title: "Tanggapin AI - Platform AI Agent Untuk Layanan Pemerintahan Digital Indonesia",
  description: "Tanggapin AI adalah Platform AI Agent untuk layanan pemerintahan digital Indonesia. Laporkan keluhan, ajukan layanan administrasi, dan dapatkan informasi pemerintah langsung melalui WhatsApp dan webchat. Solusi smart government 24/7 untuk kelurahan, kecamatan, dan instansi pemerintah.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://tanggapin.ai'),
};

// Viewport Configuration
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3F72AF' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning className={`scroll-smooth ${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/* Preconnect untuk performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        
        {/* DNS Prefetch */}
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        
        {/* Canonical URL */}
        <link rel="canonical" href={siteConfig.url} />
        
        {/* Additional Meta Tags untuk SEO */}
        <meta name="application-name" content={siteConfig.name} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={siteConfig.name} />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#3F72AF" />
        <meta name="msapplication-tap-highlight" content="no" />
        
        {/* Geo Tags untuk Local SEO Indonesia */}
        <meta name="geo.region" content="ID" />
        <meta name="geo.country" content="Indonesia" />
        <meta name="language" content="Indonesian" />
        <meta name="content-language" content="id" />
        
        {/* Rating */}
        <meta name="rating" content="general" />
        <meta name="revisit-after" content="7 days" />
        
        {/* Distribution */}
        <meta name="distribution" content="global" />
        <meta name="target" content="all" />
        <meta name="audience" content="all" />
        <meta name="coverage" content="Indonesia" />
      </head>
      <body className="antialiased font-sans">
        {/* Google Tag Manager NoScript - Fallback untuk browser tanpa JS */}
        <GTMNoScript containerId={process.env.NEXT_PUBLIC_GTM_ID || ''} />
        
        {/* Google Analytics 4 */}
        <GoogleAnalytics measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || ''} />
        
        {/* Google Tag Manager */}
        <GoogleTagManager containerId={process.env.NEXT_PUBLIC_GTM_ID || ''} />
        
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
