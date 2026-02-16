import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'Tanggapin AI - Sistem AI Agent khusus Pemerintah Berbasis Large Language Model'
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
          backgroundColor: '#F9F7F7',
          backgroundImage: 'linear-gradient(135deg, #F9F7F7 0%, #DBE2EF 60%, #3F72AF 100%)',
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
            backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(63, 114, 175, 0.2) 0%, transparent 50%)',
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
              backgroundColor: '#112D4E',
              marginBottom: '24px',
              boxShadow: '0 16px 32px rgba(17, 45, 78, 0.35)',
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
              color: '#112D4E',
              marginBottom: '12px',
            }}
          >
            Tanggapin AI
          </div>

          {/* Subtitle */}
          <div
            style={{
              display: 'flex',
              fontSize: '24px',
              color: '#112D4E',
              textAlign: 'center',
              maxWidth: '700px',
            }}
          >
            AI Agent Pemerintah Berbasis LLM
          </div>

          {/* Features */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '32px',
            }}
          >
            {['Lama Balas', 'Data', 'Pengaduan'].map((feature) => (
              <div
                key={feature}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: 'rgba(219, 226, 239, 0.9)',
                  padding: '10px 20px',
                  borderRadius: '100px',
                  fontSize: '16px',
                  color: '#112D4E',
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
              color: '#3F72AF',
            }}
          >
            tanggapin.ai
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
