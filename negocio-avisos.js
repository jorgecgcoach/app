/* =======================================================================
   negocio-avisos.js  ·  Avisos diarios de Negocio (I'M FIT)
   -----------------------------------------------------------------------
   Lee coach_data.negocio.contracts de Firestore y, cada día:
     • Pago pendiente que vence HOY  -> correo al cliente + correo a Jorge
                                        (+ push a Jorge si hay token)
     • Renovación a 14 días del fin  -> correo a Jorge (+ push a Jorge)
   Pensado para ejecutarse desde GitHub Actions (ver negocio-avisos.yml).

   SECRETOS que necesita (en Settings → Secrets del repo):
     - FIREBASE_SERVICE_ACCOUNT : el JSON del service account (el mismo que
                                  ya usas para el push diario).
     - GMAIL_APP_PASSWORD       : contraseña de aplicación de jorgecgcoach@gmail.com
                                  (Google → Seguridad → Contraseñas de aplicación).
   ======================================================================= */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

const COACH_DOC = 'coach_data';
const EMAIL_COACH_DEFAULT = 'jorgecgcoach@gmail.com';
const AVISO_DIAS_DEFAULT = 14;

// ---- init Firebase Admin ----
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

// ---- correo (Gmail + contraseña de aplicación) ----
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_COACH_DEFAULT, pass: process.env.GMAIL_APP_PASSWORD }
});

// ---- helpers de fecha (día exacto) ----
function todayISO(){ return new Date().toISOString().slice(0,10); }
function addMonths(iso,n){ const [y,m,d]=iso.split('-').map(Number); const dt=new Date(Date.UTC(y,(m-1)+n,d)); return dt.toISOString().slice(0,10); }
function addDays(iso,n){ const [y,m,d]=iso.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,d+n)); return dt.toISOString().slice(0,10); }
function daysBetween(a,b){ return Math.round((new Date(b)-new Date(a))/86400000); }
function finContrato(c){ return addDays(addMonths(c.inicio,(c.dur||0)+(c.congelado||0)),-1); }
function proxPago(c){ return c.prox || addMonths(c.inicio,(c.dur||0)+(c.congelado||0)); }

async function sendEmail(to,subject,text){
  if(!to) return;
  try{ await mailer.sendMail({ from: `I'M FIT <${EMAIL_COACH_DEFAULT}>`, to, subject, text }); console.log('  ✉️  '+to+' · '+subject); }
  catch(e){ console.error('  email ERROR '+to+': '+e.message); }
}
async function sendPush(tokens,title,body){
  const t=(tokens||[]).filter(Boolean);
  if(!t.length) return;
  try{ await messaging.sendEachForMulticast({ tokens:t, notification:{title,body} }); console.log('  🔔  push ('+t.length+') · '+title); }
  catch(e){ console.error('  push ERROR: '+e.message); }
}

// Mapa nombre->tokens de cliente (para push al cliente, best-effort por nombre).
async function buildClientTokenMap(){
  const map={};
  const snap=await db.collection('clients').get();
  snap.forEach(doc=>{
    if(doc.id===COACH_DOC) return;
    const c=doc.data();
    if(c && c.name && c.push && Array.isArray(c.push.tokens) && c.push.enabled){
      map[c.name.trim().toLowerCase()]=c.push.tokens;
    }
  });
  return map;
}

async function main(){
  const today=todayISO();
  console.log('Avisos de negocio · '+today);
  const metaSnap=await db.collection('clients').doc(COACH_DOC).get();
  if(!metaSnap.exists){ console.log('No hay coach_data.'); return; }
  const meta=metaSnap.data();
  const neg=meta.negocio||{};
  const contracts=Array.isArray(neg.contracts)?neg.contracts:[];
  const cfg=neg.cfg||{};
  const emailCoach=cfg.emailCoach||EMAIL_COACH_DEFAULT;
  const avisoDias=cfg.avisoDias||AVISO_DIAS_DEFAULT;
  const coachTokens=(meta.push&&Array.isArray(meta.push.tokens))?meta.push.tokens:[]; // token(s) de Jorge (ver nota)
  const clientTokens=await buildClientTokenMap();

  let pagos=0, renovs=0;
  for(const c of contracts){
    if(!c || !c.inicio) continue;
    const estado=(c.estado||'').toLowerCase();
    const prox=proxPago(c), fin=finContrato(c);

    // 1) Pago pendiente que vence hoy
    if(estado!=='cobrado' && prox===today){
      pagos++;
      await sendEmail(c.correo, "Recordatorio de pago — I'M FIT",
        `Hola ${c.nombre||''}:\n\nTe recuerdo que hoy toca renovar/pagar tu plan (${c.plan||''}). En cuanto lo tengas hecho, avísame.\n\n¡Gracias!\nJorge`);
      await sendEmail(emailCoach, `💶 Cobro pendiente hoy · ${c.nombre}`,
        `Vence hoy el pago de ${c.nombre} (${c.plan}). Importe: ${c.importe} €.`);
      await sendPush(coachTokens, 'Cobro pendiente hoy', `${c.nombre} — ${c.importe} €`);
      const ct=clientTokens[(c.nombre||'').trim().toLowerCase()];
      await sendPush(ct, 'Recordatorio de pago', `Hoy toca renovar tu plan (${c.plan||''}).`);
    }

    // 2) Renovación: aviso a Jorge X días antes del fin
    if(estado==='cobrado' && daysBetween(today,fin)===avisoDias){
      renovs++;
      await sendEmail(emailCoach, `🔔 Renovación en ${avisoDias} días · ${c.nombre}`,
        `A ${c.nombre} se le acaba el plan (${c.plan}) el ${fin}. Agenda la llamada de cierre.`);
      await sendPush(coachTokens, `Renovación en ${avisoDias} días`, `${c.nombre} acaba el ${fin}. Agenda la llamada.`);
    }
  }
  console.log(`Hecho. Pagos avisados: ${pagos} · Renovaciones avisadas: ${renovs}`);
}
main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });
