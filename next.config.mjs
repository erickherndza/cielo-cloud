// BASE_PATH: '/tyui' por defecto (GitHub Pages). En Firebase Hosting / dominio
// propio la app vive en la raíz: construir con BASE_PATH= (vacío).
const basePath = process.env.BASE_PATH ?? '/tyui'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
}

export default nextConfig
