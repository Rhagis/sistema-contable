# TECNOHOGAR S.A. · Sistema contable académico

Aplicación educativa para registrar compras y ventas, actualizar existencias y generar automáticamente el Libro Diario, CMV y liquidación mensual del IVA. No integra ARCA ni reemplaza un sistema contable de producción.

## Arquitectura

- `frontend/`: React 19, Vite, Axios y Lucide. La sesión viaja en cookie `httpOnly`; Axios usa `withCredentials`.
- `backend/src/routes/`: endpoints REST.
- `backend/src/controllers/`: entrada HTTP y respuestas.
- `backend/src/services/`: operaciones transaccionales, validaciones, stock y asientos.
- `backend/src/config/`: pool PostgreSQL.
- `backend/src/middleware/`: autenticación JWT y errores HTTP.
- `database/schema.sql`: esquema, restricciones, plan de cuentas y formas de pago iniciales.
- `database/demo_setup.sql`: clientes, proveedores y productos para probar los cuatro casos.

## Modelo y relaciones

| Tabla | Uso y relaciones principales |
| --- | --- |
| `usuarios` | Administradores que registran las operaciones. |
| `clientes` | 1:N con ventas; guarda identificación y condición frente al IVA. |
| `proveedores` | 1:N con compras; CUIT único. |
| `productos` | Catálogo y saldo actual de stock, costo y precio. |
| `cuentas_contables` | Plan de cuentas relacionado con líneas de asiento y medios de pago. |
| `formas_pago` | Asocia cada medio con su cuenta para ventas y compras. |
| `ventas`, `detalle_ventas` | Cabecera 1:N detalles; cada línea conserva precio y costo histórico. |
| `compras`, `detalle_compras` | Cabecera 1:N detalles con precio neto de compra. |
| `pagos_operacion` | 1:N por operación; admite dividir el total entre varios medios. |
| `movimientos_stock` | Historial de entradas/salidas con saldo anterior y nuevo. |
| `asientos`, `detalle_asientos` | Asiento 1:N líneas; cada línea referencia una cuenta y Debe/Haber. |
| `liquidaciones_iva` | Un único registro por mes/año; se vincula con su asiento de cierre. |

Los importes se guardan en `NUMERIC(14,2)`. Las FK preservan referencias históricas y los catálogos se desactivan en lugar de borrarse. Las validaciones agregadas de partida doble se hacen antes de insertar el asiento, dentro de la misma transacción que la operación.

## Flujos contables

**Venta:** valida cliente, productos, cantidades y pagos; bloquea los productos con `FOR UPDATE`; determina Factura A para Responsable Inscripto o Factura B para Consumidor Final; calcula IVA al 21%; registra venta, detalles, pagos y movimientos; crea el asiento de cobro contra Ventas e IVA Débito; calcula CMV desde el costo guardado en cada detalle y crea el segundo asiento. Cualquier fallo hace `ROLLBACK`.

**Compra:** valida proveedor, detalle, factura y medios de pago; bloquea productos; calcula IVA Crédito; registra la compra y entradas de stock; actualiza el costo al último precio neto; asienta Mercaderías e IVA Crédito contra las cuentas de pago. Todo se confirma junto o se revierte junto.

**IVA mensual:** suma IVA de ventas y compras del mes. `saldo = débito - crédito`; el saldo positivo crea IVA a Pagar, el negativo crea IVA Saldo a Favor. Una clave única impide liquidar dos veces el mismo período.

## Instalación local

Requisitos: Node.js 20.19+ y PostgreSQL 14+.

1. Crear la base `tecnohogar` en PostgreSQL (por ejemplo, desde pgAdmin).
2. Aplicar `database/schema.sql` desde la raíz del proyecto. En la instalación PostgreSQL 17 de Windows:

   ```powershell
   & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres -d tecnohogar -f database/schema.sql
   ```

3. Copiar `backend/.env.example` a `backend/.env` y configurar `DATABASE_URL`, un `JWT_SECRET` aleatorio y una contraseña local para `ADMIN_PASSWORD`:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```
4. Instalar dependencias y crear el administrador:

   ```powershell
   cd backend
   npm install
   npm run seed:admin
   ```

5. En una terminal, iniciar el API:

   ```powershell
   cd backend
   npm run dev
   ```

6. En otra terminal, iniciar React:

   ```powershell
   cd frontend
   npm run dev
   ```

   Abrir `http://localhost:5173`. Vite redirige `/api` al servidor de Express en el puerto 3000.

Para probar los datos de muestra, aplicar luego desde la raíz: `& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres -d tecnohogar -f database/demo_setup.sql`. Sus identificadores CUIT/DNI `TEST-*` son marcadores académicos, no datos fiscales reales. Las contraseñas y `.env` no se incluyen en el repositorio.

## Casos de prueba

Con los datos demo cargados, las cafeteras cuestan $35.000 y se venden a $56.000; las licuadoras cuestan $50.000 y se venden a $70.000; las aspiradoras cuestan $100.000 y se venden a $126.000; las tostadoras cuestan $35.000 y se venden a $42.000. El stock inicial es 100 unidades por producto.

| Caso | Operación | Resultado contable esperado |
| --- | --- | --- |
| 1 | 05/09, ELECTRO SUR: 4 cafeteras, 3 licuadoras y 2 aspiradoras; dividir total en efectivo y pagaré | Factura A; neto $686.000; IVA $144.060; total $830.060; CMV $490.000. |
| 2 | 10/09, Martín López: 2 cafeteras y 2 tostadoras; efectivo | Factura B; neto $196.000; IVA $41.160; total $237.160; CMV $140.000. |
| 3 | 15/09, DISTRIBUIDORA CENTRAL: 15 cafeteras, 10 licuadoras y 8 aspiradoras | Neto $1.985.000; IVA crédito $416.850; total $2.401.850. Dividir 50% banco y 50% cuenta corriente. |
| 4 | 20/09, EQUIPAMIENTOS DEL SUR: 10 tostadoras y 10 cafeteras | Neto $760.000; IVA crédito $159.600; total $919.600; cuenta corriente. |

La liquidación de septiembre debe informar IVA Débito $185.220, IVA Crédito $576.450 y saldo a favor de $391.230. Las ventas no permiten superar el stock disponible.

## API implementada

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- CRUD protegido: `/api/productos`, `/api/clientes`, `/api/proveedores`
- `POST/GET /api/ventas`, `POST/GET /api/compras`
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