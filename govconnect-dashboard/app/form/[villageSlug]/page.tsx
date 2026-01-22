import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ villageSlug: string }>;
}

async function getVillageData(villageSlug: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/public/${villageSlug}`, {
    cache: 'no-store'
  });
  
  if (!res.ok) return null;
  const data = await res.json();
  return data.success ? data.data : null;
}

async function getServicesData(villageSlug: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/public/${villageSlug}/services`, {
    cache: 'no-store'
  });
  
  if (!res.ok) return null;
  const data = await res.json();
  return data.success ? data.data : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { villageSlug } = await params;
  const village = await getVillageData(villageSlug);
  
  return {
    title: village ? `Layanan ${village.name} - GovConnect` : 'Layanan Desa - GovConnect',
    description: village ? `Ajukan permohonan layanan di ${village.name}` : 'Layanan Desa GovConnect'
  };
}

export default async function VillageServicesPage({ params }: PageProps) {
  const { villageSlug } = await params;
  
  const [village, servicesData] = await Promise.all([
    getVillageData(villageSlug),
    getServicesData(villageSlug)
  ]);

  if (!village || !servicesData) {
    notFound();
  }

  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            {village.logo_url && (
              <img 
                src={village.logo_url} 
                alt={village.name}
                className="w-16 h-16 object-contain"
              />
            )}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{village.name}</h1>
              <p className="text-gray-600">
                {village.district}, {village.regency}, {village.province}
              </p>
            </div>
          </div>
          
          {village.welcome_message && (
            <p className="mt-4 text-gray-700">{village.welcome_message}</p>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Village Info */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Informasi Kontak</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            {village.address && (
              <div>
                <span className="text-gray-500">Alamat:</span>
                <p className="text-gray-900">{village.address}</p>
              </div>
            )}
            {village.phone && (
              <div>
                <span className="text-gray-500">Telepon:</span>
                <p className="text-gray-900">{village.phone}</p>
              </div>
            )}
            {village.email && (
              <div>
                <span className="text-gray-500">Email:</span>
                <p className="text-gray-900">{village.email}</p>
              </div>
            )}
          </div>
          
          {/* Operating Hours */}
          {village.operating_hours && village.operating_hours.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Jam Operasional:</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                {village.operating_hours
                  .filter((h: any) => !h.is_closed)
                  .map((hour: any) => (
                    <div key={hour.day_of_week}>
                      <span className="font-medium">{dayNames[hour.day_of_week]}:</span>{' '}
                      {hour.open_time} - {hour.close_time}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Services List */}
        <h2 className="text-xl font-bold text-gray-900 mb-4">Pilih Layanan</h2>
        
        {servicesData.categories.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-500">Belum ada layanan yang tersedia</p>
          </div>
        ) : (
          <div className="space-y-6">
            {servicesData.categories.map((category: any) => (
              <div key={category.id} className="bg-white rounded-lg shadow">
                <div className="p-4 border-b bg-gray-50 rounded-t-lg">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    {category.icon && <span>{category.icon}</span>}
                    {category.name}
                  </h3>
                  {category.description && (
                    <p className="text-sm text-gray-600 mt-1">{category.description}</p>
                  )}
                </div>
                <div className="divide-y">
                  {category.services.map((service: any) => (
                    <Link 
                      key={service.id}
                      href={`/form/${villageSlug}/${service.slug}`}
                      className="block p-4 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{service.name}</h4>
                          {service.description && (
                            <p className="text-sm text-gray-600 mt-1">{service.description}</p>
                          )}
                          <div className="flex gap-4 mt-2 text-xs text-gray-500">
                            {service.processing_time && (
                              <span>⏱️ {service.processing_time}</span>
                            )}
                            {service.cost && (
                              <span>💰 {service.cost}</span>
                            )}
                          </div>
                        </div>
                        <span className="text-blue-600 text-sm">Ajukan →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Track Link */}
        <div className="mt-8 text-center">
          <p className="text-gray-600 mb-2">Sudah punya nomor tiket?</p>
          <Link 
            href="/track"
            className="text-blue-600 hover:underline font-medium"
          >
            Lacak Status Permohonan →
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
          <p>Powered by GovConnect</p>
        </div>
      </footer>
    </div>
  );
}
