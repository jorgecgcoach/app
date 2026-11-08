# Rediseño visual de JorgeCGCoach: auditoría y plan

- **Rama:** `rediseno/visual`, creada desde `main` en `e6c7ca8`.
- **Estado:** solo análisis. No hay código modificado, no hay commits y no se ha publicado nada.

## 1. Cómo está construida la app hoy

| Pieza | Dónde | Cómo funciona |
|---|---|---|
| Toda la app | `index.html` (1,2 MB, 9.470 líneas) | HTML + CSS + JS en un solo archivo, sin framework; GitHub Pages |
| Estilos base | `index.html` 21–1650, más `#mc-style` y `#neg-style` | Variables en `:root` (navy, teal…), fuentes Nunito y Baloo 2 |
| Datos de ejercicios | `<script id="exlibData">` | 1.109 ejercicios `{n, v, d}` (921 con vídeo), más `DATA.exLibrary` del entrenador |
| Guardado | `shared/safe-save.js` y `save()` | **No se toca** |
| Estado de navegación | objeto `UI` (`UI.home`, `UI.tab`, `UI.week`…) | `renderAll()`, que llama a `renderSide()`, `renderTop()`, `renderTabs()` y `renderView()` |

### Menú y navegación actuales
- **Barra lateral (`renderSide`).** Solo contiene la marca, la lista de clientes en acordeón con sus bloques, «Añadir bloque», Ajustes y Cerrar sesión. **No hay menú de secciones.**
- **Barra superior (`renderTop`).** Botón ☰, «← Volver», avatar, nombre y bloque del cliente, y el selector de semanas.
- **Pestañas del cliente (`renderTabs`).** 13 secciones en `SECTIONS`. En escritorio son pestañas; por debajo de 900 px pasan a la barra inferior `#botnav`.
- **Inicio del entrenador (`viewHome`).** Buscador, botones «Copia», «Biblioteca» y «Negocio» con estilos en línea, avisos de negocio, filtros por servicio y tarjetas de clientes.
- **Negocio, Biblioteca de plantillas y Copia** se abren como **ventanas emergentes** (`openNegocio`, `openLibrary`, `openBackup`), no como pantallas. No tienen dirección propia ni se puede volver atrás con el navegador.
- **Modo cliente.** Comparte el mismo esqueleto (`body.client-mode` oculta la barra lateral). **Cualquier cambio en la estructura afecta también a lo que ven los clientes.**

### Problemas visuales detectados
1. Hay 271 atributos `style="…"` en línea y unos 190 colores hexadecimales distintos, así que la paleta no es coherente.
2. Hay 10 puntos de corte distintos (520, 560, 600, 620, 680, 720, 900, 901, 1040…).
3. Los iconos son emojis: se ven distintos en cada sistema y dan un aspecto poco profesional.
4. La marca es inconsistente: «JORGECGCOACH», «JORGE CANTOS», el logo hexagonal «JC» y las referencias con la «J».
5. Las fuentes redondeadas (Nunito y Baloo 2) dan un tono informal.
6. Las herramientas del entrenador (Negocio, Biblioteca, Copia) quedan escondidas en botones del inicio.
7. En el móvil del entrenador no hay acceso directo a Negocio ni a Biblioteca.

## 2. Qué existe y qué falta, comparado con las 4 referencias

| Referencia | Ya existe | Falta |
|---|---|---|
| **Inicio** | Pagos pendientes y renovaciones (`negCoachAlerts`), buscador de clientes, accesos a Copia y Plantillas | Tareas, videollamadas con hora, «clientes por revisar», mini calendario |
| **Calendario semanal** | Datos con fecha: fin de contrato (`negFin`), próximos pagos (`negProx`), videollamada de cierre (`callDoneFor`, sin hora), sesiones y actividades de cada cliente (`sessionsOnDate`, `data.calendar`) | Calendario del entrenador. Eventos propios con hora, tareas y contenido de Instagram **no existen como datos** |
| **Biblioteca de ejercicios** | 1.109 ejercicios con músculo (en el nombre), descripción y vídeo; vídeos propios; añadir ejercicio. Solo se usa en el selector al programar | Pantalla propia, filtros por grupo y material, orden. **No hay ilustraciones** ni campo «material» |
| **Negocio** | Prácticamente todo: los 5 indicadores, objetivo del mes, de dónde sale el dinero, contratos, CRM, renovaciones, pagos, planes, métricas e importar | Solo cambia el aspecto y pasa de ventana emergente a pantalla |

**Importante:** las tareas, las videollamadas con hora y el contenido de Instagram serían **datos nuevos** que habría que guardar en Firestore. Por eso quedan fuera de este rediseño. En la primera versión el calendario y el inicio solo **leen** datos que ya existen. Si quieres eventos propios, lo planteo después como una fase aparte, con su diseño de datos y tu autorización.

## 3. Sistema de diseño propuesto

- **Archivo nuevo:** `ui/design-system.css?v=…`, que se carga después de los estilos actuales. Así los cambios quedan aislados y se pueden revertir quitando una línea.
- **Prefijo `ds-`** en las clases nuevas, para no chocar con las existentes.

| Elemento | Propuesta |
|---|---|
| **Tipografía** | **Inter** (400, 500, 600, 700, 800) para todo: interfaz y títulos. Escala de tamaños: 12 / 13 / 14 / 16 / 18 / 22 / 28 / 34 px. Cifras con `font-variant-numeric: tabular-nums` |
| **Color de marca** | Navy `#0C3B3B` (barra lateral, botón principal); teal `#2C9E9D` y `#54BEBD` (acentos, elemento activo) |
| **Neutros** | Fondo `#F5F8F8`, superficie `#FFFFFF`, borde `#E3ECEB`, texto `#13302F`, texto secundario `#5B7574` |
| **Estados** | Éxito `#27AE73`, aviso `#E8A020`, peligro `#E23B3B`, info `#3B6FD9`, videollamada `#7B5CC9`. Cada uno con su tono suave para las tarjetas de indicadores (como en las referencias) |
| **Espaciado** | Escala de 4 px: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 |
| **Radios** | 8 (campos), 12 (botones y chips), 16 (tarjetas), 20 (ventanas emergentes) |
| **Sombras** | Dos niveles: tarjeta `0 1px 2px + 0 4px 16px rgba(12,59,59,.06)`; ventana emergente `0 16px 48px rgba(12,59,59,.16)` |
| **Botones** | `ds-btn` en variantes primary (navy), secondary (borde), ghost y danger; tamaños sm (32) y md (40); en móvil, área táctil de al menos 44 px |
| **Tarjetas** | `ds-card` y `ds-kpi` (icono, etiqueta, valor y comentario; tono por color) |
| **Tablas y listas** | `ds-table`: cabecera gris pequeña, filas de 48 px, importes alineados a la derecha. En móvil pasan a lista de tarjetas |
| **Chips** | `ds-chip` para grupo muscular, estado de pago y días restantes |
| **Iconos** | Iconos SVG en línea (trazo de 1,75 px, estilo Lucide, licencia MIT) en un `<svg>` sprite dentro de `index.html`, sin dependencias externas. Sustituyen a los emojis **solo en la interfaz del entrenador y del menú** |
| **Puntos de corte** | Móvil por debajo de 640, tablet de 640 a 1023, escritorio desde 1024. Barra lateral fija en escritorio, plegable a iconos en tablet y cajón con barra inferior en móvil |
| **Accesibilidad** | Contraste AA, `:focus-visible` visible y `prefers-reduced-motion` (ya existe y se conserva) |

## 4. Plan por etapas

- **En todas las etapas:** se trabaja en `index.html` y en el archivo nuevo `ui/design-system.css`. No se modifican `shared/safe-save.js`, `firestore.rules` ni ninguna función que llame a `save()`, salvo para pintar.
- **Comprobación de cada etapa:**
  - en el emulador local con datos ficticios, a 375, 768 y 1280 px;
  - en modo entrenador y en modo cliente;
  - con `npm run test:guardado`.
- **Cada etapa** se cierra con un commit en la rama y tu revisión antes de pasar a la siguiente.

### Etapa 1: menú lateral y navegación general
- **Archivos:**
  - `index.html`: marcado de `.side`, `renderSide`, `renderTop`, nuevo estado `UI.page`, `openHome` y `#botnav` del entrenador;
  - el nuevo `ui/design-system.css`.
- **Se conserva:**
  - toda la navegación del cliente (pestañas, `SECTIONS`, `botnav`);
  - el acordeón de clientes y bloques (pasa a «Clientes»);
  - `openNegocio`, `openLibrary` y `openBackup`, que siguen funcionando;
  - Cerrar sesión, Ajustes, el selector de semanas y «Volver».
- **Mejoras:**
  - Menú del entrenador: Inicio · Clientes · Calendario · Biblioteca de ejercicios · Plantillas · Copias · Negocio (con sus 8 apartados como submenú) · Ajustes.
  - Elemento activo resaltado y marca unificada.
  - En móvil: barra inferior del entrenador (Inicio, Clientes, Calendario, Negocio, Más).
  - Cada sección abre como pantalla, con historial del navegador (`#inicio`, `#negocio/pagos`…), para que el botón atrás funcione.

### Etapa 2: panel de inicio
- **Archivos:** `index.html` (`viewHome` dividido en `viewCoachDashboard` y `viewClientes`).
- **Se conserva:** buscador, filtros por servicio, tarjetas de cliente con foto, menú ⚙️ y archivar, «Nuevo cliente» y los avisos de negocio con su función.
- **Mejoras:**
  - Saludo según la hora y 4 indicadores con datos reales: pagos que vencen esta semana, renovaciones y fines de plan próximos, clientes activos y seguimientos recibidos esta semana.
  - Lista «Pagos pendientes» y lista «Próximos fines de plan».
  - Mini calendario del mes con puntos en los días con algo.
  - Accesos rápidos.
  - La cuadrícula de clientes pasa a la pantalla «Clientes».

### Etapa 3: calendario semanal (solo lectura)
- **Archivos:** `index.html` (nueva `viewCoachCalendar`; reutiliza `negContracts`, `negFin`, `negProx`, `negCoachAlerts` y `sessionsOnDate`).
- **Se conserva:** el calendario y la periodización de cada cliente (`viewCalendar`) sin cambios.
- **Mejoras:**
  - Vistas Día, Semana y Mes, con navegación entre semanas y la línea de «ahora».
  - Muestra fines de plan, vencimientos de pago y videollamadas de cierre pendientes, con colores por tipo. Al tocar un elemento se abre el cliente o Negocio.
  - Las sesiones de entreno de los clientes se pueden mostrar con un filtro opcional.
  - Como estos datos no tienen hora, salen en una franja «Todo el día».
  - El botón «Crear evento» **no se incluye** hasta que decidas la fase de eventos.

### Etapa 4: biblioteca de ejercicios
- **Archivos:** `index.html` (nueva `viewExLibrary`; reutiliza `exLibAll`, `exNameParts`, `openLibVideo`/`saveExVid` y `exLibAddSave`).
- **Se conserva:**
  - el selector de ejercicios al programar (`openExPicker`), que es el que más se usa;
  - los datos de `exlibData` y `DATA.exLibrary`.
- **Mejoras:**
  - Pantalla propia con buscador y filtros por grupo muscular (sacado del nombre) y por material. El material se deduce de palabras como «máquina», «mancuerna», «barra», «polea» o «banda»; solo se usa para mostrar y no se guarda.
  - Orden A–Z y por grupo.
  - Chip de color por grupo, botón «Vídeo» y campo «Vídeo del entrenador», que guarda como hoy en tu biblioteca.
  - Carga de 50 en 50, porque son 1.109 ejercicios.
  - Ilustraciones: **no hay imágenes para 1.109 ejercicios**. Propongo un icono por grupo muscular. Las ilustraciones por ejercicio serían un trabajo aparte.

### Etapa 5: panel de negocio
- **Archivos:** `index.html` (`openNegocio`, `renderNegTabs`, `negResumen` y las vistas `neg*View`) y los estilos de `#neg-style`.
- **Se conserva:** **todos** los cálculos (`negReconocido`, `negCaja`, `negActivos`, MRR, bajas…) y todas las acciones (cobrar, congelar, renovar, importar…).
- **Mejoras:**
  - Pasa de ventana emergente a pantalla completa, con pestañas superiores como en la referencia.
  - Selector de mes como desplegable.
  - Indicadores con icono, barra de objetivo y tabla «De dónde sale el dinero» con iniciales.
  - En móvil, pestañas desplazables y tablas en tarjetas.
  - `openNegocioRenov()` y los avisos siguen llevando a Renovaciones.

## 5. Riesgos y cómo se controlan

| Riesgo | Control |
|---|---|
| Romper el modo cliente | Los selectores nuevos se limitan a `body:not(.client-mode)`, y en cada etapa se prueba con un código de cliente ficticio en el emulador |
| Alterar el guardado | No se edita ninguna función que guarde; se revisa el diff buscando `save(` y `safe-save` |
| Rendimiento con 1.109 ejercicios | Carga por páginas y búsqueda con un pequeño retraso |
| `index.html` enorme | Cambios acotados por funciones; CSS nuevo en un archivo aparte |
| Publicar sin querer | Todo queda en `rediseno/visual`; ni push ni PR sin tu autorización |
