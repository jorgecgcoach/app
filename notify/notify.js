const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://jcgcoach.firebaseio.com'
});

const db = admin.firestore();

async function sendNotifications() {
  const snapshot = await db.collection('clients').get();
  
  for (const doc of snapshot.docs) {
    if (doc.id === 'coach_data') continue;
    
    const client = doc.data();
    if (!client.push?.enabled || !client.push?.tokens?.length) continue;
    
    for (const token of client.push.tokens) {
      await admin.messaging().send({
        token,
        notification: {
          title: '📋 Completa tu seguimiento',
          body: `¡Hola ${client.name}! No olvides actualizar tu seguimiento semanal.`
        }
      }).catch(err => {
        if (err.code === 'messaging/invalid-registration-token') {
          client.push.tokens = client.push.tokens.filter(t => t !== token);
          db.collection('clients').doc(doc.id).update({ push: client.push });
        }
      });
    }
  }
  
  console.log('✅ Notificaciones enviadas');
}

if (require.main === module) {
  sendNotifications().catch(console.error);
}

module.exports = { sendNotifications };
