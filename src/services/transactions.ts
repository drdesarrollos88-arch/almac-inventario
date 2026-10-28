import {
  Firestore,
  doc,
  runTransaction,
  serverTimestamp,
  collection,
  Timestamp
} from 'firebase/firestore';
import {
  MaterialOperational,
  MaterialValuation,
  ProjectOperational,
  ProjectFinances,
  MovementOperational,
  MovementValuation,
  MovementItemOperational,
  MovementItemValuation
} from '../types/inventory';

// =============================================================================
// ERRORES PERSONALIZADOS DE NEGOCIO
// =============================================================================
export class InsufficientStockError extends Error {
  constructor(public materialId: string, public available: number, public requested: number) {
    super(`Stock insuficiente para el material ${materialId}. Disponible: ${available}, Solicitado: ${requested}`);
    this.name = 'InsufficientStockError';
  }
}

export class InactiveProjectError extends Error {
  constructor(public projectId: string) {
    super(`La obra ${projectId} no se encuentra activa o no existe.`);
    this.name = 'InactiveProjectError';
  }
}

// =============================================================================
// 1. REGISTRO DE ENTRADA POR COMPRA (Cálculo de PMP)
// Ejecutado por el rol 'admin'
// =============================================================================
export interface PurchaseItemInput {
  materialId: string;
  sku: string;
  name: string;
  unit: any;
  quantity: number;
  unitCostCLP: number; // Costo de compra neto
}

export interface PurchaseEntryInput {
  voucherFolio: string;
  userId: string;
  userEmail: string;
  notes?: string;
  items: PurchaseItemInput[];
}

/**
 * Registra una entrada por compra calculando de forma atómica el PMP
 * Fórmula:
 * Nuevo PMP = ((Stock Actual * PMP Actual) + (Cantidad Comprada * Costo Compra)) / (Stock Actual + Cantidad Comprada)
 */
export async function recordPurchaseEntry(
  db: Firestore,
  input: PurchaseEntryInput
): Promise<string> {
  const movementRef = doc(collection(db, 'movements'));
  const movementValuationRef = doc(db, `movements/${movementRef.id}/accounting/valuation`);

  await runTransaction(db, async (transaction) => {
    // 1. FASE DE LECTURA (Todos los 'get' deben ejecutarse antes de cualquier 'set/update')
    const materialReads = await Promise.all(
      input.items.map(async (item) => {
        const matOpRef = doc(db, 'materials', item.materialId);
        const matValRef = doc(db, `materials/${item.materialId}/accounting/valuation`);

        const [matOpSnap, matValSnap] = await Promise.all([
          transaction.get(matOpRef),
          transaction.get(matValRef)
        ]);

        if (!matOpSnap.exists()) {
          throw new Error(`El material con ID ${item.materialId} no existe en el catálogo.`);
        }

        return {
          item,
          matOpRef,
          matValRef,
          opData: matOpSnap.data() as MaterialOperational,
          valData: matValSnap.exists() ? (matValSnap.data() as MaterialValuation) : null
        };
      })
    );

    let totalMovementCost = 0;
    const operationalItems: MovementItemOperational[] = [];
    const valuationItems: MovementItemValuation[] = [];

    // 2. FASE DE CÁLCULO Y ESCRITURA
    for (const { item, matOpRef, matValRef, opData, valData } of materialReads) {
      if (item.quantity <= 0 || item.unitCostCLP < 0) {
        throw new Error(`Cantidad o costo inválido para el ítem ${item.materialId}`);
      }

      const currentStock = opData.currentStock || 0;
      const currentPMP = valData?.weightedAverageCostCLP || 0;

      // Cálculo del nuevo PMP
      let newPMP: number;
      const newStock = currentStock + item.quantity;

      if (currentStock <= 0) {
        // Si no había stock previo o estaba en cero, el PMP es el costo de compra actual
        newPMP = Math.round(item.unitCostCLP);
      } else {
        const currentValuation = currentStock * currentPMP;
        const purchaseValuation = item.quantity * item.unitCostCLP;
        newPMP = Math.round((currentValuation + purchaseValuation) / newStock);
      }

      const newTotalValuation = Math.round(newStock * newPMP);
      const subtotalItem = Math.round(item.quantity * item.unitCostCLP);
      totalMovementCost += subtotalItem;

      // Actualizar documento operativo del material
      transaction.update(matOpRef, {
        currentStock: newStock,
        isLowStock: newStock <= opData.minStock,
        updatedAt: serverTimestamp(),
        updatedBy: input.userId
      });

      // Actualizar subdocumento de valoración económica
      transaction.set(
        matValRef,
        {
          weightedAverageCostCLP: newPMP,
          totalValuationCLP: newTotalValuation,
          lastPurchasePriceCLP: item.unitCostCLP,
          lastPurchaseDate: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      operationalItems.push({
        materialId: item.materialId,
        sku: item.sku,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity
      });

      valuationItems.push({
        materialId: item.materialId,
        quantity: item.quantity,
        unitCostCLP: item.unitCostCLP,
        subtotalCLP: subtotalItem
      });
    }

    // 3. Crear Kardex Operativo
    const movementData: MovementOperational = {
      folio: input.voucherFolio,
      type: 'PURCHASE_ENTRY',
      projectId: null,
      projectName: null,
      userId: input.userId,
      userEmail: input.userEmail,
      userRole: 'admin',
      date: Timestamp.now(),
      notes: input.notes || 'Entrada por compra valorizada',
      items: operationalItems
    };
    transaction.set(movementRef, movementData);

    // 4. Crear Kardex Financiero
    const valuationData: MovementValuation = {
      movementId: movementRef.id,
      type: 'PURCHASE_ENTRY',
      totalCostCLP: totalMovementCost,
      items: valuationItems,
      createdAt: Timestamp.now()
    };
    transaction.set(movementValuationRef, valuationData);
  });

  return movementRef.id;
}

// =============================================================================
// 2. REGISTRO DE DESPACHO A OBRA (DISPATCH_PROJECT)
// Ejecución integral para Admin/Backend o despachos valorizados
// =============================================================================
export interface DispatchItemInput {
  materialId: string;
  quantity: number;
}

export interface DispatchInput {
  voucherFolio: string;
  projectId: string;
  userId: string;
  userEmail: string;
  userRole: 'admin' | 'bodeguero' | 'operaciones';
  notes?: string;
  items: DispatchItemInput[];
}

/**
 * Registra un despacho a obra:
 * - Valida stock atómicamente (bloquea stock negativo).
 * - Congela el PMP vigente del material en el movimiento.
 * - Descuenta stock y suma el costo a la obra transaccionalmente.
 */
export async function recordProjectDispatch(
  db: Firestore,
  input: DispatchInput
): Promise<string> {
  const movementRef = doc(collection(db, 'movements'));
  const movementValuationRef = doc(db, `movements/${movementRef.id}/accounting/valuation`);
  const projectRef = doc(db, 'projects', input.projectId);
  const projectFinancesRef = doc(db, `projects/${input.projectId}/accounting/finances`);

  await runTransaction(db, async (transaction) => {
    // 1. FASE DE LECTURAS
    const projectSnap = await transaction.get(projectRef);
    if (!projectSnap.exists() || (projectSnap.data() as ProjectOperational).status !== 'active') {
      throw new InactiveProjectError(input.projectId);
    }
    const projectData = projectSnap.data() as ProjectOperational;

    const projectFinancesSnap = await transaction.get(projectFinancesRef);
    const currentAccumulatedCost = projectFinancesSnap.exists()
      ? (projectFinancesSnap.data() as ProjectFinances).accumulatedCostCLP || 0
      : 0;
    const projectBudget = projectFinancesSnap.exists()
      ? (projectFinancesSnap.data() as ProjectFinances).budgetCLP || 0
      : 0;

    // Leer materiales y sus PMP
    const materialReads = await Promise.all(
      input.items.map(async (item) => {
        const matOpRef = doc(db, 'materials', item.materialId);
        const matValRef = doc(db, `materials/${item.materialId}/accounting/valuation`);

        const [matOpSnap, matValSnap] = await Promise.all([
          transaction.get(matOpRef),
          transaction.get(matValRef)
        ]);

        if (!matOpSnap.exists()) {
          throw new Error(`Material no encontrado: ${item.materialId}`);
        }

        return {
          item,
          matOpRef,
          matValRef,
          opData: matOpSnap.data() as MaterialOperational,
          valData: matValSnap.data() as MaterialValuation | undefined
        };
      })
    );

    // 2. VALIDACIONES DE STOCK
    for (const { item, opData } of materialReads) {
      if (item.quantity <= 0) {
        throw new Error(`La cantidad a despachar debe ser mayor a 0 para ${item.materialId}`);
      }
      if (opData.currentStock < item.quantity) {
        throw new InsufficientStockError(opData.sku, opData.currentStock, item.quantity);
      }
    }

    let totalDispatchCost = 0;
    const operationalItems: MovementItemOperational[] = [];
    const valuationItems: MovementItemValuation[] = [];

    // 3. ACTUALIZACIÓN DE MATERIALES
    for (const { item, matOpRef, matValRef, opData, valData } of materialReads) {
      const newStock = opData.currentStock - item.quantity;
      const pmp = valData?.weightedAverageCostCLP || 0;
      const itemSubtotal = Math.round(item.quantity * pmp);
      totalDispatchCost += itemSubtotal;

      // Descontar inventario operativo
      transaction.update(matOpRef, {
        currentStock: newStock,
        isLowStock: newStock <= opData.minStock,
        updatedAt: serverTimestamp(),
        updatedBy: input.userId
      });

      // Actualizar valor total inmovilizado
      if (valData) {
        transaction.update(matValRef, {
          totalValuationCLP: Math.round(newStock * pmp),
          updatedAt: serverTimestamp()
        });
      }

      operationalItems.push({
        materialId: item.materialId,
        sku: opData.sku,
        name: opData.name,
        unit: opData.unit,
        quantity: item.quantity
      });

      valuationItems.push({
        materialId: item.materialId,
        quantity: item.quantity,
        unitCostCLP: pmp,
        subtotalCLP: itemSubtotal
      });
    }

    // 4. ACTUALIZACIÓN DE COSTO ACUMULADO EN LA OBRA
    const newAccumulatedCost = currentAccumulatedCost + totalDispatchCost;
    const financialProgress = projectBudget > 0
      ? Number(((newAccumulatedCost / projectBudget) * 100).toFixed(2))
      : 0;

    transaction.set(
      projectFinancesRef,
      {
        accumulatedCostCLP: newAccumulatedCost,
        financialProgressPct: financialProgress,
        lastTransactionAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    // 5. REGISTRAR MOVIMIENTO KARDEX
    const movementData: MovementOperational = {
      folio: input.voucherFolio,
      type: 'DISPATCH_PROJECT',
      projectId: input.projectId,
      projectName: projectData.name,
      userId: input.userId,
      userEmail: input.userEmail,
      userRole: input.userRole,
      date: Timestamp.now(),
      notes: input.notes || 'Despacho a obra',
      items: operationalItems
    };
    transaction.set(movementRef, movementData);

    const valuationData: MovementValuation = {
      movementId: movementRef.id,
      type: 'DISPATCH_PROJECT',
      totalCostCLP: totalDispatchCost,
      items: valuationItems,
      createdAt: Timestamp.now()
    };
    transaction.set(movementValuationRef, valuationData);
  });

  return movementRef.id;
}

// =============================================================================
// 3. REGISTRO DE DESPACHO EN TERRENO (EXCLUSIVO BODEGUERO)
// Cero acceso a costos; cumple las reglas de seguridad sin violar el aislamiento
// =============================================================================
/**
 * Transacción operativa ligera ejecutada por el bodeguero en su teléfono móvil.
 * Solo lee stock físico, valida no negatividad, descuenta stock y guarda el Kardex operativo.
 */
export async function recordWarehouseDispatchOperational(
  db: Firestore,
  input: Omit<DispatchInput, 'userRole'>
): Promise<string> {
  const movementRef = doc(collection(db, 'movements'));
  const projectRef = doc(db, 'projects', input.projectId);

  await runTransaction(db, async (transaction) => {
    // 1. Verificar estado de la obra
    const projSnap = await transaction.get(projectRef);
    if (!projSnap.exists() || (projSnap.data() as ProjectOperational).status !== 'active') {
      throw new InactiveProjectError(input.projectId);
    }
    const projData = projSnap.data() as ProjectOperational;

    // 2. Leer únicamente documentos operacionales de materiales
    const reads = await Promise.all(
      input.items.map(async (item) => {
        const matRef = doc(db, 'materials', item.materialId);
        const snap = await transaction.get(matRef);
        if (!snap.exists()) throw new Error(`Material ${item.materialId} no existe.`);
        return { item, matRef, opData: snap.data() as MaterialOperational };
      })
    );

    // 3. Validar existencias
    for (const { item, opData } of reads) {
      if (item.quantity <= 0) throw new Error('Cantidad debe ser positiva.');
      if (opData.currentStock < item.quantity) {
        throw new InsufficientStockError(opData.sku, opData.currentStock, item.quantity);
      }
    }

    const operationalItems: MovementItemOperational[] = [];

    // 4. Actualizar stock
    for (const { item, matRef, opData } of reads) {
      const newStock = opData.currentStock - item.quantity;
      transaction.update(matRef, {
        currentStock: newStock,
        isLowStock: newStock <= opData.minStock,
        updatedAt: serverTimestamp(),
        updatedBy: input.userId
      });

      operationalItems.push({
        materialId: item.materialId,
        sku: opData.sku,
        name: opData.name,
        unit: opData.unit,
        quantity: item.quantity
      });
    }

    // 5. Guardar Kardex operativo (sin costos)
    const movement: MovementOperational = {
      folio: input.voucherFolio,
      type: 'DISPATCH_PROJECT',
      projectId: input.projectId,
      projectName: projData.name,
      userId: input.userId,
      userEmail: input.userEmail,
      userRole: 'bodeguero',
      date: Timestamp.now(),
      notes: input.notes || 'Despacho registrado en terreno por bodega',
      items: operationalItems
    };
    transaction.set(movementRef, movement);
  });

  return movementRef.id;
}

// =============================================================================
// 4. REGISTRO DE DEVOLUCIÓN DESDE OBRA (RETURN_PROJECT)
// =============================================================================
export interface ReturnInput {
  voucherFolio: string;
  projectId: string;
  userId: string;
  userEmail: string;
  userRole: 'admin' | 'bodeguero' | 'operaciones';
  notes?: string;
  items: {
    materialId: string;
    quantity: number;
    unitCostCLP?: number; // Si no se provee, toma el PMP actual
  }[];
}

/**
 * Reintegra existencias al inventario central y descuenta el costo asignado a la obra.
 */
export async function recordProjectReturn(
  db: Firestore,
  input: ReturnInput
): Promise<string> {
  const movementRef = doc(collection(db, 'movements'));
  const movementValuationRef = doc(db, `movements/${movementRef.id}/accounting/valuation`);
  const projectRef = doc(db, 'projects', input.projectId);
  const projectFinancesRef = doc(db, `projects/${input.projectId}/accounting/finances`);

  await runTransaction(db, async (transaction) => {
    // 1. Lecturas
    const projectSnap = await transaction.get(projectRef);
    if (!projectSnap.exists()) throw new InactiveProjectError(input.projectId);
    const projectData = projectSnap.data() as ProjectOperational;

    const projectFinancesSnap = await transaction.get(projectFinancesRef);
    const currentAccumulatedCost = projectFinancesSnap.exists()
      ? (projectFinancesSnap.data() as ProjectFinances).accumulatedCostCLP || 0
      : 0;
    const projectBudget = projectFinancesSnap.exists()
      ? (projectFinancesSnap.data() as ProjectFinances).budgetCLP || 0
      : 0;

    const materialReads = await Promise.all(
      input.items.map(async (item) => {
        const matOpRef = doc(db, 'materials', item.materialId);
        const matValRef = doc(db, `materials/${item.materialId}/accounting/valuation`);
        const [matOpSnap, matValSnap] = await Promise.all([
          transaction.get(matOpRef),
          transaction.get(matValRef)
        ]);

        if (!matOpSnap.exists()) throw new Error(`Material no encontrado: ${item.materialId}`);

        return {
          item,
          matOpRef,
          matValRef,
          opData: matOpSnap.data() as MaterialOperational,
          valData: matValSnap.data() as MaterialValuation | undefined
        };
      })
    );

    let totalReturnedCost = 0;
    const operationalItems: MovementItemOperational[] = [];
    const valuationItems: MovementItemValuation[] = [];

    // 2. Reintegro de existencias y cálculo
    for (const { item, matOpRef, matValRef, opData, valData } of materialReads) {
      if (item.quantity <= 0) throw new Error('Cantidad debe ser mayor a 0');

      const newStock = opData.currentStock + item.quantity;
      const unitCost = item.unitCostCLP ?? (valData?.weightedAverageCostCLP || 0);
      const subtotalReturned = Math.round(item.quantity * unitCost);
      totalReturnedCost += subtotalReturned;

      // Reintegrar stock al documento operativo
      transaction.update(matOpRef, {
        currentStock: newStock,
        isLowStock: newStock <= opData.minStock,
        updatedAt: serverTimestamp(),
        updatedBy: input.userId
      });

      // Actualizar valor total inmovilizado
      if (valData) {
        const pmp = valData.weightedAverageCostCLP || 0;
        transaction.update(matValRef, {
          totalValuationCLP: Math.round(newStock * pmp),
          updatedAt: serverTimestamp()
        });
      }

      operationalItems.push({
        materialId: item.materialId,
        sku: opData.sku,
        name: opData.name,
        unit: opData.unit,
        quantity: item.quantity
      });

      valuationItems.push({
        materialId: item.materialId,
        quantity: item.quantity,
        unitCostCLP: unitCost,
        subtotalCLP: subtotalReturned
      });
    }

    // 3. Descontar costo a la obra (garantizando >= 0)
    const newAccumulatedCost = Math.max(0, currentAccumulatedCost - totalReturnedCost);
    const financialProgress = projectBudget > 0
      ? Number(((newAccumulatedCost / projectBudget) * 100).toFixed(2))
      : 0;

    transaction.set(
      projectFinancesRef,
      {
        accumulatedCostCLP: newAccumulatedCost,
        financialProgressPct: financialProgress,
        lastTransactionAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    // 4. Kardex
    const movementData: MovementOperational = {
      folio: input.voucherFolio,
      type: 'RETURN_PROJECT',
      projectId: input.projectId,
      projectName: projectData.name,
      userId: input.userId,
      userEmail: input.userEmail,
      userRole: input.userRole,
      date: Timestamp.now(),
      notes: input.notes || 'Devolución de materiales desde obra',
      items: operationalItems
    };
    transaction.set(movementRef, movementData);

    const valuationData: MovementValuation = {
      movementId: movementRef.id,
      type: 'RETURN_PROJECT',
      totalCostCLP: totalReturnedCost,
      items: valuationItems,
      createdAt: Timestamp.now()
    };
    transaction.set(movementValuationRef, valuationData);
  });

  return movementRef.id;
}

