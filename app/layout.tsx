import "./globals.css";

export const metadata = {
  title: "RAB - Rumah Kos Puri",
  description: "Construction budget monitoring dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
