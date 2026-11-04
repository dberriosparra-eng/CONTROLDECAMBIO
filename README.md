# Control de Cambio · Caja Temuco

Panel interno para la gestión diaria de una casa de cambio: apertura, importación del reporte, operaciones, cuentas corrientes, cuadratura, cierre y valorización FIFO.

> Proyecto independiente. No comparte código, base de datos ni configuración con NEXO.

## Stack

- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS 4.
- **Persistencia:** Supabase (PostgreSQL + Auth + RLS).
- **Excel:** SheetJS (`xlsx`) para leer el reporte diario.
- **Dominio:** `src/lib/domain/fx.ts` (funciones puras, sin dependencias de UI).
- **Pruebas:** Node test runner (`npm test`).

## Requisitos

- Node 22 o superior.
- Un proyecto Supabase.
- Variables de entorno en `.env.local`:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

`.env.local` está en `.gitignore`. No subir claves ni cadenas de conexión.

## Desarrollo

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite (por defecto `http://localhost:5173`).

## Validación

```bash
npm test              # reglas puras del dominio
npm run validate:sql  # ejecuta las migraciones en PGlite
npm run validate:flow # flujo completo: apertura, importación, ST, FIFO, cuentas, conteo y cierre
npm run validate      # todo lo anterior
npm run build         # TypeScript + build de producción
```

La validación SQL usa `@electric-sql/pglite` con stubs de `auth.users`, `auth.uid()` y roles de Supabase. No reemplaza una prueba contra el proyecto real, pero detecta errores de sintaxis y de lógica transaccional antes de aplicar la migración.

## Base de datos

Las migraciones están en:

```text
supabase/migrations/202611040002_fx_casa_cambio.sql
supabase/migrations/202611040003_fx_rpc.sql
```

Aplícalas **en ese orden**. La primera crea tablas, vistas y RLS; la segunda crea las funciones transaccionales.

Para pegar en el SQL Editor de Supabase hay dos archivos consolidados:

```text
supabase/apply_all.sql        # UTF-8, conserva acentos
supabase/apply_all_ascii.sql  # 100% ASCII, recomendado si hay problemas de codificación
```

Si el esquema ya está aplicado y solo quieres agregar la función para sumar monedas del mundo, ejecuta:

```text
supabase/patch_world_currencies.sql
```

Si tu editor o terminal muestra caracteres raros, usa `apply_all_ascii.sql`. Para copiarlo directo al portapapeles desde PowerShell:

```powershell
Get-Content "supabase\apply_all_ascii.sql" -Raw | Set-Clipboard
```

Luego pégalo en el SQL Editor de Supabase y ejecútalo. **No ejecutes el `.sql` directamente en PowerShell**: eso solo imprime el texto, no lo aplica a Supabase.

Incluye:

- Monedas, alias y denominaciones.
- Sesiones y apertura.
- Documentos y operaciones.
- Boletas ST.
- Lotes y consumos FIFO.
- Movimientos de inventario.
- Cuentas corrientes.
- Conteo físico, cierre y gastos.
- Vistas de cálculo y RLS.

### Aplicar la migración

Con Supabase CLI:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`db push` pide la contraseña de la base de datos. También se puede pegar el SQL en el SQL Editor del panel de Supabase.

> La cadena `postgresql://postgres:[YOUR-PASSWORD]@...` requiere reemplazar `[YOUR-PASSWORD]` por la contraseña real. No guardar esa cadena en el repositorio.

### Primer usuario

1. Crear un usuario en Supabase Auth (email/password).
2. Iniciar sesión en la app.
3. La app crea automáticamente una tienda y una membresía para el usuario si no existe.

## Estructura

```text
src/
  components/        Layout, login y UI reutilizable
  views/             Apertura, importación, operaciones, cuentas, cuadratura, cierre, histórico
  lib/
    supabase.ts      Cliente Supabase
    db.ts            Consultas y RPC
    excel.ts         Lectura y normalización del reporte
    domain/fx.ts     Reglas puras: FIFO, ST, estadísticas, cuentas, cuadratura
supabase/migrations/ Migración de referencia
docs/                Análisis de los Excel y diseño funcional
tests/               Pruebas del dominio
```

## Flujo operativo

1. **Apertura:** elegir fecha y cargar solo las cantidades por divisa. El costo se calcula desde las capas FIFO (las compras más recientes quedan en el remanente).
2. **Importar reporte:** subir `.xlsx` o agregar boletas una por una. Se pueden eliminar líneas, se agrupan por día y por mes, y solo se usan boletas. Las nulas (ST) quedan registradas pero no suman.
3. **Operaciones:** revisar compras/ventas y anular boletas nulas (ST).
4. **Mayoristas:** pactar una divisa a precio fijo y registrar entregas/pagos parciales; pueden quedar saldos por ambas partes.
5. **Cuentas corrientes:** registrar préstamos, entregas, retiros, cobros y pagos por divisa. Los bancos se crean como contraparte `BANCO`.
6. **Gastos:** registrar egresos y consultar el cuadro por categoría y período.
7. **Cuadratura:** solo se muestran divisas con stock; cada una con bandera y nombre. Los billetes se cuentan aparte de las monedas CLP. Se puede agregar cualquier divisa del mundo y usar una denominación manual.
8. **Cierre:** generar el reporte jerárquico, el cuadro de gastos y la valorización FIFO del inventario.
9. **Histórico:** consultar promedios por semana, mes, año o rango personalizado.

## Apertura histórica

La sesión **2026-09-01** quedó creada con la apertura inicial de la planilla:

```text
USD 50.000 @ 925 = 46.250.000 CLP
```

Puedes verla cambiando la fecha en el panel. El reporte completo se importará desde esa fecha cuando esté disponible.

## Documentación funcional

- `docs/CAJA-TEMUCO-ANALISIS-DISENO.md`: lectura de `Reporte.xlsx` y `CAJA TEMUCO V5.xlsx`, hallazgos, modelo de datos, reglas contables, UI y plan de implementación.

Decisiones de negocio ya aplicadas:

- **ST = boleta nula**: se registra solo para auditoría y no suma en ningún cálculo.
- **`DEUDAS TCO`**: fuera de alcance; no se migra ni se considera.
- **`ARGENTINO T`**: ARS por transferencia, separado del efectivo.
- **Mayoristas**: cierre pactado con entregas/pagos parciales.
- **Bancos**: contrapartes de tipo `BANCO`.
- **Períodos**: semana, mes, año y rango personalizado.

## Estado

- [x] Análisis de los Excel.
- [x] Esquema SQL de referencia.
- [x] Núcleo de dominio FIFO/ST/cuentas/cuadratura.
- [x] RPC transaccionales de apertura, importación, cuentas, conteo y cierre.
- [x] Vistas de la interfaz conectadas a Supabase.
- [x] Importación de `Reporte.xlsx` con vista previa y exclusión de boletas nulas (ST).
- [x] Cierres mayoristas con precio pactado, entregas y pagos parciales.
- [x] Gastos con cuadro por categoría y período.
- [x] Períodos semana / mes / año / personalizado.
- [x] Bancos como contrapartes (`BANCO`) en cuentas corrientes.
- [ ] Migración del histórico completo de los Excel.
- [ ] Adjuntos/exportación PDF del cierre (hoy usa impresión del navegador).

## Seguridad

- La `publishable key` es pública; la protección real la entrega RLS.
- Nunca usar `service_role` en el frontend.
- No commitear `.env.local`.
