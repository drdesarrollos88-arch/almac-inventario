import {
  Firestore,
  doc,
  runTransaction,
  serverTimestamp,
  collection,
  Timestamp,
  arrayUnion
} from 'firebase/firestore';
import {
  MaterialOperational,
  MaterialValuation,
  ProjectOperational,
  ProjectFinances,
  MovementOperational,
  MovementValuation,
  LocationReference,
  Subproject
} from '../types/inventory';

// =============================================================================
// 1. CREACIÓN DE PROYECTOS Y SUBPROYECTOS
// =============================================================================

export interface CreateProjectInput {
  code: string;
  name: string;
  budgetCLP: number;
  address?: string;
  userId: string;
}

export async function createProject(
  db: Firestore,
  input: CreateProjectInput
): Promise<string> {
  const projectRef = doc(collection(db, 'projects'));
  const financesRef = doc(db, `projects/${projectRef.id}/accounting/finances`);

  await runTransaction(db, async (transaction) => {
    const projectData: ProjectOperational = {
      code: input.code,
      name: input.name,
      status: 'active',
      address: input.address || '',
      subprojects: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    transaction.set(projectRef, projectData);

    const financesData: ProjectFinances = {
      budgetCLP: input.budgetCLP,
      accumulatedCostCLP: 0,
      financialProgressPct: 0,
      lastTransactionAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    transaction.set(financesRef, financesData);
  });

  return projectRef.id;
}

export interface CreateSubprojectInput {
  projectId: string;
  code: string;
  name: string;
}

export async function createSubproject(
  db: Firestore,
  input: CreateSubprojectInput
): Promise<void> {
  const projectRef = doc(db, 'projects', input.projectId);

  await runTransaction(db, async (transaction) => {
    const projSnap = await transaction.get(projectRef);
    if (!projSnap.exists()) throw new Error(`Proyecto ${input.projectId} no existe.`);

    const newSubproject: Subproject = {
      id: `sub-${Date.now()}`,
      code: input.code,
      name: input.name,
      accumulatedCostCLP: 0,
      assignedMaterialsCount: 0,
      createdAt: Timestamp.now()
    };

    transaction.update(projectRef, {
      subprojects: arrayUnion(newSubproject),
      updatedAt: serverTimestamp()
    });
  });
}

// =============================================================================
// 2. TRANSFERENCIA MULTIDIRECCIONAL DE MATERIALES
// (Bodega <-> Obra/Subobra, Obra A <-> Obra B, Subobra A <-> Subobra B)
// =============================================================================

export interface TransferItemInput {
  materialId: string;
  quantity: number;
}

export interface TransferMovementInput {
  voucherFolio: string;
  origin: LocationReference;       // Bodega Central o Proyecto o Subproyecto
  destination: LocationReference;  // Bodega Central o Proyecto o Subproyecto
  userId: string;
  userEmail: string;
  userRole: 'admin' | 'operaciones' | 'bodeguero';
  notes?: string;
  items: TransferItemInput[];
}

/**
 * Transacción atómica que:
 * 1. Valida existencias en la ubicación de origen.
 * 2. Descuenta stock y costo del origen (si era obra).
 * 3. Incrementa stock y asume el costo en el destino (si es obra).
 * 4. Actualiza Bodega Central si el origen o destino es Bodega.
 * 5. Registra el Kardex operacional y la valoración histórica.
 */
export async function executeMaterialTransfer(
  db: Firestore,
  input: TransferMovementInput
): Promise<string> {
  const movementRef = doc(collection(db, 'movements'));
  const movementValRef = doc(db, `movements/${movementRef.id}/accounting/valuation`);

  await runTransaction(db, async (transaction) => {
    // 1. FASE DE LECTURA DE MATERIALES
    const materialReads = await Promise.all(
      input.items.map(async (item) => {
        const matOpRef = doc(db, 'materials', item.materialId);
        const matValRef = doc(db, `materials/${item.materialId}/accounting/valuation`);
        const [opSnap, valSnap] = await Promise.all([
          transaction.get(matOpRef),
          transaction.get(matValRef)
        ]);
        if (!opSnap.exists()) throw new Error(`Material ${item.materialId} no existe.`);
        return {
          item,
          matOpRef,
          matValRef,
          opData: opSnap.data() as MaterialOperational,
          valData: valSnap.data() as MaterialValuation | undefined
        };
      })
    );

    // 2. LECTURA DE FINANZAS DE PROYECTO ORIGEN Y DESTINO (si aplican)
    let originFinRef = null;
    let originFinances: ProjectFinances | null = null;
    let originProjRef = null;
    let originProjData: ProjectOperational | null = null;

    if (input.origin.type !== 'WAREHOUSE') {
      const projId = input.origin.projectId || input.origin.id;
      originProjRef = doc(db, 'projects', projId);
      originFinRef = doc(db, `projects/${projId}/accounting/finances`);
      const [pSnap, fSnap] = await Promise.all([
        transaction.get(originProjRef),
        transaction.get(originFinRef)
      ]);
      if (pSnap.exists()) originProjData = pSnap.data() as ProjectOperational;
      if (fSnap.exists()) originFinances = fSnap.data() as ProjectFinances;
    }

    let destFinRef = null;
    let destFinances: ProjectFinances | null = null;
    let destProjRef = null;
    let destProjData: ProjectOperational | null = null;

    if (input.destination.type !== 'WAREHOUSE') {
      const projId = input.destination.projectId || input.destination.id;
      destProjRef = doc(db, 'projects', projId);
      destFinRef = doc(db, `projects/${projId}/accounting/finances`);
      const [pSnap, fSnap] = await Promise.all([
        transaction.get(destProjRef),
        transaction.get(destFinRef)
      ]);
      if (pSnap.exists()) destProjData = pSnap.data() as ProjectOperational;
      if (fSnap.exists()) destFinances = fSnap.data() as ProjectFinances;
    }

    // 3. VALIDACIÓN DE STOCK
    for (const { item, opData } of materialReads) {
      if (item.quantity <= 0) throw new Error('Cantidad debe ser mayor a 0');
      
      // Si el origen es Bodega Central, validar warehouseStock
      if (input.origin.type === 'WAREHOUSE') {
        if (opData.warehouseStock < item.quantity) {
          throw new Error(
            `Stock insuficiente en Bodega Central para ${opData.sku}. Disponible: ${opData.warehouseStock}, Solicitado: ${item.quantity}`
          );
        }
      }
    }

    let totalTransferCost = 0;
    const opItems = [];
    const valItems = [];

    // 4. ACTUALIZACIÓN DE EXISTENCIAS FÍSICAS EN MATERIALES
    for (const { item, matOpRef, matValRef, opData, valData } of materialReads) {
      const pmp = valData?.weightedAverageCostCLP || 0;
      const subtotal = Math.round(item.quantity * pmp);
      totalTransferCost += subtotal;

      let newWarehouseStock = opData.warehouseStock;

      // Si sale de bodega central
      if (input.origin.type === 'WAREHOUSE') {
        newWarehouseStock -= item.quantity;
      }
      // Si entra a bodega central (devolución)
      if (input.destination.type === 'WAREHOUSE') {
        newWarehouseStock += item.quantity;
      }

      transaction.update(matOpRef, {
        warehouseStock: newWarehouseStock,
        isLowStock: newWarehouseStock <= opData.minStock,
        updatedAt: serverTimestamp(),
        updatedBy: input.userId
      });

      if (valData) {
        transaction.update(matValRef, {
          totalValuationWarehouseCLP: Math.round(newWarehouseStock * pmp),
          updatedAt: serverTimestamp()
        });
      }

      opItems.push({
        materialId: item.materialId,
        sku: opData.sku,
        name: opData.name,
        unit: opData.unit,
        quantity: item.quantity
      });

      valItems.push({
        materialId: item.materialId,
        quantity: item.quantity,
        unitCostCLP: pmp,
        subtotalCLP: subtotal
      });
    }

    // 5. ASUNCIÓN / DEDUCCIÓN DE COSTOS POR OBRA
    // Deducir del origen (si era obra)
    if (originFinRef && originFinances) {
      const currentCost = originFinances.accumulatedCostCLP || 0;
      const budget = originFinances.budgetCLP || 0;
      const newCost = Math.max(0, currentCost - totalTransferCost);
      const progress = budget > 0 ? Number(((newCost / budget) * 100).toFixed(2)) : 0;

      transaction.set(originFinRef, {
        accumulatedCostCLP: newCost,
        financialProgressPct: progress,
        lastTransactionAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Si el origen era un subproyecto, descontar su costo interno
      if (originProjRef && originProjData && input.origin.type === 'SUBPROJECT') {
        const updatedSubs = originProjData.subprojects.map(sub => {
          if (sub.id === input.origin.id) {
            return {
              ...sub,
              accumulatedCostCLP: Math.max(0, sub.accumulatedCostCLP - totalTransferCost)
            };
          }
          return sub;
        });
        transaction.update(originProjRef, { subprojects: updatedSubs });
      }
    }

    // Asumir en el destino (si es obra)
    if (destFinRef && destFinances) {
      const currentCost = destFinances.accumulatedCostCLP || 0;
      const budget = destFinances.budgetCLP || 0;
      const newCost = currentCost + totalTransferCost;
      const progress = budget > 0 ? Number(((newCost / budget) * 100).toFixed(2)) : 0;

      transaction.set(destFinRef, {
        accumulatedCostCLP: newCost,
        financialProgressPct: progress,
        lastTransactionAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Si el destino es un subproyecto, sumar su costo interno
      if (destProjRef && destProjData && input.destination.type === 'SUBPROJECT') {
        const updatedSubs = destProjData.subprojects.map(sub => {
          if (sub.id === input.destination.id) {
            return {
              ...sub,
              accumulatedCostCLP: sub.accumulatedCostCLP + totalTransferCost
            };
          }
          return sub;
        });
        transaction.update(destProjRef, { subprojects: updatedSubs });
      }
    }

    // 6. REGISTRAR KARDEX TRANSACCIONAL
    let movementType: any = 'TRANSFER_BETWEEN_PROJECTS';
    if (input.origin.type === 'WAREHOUSE') movementType = 'TRANSFER_WAREHOUSE_TO_PROJECT';
    else if (input.destination.type === 'WAREHOUSE') movementType = 'TRANSFER_PROJECT_TO_WAREHOUSE';

    const movementData: MovementOperational = {
      folio: input.voucherFolio,
      type: movementType,
      origin: input.origin,
      destination: input.destination,
      userId: input.userId,
      userEmail: input.userEmail,
      userRole: input.userRole,
      date: Timestamp.now(),
      notes: input.notes || 'Transferencia de materiales',
      items: opItems
    };
    transaction.set(movementRef, movementData);

    const valuationData: MovementValuation = {
      movementId: movementRef.id,
      type: movementType,
      totalCostCLP: totalTransferCost,
      items: valItems,
      createdAt: Timestamp.now()
    };
    transaction.set(movementValValRef(movementRef.id), valuationData);
  });

  return movementRef.id;
}

function movementValValRef(id: string) {
  // Helper interno
  return doc(collection(doc(collection({} as any, 'movements'), id), 'accounting'), 'valuation');
}
