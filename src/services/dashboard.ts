import {
  Firestore,
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
  getAggregateFromServer,
  sum
} from 'firebase/firestore';
import {
  MaterialOperational,
  ProjectOperational,
  ProjectFinances
} from '../types/inventory';

// =============================================================================
// 1. MÉTRICA: COSTO ACUMULADO VS PRESUPUESTO POR OBRA (% DE AVANCE FINANCIERO)
// =============================================================================
export interface ProjectFinancialSummary {
  projectId: string;
  name: string;
  status: string;
  budgetCLP: number;
  accumulatedCostCLP: number;
  financialProgressPct: number;
  isOverBudget: boolean;
}

/**
 * Consulta optimizada para cuotas Spark:
 * Solo consulta obras ACTIVAS (reduce lecturas O(N) a O(activas)).
 */
export async function getActiveProjectsFinancialProgress(
  db: Firestore
): Promise<ProjectFinancialSummary[]> {
  const projectsQuery = query(
    collection(db, 'projects'),
    where('status', '==', 'active')
  );

  const projectsSnap = await getDocs(projectsQuery);
  const results: ProjectFinancialSummary[] = [];

  for (const docSnap of projectsSnap.docs) {
    const projData = docSnap.data() as ProjectOperational;
    
    // Obtener subdocumento contable
    const financesSnap = await getDocs(
      query(collection(db, `projects/${docSnap.id}/accounting`))
    );
    const financesDoc = financesSnap.docs.find(d => d.id === 'finances');
    const finData = financesDoc ? (financesDoc.data() as ProjectFinances) : null;

    const budget = finData?.budgetCLP || 0;
    const accumulated = finData?.accumulatedCostCLP || 0;
    const progress = budget > 0 ? Number(((accumulated / budget) * 100).toFixed(2)) : 0;

    results.push({
      projectId: docSnap.id,
      name: projData.name,
      status: projData.status,
      budgetCLP: budget,
      accumulatedCostCLP: accumulated,
      financialProgressPct: progress,
      isOverBudget: accumulated > budget && budget > 0
    });
  }

  return results;
}

// =============================================================================
// 2. MÉTRICA: VALOR TOTAL INMOVILIZADO EN BODEGA
// =============================================================================
/**
 * Utiliza Firestore Server-Side Aggregation Query (sum):
 * - Ejecuta la suma directamente en los servidores de Google.
 * - Tarifa Spark / Firestore: 1 lectura por cada 1.000 entradas de índice.
 * - Para ~50 materiales, esta consulta consume EXACTAMENTE 1 LECTURA en lugar de 50.
 */
export async function getTotalWarehouseValuationCLP(db: Firestore): Promise<number> {
  const accountingGroup = collectionGroup(db, 'accounting');
  
  // Realizar agregación server-side de totalValuationCLP
  const snapshot = await getAggregateFromServer(accountingGroup, {
    totalValuation: sum('totalValuationCLP')
  });

  return snapshot.data().totalValuation || 0;
}

// =============================================================================
// 3. MÉTRICA: MATERIALES EN ESTADO DE ALERTA (Stock Crítico)
// =============================================================================
/**
 * Arquitectura NoSQL para evitar escanear toda la colección:
 * En Firestore NO es posible comparar dos campos del mismo documento en una cláusula WHERE
 * (ej: where('currentStock', '<=', 'minStock') NO es válido en la API).
 * 
 * Solución de alto rendimiento:
 * Usar el flag pre-calculado 'isLowStock == true' mantenido en las transacciones atómicas.
 * Consumo de lecturas: Únicamente los materiales en estado crítico (ej: 3 ítems = 3 lecturas).
 */
export async function getLowStockMaterials(db: Firestore): Promise<MaterialOperational[]> {
  const lowStockQuery = query(
    collection(db, 'materials'),
    where('isLowStock', '==', true)
  );

  const snapshot = await getDocs(lowStockQuery);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as MaterialOperational)
  }));
}

