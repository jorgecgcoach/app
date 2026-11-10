# Firestore y acceso por código

Preparado, no activado. `AUTH_ENABLED` está en `false` en `index.html`. Con el flag apagado la app entra como hasta ahora: el cliente escribe su código, el entrenador el suyo, y el navegador sigue leyendo `clients/coach_data`.

No despliegues estas reglas ni cambies el flag hasta el checklist de abajo, hecho junto al dueño. **No mergear a main hasta esa revisión.**

## Diseño que queda listo

Plan Spark, sin Cloud Functions y sin coste nuevo.

- **Cliente.** Sigue entrando solo con el código que el entrenador le asigna (a menudo un documento de identidad). No hay email ni contraseña nuevos en pantalla. Al guardar el código, la app del entrenador crea una cuenta de Firebase Auth en un segundo inicio (así no se cierra la sesión del entrenador). El email es un hash del código (`auth/code-identity.js`), no el código en claro. La contraseña es el código más un sufijo público `Jcg#1`, solo para llegar al mínimo de 6 caracteres de Auth. El sufijo no es un secreto: está en la app.
- **Entrenador.** Con el flag encendido entra con Google, no con el PIN. Un PIN corto se puede probar; la cuenta de Google no. Las reglas lo reconocen por el custom claim `role == 'coach'` o por su UID en `firestore.rules`.
- **Reglas.** Un cliente solo lee y escribe la ficha cuyo `authUid` es el suyo. `clients/coach_data` (códigos, negocio, contratos, CRM, tokens push del entrenador) solo lo lee el entrenador. La comprobación del código ya no descarga la lista de códigos. Los tokens push van dentro del documento: Firestore no esconde campos sueltos, así que quien puede leer la ficha ve su token, y nadie más.
- **Sesión.** `firebase.auth.Auth.Persistence.LOCAL`. La siguiente apertura no vuelve a pedir el código mientras la sesión siga en el dispositivo.
- **Contactos.** Siguen en `negocio.contacts`. El flag `CONTACTS_COLLECTION` (también `false`) copia el CRM a la colección `contacts` sin quitar el mapa antiguo.

El archivo `firestore.rules` es el modo estricto. No lleva un interruptor “aún abierto”: si se despliega, cierra el acceso. Hoy en producción siguen las reglas abiertas (`allow read, write: if true` en `clients/{clientId}`) y este archivo no está publicado.

### Por qué no Cloud Functions

La opción más cerrada sería una Cloud Function: el código se comprueba en servidor, se puede limitar intentos y devolver un custom token. Hace falta el plan Blaze (tarjeta, aunque el uso entre en la capa gratuita). El arranque en frío suma fácilmente medio segundo o más a cada login frío, y el requisito es no ir más lento que ahora.

Cuentas sintéticas creadas por el entrenador:

| | Cuentas sintéticas (esto) | Cloud Function |
| --- | --- | --- |
| Plan | Spark, sin coste | Blaze |
| Lo que escribe el cliente | El mismo código | El mismo código |
| El navegador descarga códigos | No | No |
| El código es la contraseña | Sí, guardada con el hash de Auth | No |
| Límite de intentos | El de Firebase Auth | El que programes |
| Tiempo del primer login | Una ronda de Auth, sin arranque en frío | Auth más la función, con posible arranque en frío |
| Alta de la cuenta | El entrenador, desde la app o el script | La función, al primer código válido |

Recomendación: cuentas sintéticas ahora. Functions más adelante solo si se activa Blaze y se quieren límites de intentos propios.

### Códigos fáciles de adivinar

Un documento de identidad de 8 dígitos (o 8 dígitos y una letra) se puede probar. Firebase frena los intentos seguidos desde la misma red, pero no convierte ese código en un secreto fuerte. El email de la cuenta es un hash: no sale el documento en la lista de usuarios de Auth, y un listado de emails tampoco sirve sin el código.

Mitigación, sin obligar a cambiar los códigos que ya funcionan:

- Al guardar un código que parece un documento sin nada más, la app (solo con el flag encendido) pregunta si se guarda igual. Se puede confirmar y dejarlo.
- Se puede añadir un sufijo que solo conozcan el entrenador y el cliente, por ejemplo `-7K`. El cliente lo escribe junto al código, como siempre. Tres caracteres extra de un alfabeto de unas 30 letras multiplican por unos 30.000 los intentos.
- Los códigos actuales siguen siendo válidos. No hace falta una tanda de cambios.

## Tiempos de login

No se han leído documentos de producción (ahí están los códigos). Las cifras de red de abajo son el tiempo hasta el host de Google desde esta máquina, con una petición vacía que responde 404. No es un móvil.

Medido el 5 de noviembre de 2026, cinco repeticiones:

| Host | Tiempo hasta el primer byte |
| --- | --- |
| `identitytoolkit.googleapis.com` | 41–65 ms |
| `firestore.googleapis.com` | 28–51 ms |
| `securetoken.googleapis.com` | 41–65 ms, un pico a 314 ms |

Derivar el email del código: unas 0,05 ms (mil repeticiones en local). No se nota.

Un teléfono en España suele sumar 100–250 ms por viaje en Wi-Fi y 150–400 ms en 4G, más el servidor. Con eso:

| Momento | Hoy (`AUTH_ENABLED` false) | Con el flag encendido |
| --- | --- | --- |
| Hasta ver el formulario | Espera a bajar `clients/coach_data` entero (códigos, negocio, biblioteca). En un meta pequeño, a menudo menos de medio segundo; si se acerca a 1 MiB, puede pasar de un segundo. | No lee Firestore. La primera vez descarga el SDK de Auth (queda en caché). |
| Pulsar Entrar, cliente, primera vez | El código ya está en memoria. El botón vuelve a leer el meta y luego la ficha: 2 lecturas en serie. Meta pequeño y en caché: a menudo <0,4 s. Meta grande: 0,5–2 s o más. | Hash <0,1 ms, alta o entrada en Auth (dos viajes: identity toolkit y secure token) y una consulta de su ficha, que es un documento, no el meta. En un móvil, del orden de 0,5–1,4 s. No descarga códigos ni negocio. Si el meta de hoy pesa, este camino puede ir más rápido. Si el meta es pequeño y está en caché, el primer login puede tardar unos cientos de ms más. |
| Abrir otra vez | `localStorage` y otra vez meta + ficha. Con la caché de Firestore, a menudo 50–300 ms, y no se reescribe el código. | Sesión `LOCAL`. No se pide el código. Si el token tiene menos de una hora, no hay ronda de contraseña; como mucho un refresco (~0,1–0,4 s en móvil) y la ficha, a menudo desde la caché que ya usa la app. |

La consola del navegador, con el flag encendido, escribe `[auth] entrar cliente … ms` y `[auth] sesión restaurada … ms`. No escribe el código.

## Contactos y el límite de 1 MiB

Un documento de Firestore no puede pasar de 1.048.576 bytes. `clients/coach_data` guarda códigos, biblioteca, contratos, pagos y `negocio.contacts`. La pantalla de CRM ya avisa al pasar del 70 % de ese tope.

Umbral añadido, solo cuando `CONTACTS_COLLECTION` esté en true: 400 contactos. A ~1–2 KB por contacto con notas, 400 contactos son del orden de 0,4–0,8 MiB, además del resto del meta.

Propuesta, sin hacerla todavía: cada contacto pasa a `contacts/ct_{id}` con los mismos campos y `updatedAt`. Las reglas de esa colección ya solo dejan pasar al entrenador. Con el flag, cada guardado del entrenador copia el array y borra los que ya no están, y al entrar se fusiona por `updatedAt` más reciente. El array de `negocio.contacts` se mantiene, así el CRM no cambia mientras el flag siga en false. Cuando la colección esté llena y revisada, un paso posterior puede dejar de embeber el array. Contratos y pagos siguen en el meta; si crecen, el mismo patrón.

## Checklist juntos (unos 15 minutos)

Hazlo en este orden, el día del corte, después de revisar el PR. Hasta el paso 6 la web publicada sigue igual y las reglas de producción siguen abiertas. El paso 7 es el que cambia el acceso: no lo adelantes.

1. **Copia (2 min).** En la app, como entrenador, 🛟 Copia. Guarda el JSON fuera del repo. No lo subas a GitHub ni lo pegues en el PR.
2. **Proveedores (3 min).** Firebase Console → proyecto `appjorgecgcoach` → Authentication → Sign-in method. Activa **Google** y **Correo electrónico/contraseña**. No actives el enlace por email. En Settings → Authorized domains, añade `jorgecgcoach.github.io` si no está.
3. **UID del entrenador (3 min).** Con la web actual abierta (flag todavía en false), pega esto en la consola del navegador, entra con la cuenta de Google del entrenador y copia el UID. El cuadro no muestra el email. Al terminar, la sesión de Auth se cierra.

```javascript
(function(){
  var s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/firebase/10.8.0/firebase-auth-compat.min.js';
  s.onload=async function(){
    var cred=await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    prompt('Copia este UID en firestore.rules (reemplaza el marcador).', cred.user.uid);
    await firebase.auth().signOut();
  };
  document.head.appendChild(s);
})();
```

4. **Reglas con el UID, sin publicarlo (1 min).** El repositorio es público: el UID real **no** va a git, que lleva siempre el marcador `REEMPLAZAR_UID_DEL_COACH`.
   - Escribe el UID en `config/uid-entrenador.txt` (una línea; ignorado por git).
   - `npm run reglas:preparar` genera en `reglas-despliegue/` (ignorada) las tres reglas con el UID, un `firebase.json` que despliega solo reglas y `huellas.txt`.
   - `npm run test:reglas-despliegue` pasa todas las pruebas de reglas contra esos archivos generados (comprueba también que no queda ningún marcador y que un UID casi igual no entra).
   - Para desplegar, **solo** desde esa carpeta: `firebase deploy --only firestore:rules,storage --config reglas-despliegue/firebase.json`. Nunca desde la raíz: ahí están las reglas con el marcador y el entrenador se quedaría sin acceso.
   - El claim `role == 'coach'` es opcional y solo se puede poner con el Admin SDK; el UID basta.
5. **Ensayo de la migración (2 min).** Desde la raíz del repo, con Node 18 o superior:

```bash
npm install
node scripts/migrate-client-auth.js --backup ruta/de/la-copia.json
```

Tiene que decir `dry-run` y `No se ha escrito nada`. No imprime códigos ni nombres. Revisa cuántas cuentas se crearían y cuántos códigos parecen un documento sin sufijo. Esos se pueden dejar.
6. **Crear las cuentas (2 min).** Sigue con las reglas de producción abiertas. Usa la cuenta de servicio que ya tiene el aviso diario. El JSON no se commitea.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/fuera/del/repo/service-account.json
export ALLOW_AUTH_MIGRATION_APPLY=yes
node scripts/migrate-client-auth.js --backup ruta/de/la-copia.json --apply
```

Sin `ALLOW_AUTH_MIGRATION_APPLY=yes` el script sale y no escribe en el proyecto real. Contra los emuladores solo escribe si `FIRESTORE_EMULATOR_HOST` y `FIREBASE_AUTH_EMULATOR_HOST` están definidos. Borra el JSON del disco cuando acabes. El campo `authUid` se añade a cada ficha; el resto no se toca. La web vieja lo ignora.
7. **Corte, el mismo rato (3 min).** Primero la web nueva, enseguida las reglas. Si despliegas las reglas antes, la web actual deja de cargar porque lee `coach_data` sin Auth.
   - Cambia `const AUTH_ENABLED=false` a `true`, publica `main` (GitHub Pages).
   - Enseguida: `npx firebase deploy --only firestore:rules --project appjorgecgcoach`
   - Entra tú con Google. Un cliente de prueba entra con su código de siempre. Comprueba que no ve el negocio ni otra ficha.
   - Deja `CONTACTS_COLLECTION` en false salvo que ya quieras la copia del CRM.

Si algo falla, vuelve a publicar las reglas abiertas (es el estado de hoy) y pon otra vez `AUTH_ENABLED` en false:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /clients/{clientId} {
      allow read, write: if true;
    }
  }
}
```

Los avisos de GitHub Actions usan la cuenta de servicio y no pasan por estas reglas. Siguen igual.

## Cómo probar sin producción

```bash
npm test
```

Eso levanta el emulador de Firestore del proyecto ficticio `demo-appjorgecgcoach` y corre la identidad del código, las reglas y el dry-run. Cubre: anónimo no lee `coach_data`; el entrenador (claim o UID marcador) sí; el cliente A no lee al B, ni el meta, ni `contacts`; la consulta por `authUid` devuelve solo su ficha; `coach_data` no admite `authUid`.

El `--apply` contra los emuladores (datos de `scripts/fixtures/backup.sample.json`, todos ficticios) crea las cuentas y escribe `authUid`. No lo uses con una copia real salvo el paso 6, y nunca contra `main` desde un agente.

Con el flag en false, abre la web y entra como siempre: el cliente con su código y el entrenador con el suyo. No aparece “Entrar con Google”.
