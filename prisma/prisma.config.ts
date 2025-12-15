// prisma/prisma.config.ts
// New Prisma configuration file for managing connection URLs for Migrate and Prisma Client.
// See https://pris.ly/d/config-datasource

const config = {
  datasources: {
    db: {
      provider: 'sqlserver',
      // Read the connection URL from environment for migrations and local development
      // Move any DATABASE_URL usage here for Migrate tooling
      url: process.env.DATABASE_URL || ''
    }
  }
};

export default config;
