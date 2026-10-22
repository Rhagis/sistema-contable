-- Permite conservar la cuenta contable elegida para cada renglon de compra libre.
BEGIN;

ALTER TABLE detalle_compras
    ADD COLUMN IF NOT EXISTS cuenta_id BIGINT REFERENCES cuentas_contables(id);

COMMIT;
