'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Requirement {
  id: string;
  name: string;
  type: string;
  description?: string;
  is_required: boolean;
  file_types?: string;
  max_file_size?: number;
  options?: any;
  order: number;
}

interface Service {
  id: string;
  name: string;
  slug: string;
  description?: string;
  processing_time?: string;
  cost?: string;
  delivery_method: string;
  category: {
    id: string;
    name: string;
  };
  requirements: Requirement[];
}

interface Village {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  phone?: string;
  email?: string;
}

interface PageProps {
  params: Promise<{ villageSlug: string; serviceSlug: string }>;
}

export default function ServiceFormPage({ params }: PageProps) {
  const router = useRouter();
  const [village, setVillage] = useState<Village | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ ticket_number: string; tracking_url: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    applicant_name: '',
    applicant_nik: '',
    applicant_phone: '',
    applicant_email: '',
    applicant_address: '',
    delivery_method: 'PICKUP',
    notes: ''
  });
  const [requirements, setRequirements] = useState<Record<string, { value?: string; file_url?: string; file_name?: string }>>({});

  useEffect(() => {
    async function fetchData() {
      const { villageSlug, serviceSlug } = await params;
      
      try {
        const res = await fetch(`/api/public/${villageSlug}/services/${serviceSlug}`);
        const data = await res.json();
        
        if (data.success) {
          setVillage(data.data.village);
          setService(data.data.service);
          setFormData(prev => ({
            ...prev,
            delivery_method: data.data.service.delivery_method || 'PICKUP'
          }));
        } else {
          setError('Layanan tidak ditemukan');
        }
      } catch (err) {
        setError('Gagal memuat data');
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [params]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleRequirementChange = (reqId: string, value: string) => {
    setRequirements(prev => ({
      ...prev,
      [reqId]: { ...prev[reqId], value }
    }));
  };

  const handleFileChange = async (reqId: string, file: File | null) => {
    if (!file) {
      setRequirements(prev => ({
        ...prev,
        [reqId]: { ...prev[reqId], file_url: undefined, file_name: undefined }
      }));
      return;
    }

    // TODO: Implement file upload to storage
    // For now, just store the file name
    setRequirements(prev => ({
      ...prev,
      [reqId]: { 
        ...prev[reqId], 
        file_url: `uploads/${Date.now()}_${file.name}`, // Placeholder
        file_name: file.name 
      }
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const { villageSlug, serviceSlug } = await params;
      
      // Format requirements
      const filledRequirements = Object.entries(requirements)
        .filter(([_, data]) => data.value || data.file_url)
        .map(([reqId, data]) => ({
          requirement_id: reqId,
          value: data.value,
          file_url: data.file_url,
          file_name: data.file_name
        }));

      const res = await fetch(`/api/public/${villageSlug}/services/${serviceSlug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          requirements: filledRequirements
        })
      });

      const data = await res.json();

      if (data.success) {
        setSuccess({
          ticket_number: data.data.ticket_number,
          tracking_url: data.data.tracking_url
        });
      } else {
        setError(data.error || 'Gagal mengajukan permohonan');
      }
    } catch (err) {
      setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Memuat...</p>
        </div>
      </div>
    );
  }

  if (error && !service) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link href="/" className="text-blue-600 hover:underline">
            Kembali ke beranda
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Permohonan Berhasil Diajukan!</h1>
            <p className="text-gray-600 mb-6">
              Simpan nomor tiket Anda untuk melacak status permohonan
            </p>
            
            <div className="bg-blue-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-600 mb-1">Nomor Tiket:</p>
              <p className="text-2xl font-bold text-blue-700">{success.ticket_number}</p>
            </div>
            
            <div className="space-y-3">
              <Link
                href={`/track?ticket=${success.ticket_number}`}
                className="block w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Lacak Status Permohonan
              </Link>
              <Link
                href={`/form/${village?.slug}`}
                className="block w-full py-3 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Ajukan Permohonan Lain
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <Link 
            href={`/form/${village?.slug}`}
            className="text-blue-600 hover:underline text-sm mb-2 inline-block"
          >
            ← Kembali ke daftar layanan
          </Link>
          <div className="flex items-center gap-3">
            {village?.logo_url && (
              <img 
                src={village.logo_url} 
                alt={village.name}
                className="w-12 h-12 object-contain"
              />
            )}
            <div>
              <h1 className="text-xl font-bold text-gray-900">{village?.name}</h1>
              <p className="text-sm text-gray-600">{service?.category.name}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Form */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow">
          {/* Service Info */}
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold text-gray-900">{service?.name}</h2>
            {service?.description && (
              <p className="text-gray-600 mt-1">{service.description}</p>
            )}
            <div className="flex gap-4 mt-3 text-sm text-gray-500">
              {service?.processing_time && (
                <span>⏱️ Waktu proses: {service.processing_time}</span>
              )}
              {service?.cost && (
                <span>💰 Biaya: {service.cost}</span>
              )}
            </div>
          </div>

          {/* Form Fields */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            {/* Applicant Info */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Data Pemohon</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Nama Lengkap <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="applicant_name"
                    value={formData.applicant_name}
                    onChange={handleInputChange}
                    required
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Masukkan nama lengkap sesuai KTP"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    NIK <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="applicant_nik"
                    value={formData.applicant_nik}
                    onChange={handleInputChange}
                    required
                    maxLength={16}
                    pattern="[0-9]{16}"
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="16 digit NIK"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Nomor WhatsApp <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    name="applicant_phone"
                    value={formData.applicant_phone}
                    onChange={handleInputChange}
                    required
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="08xxxxxxxxxx"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Email</label>
                  <input
                    type="email"
                    name="applicant_email"
                    value={formData.applicant_email}
                    onChange={handleInputChange}
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Alamat</label>
                  <textarea
                    name="applicant_address"
                    value={formData.applicant_address}
                    onChange={handleInputChange}
                    rows={2}
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Alamat lengkap"
                  />
                </div>
              </div>
            </div>

            {/* Requirements */}
            {service?.requirements && service.requirements.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">Persyaratan Dokumen</h3>
                <div className="space-y-4">
                  {service.requirements.map((req) => (
                    <div key={req.id}>
                      <label className="block text-sm text-gray-600 mb-1">
                        {req.name} {req.is_required && <span className="text-red-500">*</span>}
                      </label>
                      {req.description && (
                        <p className="text-xs text-gray-500 mb-1">{req.description}</p>
                      )}
                      
                      {req.type === 'FILE' && (
                        <input
                          type="file"
                          onChange={(e) => handleFileChange(req.id, e.target.files?.[0] || null)}
                          required={req.is_required}
                          accept={req.file_types || '.pdf,.jpg,.jpeg,.png'}
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                        />
                      )}
                      
                      {req.type === 'TEXT' && (
                        <input
                          type="text"
                          onChange={(e) => handleRequirementChange(req.id, e.target.value)}
                          required={req.is_required}
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      )}
                      
                      {req.type === 'TEXTAREA' && (
                        <textarea
                          onChange={(e) => handleRequirementChange(req.id, e.target.value)}
                          required={req.is_required}
                          rows={3}
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      )}
                      
                      {req.type === 'SELECT' && req.options && (
                        <select
                          onChange={(e) => handleRequirementChange(req.id, e.target.value)}
                          required={req.is_required}
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Pilih...</option>
                          {(Array.isArray(req.options) ? req.options : []).map((opt: string) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}
                      
                      {req.type === 'DATE' && (
                        <input
                          type="date"
                          onChange={(e) => handleRequirementChange(req.id, e.target.value)}
                          required={req.is_required}
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      )}
                      
                      {req.type === 'NUMBER' && (
                        <input
                          type="number"
                          onChange={(e) => handleRequirementChange(req.id, e.target.value)}
                          required={req.is_required}
                          className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delivery Method */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Metode Pengambilan</label>
              <select
                name="delivery_method"
                value={formData.delivery_method}
                onChange={handleInputChange}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="PICKUP">Ambil di Kantor Desa</option>
                <option value="DELIVERY">Diantar ke Alamat</option>
                <option value="DIGITAL">Digital/Online</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Catatan Tambahan</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows={2}
                className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Catatan atau keterangan tambahan (opsional)"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {submitting ? 'Mengirim...' : 'Ajukan Permohonan'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
