import type { MetadataRoute } from 'next';

/** Home-screen icon + app name when a player adds the web app to their phone ("Add to Home Screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Food Camp Hunt · Agency in the Wonder Woods',
    short_name: 'Food Camp Hunt',
    description: 'เกมทายอาหาร ล่าสมบัติ สะสมโทเคนให้ทีม',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1b2a4a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
