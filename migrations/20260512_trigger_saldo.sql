CREATE OR REPLACE FUNCTION fn_actualizar_saldo_cuenta()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.cuenta_id IS NOT NULL) THEN
            IF (NEW.tipo IN ('pago_cliente', 'recibo_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual + NEW.monto_total WHERE id = NEW.cuenta_id;
            ELSIF (NEW.tipo IN ('entrega_prestamo', 'devolucion_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual - NEW.monto_total WHERE id = NEW.cuenta_id;
            END IF;
        END IF;
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.cuenta_id IS NOT NULL) THEN
            IF (OLD.tipo IN ('pago_cliente', 'recibo_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual - OLD.monto_total WHERE id = OLD.cuenta_id;
            ELSIF (OLD.tipo IN ('entrega_prestamo', 'devolucion_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual + OLD.monto_total WHERE id = OLD.cuenta_id;
            END IF;
        END IF;
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.cuenta_id IS NOT NULL) THEN
            IF (OLD.tipo IN ('pago_cliente', 'recibo_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual - OLD.monto_total WHERE id = OLD.cuenta_id;
            ELSIF (OLD.tipo IN ('entrega_prestamo', 'devolucion_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual + OLD.monto_total WHERE id = OLD.cuenta_id;
            END IF;
        END IF;
        IF (NEW.cuenta_id IS NOT NULL) THEN
            IF (NEW.tipo IN ('pago_cliente', 'recibo_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual + NEW.monto_total WHERE id = NEW.cuenta_id;
            ELSIF (NEW.tipo IN ('entrega_prestamo', 'devolucion_inversion')) THEN
                UPDATE cuentas SET saldo_actual = saldo_actual - NEW.monto_total WHERE id = NEW.cuenta_id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movimientos_saldo ON movimientos;
CREATE TRIGGER trg_movimientos_saldo
AFTER INSERT OR UPDATE OR DELETE ON movimientos
FOR EACH ROW
EXECUTE FUNCTION fn_actualizar_saldo_cuenta();
