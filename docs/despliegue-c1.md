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
| P4 | Ensayo de la migración con la copia: `node scripts/migrate-client-auth.js --backup <copia>` (no escribe nada). | Tú, conmigo | Dice «dry-run», cuántas fichas recibirán código nuevo y cuáles irían «a revisar», sin datos personales. |
| P5 | Permiso de Storage para leer Firestore (abajo). **No se concede antes:** se hace en F4, tras comprobar la identidad exacta del agente de servicio y sus roles actuales. | Tú, en F4 | Comprobación de solo lectura del final de la sección. |
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

Los clientes **cambian de código**: los de hoy (a menudo un documento de identidad) se pueden adivinar y no se migran. Cada ficha recibe un código aleatorio nuevo (12 símbolos, `XXXX-XXXX-XXXX`) que el entrenador entrega después. **Avisar a los clientes antes** de que esa noche cambiará su código y que lo recibirán por el canal habitual.

| # | Paso | Tiempo |
| --- | --- | --- |
| F1 | Copia de la app («🛟 Copia → Descargar copia ahora») justo antes. `node scripts/verificar-vinculos.js --proyecto-real` (solo lee): anotar si alguna ficha ya trae cuentas (no debería). | 3 min |
| F2 | Cerrar la app del entrenador en **todos** los dispositivos (para que ninguno vuelva a escribir la lista de códigos antigua). | 1 min |
| F3 | **[Autorización]** Fusionar el PR #11 en `main` (web con `AUTH_ENABLED = true`). Esperar a que GitHub Pages la publique y comprobar byte a byte. Anotar ese commit como «última web buena con Auth». | 5–10 min |
| F4 | **[Autorización]** Enseguida, reglas definitivas de Firestore y Storage. Al desplegar Storage, comprobar antes la identidad exacta del agente de servicio y conceder solo el rol de P5. | 3 min |
| F5 | **[Autorización]** Migración: `node scripts/migrate-client-auth.js --comprobar` (solo lee) y, si cuadra, `--apply` con `ALLOW_AUTH_MIGRATION_APPLY=yes`. **Después de F4, nunca antes:** con las reglas abiertas cualquiera podría leer los códigos nuevos. Luego `verificar-vinculos.js --proyecto-real`: 0 problemas. Las fichas «a revisar» se quedan sin acceso hasta decidir a mano. | 5 min |
| F6 | Entrenador: entrar con Google en el ordenador, crear la contraseña de respaldo («🛟 Copia → 🔐 Acceso de respaldo»). Abrir «Código de acceso» de cada cliente y entregarle su código nuevo. | 10 min + entregas |
| F7 | Cliente de prueba y comprobaciones sin sesión (abajo). | 10 min |
| F8 | Seguimiento 24–48 h: consola → Firestore → Uso, sin picos de «permiso denegado»; Authentication → Usuarios (no deben aparecer cuentas nuevas que no sean del entrenador). | — |

## Qué pasa entre fases, y cómo parar o volver atrás en cada una

| Entre… | Exposición | Bloqueos posibles | Parar o volver atrás (sin abrir) |
| --- | --- | --- | --- |
| **Antes de F3** | La de hoy: las reglas de producción siguen abiertas. No se ha escrito nada. | — | Nada que deshacer. |
| **F3 → F4** (web nueva publicada, reglas aún abiertas) | La misma de hoy, durante los minutos que tarda Pages. **Por eso F4 va enseguida.** Alguien podría escribir en una ficha el uid de una cuenta suya: la migración (F5) **no la acepta** (solo valen cuentas creadas por ella, con su marca `jcgCliente`) y `verificar-vinculos` la señala. | Ningún cliente entra todavía (aún no hay cuentas). | Volver a la web anterior es seguro **solo en esta fase** (las reglas siguen como hoy). |
| **F4 → F5** (reglas definitivas, sin cuentas) | Ninguna para anónimos. | Los clientes no pueden entrar hasta F5–F6 (esperado: están avisados). | Parar aquí es seguro; la migración se puede hacer otro día. |
| **F5 en adelante** | Ninguna para anónimos. Cada cliente ve solo su ficha; el entrenador, todo. | Clientes que aún no tienen su código nuevo. Fichas «a revisar». Móviles con la web antigua: no pueden leer ni guardar; lo pendiente queda en el dispositivo y se sube al entrar con el código nuevo. | Ver tabla siguiente. **No** volver a la web sin Auth: con las reglas cerradas no carga. Repetir la migración es seguro: no crea duplicados ni cambia códigos ya dados. |

| Síntoma tras F4 | Qué se hace | Tiempo |
| --- | --- | --- |
| La app de los clientes estropea datos (p. ej. vacía series). | Desplegar `firestore.congelado.rules`. Los clientes siguen viendo su programa; lo que guarden se queda en su dispositivo. Arreglar la web, publicarla y volver a las definitivas. | 2 min |
| Un cliente no puede guardar algo legítimo («permiso denegado»). | Si es uno: «Volver a entrar» en su aviso. Si son muchos: parada (fila anterior) mientras se arregla la app; **no** relajar los campos del entrenador. | 2 min |
| Un cliente no puede entrar con su código. | Comprobar que usa el código **nuevo**. Si no: entrenador → «Código de acceso» → 🎲 generar otro y guardar (crea su cuenta y quita las anteriores). | 1 min |
| Una ficha sale «a revisar». | No tocarla con prisa: se queda sin acceso de cliente, sin borrar nada. Mirar en Authentication qué cuentas tiene; si no son claramente de ese cliente, el entrenador le genera un código nuevo (eso deja **solo** la cuenta nueva en la ficha). Las cuentas ajenas se pueden desactivar a mano después. | 5 min |
| Google no entra en el iPhone. | Contraseña de respaldo (F6). La app la propone sola si Google vuelve sin sesión. | 1 min |
| El entrenador no puede entrar de ninguna forma. | Desde el ordenador con Google. Los clientes siguen funcionando; los datos siguen protegidos. | — |
| Fallo de pantallas o botones de la web nueva. | Arreglo en `main`, o volver a publicar la «última web buena con Auth». | 10 min |
| Fotos del cliente fallan. | Falta P5: conceder el rol (un único permiso de lectura). El entrenador no se ve afectado. | 2 min |
| Datos dañados o borrados. | Parada + restauración aditiva desde la copia verificada, con autorización expresa. | 15–30 min |

**No usar** el historial de reglas de la consola para «volver a la versión anterior»: la anterior es la abierta.

### Comprobaciones de F7

1. Sin sesión, solo lectura: `coach_data` → 403, listar `clients` → 403, foto por ruta sin token → 403. Si algo da 200, revisar qué reglas están publicadas y volver a desplegar las definitivas.
2. Entrenador: inicio, clientes, Negocio, Biblioteca, una ficha; un cambio pequeño.
3. Cliente de prueba: entra con su código, ve su programa y sus vídeos, guarda una serie; recargar no pide el código.

## Migración: garantías

- **Códigos nuevos, aleatorios:** 12 símbolos de base32 Crockford generados con el generador criptográfico (60 bits). Ningún código de hoy se reutiliza ni se le añade un sufijo; los antiguos se quitan de `coach_data.codes` y dejan de servir. Los códigos no se imprimen: se ven en la app del entrenador.
- **No se fía de ninguna cuenta que ya exista.** El alta de Firebase es pública, así que una cuenta previa pudo crearla cualquiera:
  - ficha que ya trae `authUid`/`authUids` y alguna cuenta no lleva la marca `jcgCliente` de **esa** ficha (marca que solo puede poner el Admin SDK) o tiene otro proveedor → **a revisar**, sin tocarla;
  - si ya existe una cuenta para el código recién generado → **a revisar**, sin usar esa cuenta;
  - nunca borra, desactiva ni reasigna cuentas, ni cambia contraseñas. Termina con código 3 si hay algo a revisar.
- **Repetible:** las fichas ya migradas (cuentas con su marca) se saltan; repetir no crea cuentas, no cambia códigos ni cierra sesiones.
- **Con lo de ahora, no con la copia:** lee la base de datos en el momento; una ficha borrada no se vuelve a crear; si el entrenador vincula una ficha mientras corre, no se pisa (transacción).
- **Fallo parcial:** la ficha que falla no recibe código ni `authUid` (la cuenta suelta que pudo quedar no tiene código conocido ni ficha: no da acceso a nada); las demás siguen; basta repetirlo.
- **Altas posteriores desde la app** (cliente nuevo o código regenerado): solo aceptan códigos generados; si la cuenta ya existiera, se rechaza y se pide otro código; la ficha queda con **solo** la cuenta nueva. Estas cuentas no llevan la marca (la web no puede ponerla): por eso la migración se ejecuta una sola vez y el control continuo es `verificar-vinculos.js`.
- Pruebas: `npm run test:migracion` (emulador, 10 casos) y `shared/alta-codigo.test.js`.

## Adivinar códigos: límites y protecciones

- **Lo que Firebase limita:** solo por IP (`auth/too-many-requests`). Cada intento de código es un correo distinto, así que no hay bloqueo por cuenta. Un atacante con muchas IP puede probar mucho.
- **Por eso el código tiene que ser imposible de adivinar, no «difícil»:** un DNI tiene del orden de 10^8 combinaciones (y muchos se conocen); un código de 60 bits, unos 10^18. A mil intentos por segundo, sostenidos, harían falta unos 360.000 años de media para acertar *alguno* de 100 clientes. Ningún límite de intentos es necesario para que esto se cumpla.
- **Protección de enumeración de correos activa** (P2): el inicio de sesión no dice si una cuenta existe.
- **Opcional, compatible con los clientes:**
  - App Check (reCAPTCHA Enterprise, invisible) en Auth y Firestore: frena scripts fuera de la web. Primero en modo «supervisar» una semana, luego «aplicar». En iPhone funciona en Safari y en la app de inicio.
  - Verificación en dos pasos en la cuenta de Google del entrenador (la que más vale).
  - Mantener el alta pública abierta es necesario porque la web crea las cuentas de los clientes; desactivarla obligaría a crearlas con un script en el PC cada vez.

## iPhone: comprobaciones reales (P6, F6 y F7)

Con la web publicada en F3–F4 (no antes: hasta entonces no hay Auth). Cada línea, en **Safari** y en la **app de la pantalla de inicio**:

1. Entrenador con Google: entra y ve sus clientes. En la app de inicio, si vuelve a la pantalla de acceso, debe salir el aviso y abrirse el respaldo (no quedarse callada).
2. Entrenador con contraseña de respaldo (creada en F6 desde el ordenador): entra.
3. Cerrar la app del todo y volver a abrir: sigue dentro, sin pedir nada.
4. Cliente de prueba con su código nuevo: entra y ve su programa y los vídeos. Escribirlo en minúsculas o sin guiones también entra.
5. Guardar una serie; cerrar la app del todo; volver a abrir: la serie está. Verla también desde el ordenador del entrenador.
6. Modo avión: guardar una serie → aviso rojo «no están guardados». Quitar modo avión → el aviso desaparece solo y la serie está en el ordenador.
7. «Cerrar sesión» y volver a entrar con el código: la serie sigue.
8. Otro código inventado: «Código no válido».

Nota: Safari borra los datos de una web que no se abre en 7 días (la app de inicio, no). Un cliente que solo use Safari y no entre en una semana tendrá que volver a escribir su código; no pierde nada guardado en la nube.
