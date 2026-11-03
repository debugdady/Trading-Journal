/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow your laptop's local network IP
  allowedDevOrigins: ['192.168.0.105'],

  serverExternalPackages: ['better-sqlite3'],

  images: {
    unoptimized: true,
  },
}

export default nextConfig