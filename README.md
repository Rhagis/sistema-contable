# APEX SOFTWARE · Sistema contable

Aplicación educativa para registrar compras y ventas, actualizar existencias y generar automáticamente el Libro Diario, CMV y liquidación mensual del IVA. No integra ARCA ni reemplaza un sistema contable de producción.

## Arquitectura

- `frontend/`: React 19, Vite, Axios y Lucide. La sesión viaja en cookie `httpOnly`; Axios usa `withCredentials`.
- `backend/src/routes/`: endpoints REST.
- `backend/src/controllers/`: entrada HTTP y respuestas.
- `backend/src/services/`: operaciones transaccionales, validaciones, stock y asientos.
- `backend/src/config/`: pool PostgreSQL.
- `backend/src/middleware/`: autenticación JWT y errores HTTP.
- `database/schema.sql`: esquema, restricciones, plan de cuentas y formas de pago iniciales.
- `database/demo_setup.sql`: actualiza una base existente con la clasificación del nuevo plan de cuentas y un usuario administrador de prueba.

## Modelo y relaciones

| Tabla | Uso y relaciones principales |
| --- | --- |
| `usuarios` | Administradores que registran las operaciones. |
| `clientes` | 1:N con ventas; guarda identificación y condición frente al IVA. |
| `proveedores` | 1:N con compras; CUIT único. |
| `productos` | Catálogo y saldo actual de stock, costo y precio. |
| `cuentas_contables` | Catálogo principal relacionado con líneas de asiento y medios de pago. |
| `cuentas_activo`, `cuentas_pasivo`, `cuentas_patrimonio_neto`, `cuentas_resultados` | Clasificación del plan contable; un trigger las mantiene sincronizadas con `cuentas_contables`. |
| `formas_pago` | Asocia cada medio con su cuenta para ventas y compras. |
| `ventas`, `detalle_ventas` | Cabecera 1:N detalles; cada línea conserva precio y costo histórico. |
| `compras`, `detalle_compras` | Cabecera 1:N detalles con precio neto de compra. |
| `pagos_operacion` | 1:N por operación; admite dividir el total entre varios medios. |
| `movimientos_stock` | Historial de entradas/salidas con saldo anterior y nuevo. |
| `asientos`, `detalle_asientos` | Asiento 1:N líneas; cada línea referencia una cuenta y Debe/Haber. |
| `liquidaciones_iva` | Un único registro por mes/año; se vincula con su asiento de cierre. |

Los importes se guardan en `NUMERIC(14,2)`. Las FK preservan referencias históricas y los catálogos se desactivan en lugar de borrarse. Las validaciones agregadas de partida doble se hacen antes de insertar el asiento, dentro de la misma transacción que la operación.

## Flujos contables

**Venta de servicios:** valida cliente, productos, cantidades y pagos; determina el tipo de factura y calcula IVA; registra venta, detalles y pagos; crea el asiento de ingreso contra la cuenta de ventas e IVA Débito. No descuenta stock ni genera un asiento de CMV: los costos de prestar el servicio deben registrarse por separado como gastos o costos del período según el criterio contable aplicado. Cualquier fallo hace `ROLLBACK`.

Las ventas existentes se pueden editar desde el listado. La edición conserva el número de comprobante, actualiza los detalles y los asientos por reversión y reaplicación. También elimina movimientos de stock de ventas anteriores, si los hubiera, y recompone el saldo desde las compras y ajustes restantes. Los precios unitarios quedan precargados y pueden ajustarse. Los cobros ya registrados se mantienen y se reasignan a los nuevos saldos a crédito; se rechaza la edición si no se pueden cubrir o si el período actual o el nuevo ya tiene una liquidación de IVA. Es una modificación interna: cualquier corrección fiscal externa debe gestionarse por separado.

**Compra:** valida proveedor, detalle, factura y medios de pago; bloquea productos; calcula IVA Crédito; registra la compra y entradas de stock; actualiza el costo al último precio neto; asienta Mercaderías e IVA Crédito contra las cuentas de pago. Todo se confirma junto o se revierte junto.

**IVA mensual:** suma IVA de ventas y compras del mes. `saldo = débito - crédito`; el saldo positivo crea IVA a Pagar, el negativo crea IVA Saldo a Favor. Una clave única impide liquidar dos veces el mismo período.

## Instalación local

Requisitos: Node.js 20.19+ y PostgreSQL 14+.

1. Crear la base `apexsoftware` en PostgreSQL (por ejemplo, desde pgAdmin).
2. Aplicar `database/schema.sql` desde la raíz del proyecto. Este esquema crea también las cuatro tablas de clasificación que usa el sistema y carga las cuentas del nuevo plan. En la instalación PostgreSQL 17 de Windows:

   ```powershell
   & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres -d apexsoftware -f database/schema.sql
   ```
3. Para una base existente creada con el esquema anterior, aplicar `database/demo_setup.sql` para agregar las tablas y cuentas del nuevo plan, `database/migrations/007_cheque_accounts.sql` para corregir las cuentas asociadas a los cheques y `database/migrations/008_compras_cuenta_por_renglon.sql` para guardar la cuenta contable elegida en cada renglón libre de compra. El primer script crea además `admin@apexsoftware.local` con la contraseña temporal `admin`; después ejecutá `npm run seed:admin` para reemplazarla con `ADMIN_EMAIL` y `ADMIN_PASSWORD` configurados en `.env`. No ejecutes el script demo en una instalación nueva ni lo uses en producción.
4. Copiar `backend/.env.example` a `backend/.env` y configurar `DATABASE_URL`, un `JWT_SECRET` aleatorio y una contraseña local para `ADMIN_PASSWORD`:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```
5. Instalar dependencias y crear el administrador:

   ```powershell
   cd backend
   npm install
   npm run seed:admin
   ```

6. En una terminal, iniciar el API:

   ```powershell
   cd backend
   npm run dev
   ```

7. En otra terminal, iniciar React:

   ```powershell
   cd frontend
   npm run dev
   ```

   Abrir `http://localhost:5173`. Vite redirige `/api` al servidor de Express en el puerto 3000.

`database/demo_setup.sql` no carga clientes, proveedores ni productos de muestra; esos catálogos se pueden crear desde la aplicación. Los casos siguientes describen escenarios de prueba, no registros precargados. Las credenciales de `.env` no se incluyen en el repositorio.

## Casos de prueba

Para los escenarios, la pagina e-commerce cuesta $5.000.000 y se vende a $6.000.000; la pagina noticias cuesta $10.000.000 y se vende a $1.075.000; la pagina educativa cuesta $800.000 y se vende a $900.000; la pagina red social cuesta $2.000.000 y se vende a $2.300.000. Cada descripcion incluye el servicio de mantenimiento mensual indicado en la imagen. El stock inicial sugerido es 100 unidades por sistema.

| Caso | Operación | Resultado contable esperado |
| --- | --- | --- |
| 1 | 05/09, ELECTRO SUR: 4 desarrollos, 3 personalizaciones y 2 mantenimientos; dividir total en efectivo y pagaré | Factura A; neto $686.000; IVA $144.060; total $830.060; costo $490.000. |
| 2 | 10/09, Martín López: 2 desarrollos y 2 paquetes de infraestructura; efectivo | Factura B; neto $196.000; IVA $41.160; total $237.160; costo $140.000. |
| 3 | 15/09, DISTRIBUIDORA CENTRAL: 15 desarrollos, 10 personalizaciones y 8 mantenimientos | Neto $1.985.000; IVA crédito $416.850; total $2.401.850. Dividir 50% banco y 50% cuenta corriente. |
| 4 | 20/09, EQUIPAMIENTOS DEL SUR: 10 paquetes de infraestructura y 10 desarrollos | Neto $760.000; IVA crédito $159.600; total $919.600; cuenta corriente. |

La liquidación de septiembre debe informar IVA Débito $185.220, IVA Crédito $576.450 y saldo a favor de $391.230. Las ventas no permiten superar el stock disponible.

Las ventas se acreditan en 4.1.02 (Ventas de bienes o servicios). Las ventas de un emisor monotributista se registran como Factura C sin IVA. En compras, los productos del catálogo continúan ingresando a Mercaderías y al stock; cada renglón libre permite elegir una cuenta de activo o gasto, con 5.2.01 como opción inicial, y queda identificado en el detalle y el asiento.

## API implementada

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- CRUD protegido: `/api/productos`, `/api/clientes`, `/api/proveedores`
- `POST/GET /api/ventas`, `PUT /api/ventas/:id`, `POST/GET /api/compras`
- `GET /api/ventas/:id`, `GET /api/compras/:id`
- `GET /api/dashboard`, `/api/cuentas`, `/api/formas-pago`
- `GET /api/asientos`, `GET /api/asientos/:id`
- `GET /api/libro-diario?desde=&hasta=&tipo=`
- `GET /api/mayor/:cuentaId`
- `GET /api/iva?mes=9&anio=2026`, `POST /api/iva/liquidar`

## Verificaciones

```powershell
cd frontend
npm run lint
npm run build

cd ../backend
npm test
```

PostgreSQL 17 está instalado y activo en el entorno. No se aplicó el esquema durante esta generación porque la conexión local solicita una contraseña que no está configurada; aplicá el DDL con las credenciales locales antes de ejecutar `npm run seed:admin` y probar operaciones. Las pruebas automatizadas ejecutadas cubren la validación de partida doble; los cuatro casos comerciales están documentados para su prueba de integración con la base configurada.