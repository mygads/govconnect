"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { Sun, Moon, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveChatWidget } from "@/components/landing/LiveChatWidget";

export default function FormLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [isDark, setIsDark] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const toggleTheme = () => {
        setIsDark(!isDark);
        document.documentElement.classList.toggle("dark");
    };

    const navItems = [
        { href: "/form", label: "Panduan Form" },
    ];

    return (
        <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
            {/* Navbar - Same style as landing page */}
            <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-b border-border/50">
                <div className="max-w-5xl mx-auto px-4 sm:px-6">
                    <div className="flex items-center justify-between h-14">
                        <Link href="/" className="flex items-center shrink-0">
                            <Image
                                src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"}
                                alt="Tanggapin AI"
                                width={100}
                                height={100}
                                className="object-contain"
                                priority
                            />
                        </Link>

                        <div className="hidden md:flex items-center gap-0.5 bg-muted/50 rounded-full px-1.5 py-0.5">
                            {navItems.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className="text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background/80 px-3 py-1.5 rounded-full transition-all"
                                >
                                    {item.label}
                                </Link>
                            ))}
                        </div>

                        <div className="flex items-center gap-1.5">
                            <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full w-8 h-8">
                                {isDark ? <Sun className="h-4 w-4 text-yellow-500" /> : <Moon className="h-4 w-4 text-slate-600" />}
                            </Button>
                            <Button asChild size="sm" className="hidden sm:flex rounded-full bg-secondary hover:bg-secondary/90 text-xs px-4 h-8">
                                <Link href="/login">Masuk</Link>
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden rounded-full w-8 h-8">
                                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Mobile Menu */}
                {mobileMenuOpen && (
                    <div className="md:hidden bg-background/95 backdrop-blur-xl border-b border-border/50">
                        <div className="px-4 py-3 space-y-1">
                            {navItems.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="block text-sm text-muted-foreground hover:text-foreground px-3 py-2 rounded-lg hover:bg-muted transition-all"
                                >
                                    {item.label}
                                </Link>
                            ))}
                            <Button asChild size="sm" className="w-full mt-2 rounded-full bg-secondary text-xs">
                                <Link href="/login">Masuk Dashboard</Link>
                            </Button>
                        </div>
                    </div>
                )}
            </nav>

            {/* Main Content */}
            <main className="pt-20 pb-12">
                <div className="max-w-5xl mx-auto px-4 sm:px-6">
                    {children}
                </div>
            </main>

            {/* Live Chat Widget — available on public form pages */}
            <LiveChatWidget isDark={isDark} />

            {/* Footer */}
            <footer className="border-t border-border/50 bg-muted/20">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Image
                                src={isDark ? "/logo-dashboard-dark.png" : "/logo-dashboard.png"}
                                alt="Tanggapin AI"
                                width={80}
                                height={80}
                                className="object-contain"
                            />
                            <span className="text-xs text-muted-foreground">Layanan Publik Online</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            © 2026 Tanggapin AI. Platform Digital untuk Layanan Pemerintahan.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
