-- Asocia cheques recibidos y diferidos con sus cuentas contables especificas.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cuentas_contables WHERE codigo = '1.1.09')
       OR NOT EXISTS (SELECT 1 FROM cuentas_contables WHERE codigo = '1.1.10')
       OR NOT EXISTS (SELECT 1 FROM cuentas_contables WHERE codigo = '2.1.06') THEN
        RAISE EXCEPTION 'Faltan cuentas para cheques; ejecute database/demo_setup.sql antes de esta migracion.';
    END IF;
END $$;

INSERT INTO formas_pago (codigo, nombre, cuenta_venta_id, cuenta_compra_id)
SELECT 'CHEQUE_PROPIO', 'Cheque', recibido.id, emitido.id
FROM cuentas_contables recibido, cuentas_contables emitido
WHERE recibido.codigo = '1.1.09' AND emitido.codigo = '1.1.02'
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    cuenta_venta_id = EXCLUDED.cuenta_venta_id,
    cuenta_compra_id = EXCLUDED.cuenta_compra_id;

INSERT INTO formas_pago (codigo, nombre, cuenta_venta_id, cuenta_compra_id)
SELECT 'CHEQUE_DIFERIDO', 'Cheque diferido', recibido.id, emitido.id
FROM cuentas_contables recibido, cuentas_contables emitido
WHERE recibido.codigo = '1.1.10' AND emitido.codigo = '2.1.06'
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    cuenta_venta_id = EXCLUDED.cuenta_venta_id,
    cuenta_compra_id = EXCLUDED.cuenta_compra_id;

COMMIT;
