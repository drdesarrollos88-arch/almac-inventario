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
 * Documento principal en /materials/{materialId}
 * Público para todos los usuarios autenticados (incluido Bodeguero).
 * No contiene información financiera.
 */
export interface MaterialOperational {
  id?: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  currentStock: number;
  minStock: number;
  isLowStock: boolean; // Flag desnormalizado para consultas O(1) de alertas
  category: string;
  updatedAt: Timestamp;
  updatedBy: string;
}

/**
 * Subdocumento en /materials/{materialId}/accounting/valuation
 * Restringido estrictamente a Administradores.
 */
export interface MaterialValuation {
  weightedAverageCostCLP: number; // PMP en pesos chilenos
  totalValuationCLP: number;      // currentStock * PMP
  lastPurchasePriceCLP: number;
  lastPurchaseDate: Timestamp;
  updatedAt: Timestamp;
}

export type ProjectStatus = 'active' | 'completed';

/**
 * Documento principal en /projects/{projectId}
 * Público para todos los usuarios autenticados.
 */
export interface ProjectOperational {
  id?: string;
  code: string;
  name: string;
  status: ProjectStatus;
  address?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Subdocumento en /projects/{projectId}/accounting/finances
 * Restringido a Admin y Operaciones (Prohibido para Bodeguero).
 */
export interface ProjectFinances {
  budgetCLP: number;
  accumulatedCostCLP: number;
  financialProgressPct: number; // (accumulatedCostCLP / budgetCLP) * 100
  lastTransactionAt: Timestamp;
  updatedAt: Timestamp;
}

export type MovementType = 'PURCHASE_ENTRY' | 'DISPATCH_PROJECT' | 'RETURN_PROJECT';

/**
 * Ítem en el array operativo del movimiento.
 * Accesible para Bodega: solo información logística.
 */
export interface MovementItemOperational {
  materialId: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  quantity: number;
}

/**
 * Documento en /movements/{movementId}
 * Kardex operativo e inmutable.
 */
export interface MovementOperational {
  id?: string;
  folio: string;
  type: MovementType;
  projectId: string | null;
  projectName: string | null;
  userId: string;
  userEmail: string;
  userRole: UserRole;
  date: Timestamp;
  notes?: string;
  items: MovementItemOperational[];
}

/**
 * Ítem valorizado en el subdocumento de contabilidad.
 */
export interface MovementItemValuation {
  materialId: string;
  quantity: number;
  unitCostCLP: number; // PMP congelado o costo unitario de compra
  subtotalCLP: number;
}

/**
 * Subdocumento en /movements/{movementId}/accounting/valuation
 * Accesible solo para Admin.
 */
export interface MovementValuation {
  movementId: string;
  type: MovementType;
  totalCostCLP: number;
  items: MovementItemValuation[];
  createdAt: Timestamp;
}

