import type { NextConfig } from 'next';

const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // The dev-mode "N" badge sits on top of the sidebar's Slack card.
  // Build and runtime errors still show their overlay without it.
  devIndicators: false,
  images: {
    // Google profile photos
    remotePatterns: [new URL('https://lh3.googleusercontent.com/**')],
  },
  // Proxy API calls to Express so the browser sees one origin.
  // This keeps the session cookie first-party and avoids CORS.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      { source: '/health', destination: `${backendUrl}/health` },
      // Bull Board queue dashboard
      { source: '/admin/queues', destination: `${backendUrl}/admin/queues` },
      { source: '/admin/queues/:path*', destination: `${backendUrl}/admin/queues/:path*` },
    ];
  },
};

export default nextConfig;
