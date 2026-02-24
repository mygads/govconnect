"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function SuperadminWhatsappPage() {
	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold text-foreground">WhatsApp Superadmin</h1>
				<p className="text-muted-foreground mt-2">
					Halaman konfigurasi WhatsApp untuk superadmin sedang disiapkan.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Segera Hadir</CardTitle>
					<CardDescription>
						Fitur manajemen WhatsApp lintas desa akan ditambahkan di halaman ini.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						Untuk sementara, pengaturan WhatsApp masih dapat diakses dari menu Channel Connect per desa.
					</p>
				</CardContent>
			</Card>
		</div>
	)
}
