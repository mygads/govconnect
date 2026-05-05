import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Toaster } from "@/components/ui/toaster";
import { defaultMetadata, siteConfig } from "@/lib/seo";
import { GoogleAnalytics, GoogleTagManager, GTMNoScript } from "@/components/analytics/GoogleAnalytics";

export const metadata: Metadata = {
  ...defaultMetadata,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://govconnect.id"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#16a34a" },
    { media: "(prefers-color-scheme: dark)", color: "#15803d" },
  ],
};

const renderAnalytics = process.env.NEXT_BUILD_DISABLE_ANALYTICS !== "1";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://www.google-analytics.com" />
        <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
        <link rel="canonical" href={siteConfig.url} />
        <meta name="application-name" content={siteConfig.name} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={siteConfig.name} />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="msapplication-TileColor" content="#16a34a" />
        <meta name="msapplication-tap-highlight" content="no" />
        <meta name="geo.region" content="ID" />
        <meta name="geo.country" content="Indonesia" />
        <meta name="language" content="Indonesian" />
        <meta name="content-language" content="id" />
        <meta name="rating" content="general" />
        <meta name="revisit-after" content="7 days" />
        <meta name="distribution" content="global" />
        <meta name="target" content="all" />
        <meta name="audience" content="all" />
        <meta name="coverage" content="Indonesia" />
      </head>
      <body className="antialiased font-sans">
        {renderAnalytics ? <GTMNoScript containerId={process.env.NEXT_PUBLIC_GTM_ID || ""} /> : null}
        {renderAnalytics ? <GoogleAnalytics measurementId={process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || ""} /> : null}
        {renderAnalytics ? <GoogleTagManager containerId={process.env.NEXT_PUBLIC_GTM_ID || ""} /> : null}
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
