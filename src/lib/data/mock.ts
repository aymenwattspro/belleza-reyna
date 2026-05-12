import { InventoryItem } from '../types/inventory';

export const MOCK_INVENTORY: InventoryItem[] = [
  { clave: 'PU-001', descripcion: 'Labial Matte Pink Up - Rose', precioC: 45.5, existencia: 12 },
  { clave: 'PU-002', descripcion: 'Base de Maquillaje High Coverage', precioC: 120.0, existencia: 5 },
  { clave: 'PU-003', descripcion: 'Mascara de Pestañas Waterproof', precioC: 65.0, existencia: 24 },
  { clave: 'PU-004', descripcion: 'Paleta de Sombras Nude Edition', precioC: 280.0, existencia: 3 },
  { clave: 'PU-005', descripcion: 'Delineador Negro Intenso', precioC: 35.0, existencia: 50 },
  { clave: 'PU-006', descripcion: 'Rubor Mineral - Peach', precioC: 55.0, existencia: 8 },
  { clave: 'PU-007', descripcion: 'Iluminador Glow Liquid', precioC: 95.0, existencia: 15 },
  { clave: 'PU-008', descripcion: 'Corrector Liquido - Light', precioC: 42.0, existencia: 20 },
];

export const MOCK_TARGETS = [
  { clave: 'PU-001', stockObjetivo: 24, piezas: 12 },
  { clave: 'PU-002', stockObjetivo: 20, piezas: 4 },
  { clave: 'PU-003', stockObjetivo: 48, piezas: 24 },
  { clave: 'PU-004', stockObjetivo: 10, piezas: 2 },
  { clave: 'PU-005', stockObjetivo: 60, piezas: 12 },
  { clave: 'PU-006', stockObjetivo: 24, piezas: 12 },
  { clave: 'PU-007', stockObjetivo: 30, piezas: 6 },
  { clave: 'PU-008', stockObjetivo: 40, piezas: 10 },
];
