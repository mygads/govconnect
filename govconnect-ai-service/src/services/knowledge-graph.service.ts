/**
 * Knowledge Graph Service
 * 
 * Manages relationships between knowledge items for better context retrieval.
 * 
 * Features:
 * - Service relationships (SKD → SKTM → SKBM)
 * - Prerequisite relationships
 * - Related topics clustering
 * - Follow-up suggestions
 * 
 * This helps AI provide more contextual and helpful responses.
 */

import logger from '../utils/logger';

// ==================== TYPES ====================

export type RelationType = 
  | 'prerequisite'    // A is required before B
  | 'related'         // A and B are related topics
  | 'alternative'     // A can be used instead of B
  | 'follow_up'       // B is commonly asked after A
  | 'part_of'         // A is part of B
  | 'requires';       // A requires B (document/process)

export interface KnowledgeRelation {
  from: string;       // Source node ID or code
  to: string;         // Target node ID or code
  type: RelationType;
  weight: number;     // 0-1, strength of relationship
  description?: string;
}

export interface KnowledgeNode {
  id: string;
  code: string;       // e.g., 'SKD', 'SKTM', 'jalan_rusak'
  name: string;
  category: string;   // 'layanan', 'laporan', 'informasi'
  keywords: string[];
  relations: KnowledgeRelation[];
}

export interface GraphTraversalResult {
  relatedNodes: KnowledgeNode[];
  prerequisites: KnowledgeNode[];
  followUps: KnowledgeNode[];
  alternatives: KnowledgeNode[];
}

// ==================== KNOWLEDGE GRAPH DATA ====================

/**
 * Service/Document relationships
 */
const SERVICE_RELATIONS: KnowledgeRelation[] = [
  // SKD relationships
  { from: 'SKD', to: 'SPKTP', type: 'related', weight: 0.8, description: 'Sering diurus bersamaan' },
  { from: 'SKD', to: 'SPKK', type: 'related', weight: 0.7, description: 'Untuk keperluan keluarga' },
  { from: 'SKD', to: 'KTP', type: 'requires', weight: 1.0, description: 'Memerlukan KTP' },
  { from: 'SKD', to: 'KK', type: 'requires', weight: 1.0, description: 'Memerlukan KK' },
  
  // SKTM relationships
  { from: 'SKTM', to: 'SKD', type: 'related', weight: 0.6, description: 'Sering diurus bersamaan' },
  { from: 'SKTM', to: 'BPJS', type: 'follow_up', weight: 0.9, description: 'Untuk daftar BPJS' },
  { from: 'SKTM', to: 'BEASISWA', type: 'follow_up', weight: 0.8, description: 'Untuk beasiswa' },
  { from: 'SKTM', to: 'KTP', type: 'requires', weight: 1.0, description: 'Memerlukan KTP' },
  { from: 'SKTM', to: 'KK', type: 'requires', weight: 1.0, description: 'Memerlukan KK' },
  { from: 'SKTM', to: 'SURAT_RT', type: 'requires', weight: 1.0, description: 'Memerlukan surat RT' },
  
  // SKU relationships
  { from: 'SKU', to: 'SIUP', type: 'follow_up', weight: 0.8, description: 'Untuk izin usaha' },
  { from: 'SKU', to: 'SKD', type: 'related', weight: 0.5, description: 'Domisili usaha' },
  { from: 'SKU', to: 'KTP', type: 'requires', weight: 1.0, description: 'Memerlukan KTP' },
  
  // SPKTP relationships
  { from: 'SPKTP', to: 'KTP_BARU', type: 'follow_up', weight: 1.0, description: 'Untuk buat KTP baru' },
  { from: 'SPKTP', to: 'KTP_HILANG', type: 'alternative', weight: 0.9, description: 'Jika KTP hilang' },
  { from: 'SPKTP', to: 'KK', type: 'requires', weight: 1.0, description: 'Memerlukan KK' },
  
  // SPKK relationships
  { from: 'SPKK', to: 'KK_BARU', type: 'follow_up', weight: 1.0, description: 'Untuk buat KK baru' },
  { from: 'SPKK', to: 'PINDAH', type: 'related', weight: 0.7, description: 'Jika pindah domisili' },
  
  // SPSKCK relationships
  { from: 'SPSKCK', to: 'SKCK', type: 'follow_up', weight: 1.0, description: 'Untuk buat SKCK di Polsek' },
  { from: 'SPSKCK', to: 'KERJA', type: 'related', weight: 0.8, description: 'Untuk melamar kerja' },
  { from: 'SPSKCK', to: 'KTP', type: 'requires', weight: 1.0, description: 'Memerlukan KTP' },
  
  // SPAKTA relationships
  { from: 'SPAKTA', to: 'AKTA_LAHIR', type: 'follow_up', weight: 0.9, description: 'Untuk akta kelahiran' },
  { from: 'SPAKTA', to: 'AKTA_NIKAH', type: 'follow_up', weight: 0.8, description: 'Untuk akta nikah' },
  { from: 'SPAKTA', to: 'KK', type: 'requires', weight: 1.0, description: 'Memerlukan KK' },
  
  // IKR (Izin Keramaian) relationships
  { from: 'IKR', to: 'ACARA', type: 'related', weight: 0.9, description: 'Untuk acara/hajatan' },
  { from: 'IKR', to: 'POLSEK', type: 'follow_up', weight: 0.7, description: 'Lapor ke Polsek' },
  { from: 'IKR', to: 'KTP', type: 'requires', weight: 1.0, description: 'Memerlukan KTP' },
];

/**
 * Complaint category relationships
 */
const COMPLAINT_RELATIONS: KnowledgeRelation[] = [
  // Infrastructure
  { from: 'jalan_rusak', to: 'drainase', type: 'related', weight: 0.6, description: 'Sering berkaitan' },
  { from: 'jalan_rusak', to: 'banjir', type: 'related', weight: 0.5, description: 'Bisa menyebabkan banjir' },
  
  // Lighting
  { from: 'lampu_mati', to: 'keamanan', type: 'related', weight: 0.7, description: 'Masalah keamanan' },
  
  // Environment
  { from: 'sampah', to: 'drainase', type: 'related', weight: 0.6, description: 'Sampah menyumbat drainase' },
  { from: 'sampah', to: 'banjir', type: 'related', weight: 0.5, description: 'Bisa menyebabkan banjir' },
  
  // Water/Drainage
  { from: 'drainase', to: 'banjir', type: 'related', weight: 0.8, description: 'Drainase buruk = banjir' },
  
  // Trees
  { from: 'pohon_tumbang', to: 'jalan_rusak', type: 'related', weight: 0.4, description: 'Bisa merusak jalan' },
  { from: 'pohon_tumbang', to: 'lampu_mati', type: 'related', weight: 0.5, description: 'Bisa merusak lampu' },
];

/**
 * FAQ/Information relationships
 */
const INFO_RELATIONS: KnowledgeRelation[] = [
  { from: 'jam_buka', to: 'lokasi', type: 'related', weight: 0.9, description: 'Sering ditanya bersamaan' },
  { from: 'jam_buka', to: 'kontak', type: 'related', weight: 0.7, description: 'Info kontak' },
  { from: 'syarat', to: 'biaya', type: 'follow_up', weight: 0.8, description: 'Setelah syarat, tanya biaya' },
  { from: 'syarat', to: 'proses', type: 'follow_up', weight: 0.7, description: 'Setelah syarat, tanya proses' },
  { from: 'biaya', to: 'proses', type: 'follow_up', weight: 0.6, description: 'Setelah biaya, tanya proses' },
];

// Combine all relations
const ALL_RELATIONS: KnowledgeRelation[] = [
  ...SERVICE_RELATIONS,
  ...COMPLAINT_RELATIONS,
  ...INFO_RELATIONS,
];

// ==================== KNOWLEDGE NODES ====================

const KNOWLEDGE_NODES: Map<string, KnowledgeNode> = new Map([
  // Services
  ['SKD', { id: 'SKD', code: 'SKD', name: 'Surat Keterangan Domisili', category: 'layanan', keywords: ['domisili', 'tempat tinggal', 'alamat'], relations: [] }],
  ['SKTM', { id: 'SKTM', code: 'SKTM', name: 'Surat Keterangan Tidak Mampu', category: 'layanan', keywords: ['tidak mampu', 'miskin', 'kurang mampu'], relations: [] }],
  ['SKU', { id: 'SKU', code: 'SKU', name: 'Surat Keterangan Usaha', category: 'layanan', keywords: ['usaha', 'bisnis', 'dagang'], relations: [] }],
  ['SPKTP', { id: 'SPKTP', code: 'SPKTP', name: 'Surat Pengantar KTP', category: 'layanan', keywords: ['ktp', 'identitas', 'kartu'], relations: [] }],
  ['SPKK', { id: 'SPKK', code: 'SPKK', name: 'Surat Pengantar KK', category: 'layanan', keywords: ['kk', 'kartu keluarga', 'keluarga'], relations: [] }],
  ['SPSKCK', { id: 'SPSKCK', code: 'SPSKCK', name: 'Surat Pengantar SKCK', category: 'layanan', keywords: ['skck', 'kelakuan baik', 'polisi'], relations: [] }],
  ['SPAKTA', { id: 'SPAKTA', code: 'SPAKTA', name: 'Surat Pengantar Akta', category: 'layanan', keywords: ['akta', 'kelahiran', 'kematian', 'nikah'], relations: [] }],
  ['IKR', { id: 'IKR', code: 'IKR', name: 'Izin Keramaian', category: 'layanan', keywords: ['keramaian', 'acara', 'hajatan', 'pesta'], relations: [] }],
  
  // Complaints
  ['jalan_rusak', { id: 'jalan_rusak', code: 'jalan_rusak', name: 'Jalan Rusak', category: 'laporan', keywords: ['jalan', 'rusak', 'berlubang', 'aspal'], relations: [] }],
  ['lampu_mati', { id: 'lampu_mati', code: 'lampu_mati', name: 'Lampu Jalan Mati', category: 'laporan', keywords: ['lampu', 'mati', 'penerangan', 'gelap'], relations: [] }],
  ['sampah', { id: 'sampah', code: 'sampah', name: 'Masalah Sampah', category: 'laporan', keywords: ['sampah', 'menumpuk', 'bau', 'kotor'], relations: [] }],
  ['drainase', { id: 'drainase', code: 'drainase', name: 'Saluran Air/Drainase', category: 'laporan', keywords: ['drainase', 'got', 'selokan', 'tersumbat'], relations: [] }],
  ['pohon_tumbang', { id: 'pohon_tumbang', code: 'pohon_tumbang', name: 'Pohon Tumbang', category: 'laporan', keywords: ['pohon', 'tumbang', 'roboh', 'bahaya'], relations: [] }],
  ['banjir', { id: 'banjir', code: 'banjir', name: 'Banjir', category: 'laporan', keywords: ['banjir', 'genangan', 'air'], relations: [] }],
  
  // Info
  ['jam_buka', { id: 'jam_buka', code: 'jam_buka', name: 'Jam Operasional', category: 'informasi', keywords: ['jam', 'buka', 'tutup', 'operasional'], relations: [] }],
  ['lokasi', { id: 'lokasi', code: 'lokasi', name: 'Lokasi Kantor', category: 'informasi', keywords: ['lokasi', 'alamat', 'dimana', 'kantor'], relations: [] }],
  ['kontak', { id: 'kontak', code: 'kontak', name: 'Kontak', category: 'informasi', keywords: ['kontak', 'telepon', 'hp', 'whatsapp'], relations: [] }],
  ['syarat', { id: 'syarat', code: 'syarat', name: 'Persyaratan', category: 'informasi', keywords: ['syarat', 'persyaratan', 'dokumen', 'berkas'], relations: [] }],
  ['biaya', { id: 'biaya', code: 'biaya', name: 'Biaya', category: 'informasi', keywords: ['biaya', 'tarif', 'harga', 'bayar', 'gratis'], relations: [] }],
  ['proses', { id: 'proses', code: 'proses', name: 'Proses/Prosedur', category: 'informasi', keywords: ['proses', 'prosedur', 'cara', 'langkah'], relations: [] }],
]);

// Populate relations in nodes
for (const relation of ALL_RELATIONS) {
  const node = KNOWLEDGE_NODES.get(relation.from);
  if (node) {
    node.relations.push(relation);
  }
}

// ==================== GRAPH OPERATIONS ====================

/**
 * Get a knowledge node by code
 */
export function getNode(code: string): KnowledgeNode | undefined {
  return KNOWLEDGE_NODES.get(code.toUpperCase()) || KNOWLEDGE_NODES.get(code.toLowerCase());
}

/**
 * Find related nodes for a given code
 */
export function getRelatedNodes(code: string, maxDepth: number = 1): GraphTraversalResult {
  const result: GraphTraversalResult = {
    relatedNodes: [],
    prerequisites: [],
    followUps: [],
    alternatives: [],
  };

  const node = getNode(code);
  if (!node) return result;

  const visited = new Set<string>([code]);

  function traverse(currentCode: string, depth: number) {
    if (depth > maxDepth) return;

    const currentNode = getNode(currentCode);
    if (!currentNode) return;

    for (const relation of currentNode.relations) {
      if (visited.has(relation.to)) continue;
      visited.add(relation.to);

      const targetNode = getNode(relation.to);
      if (!targetNode) continue;

      switch (relation.type) {
        case 'prerequisite':
        case 'requires':
          result.prerequisites.push(targetNode);
          break;
        case 'follow_up':
          result.followUps.push(targetNode);
          break;
        case 'alternative':
          result.alternatives.push(targetNode);
          break;
        case 'related':
        case 'part_of':
          result.relatedNodes.push(targetNode);
          break;
      }

      // Recurse for deeper traversal
      if (depth < maxDepth) {
        traverse(relation.to, depth + 1);
      }
    }
  }

  traverse(code, 0);

  return result;
}

/**
 * Find node by keyword match
 */
export function findNodeByKeyword(keyword: string): KnowledgeNode | undefined {
  const lowerKeyword = keyword.toLowerCase();
  
  for (const node of KNOWLEDGE_NODES.values()) {
    if (node.code.toLowerCase() === lowerKeyword) return node;
    if (node.name.toLowerCase().includes(lowerKeyword)) return node;
    if (node.keywords.some(k => k.includes(lowerKeyword))) return node;
  }
  
  return undefined;
}

/**
 * Get follow-up suggestions based on current context
 */
export function getFollowUpSuggestions(
  currentIntent: string,
  serviceCode?: string
): string[] {
  const suggestions: string[] = [];

  // Get follow-ups from service code
  if (serviceCode) {
    const result = getRelatedNodes(serviceCode);
    
    for (const node of result.followUps.slice(0, 2)) {
      suggestions.push(`Mau sekalian urus ${node.name}?`);
    }
    
    for (const node of result.prerequisites.slice(0, 2)) {
      suggestions.push(`Pastikan sudah punya ${node.name} ya.`);
    }
  }

  // Intent-based suggestions
  if (currentIntent === 'CREATE_COMPLAINT') {
    suggestions.push('Mau cek status laporan sebelumnya?');
  } else if (currentIntent === 'CREATE_SERVICE_REQUEST') {
    suggestions.push('Mau lihat syarat layanan yang diperlukan?');
  } else if (currentIntent === 'CHECK_STATUS') {
    suggestions.push('Mau buat laporan baru?');
  }

  return suggestions.slice(0, 3);
}

/**
 * Get context enrichment for LLM prompt
 */
export function getGraphContext(code: string): string {
  const result = getRelatedNodes(code);
  const parts: string[] = [];

  if (result.prerequisites.length > 0) {
    const prereqs = result.prerequisites.map(n => n.name).join(', ');
    parts.push(`Dokumen yang diperlukan: ${prereqs}`);
  }

  if (result.relatedNodes.length > 0) {
    const related = result.relatedNodes.map(n => n.name).join(', ');
    parts.push(`Layanan terkait: ${related}`);
  }

  if (result.followUps.length > 0) {
    const followUps = result.followUps.map(n => n.name).join(', ');
    parts.push(`Biasanya dilanjutkan dengan: ${followUps}`);
  }

  if (parts.length === 0) return '';

  return `\n[KNOWLEDGE GRAPH]\n${parts.join('\n')}`;
}

// ==================== EXPORTS ====================

export default {
  getNode,
  getRelatedNodes,
  findNodeByKeyword,
  getFollowUpSuggestions,
  getGraphContext,
  KNOWLEDGE_NODES,
  ALL_RELATIONS,
};
