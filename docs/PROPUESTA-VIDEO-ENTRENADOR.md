# «Vídeo del entrenador» en la Biblioteca (ACTIVADO con autorización del usuario)

## Datos
- Ejercicios de serie: JSON incrustado en `index.html` (`#exlibData`), entradas `{n, v, d}`. Solo lectura.
- Ejercicios propios: `DATA.exLibrary` (documento META `clients/coach_data`), entradas `{n, v, d}`
  y, desde ahora, el campo opcional **`vc`** (vídeo del entrenador).
- Si un ejercicio de serie recibe tu vídeo, se añade al final de `exLibrary` una copia `{n, v, d, vc}`
  con los mismos `n`, `v` y `d`. Se muestra una sola vez (se une por nombre) y no se marca como «tuyo».
- Cambiar tu vídeo cambia solo `vc` en su sitio; quitarlo borra solo `vc`.

## Guardado
- Con el `save()` de siempre → `shared/safe-save.js` (sin modificar): revisiones `_rev`, transacción,
  mezcla de cambios que no chocan y bloqueo con aviso cuando chocan.
- No se han cambiado las reglas de Firestore ni se ha creado ninguna colección.

## Dónde se usa
- Biblioteca: añadir, cambiar y quitar, con validación del enlace.
- Selector de ejercicios de la programación: botón «▶ mi vídeo» (azul marino) junto al rojo.
- Editor de programación (entrenador): botón «▶ TUYO» junto al rojo, leído de la biblioteca por nombre.
  Los entrenamientos de los clientes NO se modifican.
- Modo cliente: sin cambios (el cliente sigue viendo el vídeo general).

## Pruebas
- `node --test ui/coach-library.test.js` (10 pruebas, incluidas dos con el guardado seguro real).
- `npm run test:guardado` (54 pruebas).
- Emulador con datos ficticios: persistencia tras recargar, segundo dispositivo, combinación de
  cambios y conflicto bloqueado (ver informe de la etapa 4).
