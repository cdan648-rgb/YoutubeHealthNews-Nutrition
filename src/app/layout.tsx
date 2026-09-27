import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Noto_Serif } from 'next/font/google';
import '@/styles/globals.css';

/*
  Both families load the `vietnamese` subset explicitly. Without it, diacritics
  fall back to a system font mid-word, which looks broken and shifts layout.
*/
const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '600', '700'],
  variable: '--font-be-vietnam-pro',
  display: 'swap',
});

const notoSerif = Noto_Serif({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '600'],
  variable: '--font-noto-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Sức Khoẻ Giải Mã',
    template: '%s — Sức Khoẻ Giải Mã',
  },
  description:
    'Bản tin độc lập về sức khoẻ và khoa học, tổng hợp từ nội dung công khai của kênh YouTube Bác sĩ Trần Văn Phúc Official.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi-VN" className={`${beVietnamPro.variable} ${notoSerif.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
