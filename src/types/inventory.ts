import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'operaciones' | 'bodeguero';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: Timestamp;
}

export type MaterialUnit = 'saco' | 'm2' | 'tira' | 'kg' | 'unidad' | 'm3' | 'rollo';

/**
 * Desglose de existencias físicas por ubicación
 */
export interface MaterialStockDistribution {
  warehouseStock: number; // Existencias en Bodega Central
  // Mapeo de ubicación (projectId o subprojectId) a cantidad física
  locations: {
    [locationId: string]: {
      locationType: 'PROJECT' | 'SUBPROJECT';
      locationName: string;
      projectId: string; // Para consolidación jerárquica
      projectName: string;
      quantity: number;
    };
  };
  totalCompanyStock: number; // Bodega + Proyectos + Subproyectos
}

/**
 * Documento principal en /materials/{materialId}
 * Datos operativos accesibles para todos los usuarios autenticados.
 */
export interface MaterialOperational {
  id?: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  warehouseStock: number;       // Stock físico en Bodega Central
  totalCompanyStock: number;    // Stock consolidado en toda la empresa
  minStock: number;             // Umbral de stock mínimo en Bodega Central
  isLowStock: boolean;          // warehouseStock <= minStock
  category: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

/**
 * Subdocumento en /materials/{materialId}/accounting/valuation
 * Restringido exclusivamente al Administrador.
 */
export interface MaterialValuation {
  weightedAverageCostCLP: number; // PMP en pesos chilenos
  totalValuationWarehouseCLP: number; // warehouseStock * PMP
  totalValuationCompanyCLP: number;   // totalCompanyStock * PMP
  lastPurchasePriceCLP: number;
  lastPurchaseDate: Timestamp;
  updatedAt: Timestamp;
}

export type ProjectStatus = 'active' | 'completed';

export interface Subproject {
  id: string;
  code: string;
  name: string;
  accumulatedCostCLP: number;
  assignedMaterialsCount: number;
  createdAt: Timestamp;
}

/**
 * Documento principal en /projects/{projectId}
 */
export interface ProjectOperational {
  id?: string;
  code: string;
  name: string;
  status: ProjectStatus;
  address?: string;
  subprojects: Subproject[]; // Subproyectos dentro de la obra
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Subdocumento en /projects/{projectId}/accounting/finances
 */
export interface ProjectFinances {
  budgetCLP: number;
  accumulatedCostCLP: number;     // Costo total = suma de subproyectos + costos directos
  financialProgressPct: number;   // (accumulatedCostCLP / budgetCLP) * 100
  lastTransactionAt: Timestamp;
  updatedAt: Timestamp;
}

export type MovementType = 
  | 'PURCHASE_ENTRY'       // Entrada a Bodega por compra
  | 'TRANSFER_WAREHOUSE_TO_PROJECT' // Bodega -> Proyecto/Subproyecto
  | 'TRANSFER_PROJECT_TO_WAREHOUSE' // Proyecto/Subproyecto -> Bodega (Devolución)
  | 'TRANSFER_BETWEEN_PROJECTS'     // Proyecto/Subproyecto A -> Proyecto/Subproyecto B
  | 'DIRECT_CONSUMPTION';           // Consumo final en obra

export interface LocationReference {
  type: 'WAREHOUSE' | 'PROJECT' | 'SUBPROJECT';
  id: string;           // 'warehouse' o projectId o subprojectId
  name: string;
  projectId?: string;   // Si es subproyecto, referencia al proyecto padre
  projectName?: string;
}

export interface MovementItemOperational {
  materialId: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  quantity: number;
}

/**
 * Kardex Transaccional de Movimientos Multidireccionales
 */
export interface MovementOperational {
  id?: string;
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

export interface MovementItemValuation {
  materialId: string;
  quantity: number;
  unitCostCLP: number; // PMP vigente congelado en el movimiento
  subtotalCLP: number;
}

export interface MovementValuation {
  movementId: string;
  type: MovementType;
  totalCostCLP: number;
  items: MovementItemValuation[];
  createdAt: Timestamp;
}
