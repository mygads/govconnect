"use client";

import React from "react";
import { motion } from "framer-motion";

export const SectionTitle = ({ 
  children, 
  subtitle, 
  align = "center",
  dark = false
}: { 
  children: React.ReactNode; 
  subtitle?: string; 
  align?: "left" | "center";
  dark?: boolean;
}) => {
  return (
    <div className={`mb-12 ${align === "center" ? "text-center mx-auto" : "text-left"} max-w-4xl`}>
      {subtitle && (
        <motion.span 
          initial={{ opacity: 0, y: 10 }} 
          whileInView={{ opacity: 1, y: 0 }} 
          viewport={{ once: true }}
          className={`inline-block py-1 px-3 rounded-full text-xs font-bold uppercase tracking-wider mb-4 ${dark ? "bg-white/10 text-white" : "bg-[#3F72AF]/10 text-[#3F72AF]"}`}
        >
          {subtitle}
        </motion.span>
      )}
      <motion.h2 
        initial={{ opacity: 0, y: 20 }} 
        whileInView={{ opacity: 1, y: 0 }} 
        viewport={{ once: true }}
        transition={{ delay: 0.1 }}
        className={`text-3xl md:text-5xl font-extrabold tracking-tight leading-tight ${dark ? "text-white" : "text-[#112D4E] dark:text-[#F9F7F7]"}`}
      >
        {children}
      </motion.h2>
      <motion.div 
        initial={{ scaleX: 0 }} 
        whileInView={{ scaleX: 1 }} 
        viewport={{ once: true }}
        transition={{ delay: 0.3, duration: 0.8 }}
        className={`h-1.5 w-24 rounded-full mt-6 ${align === "center" ? "mx-auto" : ""} ${dark ? "bg-[#3F72AF]" : "bg-[#3F72AF]"}`}
      />
    </div>
  );
};
