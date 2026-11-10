# C1: despliegue seguro y vuelta atrás sin abrir Firestore

Procedimiento para activar el acceso con cuenta (Firebase Auth) y las reglas estrictas. Cada paso marcado **[Autorización]** se hace solo con un «sí» expreso del dueño para ese paso. No contiene UID, códigos, PIN ni credenciales: el UID real vive solo en `config/uid-entrenador.txt` (ignorado por git).

**Regla de oro: en ningún caso se vuelve a desplegar `allow read, write: if true`.** Si algo falla, se usan las salidas de «Parar o volver atrás en cada fase», que mantienen la base cerrada a quien no ha iniciado sesión.

## Archivos de reglas

| Archivo | Para qué | Clientes | Anónimos |
| --- | --- | --- | --- |
| `firestore.rules` + `storage.rules` | Definitivas. | Leen y escriben su ficha, salvo los campos del entrenador. | Nada |
| `firestore.congelado.rules` | **Parada de emergencia.** Si la app de los clientes escribe algo mal y hay que pararlo ya. | Solo leen su ficha; no escriben nada. Lo que guarden queda en su dispositivo y se sube al volver a las definitivas. | Nada |
| `firestore.transicion.rules` | Fichas abiertas como hoy + catálogo. **No se usa**; solo referencia. | — | Todo, como hoy |

Ya no hay «reglas de rescate» que dejen al cliente cambiar cualquier campo de su ficha (ver «Campos del entrenador»).

Todas se generan con el UID real en `reglas-despliegue/` (ignorada por git) y se prueban así en el emulador:

```bash
npm run reglas:preparar
npm run test:reglas-despliegue
```

Despliegue, **siempre** desde esa carpeta (nunca desde la raíz, que lleva el marcador y dejaría al entrenador fuera):

| Qué | Orden |
| --- | --- |
| Definitivas (Firestore + Storage) | `npx firebase deploy --only firestore:rules,storage --project appjorgecgcoach --config reglas-despliegue/firebase.json` |
| Parada (solo Firestore) | `npx firebase deploy --only firestore:rules --project appjorgecgcoach --config reglas-despliegue/firebase.congelado.json` |

Antes de desplegar, compara `reglas-despliegue/huellas.txt` con la salida de `npm run reglas:preparar`: lo desplegado es exactamente lo probado.

## Campos del entrenador

En su ficha, un cliente **no puede** cambiar: `name` (identidad), `code` (código), `authUid` / `authUids` (cuentas de acceso), `mods` (módulos que ve), `serviceType` y `notifs` (configuración del entrenador) ni `pagos` (datos administrativos). Tampoco leer ni escribir otras fichas, `coach_data` (códigos, negocio, CRM, PIN) ni `contacts`. Cualquier escritura que toque uno de esos campos se rechaza **entera**.

Fallo encontrado el 11-11-2026 (antes de publicar): la app rellena en memoria los tipos de aviso que faltan en fichas antiguas. Con las reglas estrictas, ese relleno hacía que se rechazara también la serie que el cliente guardaba: **un cliente con la ficha antigua no podía guardar nada**. Corregido en la app (`shared/campos-cliente.js`): la app del cliente envía esos campos tal como están en la nube. Pruebas: `firestore/envio-cliente.test.js` (con el guardado real y las reglas) y comprobación en el navegador con emuladores.

Lo que el cliente sí puede cambiar de su ficha y no es suyo: el programa dentro de `blocks` (va en el mismo campo que sus series). Solo le afecta a él; el entrenador lo ve y lo puede corregir.

## Antes del día del cambio

| # | Paso | Quién | Comprobación |
| --- | --- | --- | --- |
| P1 | Copia completa real, cifrada, en el PC y en el USB, verificada. | Tú en el PC (asistente de claves) y yo con tu autorización | `copia:verificar` sin problemas en las dos copias. |
| P2 | Proveedores de Auth activos (Google, Correo/contraseña), `jorgecgcoach.github.io` autorizado, protección de enumeración de correos. | Hecho el 10-11-2026 | — |
| P3 | Reglas generadas y probadas con el UID real. | Yo | Huellas anotadas. |
| P4 | Ensayo de la migración con la copia: `node scripts/migrate-client-auth.js --backup <copia>` (no escribe nada). | Tú, conmigo | Dice «dry-run», cuántas cuentas crearía y avisos sin datos personales. |
| P5 | **[Autorización]** Permiso de Storage para leer Firestore (abajo). | Tú | Comprobación de solo lectura del final de la sección. |
| P6 | Comprobaciones en el iPhone real (lista al final). | Tú | Todo en verde. |

### P5. Permiso mínimo de Storage → Firestore

`storage.rules` lee la ficha del cliente (`firestore.get`) para saber si una foto o analítica es suya. Para eso, el agente de servicio de Storage necesita un rol que hoy **no tiene** (comprobado el 11-11-2026, solo lectura: tiene únicamente `roles/firebasestorage.serviceAgent`).

| | |
| --- | --- |
| Rol | `roles/firebaserules.firestoreServiceAgent` («Firebase Rules Firestore Service Agent»). Contiene **un solo permiso**: `datastore.entities.get` (leer un documento). Nada de escribir, listar ni administrar. Es el mínimo posible. |
| A quién | `service-<NÚMERO_DEL_PROYECTO>@gcp-sa-firebasestorage.iam.gserviceaccount.com` (cuenta gestionada por Google; el número lo da `gcloud projects describe appjorgecgcoach --format="value(projectNumber)"`). |
| Dónde | Proyecto `appjorgecgcoach` (Firestore solo admite permisos de proyecto; hay una sola base de datos). |
| Coste | Cada comprobación de Storage cuenta como una lectura de Firestore. Las reglas hacen una sola lectura por petición (máximo permitido: 2). |
| Sin él | El entrenador sigue funcionando (no lo necesita). Al cliente se le deniegan subir y ver por ruta sus fotos y analíticas. Los enlaces ya guardados con token siguen abriéndose. |

Forma recomendada: al desplegar las reglas definitivas, la CLI de Firebase pregunta si conceder el permiso. Responder **sí** solo a esa pregunta. Alternativa manual (la misma concesión, nada más):

```bash
gcloud projects add-iam-policy-binding appjorgecgcoach --member="serviceAccount:service-<NÚMERO>@gcp-sa-firebasestorage.iam.gserviceaccount.com" --role="roles/firebaserules.firestoreServiceAgent" --condition=None
```

Comprobación (solo lectura): debe listar `roles/firebasestorage.serviceAgent` y `roles/firebaserules.firestoreServiceAgent`, y nada más:

```bash
gcloud projects get-iam-policy appjorgecgcoach --flatten="bindings[].members" --format="value(bindings.role)" --filter="bindings.members:gcp-sa-firebasestorage"
```

Para retirarlo: primero quitar de `storage.rules` las llamadas a `firestore.get` (si no, todas las peticiones de Storage de clientes fallan) y después `gcloud projects remove-iam-policy-binding` con el mismo miembro y rol.

## La ventana (noche, unos 45 minutos)

| # | Paso | Tiempo |
| --- | --- | --- |
| F1 | Copia de la app («🛟 Copia → Descargar copia ahora») justo antes. | 2 min |
| F2 | **[Autorización]** Crear las cuentas de clientes: `migrate-client-auth.js --backup <copia de F1> --apply` con `ALLOW_AUTH_MIGRATION_APPLY=yes`. Después, `node scripts/verificar-vinculos.js --proyecto-real` (solo lee): 0 problemas. | 5 min |
| F3 | **[Autorización]** Fusionar el PR #11 en `main` (web con `AUTH_ENABLED = true`). Esperar a que GitHub Pages la publique y comprobar byte a byte. Anotar ese commit como «última web buena con Auth». | 5–10 min |
| F4 | **[Autorización]** Enseguida, reglas definitivas de Firestore y Storage. Justo después, otra vez `verificar-vinculos.js --proyecto-real`: 0 problemas. | 3 min |
| F5 | Entrenador: entrar con Google en el ordenador, crear la contraseña de respaldo («🛟 Copia → 🔐 Acceso de respaldo»). | 5 min |
| F6 | Cliente de prueba y comprobaciones sin sesión (abajo). | 10 min |
| F7 | Seguimiento 24–48 h: consola → Firestore → Uso, sin picos de «permiso denegado»; Authentication → Usuarios. | — |

## Qué pasa entre fases, y cómo parar o volver atrás en cada una

| Entre… | Exposición | Bloqueos posibles | Parar o volver atrás (sin abrir) |
| --- | --- | --- | --- |
| **Antes de F2** | La de hoy: las reglas de producción siguen abiertas. No cambia nada. | — | — |
| **F2 → F3** (cuentas creadas, web antigua, reglas abiertas) | La de hoy, más una nueva: con las fichas abiertas, alguien podría escribir en una ficha el uid de una cuenta suya y **conservar el acceso tras F4**. Por eso `verificar-vinculos.js` en F2 y otra vez justo después de F4 (lo que se cuele entre medias aparece en la segunda). `authUid` en sí no es secreto: sin el código no sirve. | Ninguno: la web antigua ignora `authUid`. | Parar aquí es seguro: se puede dejar días. Repetir F2 no duplica nada. Deshacer no hace falta; si se quisiera, borrar las cuentas en Authentication y el campo `authUid` (no lo recomiendo). |
| **F3 → F4** (web nueva publicada, reglas aún abiertas) | La misma de hoy, durante los minutos que tarda Pages. **Por eso F4 va enseguida.** El catálogo de vídeos no se puede escribir hasta F4 (se reintenta solo). | Un cliente sin cuenta (código nuevo después de F1) no entra con la web nueva: el entrenador guarda otra vez su código. | Volver a la web anterior es seguro **solo en esta fase** (las reglas siguen como hoy). |
| **F4 en adelante** (reglas definitivas) | Ninguna para anónimos. Cada cliente ve solo su ficha; el entrenador, todo. | Móviles con la web antigua abierta sin recargar: no pueden leer ni guardar; lo pendiente queda en el dispositivo y se sube al recargar y entrar con su código. Un cliente cuya cuenta no se creó: «Código no válido» → el entrenador guarda otra vez su código. | Ver tabla siguiente. **No** volver a la web sin Auth: con las reglas cerradas no carga (no abre nada, pero deja a todos sin app). |

| Síntoma tras F4 | Qué se hace | Tiempo |
| --- | --- | --- |
| La app de los clientes estropea datos (p. ej. vacía series). | Desplegar `firestore.congelado.rules`. Los clientes siguen viendo su programa; lo que guarden se queda en su dispositivo. Arreglar la web, publicarla y volver a las definitivas. | 2 min |
| Un cliente no puede guardar algo legítimo («permiso denegado»). | Si es uno: «Volver a entrar» en su aviso. Si son muchos: parada (fila anterior) mientras se arregla la app; **no** relajar los campos del entrenador. | 2 min |
| Un cliente no puede entrar con su código. | Entrenador: «Código de acceso» → guardar su código otra vez. O repetir F2. | 1 min |
| Google no entra en el iPhone. | Contraseña de respaldo (F5). La app la propone sola si Google vuelve sin sesión. | 1 min |
| El entrenador no puede entrar de ninguna forma. | Desde el ordenador con Google. Los clientes siguen funcionando; los datos siguen protegidos. | — |
| Fallo de pantallas o botones de la web nueva. | Arreglo en `main`, o volver a publicar la «última web buena con Auth». | 10 min |
| Fotos del cliente fallan. | Falta P5: conceder el rol (un único permiso de lectura). El entrenador no se ve afectado. | 2 min |
| Datos dañados o borrados. | Parada + restauración aditiva desde la copia verificada, con autorización expresa. | 15–30 min |

**No usar** el historial de reglas de la consola para «volver a la versión anterior»: la anterior es la abierta.

### Comprobaciones de F6

1. Sin sesión, solo lectura: `coach_data` → 403, listar `clients` → 403, foto por ruta sin token → 403. Si algo da 200, revisar qué reglas están publicadas y volver a desplegar las definitivas.
2. Entrenador: inicio, clientes, Negocio, Biblioteca, una ficha; un cambio pequeño.
3. Cliente de prueba: entra con su código, ve su programa y sus vídeos, guarda una serie; recargar no pide el código.

## Migración: garantías

- **Repetible:** cuentas existentes se reutilizan; repetir no crea duplicados ni cambia fichas ya vinculadas, ni cierra sus sesiones.
- **Con lo de ahora, no con la copia:** solo se usan códigos que siguen valiendo hoy (`coach_data.codes` o el campo `code` de la ficha). Un código cambiado o quitado después de la copia no crea cuenta ni da acceso. Una ficha borrada no se vuelve a crear. Un `authUid` puesto después por el entrenador no se pisa.
- **Cuentas creadas antes por otra persona** (el alta de Firebase es pública): si existe la cuenta de un código y aún no está vinculada, se le pone la contraseña del código y se cierran sus sesiones antes de vincularla. Cuentas con otro proveedor (p. ej. Google) con ese correo: no se vinculan y se avisa.
- **Fallo parcial:** la ficha que falla no recibe `authUid` (sin vínculo, las cuentas no dan acceso a nada); las demás siguen; el comando termina con código 3 y basta repetirlo.
- Pruebas: `npm run test:migracion` (emulador).

## iPhone: comprobaciones reales (P6 y F5)

Con la web publicada en F3–F4 (no antes: hasta entonces no hay Auth). Cada línea, en **Safari** y en la **app de la pantalla de inicio**:

1. Entrenador con Google: entra y ve sus clientes. En la app de inicio, si vuelve a la pantalla de acceso, debe salir el aviso y abrirse el respaldo (no quedarse callada).
2. Entrenador con contraseña de respaldo (creada en F5 desde el ordenador): entra.
3. Cerrar la app del todo y volver a abrir: sigue dentro, sin pedir nada.
4. Cliente de prueba con su código: entra y ve su programa y los vídeos.
5. Guardar una serie; cerrar la app del todo; volver a abrir: la serie está. Verla también desde el ordenador del entrenador.
6. Modo avión: guardar una serie → aviso rojo «no están guardados». Quitar modo avión → el aviso desaparece solo y la serie está en el ordenador.
7. «Cerrar sesión» y volver a entrar con el código: la serie sigue.
8. Otro código inventado: «Código no válido».

Nota: Safari borra los datos de una web que no se abre en 7 días (la app de inicio, no). Un cliente que solo use Safari y no entre en una semana tendrá que volver a escribir su código; no pierde nada guardado en la nube.
