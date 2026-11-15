# Fase 1 — Menú principal e inicio del entrenador (propuesta)

Rama local `rediseno/inicio-entrenador` (desde `origin/main` 8bce0db). Sin publicar.
Reutiliza las etapas 1–4 de `rediseno/visual` (menú, calendario de solo lectura, biblioteca).

## Menú (7 apartados)
Inicio · Clientes · Calendario · Biblioteca de ejercicios · Plantillas · Copias de seguridad · Configuración.

- **Contratos y pagos** (el antiguo «Negocio», con sus 8 pestañas) está dentro de **Clientes**,
  como primera línea de su lista. También se llega desde el Inicio y desde Configuración. No se quita nada.
- **Plantillas** y **Copias de seguridad** pasan de ventana emergente a pantalla propia, con las mismas acciones.
- En iPhone, barra inferior: Inicio · Clientes · Calendario · Biblioteca · Más (abre el menú completo).
- El modo cliente no cambia.

## Inicio (solo lectura: no guarda nada)
1. **Resumen**: clientes activos, ingresos del mes con barra hacia el objetivo (dorado), cobros pendientes
   (con lo vencido en rojo), programas por terminar.
2. **Videollamadas y citas** (3 semanas): videollamadas de cierre (agendada / por agendar) e inicios de plan.
   Hoy la app no guarda la hora de las videollamadas; eso irá con el calendario completo (fase posterior, requiere un dato nuevo).
3. **Programas que terminan** (±2 semanas): semana actual, fecha de fin y barra de progreso; abre el programa del cliente.
4. **Pagos y vencimientos** (30 días): total pendiente, vencido, y cada cobro con su fecha.
5. **Tareas y avisos** por prioridad: cobros vencidos, programas terminados, videollamadas por agendar,
   seguimientos recibidos esta semana, clientes sin entrenamiento.
6. **Accesos rápidos**: nuevo cliente, registrar pago, calendario, biblioteca, plantillas, copia de seguridad.

Las cifras usan las mismas fórmulas que Contratos y pagos. No se toca Auth, reglas, estructura de datos ni guardado.

## Vista previa
Datos ficticios con `node e2e/demo-inicio.js` (emuladores `npm run e2e:emulador-auth`) y
`E2E_AUTH=1 E2E_PORT=5399 node e2e/serve.js`. Capturas en `docs/capturas-fase1/`.
