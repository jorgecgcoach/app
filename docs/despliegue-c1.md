# C1: despliegue seguro y vuelta atrás sin abrir Firestore

Procedimiento para activar el acceso con cuenta (Firebase Auth) y las reglas estrictas. Cada paso marcado **[Autorización]** se hace solo con un «sí» expreso del dueño para ese paso. No contiene UID, códigos, PIN ni credenciales: el UID real vive solo en `config/uid-entrenador.txt` (ignorado por git).

**Regla de oro: en ningún caso se vuelve a desplegar `allow read, write: if true`.** Si algo falla, se usan las salidas de «Parar o volver atrás en cada fase», que mantienen la base cerrada a quien no ha iniciado sesión.

## Archivos de reglas

| Archivo | Para qué | Clientes | Anónimos |
| --- | --- | --- | --- |
| `firestore.rules` + `storage.rules` | Definitivas. | Leen y escriben su ficha, salvo los campos del entrenador. | Nada |
| `firestore.congelado.rules` | **Parada de emergencia.** Si la app de los clientes escribe algo mal y hay que pararlo ya. | Solo leen su ficha; no escriben nada. Lo que guarden queda en su dispositivo y se sube al volver a las definitivas. | Nada |
| `firestore.transicion.rules` | Fichas abiertas como hoy + catálogo. **No se usa**; solo referencia. | — | Todo, como hoy |

**Guardia `_rev` en las tres** (añadida el 11-11-2026): producción tiene desde el 07-11-2026 una regla que solo acepta escrituras en `clients/*` con `_rev` = anterior + 1, para que una pestaña o app con datos viejos no sobrescriba lo nuevo. Las reglas de C1 no la tenían: publicarlas la habría quitado. Ahora la llevan las definitivas, la parada y la de transición. Pruebas: `firestore/rules.test.js`, `firestore/congelado.test.js`, `scripts/conservacion-emulador.test.js`.

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
| P1 | Copia completa real, cifrada, en el PC y en el USB, verificada. | **Hecha el 10-11-2026 21:56** (`copias-c16-11-10_215547.jcgenc` y duplicado en el USB, idénticos). Se repite en F1. | `copia-cifrada.js comprobar` en las dos. |
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
| F1 | **[Autorización]** Copia completa real cifrada justo antes (solo lectura, con `copias-lector`): `node scripts/copia-completa.js --proyecto-real --destino C:JorgeCGCoach-recuperacioncopias-c1 --duplicar D:JorgeCGCoach-Backup --cifrar C:JorgeCGCoach-recuperacionclaves-copiasclave-publica.json` (rama `copias/copia-real`). Comprobar que dice ÍNTEGRA y que los recuentos no bajan respecto a la anterior. Además, copia de la app («🛟 Copia → Descargar copia ahora»). `node scripts/verificar-vinculos.js --proyecto-real` (solo lee): anotar si alguna ficha ya trae cuentas (no debería). | 3 min |
| F2 | Cerrar la app del entrenador en **todos** los dispositivos (para que ninguno vuelva a escribir la lista de códigos antigua). | 1 min |
| F3 | **[Autorización]** Fusionar el PR #11 en `main` (web con `AUTH_ENABLED = true`. **Camino mínimo, sin Blaze:** `ALTAS_SERVIDOR = false`, las altas se hacen desde el navegador del entrenador. La opción C, `ALTAS_SERVIDOR = true`, solo si antes se ha desplegado; ver `docs/altas-servidor.md`). Esperar a que GitHub Pages la publique y comprobar byte a byte. Anotar ese commit como «última web buena con Auth». | 5–10 min |
| F4 | **[Autorización]** Enseguida, reglas definitivas de Firestore y Storage. Al desplegar Storage, comprobar antes la identidad exacta del agente de servicio y conceder solo el rol de P5. | 3 min |
| F5 | **[Autorización]** Migración. 1) `node scripts/migrate-client-auth.js --comprobar` y `--simular-aislar` (las dos solo leen): el informe dice cuántas fichas y cuentas perderían el acceso, por qué, y una huella. 2) **Revisas el informe y decides.** 3) Con tu «sí», `--apply` con `ALLOW_AUTH_MIGRATION_APPLY=yes`, y solo si apruebas aislar, `--aislar --confirmar-aislar=<huella>` (decisión D2: sin la huella, o si algo cambió desde la simulación, no se aísla nada; solo vale en la primera ejecución). **Después de F4, nunca antes:** con las reglas abiertas cualquiera podría leer los códigos nuevos. Luego `verificar-vinculos.js --proyecto-real`: 0 problemas. Con `--aislar`, las fichas «a revisar» se quedan sin acceso hasta decidir a mano. | 5 min |
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
| Una ficha sale «a revisar». | No tocarla con prisa. Con `--aislar` ya no tiene acceso de cliente (las cuentas dudosas quedan anotadas en `cuentasEnRevision`); sin él, **la cuenta dudosa sigue entrando** hasta que el entrenador le dé código nuevo. No se borra nada. Mirar en Authentication qué cuentas tiene; si no son claramente de ese cliente, el entrenador le genera un código nuevo (eso deja **solo** la cuenta nueva en la ficha). Las cuentas ajenas se pueden desactivar a mano después. | 5 min |
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
- **`--aislar` (opcional, recomendado):** en las fichas con cuentas dudosas mueve `authUid`/`authUids` a `cuentasEnRevision`: esas cuentas pierden el acceso a la ficha, pero no se borran, no se desactivan y no se asignan a nadie. La ficha no se migra; queda a revisar. Antes hay que ejecutar `--simular-aislar` (solo lee: fichas y cuentas afectadas, motivos, fechas, sin uids ni correos) y pasar su huella con `--confirmar-aislar`; si algo cambia entre medias, no se aplica nada. Solo se puede usar en la primera ejecución (después, las cuentas creadas desde la app, que no llevan la marca, parecerían dudosas).
- **Nada en claro fuera de Firestore:** la salida solo lleva ids de ficha, conteos y códigos de error técnicos (nunca el mensaje del error); no escribe archivos. Probado ejecutando la consola contra los emuladores y buscando en la salida códigos, correos, uids y nombres.
- Pruebas: `npm run test:migracion` (emuladores, 16 casos: migración y apropiación) y `shared/alta-codigo.test.js` (15 casos).

## Adivinar códigos: límites y protecciones

- **Lo que Firebase limita:** solo por IP (`auth/too-many-requests`). Cada intento de código es un correo distinto, así que no hay bloqueo por cuenta. Un atacante con muchas IP puede probar mucho.
- **Por eso el código tiene que ser imposible de adivinar, no «difícil»:** un DNI tiene del orden de 10^8 combinaciones (y muchos se conocen); un código de 60 bits, unos 10^18. A mil intentos por segundo, sostenidos, harían falta unos 360.000 años de media para acertar *alguno* de 100 clientes. Ningún límite de intentos es necesario para que esto se cumpla.
- **Protección de enumeración de correos activa** (P2): el inicio de sesión no dice si una cuenta existe.
- **Opcional, compatible con los clientes:**
  - App Check (reCAPTCHA Enterprise, invisible) en Auth y Firestore: frena scripts fuera de la web. Primero en modo «supervisar» una semana, luego «aplicar». En iPhone funciona en Safari y en la app de inicio.
  - Verificación en dos pasos en la cuenta de Google del entrenador (la que más vale).
  - Sobre el alta pública: ver «Registro público de cuentas» más abajo (decisión D1).
- **Entropía comprobada** (`auth/code-identity.test.js`): generador criptográfico (nunca el aleatorio normal de JavaScript; sin él no se genera nada); cada byte se recorta a 5 bits y 256 es múltiplo de 32, así que no hay sesgo (prueba chi-cuadrado por posición con 64.000 códigos); sin colisiones en 200.000 (probabilidad teórica ~2·10⁻⁸).
- **La normalización no resta seguridad:** solo se reinterpretan O→0 e I/L→1, y O, I, L y U no están en el alfabeto, así que nunca se juntan dos códigos válidos; el espacio sigue siendo 32¹². Un código incompleto o con un símbolo de más no se completa ni se recorta.
- **Solo códigos generados, de verdad:** la app ya no acepta un texto de 12 símbolos tecleado a mano aunque tenga el formato (tendría el formato, no la entropía). Solo vale un código generado con 🎲 en ese dispositivo, una vez, y los campos de código son de solo lectura con Auth.
- **El correo de la cuenta es un hash rápido del código** (SHA-256). Solo serviría para adivinar códigos fuera de línea a quien tuviera la lista de usuarios de Authentication, y quien la tiene (un administrador del proyecto) ya puede leer los códigos en Firestore. No se cambia.

## Altas desde el navegador del entrenador

Orden seguro, probado en `shared/alta-codigo.test.js` con las funciones reales de la app:

1. Se valida el código: generado en este dispositivo, sin usar y sin dueño.
2. Se comprueba contra el servidor que la sesión del entrenador sigue viva. Si caducó, no se crea nada: «Vuelve a entrar y repítelo».
3. Se crea la cuenta en una segunda instancia de Auth (la sesión del entrenador no cambia). Si ya existía —otra persona conocía el código y se adelantó, o una respuesta perdida de un intento anterior— **no se usa**: hay que generar otro código.
4. Solo entonces, y en el mismo guardado, se cambian el código y las cuentas de la ficha (queda **solo** la cuenta nueva).

Si algo falla antes del paso 4 (red, cuenta existente, sesión caducada, ficha borrada mientras tanto), la ficha queda como estaba y el código anterior sigue funcionando. Un solo alta a la vez (la doble pulsación se rechaza). Si falla el guardado del paso 4, el guardado seguro lo reintenta y, si la sesión caducó, lo sube tras «Volver a entrar». La cuenta suelta que pueda quedar no tiene ficha ni un código entregado: no da acceso a nada.

## Reducir el tiempo sin acceso (F4–F6) y recuperar clientes

**Cuánto dura:** desde que Pages publica la web nueva (F3) hasta que el cliente recibe su código. F3→F5 son 10–15 minutos si se hacen seguidos; lo que más tarda es la entrega (F6).

Antes de la noche:

- Avisar a los clientes 2–3 días antes (fecha y hora, y que recibirán un código nuevo por el canal habitual). Lo que registren esa noche sin conexión se queda en su móvil y se sube al entrar con el código nuevo.
- Elegir una hora sin entrenamientos y tener preparada la plantilla del mensaje.
- P1 (copia real cifrada y verificada) y los ensayos P3–P4 hechos: así F4 y F5 son dos comandos ya probados. Credenciales para F5 preparadas en el PC (fuera del repositorio) y `--comprobar` ensayado.

La noche: F3, F4 y F5 seguidos, sin pausas. Entregar primero a quien entrena a primera hora.

Si un cliente no recibe o pierde su código:

- Si entra con el antiguo, la app le dice que los códigos han cambiado y que lo pida a su entrenador.
- Entrenador → «Código de acceso»: el código vigente se ve ahí y se puede **reenviar tal cual** (no hace falta cambiarlo).
- Si se ha perdido o pudo verlo otra persona: 🎲 generar otro y guardar. La cuenta anterior deja de entrar en ese mismo momento.
- Si F5 no puede terminar (credenciales, cuota…): la app del entrenador da acceso cliente a cliente con 🎲, sin la migración. Si después se repite la migración, esas fichas salen «a revisar» y no se tocan; en ese caso no usar `--aislar` (el script lo impide si ya hay fichas migradas, pero no distingue las activadas desde la app).

## Registro público de cuentas (decisión D1)

Hoy cualquiera puede crear una cuenta de correo y contraseña en el proyecto (lo necesita la web para dar de alta a los clientes). Probado en el emulador con las reglas definitivas: una cuenta así **no lee ni escribe ninguna ficha, ni el meta, ni puede listar**, y no puede apropiarse de una ficha; **sí puede leer el catálogo de ejercicios** (`catalog/exercises`). Además puede ensuciar la lista de usuarios.

| Opción | Superficie | Coste | Qué cambia |
| --- | --- | --- | --- |
| A. Mantener el alta pública (lo preparado) | Cuentas vacías de cualquiera; catálogo legible. | Ninguno. | Nada. Razonable solo con App Check en «aplicar». |
| B. Cerrar el alta y dar de alta desde el PC | Ninguna alta pública. Todas las cuentas llevarían la marca y las reglas podrían exigirla: una cuenta plantada en una ficha no serviría de nada. | Cada cliente nuevo o código cambiado necesita el PC y un script. Cerrar el alta exige pasar a «Firebase Authentication con Identity Platform» (comprobar en la consola el interruptor y los límites del plan gratuito). | Script de altas, reglas por marca, la app deja de crear cuentas. |
| C. Cerrar el alta y dar de alta con una función en el servidor | Igual que B. | Plan Blaze (tarjeta; el uso entraría en la capa gratuita). | Una función que solo acepta al entrenador. La entrada de los clientes no se ralentiza: la función solo actúa en las altas. |

**Decisión (11-11-2026): opción C**, si se confirma su viabilidad. Preparada y probada en emuladores, sin desplegar: viabilidad, compatibilidad, coste y aprobaciones en [`docs/altas-servidor.md`](altas-servidor.md).

## Dónde pueden quedar códigos en claro

- **Migración:** en ningún sitio fuera de Firestore (probado).
- **Firestore** (`coach_data.codes` y `code` de cada ficha): necesario para que el entrenador pueda reenviarlos; solo los lee el entrenador (y cada cliente el suyo).
- **«Descargar copia» de la app:** hoy incluye todos los códigos y el PIN antiguo, sin cifrar. **Decisión D3 (hecha, activa con C1):** con `AUTH_ENABLED`, la descarga habitual ya no lleva el PIN, ni la lista de códigos, ni el código de cada ficha; todo lo demás sigue (`shared/descarga-copia.test.js`). Restaurar desde la app nunca usaba PIN ni códigos, así que se restaura igual.
- **Copia administrativa completa (con códigos):** la del PC, `copia-completa --cifrar` (AES-256-GCM; se abre con la contraseña de la llave o con el código de recuperación en papel), en el PC y en el USB. Es la que se usa si hubiera que recuperar un código o el estado completo de `coach_data`.
- Copias antiguas: los códigos de hoy dejan de valer tras F5.

## iPhone: comprobaciones reales (P6, F6 y F7)

Con la web publicada en F3–F4 (no antes: hasta entonces no hay Auth). Cada línea, en **Safari** y en la **app de la pantalla de inicio**:

1. Entrenador con Google: entra y ve sus clientes. En la app de inicio, si vuelve a la pantalla de acceso, debe salir el aviso y abrirse el respaldo (no quedarse callada).
2. Entrenador con contraseña de respaldo (creada en F6 desde el ordenador): entra.
3. Cerrar la app del todo y volver a abrir: sigue dentro, sin pedir nada.
4. Cliente de prueba con su código nuevo: entra y ve su programa y los vídeos. Escribirlo en minúsculas o sin guiones también entra.
5. Guardar una serie; cerrar la app del todo; volver a abrir: la serie está. Verla también desde el ordenador del entrenador.
6. Modo avión: guardar una serie → aviso rojo «no están guardados». Quitar modo avión → el aviso desaparece solo y la serie está en el ordenador.
7. «Cerrar sesión» y volver a entrar con el código: la serie sigue.
8. Otro código inventado: «Código no válido». Un código antiguo (p. ej. el DNI): «Los códigos de acceso han cambiado…», sin llegar a enviarlo a Firebase.

Nota: Safari borra los datos de una web que no se abre en 7 días (la app de inicio, no). Un cliente que solo use Safari y no entre en una semana tendrá que volver a escribir su código; no pierde nada guardado en la nube.
