import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';

// Types
interface Complaint {
  id: string;
  complaint_id: string;
  wa_user_id: string;
  kategori: string;
  deskripsi: string;
  alamat?: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

interface ExportOptions {
  title?: string;
  filename?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// =====================================================
// EXCEL EXPORT
// =====================================================

export function exportToExcel(complaints: Complaint[], options: ExportOptions = {}) {
  const { filename = 'laporan-pengaduan', title = 'Laporan Pengaduan' } = options;

  // Transform data for Excel
  const excelData = complaints.map((c, index) => ({
    'No': index + 1,
    'ID Laporan': c.complaint_id,
    'No. WhatsApp': c.wa_user_id,
    'Kategori': c.kategori.replace(/_/g, ' '),
    'Deskripsi': c.deskripsi,
    'Alamat': c.alamat || '-',
    'Status': formatStatusText(c.status),
    'Tanggal Lapor': formatDateIndo(c.created_at),
    'Terakhir Update': c.updated_at ? formatDateIndo(c.updated_at) : '-',
  }));

  // Create workbook
  const workbook = XLSX.utils.book_new();
  
  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(excelData);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 5 },   // No
    { wch: 18 },  // ID Laporan
    { wch: 15 },  // WhatsApp
    { wch: 15 },  // Kategori
    { wch: 50 },  // Deskripsi
    { wch: 30 },  // Alamat
    { wch: 12 },  // Status
    { wch: 18 },  // Tanggal Lapor
    { wch: 18 },  // Update
  ];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan');

  // Generate filename with date
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  const fullFilename = `${filename}_${dateStr}.xlsx`;

  // Trigger download
  XLSX.writeFile(workbook, fullFilename);

  return fullFilename;
}

// =====================================================
// PDF EXPORT
// =====================================================

export function exportToPDF(complaints: Complaint[], options: ExportOptions = {}) {
  const { filename = 'laporan-pengaduan', title = 'Laporan Pengaduan Masyarakat' } = options;

  // Create PDF (A4 landscape for more columns)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, pageWidth / 2, 15, { align: 'center' });

  // Sub header
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Dicetak: ${formatDateIndo(new Date().toISOString())}`, pageWidth / 2, 22, { align: 'center' });
  
  if (options.dateRange) {
    const rangeText = `Periode: ${formatDateIndo(options.dateRange.start.toISOString())} - ${formatDateIndo(options.dateRange.end.toISOString())}`;
    doc.text(rangeText, pageWidth / 2, 27, { align: 'center' });
  }

  // Table data
  const tableData = complaints.map((c, index) => [
    index + 1,
    c.complaint_id,
    c.wa_user_id,
    c.kategori.replace(/_/g, ' '),
    c.deskripsi.length > 50 ? c.deskripsi.substring(0, 50) + '...' : c.deskripsi,
    formatStatusText(c.status),
    formatDateIndo(c.created_at),
  ]);

  // Generate table
  autoTable(doc, {
    head: [['No', 'ID Laporan', 'WhatsApp', 'Kategori', 'Deskripsi', 'Status', 'Tanggal']],
    body: tableData,
    startY: options.dateRange ? 32 : 27,
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [59, 130, 246], // Blue
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 30 },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 80 },
      5: { cellWidth: 20 },
      6: { cellWidth: 30 },
    },
  });

  // Footer with stats
  const finalY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Ringkasan:', 14, finalY);
  doc.setFont('helvetica', 'normal');
  
  const stats = getComplaintStats(complaints);
  doc.text(`Total Laporan: ${stats.total}`, 14, finalY + 5);
  doc.text(`Baru: ${stats.open} | Proses: ${stats.process} | Selesai: ${stats.done} | Dibatalkan: ${stats.canceled} | Ditolak: ${stats.reject}`, 14, finalY + 10);

  // Generate filename with date
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  const fullFilename = `${filename}_${dateStr}.pdf`;

  // Save PDF
  doc.save(fullFilename);

  return fullFilename;
}

// =====================================================
// PRINT BUKTI LAPORAN
// =====================================================

export function generateReceiptHTML(complaint: Complaint): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Bukti Laporan - ${complaint.complaint_id}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; }
        .receipt { 
          max-width: 800px; 
          margin: 0 auto; 
          border: 2px solid #333; 
          padding: 30px;
          position: relative;
        }
        .header { 
          text-align: center; 
          border-bottom: 2px solid #333; 
          padding-bottom: 20px; 
          margin-bottom: 20px;
        }
        .header h1 { font-size: 24px; margin-bottom: 5px; }
        .header .subtitle { color: #666; font-size: 14px; }
        .receipt-number {
          background: #3b82f6;
          color: white;
          padding: 10px 20px;
          font-size: 20px;
          font-weight: bold;
          text-align: center;
          margin: 20px 0;
          border-radius: 5px;
        }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
        .info-item { margin-bottom: 15px; }
        .info-item label { 
          display: block; 
          font-size: 12px; 
          color: #666; 
          text-transform: uppercase; 
          margin-bottom: 5px;
        }
        .info-item .value { font-size: 14px; font-weight: 500; }
        .description {
          background: #f5f5f5;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
        }
        .description label { 
          display: block; 
          font-size: 12px; 
          color: #666; 
          text-transform: uppercase; 
          margin-bottom: 10px;
        }
        .status-badge {
          display: inline-block;
          padding: 5px 15px;
          border-radius: 20px;
          font-weight: bold;
          font-size: 14px;
        }
        .status-open { background: #fef3c7; color: #92400e; }
        .status-process { background: #dbeafe; color: #1e40af; }
        .status-done { background: #d1fae5; color: #065f46; }
        .status-canceled { background: #e5e7eb; color: #374151; }
        .status-reject { background: #fee2e2; color: #991b1b; }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px dashed #ccc;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .qr-placeholder {
          width: 80px;
          height: 80px;
          border: 1px solid #ccc;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: #999;
        }
        .print-info { font-size: 11px; color: #666; }
        @media print {
          body { padding: 0; }
          .receipt { border: 1px solid #000; }
          .no-print { display: none; }
        }
      </style>
    </head>
      <body>
        <div class="receipt">
        <div class="header">
          <h1>TANDA TERIMA LAPORAN</h1>
          <p class="subtitle">Sistem Pengaduan Masyarakat - Tanggapin AI</p>
        </div>
        
          <div class="receipt-number">
          ${complaint.complaint_id}
        </div>
        
        <div class="info-grid">
          <div class="info-item">
            <label>Nomor WhatsApp</label>
            <div class="value">${complaint.wa_user_id}</div>
          </div>
          <div class="info-item">
            <label>Kategori</label>
            <div class="value">${complaint.kategori.replace(/_/g, ' ')}</div>
          </div>
          <div class="info-item">
            <label>Tanggal Lapor</label>
            <div class="value">${formatDateIndo(complaint.created_at)}</div>
          </div>
          <div class="info-item">
            <label>Status</label>
            <div class="value">
              <span class="status-badge status-${String(complaint.status || '').toLowerCase()}">${formatStatusText(complaint.status)}</span>
            </div>
          </div>
        </div>

        ${complaint.alamat ? `
        <div class="info-item">
          <label>Alamat Kejadian</label>
          <div class="value">${complaint.alamat}</div>
        </div>
        ` : ''}
        
        <div class="description">
          <label>Deskripsi Laporan</label>
          <p>${complaint.deskripsi}</p>
        </div>
        
        <div class="footer">
          <div class="print-info">
            <p>Dicetak: ${formatDateIndo(new Date().toISOString())}</p>
            <p>Simpan nomor laporan ini untuk mengecek status laporan Anda.</p>
          </div>
          <div class="qr-placeholder">
            QR Code
          </div>
        </div>
      </div>
      
      <div class="no-print" style="text-align: center; margin-top: 20px;">
        <button onclick="window.print()" style="padding: 10px 30px; font-size: 16px; cursor: pointer;">
          🖨️ Cetak Bukti
        </button>
      </div>
    </body>
    </html>
  `;
}

export function printReceipt(complaint: Complaint) {
  const html = generateReceiptHTML(complaint);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

// =====================================================
// REPORT GENERATION
// =====================================================

interface ReportData {
  period: string;
  startDate: Date;
  endDate: Date;
  complaints: Complaint[];
  stats: ReturnType<typeof getComplaintStats>;
  categoryBreakdown: Record<string, number>;
}

export function generateReport(
  complaints: Complaint[],
  period: 'weekly' | 'monthly',
  date: Date = new Date()
): ReportData {
  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  if (period === 'weekly') {
    // Get start of week (Monday)
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    startDate = new Date(date.setDate(diff));
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    periodLabel = `Minggu ${format(startDate, 'd MMM', { locale: idLocale })} - ${format(endDate, 'd MMM yyyy', { locale: idLocale })}`;
  } else {
    // Monthly
    startDate = new Date(date.getFullYear(), date.getMonth(), 1);
    endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);
    periodLabel = format(startDate, 'MMMM yyyy', { locale: idLocale });
  }

  // Filter complaints by date range
  const filteredComplaints = complaints.filter(c => {
    const createdAt = new Date(c.created_at);
    return createdAt >= startDate && createdAt <= endDate;
  });

  // Calculate category breakdown
  const categoryBreakdown: Record<string, number> = {};
  filteredComplaints.forEach(c => {
    const cat = c.kategori;
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  });

  return {
    period: periodLabel,
    startDate,
    endDate,
    complaints: filteredComplaints,
    stats: getComplaintStats(filteredComplaints),
    categoryBreakdown,
  };
}

export function exportReportToPDF(report: ReportData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 15;

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('LAPORAN PENGADUAN MASYARAKAT', pageWidth / 2, yPos, { align: 'center' });
  
  yPos += 8;
  doc.setFontSize(14);
  doc.text(report.period, pageWidth / 2, yPos, { align: 'center' });

  yPos += 5;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Dicetak: ${formatDateIndo(new Date().toISOString())}`, pageWidth / 2, yPos, { align: 'center' });

  // Stats Summary Box
  yPos += 15;
  doc.setFillColor(240, 240, 240);
  doc.rect(14, yPos, pageWidth - 28, 35, 'F');
  
  yPos += 8;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('RINGKASAN STATISTIK', 20, yPos);
  
  yPos += 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  
  const statsCol1 = [
    `Total Laporan: ${report.stats.total}`,
    `Laporan Baru: ${report.stats.open}`,
  ];
  const statsCol2 = [
    `Dalam Proses: ${report.stats.process}`,
    `Selesai: ${report.stats.done}`,
  ];
  const statsCol3 = [
    `Dibatalkan: ${report.stats.canceled}`,
    `Ditolak: ${report.stats.reject}`,
    `Tingkat Penyelesaian: ${report.stats.total > 0 ? Math.round((report.stats.done / report.stats.total) * 100) : 0}%`,
  ];

  statsCol1.forEach((text, i) => {
    doc.text(text, 20, yPos + (i * 6));
  });
  statsCol2.forEach((text, i) => {
    doc.text(text, 80, yPos + (i * 6));
  });
  statsCol3.forEach((text, i) => {
    doc.text(text, 140, yPos + (i * 6));
  });

  // Category Breakdown
  yPos += 25;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('BREAKDOWN PER KATEGORI', 14, yPos);

  yPos += 5;
  const categoryData = Object.entries(report.categoryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => [
      category.replace(/_/g, ' '),
      count.toString(),
      `${Math.round((count / report.stats.total) * 100)}%`,
    ]);

  if (categoryData.length > 0) {
    autoTable(doc, {
      head: [['Kategori', 'Jumlah', 'Persentase']],
      body: categoryData,
      startY: yPos,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [59, 130, 246] },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 30, halign: 'center' },
      },
    });
    yPos = (doc as any).lastAutoTable.finalY + 10;
  }

  // Complaints Table
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('DAFTAR LAPORAN', 14, yPos);

  yPos += 5;
  const tableData = report.complaints.map((c, i) => [
    i + 1,
    c.complaint_id,
    c.kategori.replace(/_/g, ' '),
    formatStatusText(c.status),
    formatDateIndo(c.created_at),
  ]);

  if (tableData.length > 0) {
    autoTable(doc, {
      head: [['No', 'ID Laporan', 'Kategori', 'Status', 'Tanggal']],
      body: tableData,
      startY: yPos,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });
  } else {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Tidak ada laporan dalam periode ini.', 14, yPos + 5);
  }

  // Save
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  const filename = `laporan-${report.period.toLowerCase().replace(/\s+/g, '-')}_${dateStr}.pdf`;
  doc.save(filename);

  return filename;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function formatDateIndo(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'd MMMM yyyy, HH:mm', { locale: idLocale });
  } catch {
    return dateStr;
  }
}

function formatStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    open: 'Baru',
    process: 'Dalam Proses',
    done: 'Selesai',
    canceled: 'Dibatalkan',
    reject: 'Ditolak',
    baru: 'Baru',
    proses: 'Dalam Proses',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan',
    ditolak: 'Ditolak',
  };
  return statusMap[status.toLowerCase()] || status;
}

function getComplaintStats(complaints: Complaint[]) {
  return {
    total: complaints.length,
    open: complaints.filter(c => ['OPEN', 'baru'].includes(c.status)).length,
    process: complaints.filter(c => ['PROCESS', 'proses'].includes(c.status)).length,
    done: complaints.filter(c => ['DONE', 'selesai'].includes(c.status)).length,
    canceled: complaints.filter(c => ['CANCELED', 'dibatalkan'].includes(c.status)).length,
    reject: complaints.filter(c => ['REJECT', 'ditolak'].includes(c.status)).length,
  };
}
