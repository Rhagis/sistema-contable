-- Permite registrar gastos de compra sin numero de factura.
BEGIN;

ALTER TABLE compras
    ALTER COLUMN numero_comprobante DROP NOT NULL;

COMMIT;
