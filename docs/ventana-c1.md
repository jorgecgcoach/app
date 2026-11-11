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
| F5 | **[Autorización]** Migración. 1) Permiso temporal `roles/firebaseauth.admin` a `firestore-recuperador` (para crear las cuentas). 2) `--comprobar` y `--simular-aislar` (solo leen). 3) `--apply`. 4) `verificar-vinculos`: 0 problemas. 5) **Retirar el permiso temporal**. | Yo | 23 fichas con código nuevo y cuenta; «demo» sin tocar; 0 a revisar; 0 errores. | Una ficha con error: repetir `--apply` (no duplica). Fichas «a revisar»: no se tocan; se decide a mano. |
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

## Cambios pendientes en móviles con la versión antigua

- Lo que un cliente guarde **antes de F4** llega a la nube como siempre.
- Desde F4, un móvil con la web antigua no puede guardar: el cambio queda en su móvil (el guardado lo mantiene pendiente y lo anota en el diario del navegador). Al entrar con su código nuevo, la web nueva lo recupera y lo sube a SU ficha (`afterDataLoaded → recover`). La migración no toca entrenamientos, series ni valoraciones (probado), y la guardia `_rev` hace que lo pendiente se monte sobre la versión actual sin pisar nada.
- Límite real: si el cliente borra los datos del navegador, o usa solo Safari y no abre la web en 7 días, lo que no llegó a subir se pierde. Por eso el aviso pide **comprobar antes de la noche que no queda nada sin guardar** (sin aviso rojo).

## Aviso a los clientes (enviar 2–3 días antes)

> Hola, [nombre]. El [día] por la noche voy a mejorar la seguridad de la app de entrenamiento. A partir de esa noche se entrará con un **código nuevo y personal** que te enviaré yo por mensaje privado; el código de ahora dejará de funcionar.
>
> Antes de esa noche: abre la app y comprueba que todo lo que has registrado está guardado (no debe aparecer ningún aviso rojo). Esa noche, durante un rato, no podrás entrar.
>
> Tu código nuevo es solo para ti: no lo compartas. Si no te funciona, escríbeme y te genero otro al momento. No pierdes nada de lo registrado.

## Entrega segura de los códigos (F6)

1. En el portátil, para cada cliente: abrir su ficha → «Código de acceso». El código se ve ahí; no se imprime en ningún otro sitio.
2. Enviarlo **por mensaje privado al número o correo que ya tienes de ese cliente** (nunca en un grupo, nunca en una captura con más datos). Texto:
   > Tu código nuevo para entrar en la app es: XXXX-XXXX-XXXX. Escríbelo tal cual (da igual mayúsculas o guiones). Es personal: no lo compartas.
3. Marcar en tu lista quién lo ha recibido y quién ha entrado (en Authentication → Usuarios aparece la fecha del último acceso).
4. Si un cliente lo pierde o lo comparte: «Código de acceso» → 🎲 generar otro → guardar. El anterior deja de valer al momento.
5. No guardar la lista de códigos en notas, hojas de cálculo ni capturas.
