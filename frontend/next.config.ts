import path from 'node:path';
import type { NextConfig } from 'next';

const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

// Sent with every page. HSTS is left to the HTTPS proxy in front of the app.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image (see frontend/Dockerfile).
  output: 'standalone',
  // The app lives in an npm workspace: trace dependencies from the repo root.
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  poweredByHeader: false,
  // The dev-mode "N" badge sits on top of the sidebar's Slack card.
  // Build and runtime errors still show their overlay without it.
  devIndicators: false,
  images: {
    // Google profile photos
    remotePatterns: [new URL('https://lh3.googleusercontent.com/**')],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
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
