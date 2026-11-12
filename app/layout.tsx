import type { Metadata, Viewport } from 'next';
import './globals.css';
import './responsive.css';

export const metadata: Metadata = {
  title: 'Agency in the Wonder Woods',
  description: 'เกมทายอาหาร ล่าสมบัติ สะสมโทเคนให้ทีม',
  robots: { index: false, follow: false },
  appleWebApp: { title: 'Wonder Woods', capable: true, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#65622d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
