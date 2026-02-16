"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { MessageCircle, FileText, Bell, CheckCircle } from "lucide-react";

/**
 * SolutionAnimation Component
 * Illustrates all-in-one solution concept with service icons connecting to phone
 * Shows connection line animations and service cycling
 */

interface Service {
  icon: typeof MessageCircle;
  label: string;
  color: string;
}

export const SolutionAnimation = () => {
  const [phase, setPhase] = useState(0);
  const [activeService, setActiveService] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((prev) => (prev + 1) % 6);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Cycle services on phone screen
    const serviceInterval = setInterval(() => {
      setActiveService((prev) => (prev + 1) % 3);
    }, 1000);
    return () => clearInterval(serviceInterval);
  }, []);

  const services: Service[] = [
    { icon: MessageCircle, label: "Pengaduan", color: "bg-blue-500" },
    { icon: FileText, label: "Laporan", color: "bg-green-500" },
    { icon: Bell, label: "Layanan", color: "bg-orange-500" },
  ];

  return (
    <div className="relative w-72 h-56 flex items-center justify-center">
      {/* Left Service Icons - Pop Animation */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 space-y-3">
        {services.map((service, index) => (
          <motion.div
            key={index}
            className="relative"
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: phase >= index ? [0, 1.2, 1] : 0,
              opacity: phase >= index ? 1 : 0,
            }}
            transition={{ duration: 0.3, delay: index * 0.15 }}
          >
            <div className={`w-10 h-10 ${service.color} rounded-xl flex items-center justify-center shadow-lg`}>
              <service.icon className="h-5 w-5 text-white" />
            </div>
            {/* Glow effect on active */}
            <motion.div
              className={`absolute inset-0 ${service.color} rounded-xl`}
              animate={{
                opacity: phase === index ? [0, 0.4, 0] : 0,
                scale: phase === index ? [1, 1.4, 1.4] : 1,
              }}
              transition={{ duration: 0.4 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Connecting Lines - Drawing Effect */}
      <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
        {/* Line 1: Top icon to phone */}
        <motion.path
          d="M 50 50 Q 100 50 144 90"
          fill="none"
          stroke="rgb(59 130 246)"
          strokeWidth="2"
          strokeDasharray="4,4"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{
            pathLength: phase >= 3 ? 1 : 0,
            opacity: phase >= 3 ? 0.6 : 0,
          }}
          transition={{ duration: 0.4 }}
        />
        {/* Line 2: Middle icon to phone */}
        <motion.path
          d="M 50 112 L 144 112"
          fill="none"
          stroke="rgb(34 197 94)"
          strokeWidth="2"
          strokeDasharray="4,4"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{
            pathLength: phase >= 4 ? 1 : 0,
            opacity: phase >= 4 ? 0.6 : 0,
          }}
          transition={{ duration: 0.4 }}
        />
        {/* Line 3: Bottom icon to phone */}
        <motion.path
          d="M 50 174 Q 100 174 144 134"
          fill="none"
          stroke="rgb(249 115 22)"
          strokeWidth="2"
          strokeDasharray="4,4"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{
            pathLength: phase >= 5 ? 1 : 0,
            opacity: phase >= 5 ? 0.6 : 0,
          }}
          transition={{ duration: 0.4 }}
        />
      </svg>

      {/* Phone - Center Solution */}
      <motion.div
        className="absolute right-0 top-1/2 -translate-y-1/2"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Phone Glow Effect */}
        <motion.div
          className="absolute inset-0 bg-blue-400/30 rounded-2xl blur-xl"
          animate={{
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.1, 1],
          }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <motion.div
          className="absolute inset-0 bg-green-400/20 rounded-2xl blur-2xl"
          animate={{
            opacity: [0.2, 0.5, 0.2],
            scale: [1.1, 1.2, 1.1],
          }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
        />

        {/* Phone Body */}
        <div className="relative w-24 h-40 bg-slate-200 dark:bg-slate-700 rounded-2xl border-4 border-slate-300 dark:border-slate-600 overflow-hidden shadow-2xl">
          {/* Phone Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-2 bg-slate-300 dark:bg-slate-600 rounded-b-lg z-10" />

          {/* Phone Screen */}
          <div className="absolute inset-2 top-4 bg-white dark:bg-slate-800 rounded-lg overflow-hidden">
            {/* App Header */}
            <div className="bg-secondary h-6 flex items-center justify-center">
              <span className="text-white text-[8px] font-semibold">Tanggapin</span>
            </div>

            {/* Service Icons Display */}
            <div className="p-2 space-y-1.5">
              {services.map((service, index) => (
                <motion.div
                  key={index}
                  className={`flex items-center gap-1.5 p-1 rounded-md transition-colors ${activeService === index ? "bg-secondary/10" : "bg-slate-100 dark:bg-slate-700"}`}
                  animate={{
                    scale: activeService === index ? [1, 1.05, 1] : 1,
                    opacity: activeService === index ? 1 : 0.5,
                  }}
                  transition={{ duration: 0.3 }}
                >
                  <div className={`w-4 h-4 ${service.color} rounded flex items-center justify-center`}>
                    <service.icon className="h-2.5 w-2.5 text-white" />
                  </div>
                  <span className="text-[7px] font-medium truncate">{service.label}</span>
                </motion.div>
              ))}
            </div>

            {/* Active indicator */}
            <motion.div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5"
            >
              {services.map((_, index) => (
                <motion.div
                  key={index}
                  className="w-1 h-1 rounded-full"
                  animate={{
                    backgroundColor: activeService === index ? "rgb(34 60 110)" : "rgb(203 213 225)",
                    scale: activeService === index ? 1.3 : 1,
                  }}
                  transition={{ duration: 0.2 }}
                />
              ))}
            </motion.div>
          </div>

          {/* Phone Bottom Bar */}
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-12 h-1 bg-slate-300 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Success Badge */}
        <motion.div
          className="absolute -top-2 -right-2"
          animate={{
            scale: phase >= 5 ? [0, 1.2, 1] : 0,
            opacity: phase >= 5 ? 1 : 0,
          }}
          transition={{ duration: 0.3 }}
        >
          <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
            <CheckCircle className="h-4 w-4 text-white" />
          </div>
        </motion.div>
      </motion.div>

      {/* Floating particles */}
      {[...Array(4)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full bg-blue-400/60"
          style={{
            left: `${30 + i * 20}%`,
            top: `${20 + (i % 2) * 60}%`,
          }}
          animate={{
            y: [0, -10, 0],
            opacity: [0.3, 0.7, 0.3],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            delay: i * 0.3,
          }}
        />
      ))}
    </div>
  );
};
