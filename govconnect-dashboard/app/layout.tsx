import type { Metadata } from "next";
// Temporarily disabled Google Fonts for Docker build
// import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Toaster } from "@/components/ui/toaster";

// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });

// const geistMono = Geist_Mono({
//   variable: "--font-geist-mono",
//   subsets: ["latin"],
// });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: "GovConnect - Layanan Kelurahan Digital Terpadu",
  description: "Laporkan keluhan, ajukan surat, dan dapatkan informasi kelurahan langsung melalui WhatsApp. Cepat, mudah, dan terpercaya.",
  keywords: ["govconnect", "layanan kelurahan", "whatsapp", "digital", "pemerintah", "surat online", "laporan keluhan"],
  authors: [{ name: "GovConnect Team" }],
  creator: "GovConnect",
  publisher: "GovConnect",
  openGraph: {
    type: "website",
    locale: "id_ID",
    url: "https://govconnect.id",
    title: "GovConnect - Layanan Kelurahan Digital Terpadu",
    description: "Laporkan keluhan, ajukan surat, dan dapatkan informasi kelurahan langsung melalui WhatsApp. Cepat, mudah, dan terpercaya.",
    siteName: "GovConnect",
    images: [
      {
        url: "/dashboard.png",
        width: 1200,
        height: 630,
        alt: "GovConnect Dashboard Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GovConnect - Layanan Kelurahan Digital Terpadu",
    description: "Laporkan keluhan, ajukan surat, dan dapatkan informasi kelurahan langsung melalui WhatsApp.",
    images: ["/dashboard.png"],
    creator: "@govconnect",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/logo-dashboard.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning className="scroll-smooth">
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
