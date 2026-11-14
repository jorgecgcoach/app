# C1, opción C: altas controladas desde el servidor

**Estado:** preparado y probado en emuladores. **No desplegado.** No se ha activado Blaze, ni Identity Platform, ni se ha tocado ninguna regla, permiso o dato real. La app lleva el interruptor `ALTAS_SERVIDOR=false`: sin desplegar nada, todo funciona como en el resto de C1.

## ¿Se puede cerrar de verdad el registro público?

Sí, de dos formas que se complementan. Las dos exigen pasar Authentication a «Firebase Authentication con Identity Platform».

1. **Interruptor de la consola** (Authentication → Configuración → Acciones del usuario → desmarcar «Habilitar creación (registro)»). Según la documentación de Google, impide que un usuario final cree (o, si se desmarca también, borre) su cuenta, y está pensado para cuando las cuentas las crea un administrador con el Admin SDK. Un alta desde el navegador recibe `auth/admin-restricted-operation`. No se puede probar en el emulador: se comprueba en la consola el día del cambio (abajo).
2. **Función de bloqueo `bloquearRegistro`** (`beforeUserCreated`): rechaza cualquier alta que no venga del Admin SDK. Defensa por si alguien vuelve a marcar el interruptor. **Probado en el emulador:**
   - un alta desde el navegador (con un código o con un correo cualquiera) se rechaza y no se crea ninguna cuenta;
   - el Admin SDK (la migración y `altaCliente`) sigue creando cuentas: la función de bloqueo no se ejecuta para él;
   - las cuentas que ya existen siguen entrando: entrar no es crear. Vale para los clientes, para el entrenador y para cambiar la contraseña (el respaldo del entrenador es un cambio de contraseña, no un alta).

**Requisito de orden:** la cuenta del entrenador ya existe (Google), así que cerrar el registro no le afecta. Si algún día entrase con **otra** cuenta de Google, se rechazaría (es lo que se quiere).

## Cómo funciona

- `functions/altas.js` → `altaCliente({clientId, code})`, región `europe-west1`:
  - solo el entrenador (su UID, leído de `functions/.env.appjorgecgcoach`, ignorado por git, o el claim `role=='coach'`); sin UID configurado no entra nadie por UID (falla cerrado);
  - solo códigos generados de 60 bits; la ficha tiene que existir; nunca `coach_data`;
  - si ya hay una cuenta para el código, **no se reutiliza** (`already-exists`);
  - crea la cuenta y le pone la marca `jcgCliente = id de la ficha`. Si no puede marcarla, retira la cuenta recién creada (nadie la conoce);
  - devuelve solo el uid. No escribe en registros ni el código, ni el correo, ni la contraseña.
- La app (con `ALTAS_SERVIDOR=true`) llama a la función en lugar de crear la cuenta en el navegador. Después guarda la ficha **igual que ahora**, en un único guardado: primero la cuenta, luego el código y las cuentas. Si algo falla, la ficha queda como estaba.
- Entrada de clientes: no cambia y no pasa por la función, así que no va más lenta. Solo el alta del entrenador puede tardar 1–3 s si la función estaba dormida.
- Con todas las cuentas creadas por el Admin SDK, todas llevan la marca. Más adelante se podría exigir la marca en las reglas (no está hecho: sería un cambio de reglas).

## Pruebas

- `npm run test:funciones`: emuladores de Auth, Firestore y Functions con las reglas estrictas, 6 casos:
  - registro cerrado sin bloquear al Admin SDK;
  - alta con marca, y el cliente solo ve su ficha;
  - solo el entrenador da altas (no sin sesión, ni un cliente, ni una cuenta cualquiera);
  - datos no válidos;
  - cuenta ya existente, que no se toca;
  - el entrenador entra con el registro cerrado.
- `shared/alta-codigo.test.js`: el camino de la app con la función:
  - el navegador no crea cuentas;
  - cada error de la función deja la ficha intacta;
  - con la sesión caducada no se llama a la función;
  - el interruptor está apagado;
  - la copia de `code-identity.js` de las funciones es idéntica a la de la app.

## Coste mensual estimado

Uso esperado: unas decenas de altas al mes. La función de bloqueo solo se ejecuta cuando alguien intenta registrarse; con el interruptor de la consola cerrado, lo previsible es que ni siquiera llegue a ejecutarse (no lo he podido comprobar en el emulador).

| Servicio | Gratis cada mes (según las páginas de precios; confirmar al activar) | Uso previsto | Coste previsto |
| --- | --- | --- | --- |
| Cloud Run functions (2.ª generación) | 2 millones de peticiones, 180.000 vCPU·s, 360.000 GiB·s | < 1.000 peticiones | 0 € |
| Authentication con Identity Platform | 50.000 usuarios activos al mes (correo, Google) | < 200 | 0 € |
| Cloud Build (al desplegar) | Cuota gratuita de minutos de compilación | 1–2 despliegues | 0 € |
| Artifact Registry (imagen de la función) | Cuota gratuita pequeña | ~0,1–0,3 GB, con limpieza automática | 0–0,05 € |
| Firestore, Hosting en GitHub Pages | Sin cambios | — | 0 € |

**Previsto: 0 €/mes. Techo razonable: menos de 1 €/mes.** Recomendado: alerta de presupuesto en 2 € (avisa, no corta el gasto) y `maxInstances: 2` en la función (ya puesto), que limita el gasto si alguien la llamara en masa. Aun así, sin ser el entrenador, la función rechaza la llamada en milisegundos.

Avisos honestos:

- Blaze exige una cuenta de facturación con tarjeta, aunque el uso sea gratis.
- Algunas cuotas gratuitas se calculan con precios de `us-central1`; la función está en `europe-west1` (más cerca). A este volumen la diferencia es de céntimos como mucho.
- Los precios pueden cambiar: se comprueban en la consola antes de activar.

## Qué tendrías que aprobar (en este orden)

1. **Copia real cifrada y verificada (P1)**: requisito de todo C1.
2. **Activar Blaze** en el proyecto, con alerta de presupuesto (2 €).
3. **Pasar a Identity Platform** (Authentication → Configuración). Los usuarios y proveedores actuales se conservan.
4. **Desplegar las funciones**, solo esta parte. Primero `npm run reglas:preparar` (genera `functions/.env.appjorgecgcoach` con tu UID) y después:
   `npx firebase deploy --only functions:c1 --project appjorgecgcoach --config firebase.funciones-despliegue.json`
   Si la CLI pregunta por la política de limpieza de imágenes, responder con 1 día.
5. **Publicar la web con `ALTAS_SERVIDOR=true`** junto con `AUTH_ENABLED=true` (F3 de la ventana).
6. **Después de F5 (migración)**: desmarcar «Habilitar creación (registro)» y también «Habilitar eliminación» (así nadie que conozca un código puede borrar la cuenta del cliente). Comprobación inmediata: en una ventana privada, intentar entrar con un código inventado → «Código no válido», y en Authentication → Usuarios no aparece ninguna cuenta nueva.

Antes de F5 no se puede cerrar el registro si se usara la opción A (la app crearía las cuentas desde el navegador). Con la opción C no hace falta esperar: la migración y la función usan el Admin SDK. Aun así, lo propongo después de F5 para no mezclar cambios en la misma media hora.

## Vuelta atrás

- Volver a marcar «Habilitar creación (registro)». La función de bloqueo seguiría rechazando altas: si se quiere el registro abierto, borrarla también (`npx firebase functions:delete bloquearRegistro --region europe-west1 --project appjorgecgcoach`).
- Web con `ALTAS_SERVIDOR=false`: las altas vuelven a hacerse desde el navegador (exige el registro abierto).
- Borrar las funciones y volver al plan Spark. Las cuentas creadas siguen funcionando, y nada de esto toca Firestore ni las reglas.
