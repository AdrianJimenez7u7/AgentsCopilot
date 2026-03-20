import { jest } from '@jest/globals';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Exportar el mock directamente para que los tests puedan acceder a él
export const prismaMock = mockDeep();

// Mockear el módulo del cliente de Prisma
jest.unstable_mockModule('../../../shared/prisma/client.js', () => ({
  prisma: prismaMock,
}));

// No necesitamos beforeEach aquí si lo manejamos en los archivos de test individualmente
// o si Jest lo maneja globalmente si lo importamos.
