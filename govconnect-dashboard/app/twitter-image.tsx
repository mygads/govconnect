import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'GovConnect - Platform Layanan Pemerintahan Digital Berbasis AI Indonesia | Smart Government Solution by Genfity Digital Solution'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          backgroundImage: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #bbf7d0 100%)',
        }}
      >
        {/* Background Pattern */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(22, 163, 74, 0.1) 0%, transparent 50%)',
          }}
        />
        
        {/* Content Container */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
          }}
        >
          {/* Logo/Icon */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100px',
              height: '100px',
              borderRadius: '20px',
              backgroundColor: '#16a34a',
              marginBottom: '24px',
              boxShadow: '0 16px 32px rgba(22, 163, 74, 0.3)',
            }}
          >
            <svg
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>

          {/* Title */}
          <div
            style={{
              display: 'flex',
              fontSize: '56px',
              fontWeight: 'bold',
              color: '#16a34a',
              marginBottom: '12px',
            }}
          >
            GovConnect
          </div>

          {/* Subtitle */}
          <div
            style={{
              display: 'flex',
              fontSize: '24px',
              color: '#374151',
              textAlign: 'center',
              maxWidth: '700px',
            }}
          >
            Platform Layanan Pemerintahan Digital Berbasis AI
          </div>

          {/* Features */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '32px',
            }}
          >
            {['24/7 Online', 'AI-Powered', 'Multi-Channel'].map((feature) => (
              <div
                key={feature}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(22, 163, 74, 0.1)',
                  padding: '10px 20px',
                  borderRadius: '100px',
                  fontSize: '16px',
                  color: '#16a34a',
                  fontWeight: '600',
                }}
              >
                ✓ {feature}
              </div>
            ))}
          </div>
        </div>

        {/* Footer with Brand */}
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <div
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#16a34a',
            }}
          >
            govconnect.id
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#9ca3af',
            }}
          >
            by Genfity Digital Solution | www.genfity.com
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
