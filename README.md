# Panel Sensorial por Sesiones

App web para análisis sensorial con varias sesiones por panelista (grupos de vinos y repeticiones).

- **App de panelistas:** https://anibalacatania.github.io/panel-sensorial-sesiones/
- **Administración:** https://anibalacatania.github.io/panel-sensorial-sesiones/#admin
- **Datos:** planilla de Google “Panel Sensorial Sesiones - Datos” (la clave de administrador está en la hoja **Config**)

## Cómo se usa

### 1. Armar el estudio (administrador)
1. Entrá a `#admin` con la clave.
2. Pegá la lista de vinos (uno por línea, se puede copiar una columna de Excel).
3. Elegí **vinos por sesión**, **repeticiones** y **número de panelistas**.
4. **Generar vista previa** → revisá las sesiones y los códigos → **Guardar y publicar**.

Qué hace (equivale a `crear_grupos_aleatorios_df` + `generar_archivos_csv`):
- Mezcla los vinos al azar y los reparte en grupos (f1, f2, …). Opcionalmente reparte parejo (17 vinos → 6+6+5).
- Cada grupo se repite según las repeticiones: sesión = grupo × repetición (S1 = f1·R1, S2 = f2·R1, …).
- En cada sesión, el orden de presentación sigue un **cuadrado de Williams** (balanceo de orden y arrastre), con un mapeo aleatorio de vinos por cada bloque de panelistas.
- Cada vino recibe un **código de 3 dígitos** distinto en cada sesión, sin repetir en todo el estudio.
- Con la misma **semilla** y los mismos datos se obtiene exactamente el mismo diseño.
- Para balance completo, el número de panelistas debería ser múltiplo de n (vinos por sesión, si es par) o 2n (si es impar). La app avisa.

Si ya hay respuestas y se guarda un diseño nuevo, la hoja **Respuestas** no se borra: se renombra como respaldo.

### 2. Panelistas
- Eligen su número → ven todas sus sesiones → entran a la que quieran.
- Cada muestra se guarda en la planilla al tocar “Enviar y continuar”. Sin internet, quedan pendientes y se suben solas.
- Si salen a mitad de una sesión, al volver continúan donde quedaron.
- Al completar una sesión queda **deshabilitada** (✔ Completada).

### 3. Durante el panel (administrador)
- **Progreso:** tabla panelista × sesión (✔ completa, n/N en curso).
- **Planilla de servicio:** por sesión, la clave vino → código y la bandeja de cada panelista en orden. Botón **Imprimir**.

## Hojas de la planilla
| Hoja | Contenido |
|---|---|
| Config | ClaveAdmin, Estudio |
| Atributos | un atributo por fila |
| Sesiones | Sesion, Grupo, Rep, NMuestras, Vinos |
| Diseno | Sesion, Grupo, Rep, Valuador, Orden, Muestra, NombreProducto, CodigoProducto |
| Respuestas | una fila por muestra evaluada + un atributo por columna |

## Archivos
- `index.html` — la app (panelistas y administración)
- `config.json` — URL del script de Google (se lee sin caché)
- `Codigo.gs` — copia del script que está en la planilla (Extensiones → Apps Script)
