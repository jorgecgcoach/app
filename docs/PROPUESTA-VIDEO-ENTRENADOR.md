# Propuesta: «Vídeo del entrenador» en la Biblioteca (pendiente de autorización)

## Situación actual
- Ejercicios de serie: JSON incrustado en `index.html` (`#exlibData`), 1.109 entradas `{n, v, d}`
  (n = «Nombre - Músculos», v = vídeo general, d = descripción). Solo lectura.
- Ejercicios propios: `DATA.exLibrary` (documento META del entrenador), entradas `{n, v, d}`.
  Si el nombre coincide, sustituyen a la entrada de serie.
- No existe ningún campo para un segundo vídeo.

## Cambio propuesto
- Campo nuevo opcional **`vc`** (vídeo del entrenador) dentro de cada entrada de `DATA.exLibrary`.
- Al guardar un vídeo propio en un ejercicio de serie se crea una copia `{n, v, d, vc}` con los
  mismos `n`, `v` y `d` del original: el vídeo general y la descripción no cambian.
- Quitar el enlace borra solo `vc`.
- Se guarda con el `save()` de siempre (sistema de guardado seguro), sin tocar `shared/safe-save.js`,
  las reglas de Firestore ni crear colecciones. Las reglas actuales no validan el contenido de
  `exLibrary`, así que no hace falta cambiarlas.

## Estado
- Código preparado en `ui/coach-library.js` (`klCoachVideoApply`, `klSaveCoachVideo`) detrás de
  `KLIB_COACH_VIDEO_ON = false`. Con el interruptor apagado el campo se ve bloqueado y no escribe nada.
- Pruebas: `node --test ui/coach-library.test.js` (incluye que `n`, `v` y `d` no cambian).

## Para activarlo (solo con autorización)
1. Poner `KLIB_COACH_VIDEO_ON = true`.
2. Probar en el emulador con datos ficticios.
3. Decidir después si el cliente ve el vídeo del entrenador antes que el general (otra fase).
