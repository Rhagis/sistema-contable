BEGIN;

INSERT INTO clientes (razon_social, identificacion, domicilio, condicion_iva)
SELECT 'ELECTRO SUR S.R.L.', 'TEST-DNI-0001', 'Av. Corrientes 1000, C.A.B.A.', 'RESPONSABLE_INSCRIPTO'
WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE identificacion = 'TEST-DNI-0001');

INSERT INTO clientes (razon_social, identificacion, domicilio, condicion_iva)
SELECT 'Martin Lopez', 'TEST-DNI-0002', 'C.A.B.A.', 'CONSUMIDOR_FINAL'
WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE identificacion = 'TEST-DNI-0002');

INSERT INTO proveedores (razon_social, cuit, domicilio, condicion_iva)
SELECT 'DISTRIBUIDORA CENTRAL S.A.', 'TEST-CUIT-0001', 'C.A.B.A.', 'RESPONSABLE_INSCRIPTO'
WHERE NOT EXISTS (SELECT 1 FROM proveedores WHERE cuit = 'TEST-CUIT-0001');

INSERT INTO proveedores (razon_social, cuit, domicilio, condicion_iva)
SELECT 'EQUIPAMIENTOS DEL SUR S.R.L.', 'TEST-CUIT-0002', 'Buenos Aires', 'RESPONSABLE_INSCRIPTO'
WHERE NOT EXISTS (SELECT 1 FROM proveedores WHERE cuit = 'TEST-CUIT-0002');

INSERT INTO productos (nombre, descripcion, stock, costo_unitario, precio_venta)
SELECT demo.nombre, demo.descripcion, 100, demo.costo, demo.precio
FROM (VALUES
    ('Cafetera', 'Cafetera electrica', 35000.00::NUMERIC, 56000.00::NUMERIC),
    ('Licuadora', 'Licuadora domestica', 50000.00::NUMERIC, 70000.00::NUMERIC),
    ('Aspiradora', 'Aspiradora compacta', 100000.00::NUMERIC, 126000.00::NUMERIC),
    ('Tostadora', 'Tostadora electrica', 35000.00::NUMERIC, 42000.00::NUMERIC)
) AS demo(nombre, descripcion, costo, precio)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.nombre = demo.nombre);

COMMIT;