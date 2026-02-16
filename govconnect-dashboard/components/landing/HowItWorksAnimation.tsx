"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Globe, MessageCircle, Clock, CheckCircle } from "lucide-react";
import { WhatsAppIcon } from "./WhatsAppIcon";

/**
 * HowItWorksAnimation Component
 * Shows step-by-step process animation with 4 steps
 * Auto-cycles through steps with 2.5s per step
 */

interface Step {
  icon: typeof Globe;
  title: string;
  desc: string;
  color: string;
}

export const HowItWorksAnimation = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    // Cycle through steps
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= 3) {
          // Reset animation after completing all steps
          setKey((k) => k + 1);
          return 0;
        }
        return prev + 1;
      });
    }, 2500);
    return () => clearInterval(stepInterval);
  }, []);

  const steps: Step[] = [
    {
      icon: Globe,
      title: "Akses Tanggapin",
      desc: "Buka webchat atau WhatsApp",
      color: "bg-blue-500",
    },
    {
      icon: MessageCircle,
      title: "Sampaikan Kebutuhan",
      desc: "Informasi, layanan, atau aduan",
      color: "bg-green-500",
    },
    {
      icon: Clock,
      title: "Tanggapin AI Memproses",
      desc: "Memahami konteks & data layanan",
      color: "bg-orange-500",
    },
    {
      icon: CheckCircle,
      title: "Selesai & Terpantau",
      desc: "Status layanan/laporan terbarui",
      color: "bg-secondary",
    },
  ];

  return (
    <div key={key} className="relative w-full max-w-md mx-auto">
      {/* Phone Frame */}
      <div className="bg-card border-4 border-border rounded-[2.5rem] shadow-2xl overflow-hidden">
        {/* Phone Notch */}
        <div className="bg-border h-6 flex items-center justify-center">
          <div className="w-20 h-4 bg-background rounded-full" />
        </div>

        {/* App Content */}
        <div className="bg-background p-4 min-h-[400px]">
          {/* App Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-sm">Tanggapin</p>
              <p className="text-xs text-muted-foreground">Agent: Tanggapin AI</p>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="space-y-4">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0.3, x: -20 }}
                animate={{
                  opacity: currentStep >= index ? 1 : 0.3,
                  x: currentStep >= index ? 0 : -20,
                  scale: currentStep === index ? 1.02 : 1,
                }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                  currentStep >= index
                    ? "border-secondary/50 bg-secondary/5"
                    : "border-border bg-muted/30"
                }`}
              >
                {/* Step Icon */}
                <motion.div
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    currentStep >= index ? step.color : "bg-muted"
                  }`}
                  animate={
                    currentStep === index
                      ? { scale: [1, 1.1, 1] }
                      : {}
                  }
                  transition={{ duration: 0.8, repeat: currentStep === index ? Infinity : 0 }}
                >
                  {currentStep > index ? (
                    <CheckCircle className="h-6 w-6 text-white" />
                  ) : (
                    <step.icon className={`h-6 w-6 ${currentStep >= index ? "text-white" : "text-muted-foreground"}`} />
                  )}
                </motion.div>

                {/* Step Content */}
                <div className="flex-1">
                  <p className={`font-semibold text-sm ${currentStep >= index ? "" : "text-muted-foreground"}`}>
                    {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{step.desc}</p>
                </div>

                {/* Status Indicator */}
                {currentStep === index && (
                  <motion.div
                    className="flex gap-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <motion.div
                      className="w-2 h-2 rounded-full bg-secondary"
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                    />
                    <motion.div
                      className="w-2 h-2 rounded-full bg-secondary"
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                    />
                    <motion.div
                      className="w-2 h-2 rounded-full bg-secondary"
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                    />
                  </motion.div>
                )}

                {currentStep > index && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center"
                  >
                    <CheckCircle className="h-4 w-4 text-white" />
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Success Message */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: currentStep >= 3 ? 1 : 0,
              y: currentStep >= 3 ? 0 : 20,
            }}
            transition={{ duration: 0.5 }}
            className="mt-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <motion.div
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 1 }}
                className="text-2xl"
              >
                🎉
              </motion.div>
              <div>
                <p className="font-semibold text-green-600 text-sm">Berhasil!</p>
                <p className="text-xs text-muted-foreground">Laporan Anda telah ditindaklanjuti</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Phone Bottom Bar */}
        <div className="bg-border h-4 flex items-center justify-center">
          <div className="w-24 h-1 bg-background/50 rounded-full" />
        </div>
      </div>

      {/* Floating Elements */}
      <motion.div
        className="absolute -top-4 -right-4 bg-green-500 text-white p-3 rounded-full shadow-lg"
        animate={{ y: [0, -10, 0], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        <WhatsAppIcon className="h-6 w-6" />
      </motion.div>

      <motion.div
        className="absolute -bottom-2 -left-2 bg-primary text-white px-3 py-1.5 rounded-full shadow-lg text-xs font-medium"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        24/7 Online
      </motion.div>
    </div>
  );
};
