'use client'

import Script from 'next/script'

interface GoogleAnalyticsProps {
  measurementId: string
}

export function GoogleAnalytics({ measurementId }: GoogleAnalyticsProps) {
  if (!measurementId) return null

  return (
    <>
      {/* Google Analytics 4 */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}', {
            page_title: document.title,
            page_location: window.location.href,
            send_page_view: true,
            cookie_flags: 'SameSite=None;Secure',
          });
        `}
      </Script>
    </>
  )
}

// Google Tag Manager
interface GTMProps {
  containerId: string
}

export function GoogleTagManager({ containerId }: GTMProps) {
  if (!containerId) return null

  return (
    <>
      {/* Google Tag Manager - Head */}
      <Script id="gtm-head" strategy="afterInteractive">
        {`
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','${containerId}');
        `}
      </Script>
    </>
  )
}

// GTM NoScript (untuk body)
export function GTMNoScript({ containerId }: GTMProps) {
  if (!containerId) return null

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${containerId}`}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
      />
    </noscript>
  )
}

// Facebook Pixel
interface FacebookPixelProps {
  pixelId: string
}

export function FacebookPixel({ pixelId }: FacebookPixelProps) {
  if (!pixelId) return null

  return (
    <Script id="facebook-pixel" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${pixelId}');
        fbq('track', 'PageView');
      `}
    </Script>
  )
}

// Custom Event Tracking
export function trackEvent(
  eventName: string,
  eventParams?: Record<string, unknown>
) {
  if (typeof window !== 'undefined' && (window as unknown as { gtag?: Function }).gtag) {
    (window as unknown as { gtag: Function }).gtag('event', eventName, eventParams)
  }
}

// Predefined Events untuk GovConnect
export const GovConnectEvents = {
  // User Engagement
  viewDemo: () => trackEvent('view_demo', { content_type: 'demo' }),
  clickWhatsApp: () => trackEvent('click_whatsapp', { method: 'whatsapp' }),
  clickLogin: () => trackEvent('click_login', { method: 'dashboard' }),
  
  // Feature Interest
  viewFeature: (featureName: string) => 
    trackEvent('view_feature', { feature_name: featureName }),
  
  // FAQ Interaction
  expandFAQ: (question: string) => 
    trackEvent('expand_faq', { question }),
  
  // Contact
  contactUs: (method: string) => 
    trackEvent('contact_us', { method }),
  
  // Scroll Depth
  scrollDepth: (percentage: number) => 
    trackEvent('scroll_depth', { percentage }),
  
  // Time on Page
  timeOnPage: (seconds: number) => 
    trackEvent('time_on_page', { seconds }),
}
