"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/components/auth/AuthContext";
import { Loader2, LogIn, Eye, EyeOff, ArrowLeft } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { login, user, isLoading } = useAuth();
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto redirect to dashboard if already logged in
  useEffect(() => {
    if (!isLoading && user) {
      router.push("/dashboard");
    }
  }, [user, isLoading, router]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Memeriksa sesi...</p>
        </div>
      </div>
    );
  }

  // If user is logged in, show loading while redirecting ya
  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Mengalihkan ke dashboard...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(username, password);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Login gagal. Periksa username dan password Anda.";
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const logoSrc =
    mounted && resolvedTheme === "dark"
      ? "/logo-dashboard-dark.png"
      : "/logo-dashboard.png";

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#112D4E] to-[#3F72AF] relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 border border-white/30 rounded-full" />
          <div className="absolute top-40 right-20 w-32 h-32 border border-white/20 rounded-full" />
          <div className="absolute bottom-40 left-40 w-48 h-48 border border-white/20 rounded-full" />
          <div className="absolute bottom-20 right-40 w-24 h-24 bg-white/10 rounded-full" />
        </div>

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="mb-8">
               <Image 
                 src="/logo-dashboard-dark.png" 
                 alt="Tanggapin AI Logo" 
                 width={200} 
                 height={60} 
                 className="object-contain"
                 priority
               />
            </div>
            <h1 className="text-4xl xl:text-5xl font-bold text-white mb-6 leading-tight">
              Selamat Datang di
              <br />
              <span className="text-white/90">Tanggapin AI Dashboard</span>
            </h1>
            <p className="text-lg text-white/80 mb-8 max-w-md leading-relaxed">
              Platform administrasi untuk mengelola layanan kelurahan digital.
              Kelola laporan, surat, dan komunikasi warga dengan mudah.
            </p>

            {/* Features */}
            <div className="space-y-4">
              {[
                "Kelola laporan warga secara real-time",
                "Proses pengajuan surat digital",
                "Pantau statistik dan analitik",
                "Komunikasi langsung via WhatsApp",
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3 text-white/90"
                >
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                    <svg
                      className="w-3.5 h-3.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <span>{feature}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Bottom decoration */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-black/20 to-transparent" />
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-background p-6 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Back to Home */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Beranda</span>
          </Link>

          <Card className="border-0 shadow-none lg:shadow-xl lg:border">
            <CardHeader className="space-y-4 text-center pb-2">
              {/* Logo */}
              <div className="flex justify-center">
                <div className="relative h-12 w-40">
                  <Image
                    src={logoSrc}
                    alt="Tanggapin AI Logo"
                    fill
                    className="object-contain"
                    priority
                  />
                </div>
              </div>
              <div>
                <CardTitle className="text-2xl font-bold">
                  Masuk Dashboard
                </CardTitle>
                <CardDescription className="text-base mt-2">
                  Masuk untuk mengelola layanan kelurahan
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-sm font-medium">
                    Nama Pengguna
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Masukkan nama pengguna"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isSubmitting}
                    required
                    className="h-10 px-3"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Kata Sandi
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Masukkan kata sandi"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isSubmitting}
                      required
                      className="h-10 px-3 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm"
                  >
                    {error}
                  </motion.div>
                )}

                <Button
                  type="submit"
                  className="w-full h-10 text-sm font-semibold bg-[#112D4E] hover:bg-[#112D4E]/90 text-white shadow-lg shadow-blue-900/20"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <LogIn className="mr-2 h-4 w-4" />
                      Masuk
                    </>
                  )}
                </Button>


              </form>
            </CardContent>
          </Card>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground mt-8">
            &copy; {new Date().getFullYear()} Tanggapin AI. Didukung oleh{" "}
            <a
              href="https://genfity.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-secondary hover:underline"
            >
              Genfity
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
