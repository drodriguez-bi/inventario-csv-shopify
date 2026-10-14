/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Estas librerías usan módulos nativos/dinámicos: se cargan tal cual en el servidor.
    serverComponentsExternalPackages: ['ssh2', 'ssh2-sftp-client', 'basic-ftp'],
  },
};

module.exports = nextConfig;
