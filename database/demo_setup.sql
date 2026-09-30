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

UPDATE productos
SET nombre = 'Pagina e-commerce',
        descripcion = 'Sistema e-commerce con mantenimiento mensual de $1.000.000',
        costo_unitario = 5000000.00,
        precio_venta = 6000000.00
WHERE nombre = 'Desarrollo de pagina web'
    AND NOT EXISTS (SELECT 1 FROM productos WHERE nombre = 'Pagina e-commerce');

UPDATE productos
SET nombre = 'Pagina noticias',
        descripcion = 'Sistema de noticias con mantenimiento mensual de $75.000',
        costo_unitario = 10000000.00,
        precio_venta = 1075000.00
WHERE nombre = 'Personalizacion de pagina web'
    AND NOT EXISTS (SELECT 1 FROM productos WHERE nombre = 'Pagina noticias');

UPDATE productos
SET nombre = 'Pagina educativa',
        descripcion = 'Sistema educativo con mantenimiento mensual de $100.000',
        costo_unitario = 800000.00,
        precio_venta = 900000.00
WHERE nombre = 'Mantenimiento tecnico mensual'
    AND NOT EXISTS (SELECT 1 FROM productos WHERE nombre = 'Pagina educativa');

UPDATE productos
SET nombre = 'Pagina red social',
        descripcion = 'Sistema de red social con mantenimiento mensual de $3.000.000',
        costo_unitario = 2000000.00,
        precio_venta = 2300000.00
WHERE nombre = 'Dominio, hosting y certificado SSL'
    AND NOT EXISTS (SELECT 1 FROM productos WHERE nombre = 'Pagina red social');

INSERT INTO productos (nombre, descripcion, stock, costo_unitario, precio_venta)
SELECT demo.nombre, demo.descripcion, 100, demo.costo, demo.precio
FROM (VALUES
    ('Pagina e-commerce', 'Sistema e-commerce con mantenimiento mensual de $1.000.000', 5000000.00::NUMERIC, 6000000.00::NUMERIC),
    ('Pagina noticias', 'Sistema de noticias con mantenimiento mensual de $75.000', 10000000.00::NUMERIC, 1075000.00::NUMERIC),
    ('Pagina educativa', 'Sistema educativo con mantenimiento mensual de $100.000', 800000.00::NUMERIC, 900000.00::NUMERIC),
    ('Pagina red social', 'Sistema de red social con mantenimiento mensual de $3.000.000', 2000000.00::NUMERIC, 2300000.00::NUMERIC)
) AS demo(nombre, descripcion, costo, precio)
WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.nombre = demo.nombre);

COMMIT;