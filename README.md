# ALMAC - Control de Inventario Valorizado & Asignación de Costos por Obra

Software de control de inventario con costeo por Precio Medio Ponderado (PMP) e imputación presupuestaria a obras en tiempo real, operando sobre el **Plan Spark (100% gratuito)** de Firebase y listo para desplegar en **Cloudflare Pages**.

---

## 🚀 Despliegue en Cloudflare Pages

1. Conecta este repositorio en tu cuenta de [Cloudflare Pages](https://dash.cloudflare.com/).
2. Configuración de Build:
   - **Framework preset:** `None`
   - **Build command:** *(dejar vacío)*
   - **Build output directory:** `/` (o la raíz del proyecto)
3. ¡Listo! Cloudflare generará tu URL pública con SSL y CDN global instantáneamente.

---

## 📦 Estructura del Proyecto

- `index.html`: Dashboard interactivo web con simulación de roles (`admin`, `operaciones`, `bodeguero`) y transacciones en tiempo real.
- `firestore.rules`: Reglas de seguridad de Cloud Firestore con aislamiento de costos y protección contra stock negativo.
- `src/types/inventory.ts`: Definición de interfaces y modelos NoSQL en TypeScript.
- `src/services/transactions.ts`: Transacciones atómicas (`recordPurchaseEntry`, `recordProjectDispatch`, `recordProjectReturn`) en Firebase SDK v10+.
- `src/services/dashboard.ts`: Consultas de agregación server-side (`sum()`) optimizadas para no consumir cuotas del Plan Spark.
- `scripts/set-custom-claims.js`: Script de administración para asignar roles de Firebase Auth con el Admin SDK.

---

## 👥 Matriz de Roles y Aislamiento de Costos

| Capacidad / Permiso | Admin | Operaciones | Bodeguero (Terreno) |
| :--- | :---: | :---: | :---: |
| Consultar stock físico | ✅ | ✅ | ✅ |
| Registrar despachos / devoluciones | ✅ | ✅ | ✅ |
| Entrada por compras con costos | ✅ | ❌ | ❌ |
| Ver PMP y valorización total bodega | ✅ | ❌ | 🔒 **Restringido** |
| Ver presupuestos y costos acumulados | ✅ | ✅ | 🔒 **Restringido** |

---

## 🛠️ Ejecución Local

```bash
# Abrir directamente en el navegador
npm run open

# O iniciar un servidor web local
npm start
```

