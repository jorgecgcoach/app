# C1: despliegue seguro y vuelta atrás sin abrir Firestore

Procedimiento para activar el acceso con cuenta (Firebase Auth) y las reglas estrictas. Cada paso marcado **[Autorización]** se hace solo con un «sí» expreso del dueño para ese paso. No contiene UID, códigos, PIN ni credenciales: el UID real vive solo en `config/uid-entrenador.txt` (ignorado por git).

**Regla de oro: en ningún caso se vuelve a desplegar `allow read, write: if true`.** Si algo falla, se usan las salidas de la tabla «Vuelta atrás», que mantienen la base cerrada a quien no ha iniciado sesión.

## Archivos de reglas

| Archivo | Para qué | Abre algo a anónimos |
| --- | --- | --- |
| `firestore.rules` + `storage.rules` | Reglas definitivas. | No |
| `firestore.rescate.rules` | Vuelta atrás: igual que las definitivas, pero el cliente puede cambiar cualquier campo de **su** ficha (no el dueño). Para cuando una escritura legítima choca con la lista de campos protegidos. | No |
| `firestore.transicion.rules` | Fichas como hoy (abiertas) + catálogo. **No se usa** en este procedimiento; existe solo como referencia. | Sí (como hoy) |

Todas se generan con el UID real en `reglas-despliegue/` (ignorada por git) y se prueban así en el emulador:

```bash
npm run reglas:preparar
npm run test:reglas-despliegue
```

Despliegue, **siempre** desde esa carpeta generada (nunca desde la raíz, que lleva el marcador y dejaría al entrenador fuera):

| Qué | Orden |
| --- | --- |
| Definitivas (Firestore + Storage) | `npx firebase deploy --only firestore:rules,storage --project appjorgecgcoach --config reglas-despliegue/firebase.json` |
| Rescate (solo Firestore) | `npx firebase deploy --only firestore:rules --project appjorgecgcoach --config reglas-despliegue/firebase.rescate.json` |

Antes de desplegar, compara `reglas-despliegue/huellas.txt` con la salida de `npm run reglas:preparar`: lo que se despliega es exactamente lo probado.

## Antes del día del cambio

| # | Paso | Quién | Comprobación |
| --- | --- | --- | --- |
| P1 | Copia completa real, cifrada, en el PC y en el USB, verificada. | Tú en el PC (asistente de claves) y yo con tu autorización | `copia:verificar` sin problemas en las dos copias. |
| P2 | Proveedores de Auth activos (Google, Correo/contraseña), `jorgecgcoach.github.io` autorizado, protección de enumeración de correos activa. | Hecho el 10-11-2026 | — |
| P3 | Reglas generadas y probadas con el UID real (`test:reglas-despliegue` en verde). | Yo | Huellas anotadas. |
| P4 | Ensayo de la migración con la copia: `node scripts/migrate-client-auth.js --backup <copia>` (no escribe nada). | Tú, conmigo | Dice «dry-run», cuántas cuentas crearía y avisos sin datos personales. |
| P5 | **[Autorización]** Permiso de Storage para leer Firestore. `storage.rules` comprueba en la ficha quién es el dueño de una foto; Firebase pide conceder a la cuenta de servicio de Storage un rol para eso la primera vez que se despliegan reglas con `firestore.get`. Es un cambio de IAM: la CLI lo pregunta al desplegar; acepta solo ese. | Tú | Sin él, el entrenador funciona, pero el cliente no puede subir ni leer sus fotos por ruta. |

## La ventana (noche, unos 45 minutos)

| # | Paso | Tiempo | Si falla |
| --- | --- | --- | --- |
| V1 | Copia de la app («🛟 Copia → Descargar copia ahora») justo antes. Fuera del repositorio. | 2 min | No seguir. |
| V2 | **[Autorización]** Crear las cuentas de clientes: `migrate-client-auth.js --backup <copia de V1> --apply` con `ALLOW_AUTH_MIGRATION_APPLY=yes`. Solo añade `authUid`/`authUids`; la web actual lo ignora. Decide con la ficha **actual** (no resucita fichas borradas, no pisa un `authUid` nuevo, no vincula un código cambiado después de la copia). | 3 min | Se puede repetir: no duplica. Nada visible cambia todavía. |
| V3 | **[Autorización]** Fusionar el PR #11 en `main` (web con `AUTH_ENABLED = true`). Esperar a que GitHub Pages publique y comprobar byte a byte que lo servido es el commit fusionado. Anotar ese commit como «última web buena con Auth». | 5–10 min | Las reglas siguen como hoy: la web nueva funciona igual de abierta. Se puede volver a la web anterior sin riesgo **solo mientras no se hayan desplegado las reglas**. |
| V4 | **[Autorización]** Enseguida, reglas definitivas de Firestore y Storage (orden de arriba). Sin pasar por la transición: el tiempo con la base abierta no se alarga. | 2 min | Ver «Vuelta atrás». |
| V5 | Entrenador: entrar con Google en el ordenador, crear la contraseña de respaldo («🛟 Copia → 🔐 Acceso de respaldo»), probarla en el iPhone (Safari y app de inicio). | 10 min | Con Google en el ordenador sigue entrando. |
| V6 | Un cliente de prueba: entra con su código, ve su programa y sus vídeos, guarda una serie; recargar no pide el código. | 5 min | Volver a guardar su código desde «Código de acceso». |
| V7 | Comprobaciones sin sesión (solo lectura): `coach_data` → 403, listar `clients` → 403, foto por ruta sin token → 403. | 3 min | Si algo da 200: rescate **no**; revisar qué reglas están publicadas (consola → Reglas) y volver a desplegar las definitivas. |
| V8 | Seguimiento 24–48 h: consola → Firestore → Uso, sin picos de «permiso denegado»; Authentication → Usuarios, quién ha entrado. | — | — |

Móviles con la web antigua abierta sin recargar: tras V4 no pueden guardar. Lo pendiente queda en el diario local del guardado seguro; al recargar entran con su código y se sube solo.

## Vuelta atrás (sin volver a abrir la base)

| Síntoma | Qué se hace | Tiempo | Base abierta |
| --- | --- | --- | --- |
| Un cliente no puede guardar algo legítimo («permiso denegado» en su ficha). | Desplegar `firestore.rescate.rules`. Arreglar la app o las reglas y volver a las definitivas. | 2 min | No |
| Un cliente no puede entrar con su código. | Entrenador: «Código de acceso» → guardar su código otra vez (crea la cuenta y la vincula). O repetir V2. | 1 min | No |
| Un cliente ve «tu sesión ha caducado o ya no tiene permiso». | Pulsar «Volver a entrar» y escribir su código. Sus cambios pendientes se suben al entrar. | 1 min | No |
| Google no entra en el iPhone. | Contraseña de respaldo (V5). La app lo propone sola si Google vuelve sin sesión. | 1 min | No |
| El entrenador no puede entrar de ninguna forma. | Desde el ordenador con Google. Los clientes siguen funcionando; los datos siguen protegidos. | — | No |
| Fallo de la web nueva (pantallas, botones). | Arreglo rápido en `main`, o volver a publicar la «última web buena con Auth». **No** volver a la web sin Auth: con las reglas cerradas no carga (no abre nada, pero deja a todos sin app). | 10 min | No |
| Fotos del cliente fallan (subir o ver por ruta). | Conceder el permiso de P5 (consola de Storage → Reglas lo ofrece). El entrenador no se ve afectado. | 2 min | No |
| Datos dañados o borrados. | Restauración aditiva desde la copia verificada, con autorización expresa. Las reglas no se tocan. | 15–30 min | No |

**No usar** el historial de reglas de la consola para «volver a la versión anterior»: la anterior es la abierta.

## Escenarios comprobados (emulador, datos ficticios)

- Sin conexión: los cambios quedan en el dispositivo, aviso rojo, se suben al volver.
- Sesión caducada o cuenta cambiada: aviso propio («Volver a entrar»), nada se pierde; al entrar se sube lo pendiente.
- Conflicto con otro dispositivo: no se pisa; se combina lo que no choca.
- iPhone: en Safari, ventana de Google (la redirección pierde la sesión desde Safari 16.1); en la app de inicio, redirección con aviso y respaldo si vuelve sin sesión. **El iPhone real no se ha podido probar en remoto: es el paso V5.**
