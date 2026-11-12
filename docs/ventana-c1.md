# C1: ventana de publicación (orden exacto)

Cada paso **[Autorización]** se ejecuta solo con un «sí» expreso para ESE paso. Si un paso falla, se para y se sigue la columna «Si falla». **Nunca** se vuelven a abrir las reglas (`if true`). Detalle técnico y tablas de riesgo: `docs/despliegue-c1.md`.

## Lo que preparas tú (antes del día)

1. **Elegir la noche** (sugerido: domingo a partir de las 22:00, unos 60 minutos más las entregas).
2. **Enviar el aviso** a los clientes (texto abajo) 2–3 días antes y repetirlo la misma tarde.
3. Tener **a mano**: el portátil con el disco USB conectado, el iPhone, Bitwarden abierto (la contraseña de la llave está en «Clave de autenticador» de «Copias JorgeCGCoach.») y tu cuenta de Google.
4. Pensar una **contraseña de respaldo** para tu cuenta de entrenador (mínimo 12 caracteres) y crear para ella un elemento NUEVO en Bitwarden, en el campo **Contraseña**: «Respaldo entrenador JorgeCGCoach».
5. La tarde de antes, **no editar** nada en la app del entrenador desde el móvil (solo el portátil esa noche).

## Orden de publicación

| # | Paso | Quién | Comprobación | Si falla |
| --- | --- | --- | --- | --- |
| F0 | Ensayo final, solo lectura: `--comprobar` → 23 cuentas reales, «demo» excluida, 0 a revisar; todas las pruebas en verde; reglas generadas con tu UID y huellas anotadas. | Yo | Recuentos iguales al ensayo P4 (salvo fichas nuevas). | No se sigue: nada publicado. |
| F1 | **[Autorización]** Copia real cifrada nueva (solo lectura), temporales en D:, duplicado en C:, y comprobación con la ventana visual (contraseña de Bitwarden o código de papel). | Yo + tú pegas la contraseña | ÍNTEGRA; se descifra en C: y D:; recuentos ≥ los de la anterior. | No se sigue sin copia verificada. |
| F2 | Cerrar la app del entrenador en **todos** los dispositivos salvo el portátil. | Tú | — | — |
| F3 | **[Autorización]** Publicar la web con acceso por cuenta (PR #11 a `main`; `AUTH_ENABLED=true`, `ALTAS_SERVIDOR=false`). Esperar a GitHub Pages y comprobar que sirve exactamente esa versión. **Las reglas siguen como hoy**: aún no hay nada cerrado. | Yo | La web pide entrar; el código antiguo de un cliente da «Los códigos de acceso han cambiado…». | Volver a publicar la web anterior (seguro solo en esta fase). |
| F3a | **Tu acceso con Google, ANTES de cerrar nada**: en el portátil, «Entrar con Google» → ves tus clientes. | Tú | Entras como entrenador. | Paramos aquí; la web anterior se vuelve a publicar. Nada cerrado. |
| F3b | **Contraseña de respaldo**: en el portátil, «🛟 Copia → 🔐 Acceso de respaldo», pegar la contraseña de Bitwarden dos veces. | Tú | «Acceso de respaldo listo». | Si pide volver a entrar con Google, salir, entrar y repetir. |
| F3c | **iPhone**: abrir la web (Safari y la app de inicio) → «Entrar con Google». Después «Cerrar sesión» → entrar con **correo + contraseña de respaldo** (copiada de Bitwarden). | Tú | Entras de las dos formas. | Si Google falla en el iPhone pero el respaldo funciona: se sigue (el respaldo es la salida). Si fallan los dos: paramos y volvemos a la web anterior. |
| F4 | **[Autorización]** `firebase login` (lo abres tú en el navegador) y desplegar las reglas definitivas de Firestore y Storage **desde `reglas-despliegue/`**, con la huella comprobada. Conceder a Storage solo el rol de lectura de P5 tras verificar su identidad. | Yo + tú | Al momento: tú sigues dentro en el portátil y en el iPhone; sin sesión, `coach_data` y la lista de fichas dan «permiso denegado». | Tú no entras: regenerar las reglas con el UID correcto y volver a desplegar (2 min; mientras, todo sigue cerrado). Un fallo de la app que estropee datos: reglas de parada (`firestore.congelado.rules`). |
| F5 | **[Autorización]** Migración. 1) Permiso temporal **mínimo** a `firestore-recuperador` (sección «Permiso temporal de F5»). 2) `--comprobar` y `--simular-aislar` (solo leen). 3) `--apply`. 4) `verificar-vinculos --sin-vincular`: 0 problemas. 5) **Retirar el permiso temporal** y comprobar que ya no está. | Yo | 23 fichas con código nuevo y cuenta; «demo» sin tocar; 0 a revisar; 0 errores. | Sección «Si la migración se corta». Fichas «a revisar»: no se tocan; se decide a mano. |
| F6 | Entregar los códigos (procedimiento abajo). | Tú | Cada cliente entra. | Código que no funciona: «Código de acceso» → 🎲 generar otro → guardar → entregar el nuevo. |
| F7 | Cliente de prueba en el iPhone: entrar con un código, guardar una serie, cerrar y abrir la app, verla en el portátil; modo avión y vuelta. | Tú | Lista P6 de `despliegue-c1.md`. | Ver tabla «Síntoma tras F4». |
| F8 | Seguimiento 24–48 h: Firestore → Uso (sin picos de «permiso denegado»); Authentication → Usuarios (solo tú + 23 clientes). | Tú + yo | — | — |

Tiempo con datos tan expuestos como hoy: solo de F3 a F4 (≈15 min, lo que tardan F3a–F3c). Clientes sin acceso: de F3 hasta que reciben su código.

## Si falla el acceso (sin abrir las reglas)

| Problema | Salida |
| --- | --- |
| Google no funciona en el iPhone | Contraseña de respaldo (F3b/F3c). |
| Google no funciona en ningún sitio | Respaldo en el portátil. Si tampoco: antes de F4 se vuelve a la web anterior; después de F4 los datos siguen cerrados y protegidos, se entra a la consola de Firebase con tu Google y se regenera el acceso. |
| Las reglas no te reconocen (UID) | Regenerar reglas con el UID correcto y desplegar de nuevo. |
| Un cliente no entra | Comprobar que usa el código NUEVO; si no, generar otro (crea su cuenta y retira las anteriores). |
| La app de los clientes estropea algo | Reglas de parada: los clientes solo leen; tú sigues entrando. |
| Datos dañados | Parada + restauración aditiva desde la copia F1, con autorización. |

## Permiso temporal de F5 (preparado; NO aplicado)

La migración solo usa tres llamadas de Authentication: buscar una cuenta (`getUser`, `getUserByEmail`), crearla (`createUser`) y ponerle la marca de su ficha (`setCustomUserClaims`); `verificar-vinculos --sin-vincular` además las lista. Eso son **tres permisos**: `firebaseauth.users.get`, `firebaseauth.users.create` y `firebaseauth.users.update`. No hace falta `roles/firebaseauth.admin` (también borra cuentas y cambia la configuración de acceso). Se usa un **rol propio con solo esos tres**, que además **caduca solo** a las 3 horas aunque se olvide retirarlo.

1. Crear el rol (tú, con tu cuenta, en la terminal que yo prepare): `gcloud iam roles create migracionCuentasC1 --project=appjorgecgcoach --title="Migracion C1 (temporal)" --permissions=firebaseauth.users.get,firebaseauth.users.create,firebaseauth.users.update --stage=GA`
2. Concederlo solo a `firestore-recuperador`, con caducidad: `gcloud projects add-iam-policy-binding appjorgecgcoach --member=serviceAccount:firestore-recuperador@appjorgecgcoach.iam.gserviceaccount.com --role=projects/appjorgecgcoach/roles/migracionCuentasC1 --condition='expression=request.time < timestamp("AAAA-MM-DDTHH:MM:00Z"),title=caduca-ventana-c1'` (la hora se pone esa noche: inicio + 3 h).
3. Verificar (solo lee), esperando 2–5 min a que se propague: como `firestore-recuperador`, `testIamPermissions` debe devolver los tres permisos y **ninguno** de `firebaseauth.users.delete`, `firebaseauth.configs.update`; la política del proyecto debe mostrar ese rol en esa única cuenta. `firebase-adminsdk-fbsvc` no se toca.
4. Retirar, nada más terminar F5: `gcloud projects remove-iam-policy-binding` con el mismo miembro, rol y condición, y `gcloud iam roles delete migracionCuentasC1 --project=appjorgecgcoach`. Verificar: `testIamPermissions` ya no devuelve ninguno de los tres y la política no muestra el rol.

## Si la migración se corta (probado)

Probado con el proceso muerto de golpe en tres momentos (`scripts/interrupcion-emulador.test.js`): con la cuenta creada sin marca, con la marca puesta pero sin vincular, y justo después de vincular una ficha. En los tres casos, **repetir `--apply`** termina el trabajo: las fichas ya hechas **conservan su código y su cuenta**, cada ficha queda con **una sola** cuenta y **un solo** código, no quedan códigos viejos, «demo» no se toca y valoraciones, series y pagos quedan idénticos. Una tercera ejecución no cambia nada.

- Lo único que puede quedar es **una cuenta suelta** (creada justo antes del corte, sin vincular). No da acceso a nada: nadie conoce su código y las reglas exigen el vínculo (probado: no puede leer ninguna ficha). `verificar-vinculos --sin-vincular` la cuenta. No se borra sola: se deja (o se borra más adelante con tu autorización). Por eso en F8 puede haber «tú + 23 + 1».
- Qué hacer: 1) no tocar nada en la app; 2) comprobar que el permiso temporal sigue vigente (si caducó, volver a concederlo, con tu sí); 3) `--comprobar` (solo lee); 4) `--apply` otra vez; 5) `verificar-vinculos --sin-vincular`; 6) retirar el permiso. Si algo no cuadra (una ficha «a revisar» o un error que se repite): se para; esa ficha se queda sin código hasta revisarla, las demás funcionan.
- Los códigos se entregan **solo cuando F5 ha terminado** y `verificar-vinculos` da 0 problemas: así nunca se entrega un código que luego cambie.

## Cambios pendientes en móviles con la versión antigua (probado)

- Lo que un cliente guarde **antes de F4** llega a la nube como siempre.
- Desde F4, un móvil con la web antigua no puede guardar: el cambio queda en su móvil con el aviso rojo. Al entrar con su código nuevo **en ese mismo navegador o app**, la web nueva lo sube solo a SU ficha.
- **Probado en el navegador** con la versión publicada hoy y la nueva, el emulador y datos ficticios: serie registrada en la versión antigua con las reglas cerradas → migración → entrar con el código nuevo → la serie llega sola a la nube, sin aviso ni botones; valoración, pagos y código intactos.
- Esa prueba encontró un fallo, ya **corregido** (`shared/safe-save.js`, prueba en `shared/safe-save.test.js`): si la nube no tenía un campo que la app rellena al abrir, la versión nueva lo tomaba por «cambio de otro dispositivo» y pedía al cliente elegir (el botón «Usar la nube solo en lo que choca» sí conservaba la serie). Ahora un relleno local no cuenta como cambio; un cambio real de otro dispositivo sigue siendo conflicto.
- Límites reales: 1) cada navegador guarda lo suyo: en iPhone, **Safari y el icono de la pantalla de inicio son sitios distintos**; lo pendiente solo sube al entrar desde el mismo sitio donde se registró. 2) Si el cliente borra los datos del navegador, o en iPhone no abre la web en 7 días, lo que no subió se pierde. Por eso el aviso pide comprobar antes que no hay aviso rojo y entrar con el código nuevo **desde donde entrena siempre**.

## Aviso a los clientes (enviar 2–3 días antes)

> Hola, [nombre]. El [día] por la noche voy a mejorar la seguridad de la app de entrenamiento. A partir de esa noche se entrará con un **código nuevo y personal** que te enviaré yo por mensaje privado; el código de ahora dejará de funcionar.
>
> Antes de esa noche: abre la app y comprueba que todo lo que has registrado está guardado (no debe aparecer ningún aviso rojo). Esa noche, durante un rato, no podrás entrar.
>
> Cuando recibas el código, entra desde donde entrenas siempre (si usas el icono de la pantalla de inicio, desde ahí). Tu código nuevo es solo para ti: no lo compartas. Si no te funciona, escríbeme y te genero otro al momento. No pierdes nada de lo registrado.

## Entrega segura de los códigos (F6)

1. En el portátil, para cada cliente: abrir su ficha → «Código de acceso». El código se ve ahí; no se imprime en ningún otro sitio.
2. Enviarlo **por mensaje privado al número o correo que ya tienes de ese cliente** (nunca en un grupo, nunca en una captura con más datos). Texto:
   > Tu código nuevo para entrar en la app es: XXXX-XXXX-XXXX. Escríbelo tal cual (da igual mayúsculas o guiones). Es personal: no lo compartas.
3. Marcar en tu lista quién lo ha recibido y quién ha entrado (en Authentication → Usuarios aparece la fecha del último acceso).
4. Si un cliente lo pierde o lo comparte: «Código de acceso» → 🎲 generar otro → guardar. El anterior deja de valer al momento.
5. No guardar la lista de códigos en notas, hojas de cálculo ni capturas.
