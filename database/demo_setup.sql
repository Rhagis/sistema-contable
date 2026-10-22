-- MIGRACION DEL PLAN DE CUENTAS - sistema-contable (rama main)
-- Fuente: PDF "cuentas contables.pdf", paginas 1 a 3.
-- Ejecutar una sola vez contra la base existente; es re-ejecutable.
-- IMPORTANTE: respaldar previamente la base con pg_dump.
-- Esta migracion NO elimina cuentas_contables porque formas_pago y
-- detalle_asientos referencian sus IDs, y el backend busca codigos fijos.
BEGIN;

-- 1. Cuatro tablas reales de clasificacion (mismo ID que la cuenta matriz).
CREATE TABLE IF NOT EXISTS cuentas_activo (
    cuenta_id BIGINT PRIMARY KEY REFERENCES cuentas_contables(id) ON DELETE CASCADE,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL,
    activo BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS cuentas_pasivo (
    cuenta_id BIGINT PRIMARY KEY REFERENCES cuentas_contables(id) ON DELETE CASCADE,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL,
    activo BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS cuentas_patrimonio_neto (
    cuenta_id BIGINT PRIMARY KEY REFERENCES cuentas_contables(id) ON DELETE CASCADE,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL,
    activo BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS cuentas_resultados (
    cuenta_id BIGINT PRIMARY KEY REFERENCES cuentas_contables(id) ON DELETE CASCADE,
    codigo VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL,
    tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO')),
    activo BOOLEAN NOT NULL
);

-- 2. Se agregan las cuentas del PDF que faltan en el plan inicial.
-- Los codigos existentes (IVA, Mercaderias, Ventas, etc.) se conservan.
-- No se actualizan cuentas preexistentes ni se alteran IDs historicos.
INSERT INTO cuentas_contables (codigo, nombre, tipo) VALUES
    -- ACTIVO (pagina 3)
    ('1.1.08', 'Deudores Varios', 'ACTIVO'),
    ('1.1.09', 'Valores a Depositar', 'ACTIVO'),
    ('1.1.10', 'Valores Diferidos a Depositar', 'ACTIVO'),
    ('1.1.11', 'Tarjeta de Credito XX', 'ACTIVO'),
    ('1.2.01', 'Rodados', 'ACTIVO'),
    ('1.2.02', 'Muebles y Utiles', 'ACTIVO'),
    ('1.2.03', 'Instalaciones', 'ACTIVO'),
    ('1.2.04', 'Inmuebles', 'ACTIVO'),
    ('1.2.05', 'Maquinarias', 'ACTIVO'),
    ('1.2.06', 'Materias Primas', 'ACTIVO'),
    ('1.2.07', 'Equipos de Computacion', 'ACTIVO'),
    -- PASIVO (pagina 3)
    ('2.1.05', 'Acreedores Varios', 'PASIVO'),
    ('2.1.06', 'Valores Diferidos a Pagar', 'PASIVO'),
    -- PATRIMONIO NETO (pagina 3)
    ('3.1.02', 'Reservas', 'PATRIMONIO_NETO'),
    ('3.1.03', 'Utilidad del Ejercicio', 'PATRIMONIO_NETO'),
    ('3.1.04', 'Quebranto del Ejercicio', 'PATRIMONIO_NETO'),
    -- RESULTADOS POSITIVOS (pagina 3)
    ('4.1.02', 'Ventas (Bienes o Servicios prestados)', 'RESULTADO_POSITIVO'),
    ('4.1.03', 'Alquileres Ganados', 'RESULTADO_POSITIVO'),
    ('4.1.04', 'Intereses Ganados', 'RESULTADO_POSITIVO'),
    ('4.1.05', 'Descuentos Obtenidos', 'RESULTADO_POSITIVO'),
    ('4.1.06', 'Comisiones Ganadas', 'RESULTADO_POSITIVO'),
    -- RESULTADOS NEGATIVOS (pagina 3)
    ('5.2.03', 'Alquileres Perdidos', 'RESULTADO_NEGATIVO'),
    ('5.2.04', 'Sueldos y Jornales', 'RESULTADO_NEGATIVO'),
    ('5.2.05', 'Fletes y Acarreos', 'RESULTADO_NEGATIVO'),
    ('5.2.06', 'Descuentos Cedidos', 'RESULTADO_NEGATIVO'),
    ('5.2.07', 'Seguros', 'RESULTADO_NEGATIVO'),
    ('5.2.08', 'Impuestos', 'RESULTADO_NEGATIVO'),
    ('5.2.09', 'Intereses Perdidos', 'RESULTADO_NEGATIVO'),
    ('5.2.10', 'Gastos Generales', 'RESULTADO_NEGATIVO'),
    ('5.2.11', 'Comisiones Perdidas', 'RESULTADO_NEGATIVO'),
    ('5.2.12', 'Publicidad Perdida', 'RESULTADO_NEGATIVO')
ON CONFLICT DO NOTHING;

-- Actualizar las cuentas de los cheques en instalaciones que ya tenian estos medios de pago.
UPDATE formas_pago fp
SET nombre = 'Cheque',
    cuenta_venta_id = recibido.id,
    cuenta_compra_id = emitido.id
FROM cuentas_contables recibido, cuentas_contables emitido
WHERE fp.codigo = 'CHEQUE_PROPIO'
  AND recibido.codigo = '1.1.09'
  AND emitido.codigo = '1.1.02';

UPDATE formas_pago fp
SET cuenta_venta_id = recibido.id,
    cuenta_compra_id = emitido.id
FROM cuentas_contables recibido, cuentas_contables emitido
WHERE fp.codigo = 'CHEQUE_DIFERIDO'
  AND recibido.codigo = '1.1.10'
  AND emitido.codigo = '2.1.06';

-- 3. Una funcion sincroniza las cuatro tablas cuando cambia la matriz.
CREATE OR REPLACE FUNCTION sincronizar_clasificacion_cuenta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- ON DELETE CASCADE limpia automaticamente las 4 tablas.
        RETURN OLD;
    END IF;

    -- Eliminar cualquier clasificacion anterior (p. ej., si cambio tipo).
    DELETE FROM cuentas_activo WHERE cuenta_id = NEW.id;
    DELETE FROM cuentas_pasivo WHERE cuenta_id = NEW.id;
    DELETE FROM cuentas_patrimonio_neto WHERE cuenta_id = NEW.id;
    DELETE FROM cuentas_resultados WHERE cuenta_id = NEW.id;

    CASE NEW.tipo
      WHEN 'ACTIVO' THEN
        INSERT INTO cuentas_activo (cuenta_id, codigo, nombre, activo)
        VALUES (NEW.id, NEW.codigo, NEW.nombre, NEW.activo);
      WHEN 'PASIVO' THEN
        INSERT INTO cuentas_pasivo (cuenta_id, codigo, nombre, activo)
        VALUES (NEW.id, NEW.codigo, NEW.nombre, NEW.activo);
      WHEN 'PATRIMONIO_NETO' THEN
        INSERT INTO cuentas_patrimonio_neto (cuenta_id, codigo, nombre, activo)
        VALUES (NEW.id, NEW.codigo, NEW.nombre, NEW.activo);
      WHEN 'RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO' THEN
        INSERT INTO cuentas_resultados (cuenta_id, codigo, nombre, tipo, activo)
        VALUES (NEW.id, NEW.codigo, NEW.nombre, NEW.tipo, NEW.activo);
    END CASE;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_clasificacion_cuenta ON cuentas_contables;
CREATE TRIGGER trg_sincronizar_clasificacion_cuenta
AFTER INSERT OR UPDATE OF codigo, nombre, tipo, activo
ON cuentas_contables
FOR EACH ROW EXECUTE FUNCTION sincronizar_clasificacion_cuenta();

-- 4. Poblar o reparar la clasificacion de las cuentas ya existentes.
-- Al reejecutarse, reconstruye las tablas a partir del catalogo principal.
TRUNCATE TABLE cuentas_activo, cuentas_pasivo, cuentas_patrimonio_neto, cuentas_resultados;
INSERT INTO cuentas_activo (cuenta_id, codigo, nombre, activo)
SELECT id, codigo, nombre, activo FROM cuentas_contables WHERE tipo = 'ACTIVO';
INSERT INTO cuentas_pasivo (cuenta_id, codigo, nombre, activo)
SELECT id, codigo, nombre, activo FROM cuentas_contables WHERE tipo = 'PASIVO';
INSERT INTO cuentas_patrimonio_neto (cuenta_id, codigo, nombre, activo)
SELECT id, codigo, nombre, activo FROM cuentas_contables WHERE tipo = 'PATRIMONIO_NETO';
INSERT INTO cuentas_resultados (cuenta_id, codigo, nombre, tipo, activo)
SELECT id, codigo, nombre, tipo, activo FROM cuentas_contables
WHERE tipo IN ('RESULTADO_POSITIVO', 'RESULTADO_NEGATIVO');

-- 5. Administrador de pruebas: clave con hash bcrypt (pgcrypto).
-- No guardar contrasenas en texto plano en usuarios.
-- Requiere permisos para habilitar la extension pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
VALUES (
    'Administrador',
    'admin@apexsoftware.local',
    crypt('admin', gen_salt('bf', 12)),
    'ADMIN',
    TRUE
)
ON CONFLICT (email) DO UPDATE
SET nombre = EXCLUDED.nombre,
    password_hash = EXCLUDED.password_hash,
    rol = EXCLUDED.rol,
    activo = TRUE;

COMMIT;

-- Verificacion: cuatro tablas y total general.
SELECT 'ACTIVO' AS grupo, COUNT(*) AS cuentas FROM cuentas_activo
UNION ALL SELECT 'PASIVO', COUNT(*) FROM cuentas_pasivo
UNION ALL SELECT 'PATRIMONIO_NETO', COUNT(*) FROM cuentas_patrimonio_neto
UNION ALL SELECT 'RESULTADOS', COUNT(*) FROM cuentas_resultados
UNION ALL SELECT 'TOTAL', COUNT(*) FROM cuentas_contables;

-- Consultas de ejemplo:
-- SELECT * FROM cuentas_activo ORDER BY codigo;
-- SELECT * FROM cuentas_pasivo ORDER BY codigo;
-- SELECT * FROM cuentas_patrimonio_neto ORDER BY codigo;
-- SELECT * FROM cuentas_resultados ORDER BY tipo, codigo;
