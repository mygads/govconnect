'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface StatusHistory {
  status: string;
  notes?: string;
  created_at: string;
}

interface TrackingData {
  ticket_number: string;
  village: {
    name: string;
    slug: string;
    phone?: string;
  };
  service: {
    name: string;
    processing_time?: string;
    category: {
      name: string;
    };
  };
  applicant_name: string;
  status: string;
  delivery_method: string;
  pickup_location?: string;
  pickup_date?: string;
  rejection_reason?: string;
  created_at: string;
  completed_at?: string;
  status_history: StatusHistory[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  'SUBMITTED': { label: 'Diajukan', color: 'bg-blue-100 text-blue-800' },
  'VERIFYING': { label: 'Verifikasi', color: 'bg-yellow-100 text-yellow-800' },
  'REVISION_NEEDED': { label: 'Perlu Revisi', color: 'bg-orange-100 text-orange-800' },
  'PROCESSING': { label: 'Diproses', color: 'bg-indigo-100 text-indigo-800' },
  'READY': { label: 'Siap Diambil', color: 'bg-green-100 text-green-800' },
  'DELIVERED': { label: 'Dikirim', color: 'bg-teal-100 text-teal-800' },
  'COMPLETED': { label: 'Selesai', color: 'bg-green-100 text-green-800' },
  'REJECTED': { label: 'Ditolak', color: 'bg-red-100 text-red-800' },
  'CANCELLED': { label: 'Dibatalkan', color: 'bg-gray-100 text-gray-800' }
};

function TrackingContent() {
  const searchParams = useSearchParams();
  const initialTicket = searchParams.get('ticket') || '';
  
  const [ticketNumber, setTicketNumber] = useState(initialTicket);
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketNumber.trim()) return;
    
    setLoading(true);
    setError('');
    setSearched(true);
    
    try {
      const res = await fetch(`/api/public/track/${ticketNumber.trim()}`);
      const result = await res.json();
      
      if (result.success) {
        setData(result.data);
      } else {
        setData(null);
        setError(result.error || 'Permohonan tidak ditemukan');
      }
    } catch (err) {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
      {/* Search Form */}
      <form onSubmit={handleSearch} className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={ticketNumber}
            onChange={(e) => setTicketNumber(e.target.value)}
            placeholder="Masukkan nomor tiket (contoh: SVC-20250101-XXXXX)"
            className="flex-1 border rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={loading || !ticketNumber.trim()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {loading ? 'Mencari...' : 'Lacak'}
          </button>
        </div>
      </form>

      {/* Error State */}
      {searched && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-700">{error}</p>
            <p className="text-sm text-red-600 mt-2">
              Pastikan nomor tiket yang Anda masukkan sudah benar
            </p>
          </div>
        )}

        {/* Result */}
        {data && (
          <div className="space-y-6">
            {/* Status Card */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-sm text-gray-500">Nomor Tiket</p>
                  <p className="text-lg font-bold text-gray-900">{data.ticket_number}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_LABELS[data.status]?.color || 'bg-gray-100'}`}>
                  {STATUS_LABELS[data.status]?.label || data.status}
                </span>
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Layanan</span>
                  <span className="text-gray-900 font-medium">{data.service.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Kategori</span>
                  <span className="text-gray-900">{data.service.category.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Desa/Kelurahan</span>
                  <span className="text-gray-900">{data.village.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Nama Pemohon</span>
                  <span className="text-gray-900">{data.applicant_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tanggal Pengajuan</span>
                  <span className="text-gray-900">{formatDate(data.created_at)}</span>
                </div>
                {data.service.processing_time && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Estimasi Proses</span>
                    <span className="text-gray-900">{data.service.processing_time}</span>
                  </div>
                )}
              </div>

              {/* Status-specific info */}
              {data.status === 'READY' && data.pickup_location && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <p className="text-sm font-medium text-green-800">Dokumen Siap Diambil</p>
                  <p className="text-green-700">{data.pickup_location}</p>
                  {data.pickup_date && (
                    <p className="text-sm text-green-600">Jadwal: {formatDate(data.pickup_date)}</p>
                  )}
                </div>
              )}

              {data.status === 'REJECTED' && data.rejection_reason && (
                <div className="mt-4 p-4 bg-red-50 rounded-lg">
                  <p className="text-sm font-medium text-red-800">Alasan Penolakan</p>
                  <p className="text-red-700">{data.rejection_reason}</p>
                </div>
              )}

              {data.status === 'REVISION_NEEDED' && (
                <div className="mt-4 p-4 bg-orange-50 rounded-lg">
                  <p className="text-sm font-medium text-orange-800">Perlu Revisi</p>
                  <p className="text-orange-700">
                    Silakan hubungi kantor desa untuk informasi lebih lanjut.
                  </p>
                  {data.village.phone && (
                    <a 
                      href={`tel:${data.village.phone}`}
                      className="text-orange-600 hover:underline font-medium"
                    >
                      📞 {data.village.phone}
                    </a>
                  )}
                </div>
              )}

              {data.completed_at && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm text-gray-500">Selesai pada:</p>
                  <p className="text-gray-900">{formatDate(data.completed_at)}</p>
                </div>
              )}
            </div>

            {/* Status History */}
            {data.status_history.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Riwayat Status</h3>
                <div className="space-y-4">
                  {data.status_history.map((history, index) => (
                    <div key={index} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full ${index === 0 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                        {index < data.status_history.length - 1 && (
                          <div className="w-0.5 h-full bg-gray-200 mt-1" />
                        )}
                      </div>
                      <div className="flex-1 pb-4">
                        <p className="font-medium text-gray-900">
                          {STATUS_LABELS[history.status]?.label || history.status}
                        </p>
                        {history.notes && (
                          <p className="text-sm text-gray-600 mt-1">{history.notes}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDate(history.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contact */}
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <p className="text-gray-600 mb-2">Ada pertanyaan?</p>
              <p className="text-gray-900">Hubungi {data.village.name}</p>
              {data.village.phone && (
                <a 
                  href={`tel:${data.village.phone}`}
                  className="inline-block mt-2 text-blue-600 hover:underline font-medium"
                >
                  📞 {data.village.phone}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Initial State */}
        {!searched && (
          <div className="text-center text-gray-500 py-12">
            <p>Masukkan nomor tiket untuk melihat status permohonan</p>
          </div>
        )}
    </>
  );
}

function LoadingFallback() {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="animate-pulse flex gap-3">
        <div className="flex-1 h-12 bg-gray-200 rounded-lg"></div>
        <div className="w-24 h-12 bg-gray-200 rounded-lg"></div>
      </div>
    </div>
  );
}

export default function TrackingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900">Lacak Permohonan</h1>
          <p className="text-gray-600 mt-1">
            Masukkan nomor tiket untuk melihat status permohonan Anda
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Suspense fallback={<LoadingFallback />}>
          <TrackingContent />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-2xl mx-auto px-4 py-6 text-center">
          <Link href="/" className="text-blue-600 hover:underline">
            ← Kembali ke Beranda
          </Link>
        </div>
      </footer>
    </div>
  );
}
