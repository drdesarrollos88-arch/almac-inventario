import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'operaciones' | 'bodeguero';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: Timestamp;
}

export type MaterialUnit = 'saco' | 'm2' | 'tira' | 'kg' | 'unidad' | 'm3' | 'rollo' | 'litro' | 'caja';

// =============================================================================
// MÓDULO: PROVEEDORES
// =============================================================================
export interface Supplier {
  id: string;
  businessName: string;       // Razón Social
  tradeName: string;          // Nombre de Fantasía
  rut: string;                // RUT (ej: 76.123.456-7)
  businessLine: string;       // Giro Comercial
  phone: string;              // Teléfono de la empresa
  address: string;            // Dirección
  email: string;              // Correo de la empresa
  contactSalesperson: string; // Vendedor de contacto
  contactPhone: string;       // Teléfono de contacto directo
  contactEmail: string;       // Correo de contacto directo
  suppliedCategory?: string;  // Categoría de materiales que provee
  createdAt: Timestamp;
}

// =============================================================================
// MÓDULO: MATERIALES (CATÁLOGO MAESTRO)
// =============================================================================
export interface MaterialOperational {
  id: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  category: string;
  minStock: number;
  warehouseStock: number;       // Stock libre en Bodega Central Matriz
  totalCompanyStock: number;    // Stock consolidado en toda la empresa
  isLowStock: boolean;          // warehouseStock <= minStock
  defaultSupplierId?: string;   // Proveedor asociado para cotizaciones inteligentes
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface MaterialValuation {
  weightedAverageCostCLP: number; // PMP en pesos chilenos
  totalValuationWarehouseCLP: number;
  totalValuationCompanyCLP: number;
  lastPurchasePriceCLP: number;
  lastPurchaseDate: Timestamp;
  updatedAt: Timestamp;
}

// =============================================================================
// MÓDULO: OBRAS Y SUBPROYECTOS
// =============================================================================
export type ProjectStatus = 'active' | 'completed';

export interface Subproject {
  id: string;
  code: string;
  name: string;
  accumulatedCostCLP: number;
  createdAt: Timestamp;
}

export interface ProjectOperational {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  address?: string;
  subprojects: Subproject[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectFinances {
  budgetCLP: number;
  accumulatedCostCLP: number;
  financialProgressPct: number;
  lastTransactionAt: Timestamp;
  updatedAt: Timestamp;
}

// =============================================================================
// KARDEX TRANSACCIONAL
// =============================================================================
export type MovementType = 
  | 'PURCHASE_ENTRY'
  | 'TRANSFER_WAREHOUSE_TO_PROJECT'
  | 'TRANSFER_PROJECT_TO_WAREHOUSE'
  | 'TRANSFER_BETWEEN_SUBPROJECTS'
  | 'TRANSFER_BETWEEN_PROJECTS';

export interface LocationReference {
  type: 'WAREHOUSE' | 'PROJECT_GENERAL' | 'SUBPROJECT';
  id: string;
  name: string;
  projectId?: string;
  projectName?: string;
}

export interface MovementItemOperational {
  materialId: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  quantity: number;
}

export interface MovementOperational {
  id: string;
  folio: string;
  type: MovementType;
  origin: LocationReference;
  destination: LocationReference;
  userId: string;
  userEmail: string;
  userRole: UserRole;
  date: Timestamp;
  notes?: string;
  items: MovementItemOperational[];
}
