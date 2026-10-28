import { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'operaciones' | 'bodeguero';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: Timestamp;
}

export type MaterialUnit = 'saco' | 'm2' | 'tira' | 'kg' | 'unidad' | 'm3' | 'rollo' | 'litro' | 'caja' | 'plancha' | 'balde';

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
// MÓDULO: PLANTILLAS CONSTRUCTIVAS (TIPOS DE VIVIENDA / PARTIDAS PREDEFINIDAS)
// =============================================================================
export interface ConstructionTemplateItem {
  materialId: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  theoreticalQuantity: number; // Cantidad teórica calculada por vivienda
  partida: string;             // ej: "Techumbre", "Aislación Térmica EIFS", "Ventanas"
}

export interface ConstructionTemplate {
  id: string;
  code: string;                // ej: "PLT-TECH-01"
  name: string;                // ej: "Solo Techumbre", "Techumbre y Aislación EIFS"
  description: string;
  partidas: string[];
  items: ConstructionTemplateItem[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// =============================================================================
// MÓDULO: OBRAS (PROYECTOS COMITÉS) Y VIVIENDAS (BENEFICIARIOS)
// =============================================================================
export type ProjectStatus = 'active' | 'completed';

export interface TheoreticalMaterialAllocation {
  materialId: string;
  theoreticalQty: number;      // Cubicada por plantilla o EETT SERVIU
  appliedTemplateId?: string;
  partida?: string;
}

export interface HousingUnit {
  id: string;
  code: string;                 // ej: "OBR-2026-01-VIV01"
  housingNumber: string;        // N° de Vivienda, Lote o Departamento
  ownerName: string;            // Nombre de Propietario / Beneficiario
  address: string;              // Dirección / Pasaje
  serviuCode?: string;          // Código SERVIU (Opcional)
  appliedTemplateIds?: string[];// Plantillas constructivas aplicadas
  theoreticalMaterials: TheoreticalMaterialAllocation[];
  accumulatedCostCLP: number;
  createdAt: Timestamp;
}

// Compatibilidad con Subproject
export type Subproject = HousingUnit;

export interface ProjectOperational {
  id: string;
  code: string;                 // ej: "OBR-2026-01"
  name: string;                 // ej: "Proyecto Comité Las Camelias"
  status: ProjectStatus;
  serviuCode?: string;          // Código SERVIU de la Obra (Opcional)
  designatedApprover?: string;  // Responsable asignado para autorizaciones de movimientos
  address?: string;
  subprojects: HousingUnit[];   // Listado de Viviendas / Beneficiarios
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
// MÓDULO: PEDIDOS DE OBRA DESDE TERRENO (REQUISICIONES)
// =============================================================================
export type RequisitionStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'DISPATCHED';

export interface RequisitionItem {
  materialId: string;
  sku: string;
  name: string;
  unit: MaterialUnit;
  requestedQty: number;
}

export interface SiteRequisition {
  id: string;
  folio: string;               // ej: "REQ-2026-001"
  projectId: string;
  projectName: string;
  housingUnitId?: string;      // Vivienda destino específica
  housingUnitName?: string;
  requestedBy: string;         // Personal de terreno
  urgency: 'Baja' | 'Media' | 'Alta' | 'Urgente';
  status: RequisitionStatus;
  date: string;
  notes?: string;
  items: RequisitionItem[];
  authorizedBy?: string;
  authorizedAt?: string;
}

// =============================================================================
// KARDEX TRANSACCIONAL Y GOBERNANZA DE AUTORIZACIÓN
// =============================================================================
export type MovementType = 
  | 'PURCHASE_ENTRY'
  | 'TRANSFER_WAREHOUSE_TO_PROJECT'
  | 'TRANSFER_PROJECT_TO_WAREHOUSE'
  | 'TRANSFER_BETWEEN_SUBPROJECTS'
  | 'TRANSFER_BETWEEN_PROJECTS'
  | 'DISPATCH_REQUISITION';

export type MovementStatus = 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED';

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
  status: MovementStatus;
  origin: LocationReference;
  destination: LocationReference;
  userId: string;
  userEmail: string;
  userRole: UserRole;
  authorizedBy?: string;
  authorizedAt?: Timestamp;
  date: Timestamp;
  notes?: string;
  items: MovementItemOperational[];
}
