/**
 * Script de utilidad para asignar Custom Claims a usuarios de Firebase Auth.
 * Se ejecuta localmente con credenciales de servicio (Admin SDK).
 * 
 * Uso:
 *   node scripts/set-custom-claims.js <uid> <admin|operaciones|bodeguero>
 */

const admin = require('firebase-admin');

// Inicialización con variables de entorno o serviceAccountKey.json
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const [,, uid, role] = process.argv;

const VALID_ROLES = ['admin', 'operaciones', 'bodeguero'];

async function assignRole(targetUid, targetRole) {
  if (!targetUid || !targetRole) {
    console.error('Error: Debes proporcionar UID y rol.');
    console.log('Ejemplo: node set-custom-claims.js "ABC123UID" "bodeguero"');
    process.exit(1);
  }

  if (!VALID_ROLES.includes(targetRole)) {
    console.error(`Error: Rol inválido. Debe ser uno de: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  try {
    await admin.auth().setCustomUserClaims(targetUid, { role: targetRole });
    console.log(`✅ Custom Claim '{ role: "${targetRole}" }' asignado con éxito al usuario: ${targetUid}`);

    // Sincronizar documento en Firestore
    const db = admin.firestore();
    await db.collection('users').doc(targetUid).set({
      role: targetRole,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`✅ Perfil en Firestore /users/${targetUid} actualizado.`);
  } catch (error) {
    console.error('❌ Error al asignar Custom Claims:', error);
    process.exit(1);
  }
}

assignRole(uid, role);

