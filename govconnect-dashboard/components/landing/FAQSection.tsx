"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, ChevronDown } from "lucide-react";

const faqItems = [
  {
    category: "Umum",
    q: "Apa bedanya Tanggapin dengan chatbot biasa?",
    a: "Tanggapin menggunakan teknologi LLM + RAG (Retrieval-Augmented Generation). Artinya, ia tidak hanya 'mencocokkan kata kunci' tapi benar-benar *memahami* pertanyaan dan mencari jawaban dari dokumen resmi pemerintah daerah Anda. Jawaban lebih luwes, relevan, dan minim halusinasi."
  },
  {
    category: "Teknis",
    q: "Apakah perlu install aplikasi tambahan?",
    a: "Tidak perlu! Warga cukup menggunakan WhatsApp yang sudah ada di HP mereka. Untuk admin pemerintah, tersedia dashboard berbasis web yang bisa diakses via browser laptop/HP tanpa instalasi software khusus."
  },
  {
    category: "Keamanan",
    q: "Bagaimana keamanan data warga?",
    a: "Kami menerapkan enkripsi end-to-end standar industri. Data pibadi warga (NIK/KK) yang dikirim via chat akan di-masking secara otomatis sebelum disimpan ke database, dan hanya bisa diakses oleh petugas berwenang dengan otorisasi khusus."
  },
  {
    category: "Implementasi",
    q: "Berapa lama proses setup untuk satu kecamatan?",
    a: "Sangat cepat. Hanya butuh 1-2 hari untuk setup server & nomor WhatsApp. Proses 'training' data (upload Perda, SOP, Data Warga) memakan waktu 3-5 hari tergantung kelengkapan dokumen. Total siap live dalam <1 minggu."
  },
  {
    category: "Biaya",
    q: "Apakah ada biaya langganan bulanan?",
    a: "Untuk skema kerjasama pemerintah (B2G), kami menawarkan model lisensi tahunan atau bagi hasil (SaaS). Silakan hubungi tim sales kami untuk proposal penawaran yang sesuai dengan APBD/anggaran Anda."
  }
];

export const FAQSection = () => {
    return (
        <section id="faq" className="py-24 bg-[#F9F7F7] dark:bg-[#111]">
            <div className="max-w-4xl mx-auto px-4 sm:px-6">
                <div className="text-center mb-16">
                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider">
                        Pusat Bantuan
                    </span>
                    <h2 className="text-3xl md:text-5xl font-black text-[#112D4E] dark:text-white mt-4 mb-6">
                        Sering Ditanyakan
                    </h2>
                    <p className="text-lg text-gray-600 dark:text-gray-400">
                        Jawaban untuk pertanyaan umum seputar implementasi dan fitur Tanggapin AI.
                    </p>
                </div>

                <div className="space-y-4">
                    {faqItems.map((item, i) => (
                        <motion.div 
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-gray-200 dark:border-[#333] overflow-hidden shadow-sm hover:shadow-md transition-all"
                        >
                            <Accordion type="single" collapsible className="w-full">
                                <AccordionItem value={`item-${i}`} className="border-none">
                                    <AccordionTrigger className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-[#222] text-left">
                                        <div className="flex items-center gap-4">
                                            <div className="w-8 h-8 rounded-lg bg-[#3F72AF]/10 flex items-center justify-center text-[#3F72AF]">
                                                <HelpCircle className="w-5 h-5" />
                                            </div>
                                            <span className="text-lg font-bold text-[#112D4E] dark:text-gray-100 text-left flex-1">
                                                {item.q}
                                            </span>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="px-6 py-4 pt-0 text-gray-600 dark:text-gray-400 ml-12 border-t border-gray-100 dark:border-[#333/50] mt-2">
                                        <div className="mt-4 leading-relaxed">
                                            {item.a}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
};
