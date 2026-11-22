-- ============================================================
-- PENDIENTE DE TENER NOTA PAC 2 PARA NO AFECTAR FUNCIONAMIENTO 
-- Cambios pendientes de aplicar a Postgre
-- Este archivo es de preparación
-- PENDIENTE DE EJECUTARLO CUANDO SE PUEDA ALTERAR SUPABASE Y LA BBDD
-- ============================================================

-- ============================================================
-- PAC3 - CONTROL DE VERSIONES, BLOQUEOS Y AUDITORÍA DE CUENTAS
--
-- ESTADO: IMPLEMENTADO EN SUPABASE
-- Fecha de comprobación: 21/11/2026
--
-- Los 21 elementos del inventario han sido localizados:
-- - Columna de versionado
-- - Tablas de bloqueos y auditoría
-- - Restricciones CHECK
-- - Índices
-- - RLS y restricciones de permisos de cliente
--
-- ARCHIVO HISTÓRICO DE IMPLEMENTACIÓN
-- NO VOLVER A EJECUTAR COMPLETO SOBRE LA BASE DE DATOS.
-- ============================================================

-- 1. CONTROL DE VERSIONES COMPARTIDO DE LAS CUENTAS
--
-- La versión se incrementará cada vez que se modifique una cuenta, independientemente de quién realice el cambio:
--
-- - El administrador titular de la cuenta.
-- - Un superadministrador autorizado.
--
-- El objetivo es impedir que una edición basada en datos antiguos machaque modificaciones más recientes.
--
-- REGLA DE PRIORIDAD:
-- El administrador titular tiene prioridad de edición sobre cualquier superadministrador.
--
-- El control de versiones se complementa con bloqueos de edición gestionados por Nest.
-- ============================================================

ALTER TABLE public.cuentas
ADD COLUMN version INTEGER NOT NULL DEFAULT 1;


-- Impedir que una cuenta tenga una versión inválida

ALTER TABLE public.cuentas
ADD CONSTRAINT cuentas_version_valida
CHECK (version >= 1);


-- ============================================================
-- 2. BLOQUEOS DE EDICIÓN DE CUENTAS
-- ============================================================
--
-- Permite controlar quién está editando una cuenta.
--
-- REGLAS:
--
-- 1. El administrador titular tiene prioridad sobre cualquier superadministrador.
--
-- 2. Un superadministrador no puede editar una cuenta mientras su titular mantiene un bloqueo activo.
--
-- 3. Si el administrador comienza a editar mientras un superadministrador tiene el bloqueo, el titular puede recuperar la prioridad.
--
-- 4. Solo puede existir un bloqueo vigente por cuenta.
--
-- 5. Los bloqueos duran 5 minutos y pueden renovarse.
--
-- 6. Un bloqueo caducado no autoriza nuevas escrituras.
--
-- 7. Los bloqueos se validarán desde NestJS junto con el control de versiones.
--
-- ============================================================

CREATE TABLE public.bloqueos_edicion_cuentas (

    -- Cuenta cuyos datos están siendo editados.
    -- Es clave primaria para impedir múltiples bloqueos simultáneos sobre una misma cuenta.
    cuenta_id UUID PRIMARY KEY
        REFERENCES public.cuentas(id)
        ON DELETE CASCADE,

    -- Usuario que está realizando la edición
    editor_id UUID NOT NULL
        REFERENCES public.cuentas(id)
        ON DELETE CASCADE,

    -- Rol de quien está editando
    rol_editor VARCHAR(20) NOT NULL,

    -- Identificador seguro del bloqueo
    token_hash VARCHAR(64) NOT NULL UNIQUE,

    -- Versión de la cuenta cuando se adquirió el bloqueo.
    -- Permite detectar cambios realizados desde el inicio de la edición, aunque el bloqueo siga vigente.
    version_inicio INTEGER NOT NULL
        CHECK (version_inicio >= 1),


    -- Fecha de adquisición del bloqueo
    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Última renovación
    fecha_renovacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Caducidad inicial: cinco minutos
    fecha_caducidad TIMESTAMPTZ NOT NULL
        DEFAULT (NOW() + INTERVAL '5 minutes'),

    -- Roles permitidos
    CONSTRAINT bloqueos_cuentas_rol_valido
        CHECK (
            rol_editor IN (
                'administrador',
                'superadministrador'
            )
        ),

    -- Un administrador solo puede bloquear la edición de su propia cuenta
    CONSTRAINT bloqueos_cuentas_titular
        CHECK (
            rol_editor <> 'administrador'
            OR editor_id = cuenta_id
        ),

    -- La caducidad debe ser posterior al inicio y a la última renovación del bloqueo
    CONSTRAINT bloqueos_cuentas_fechas_validas
        CHECK (
            fecha_caducidad > fecha_inicio
            AND fecha_renovacion >= fecha_inicio
            AND fecha_caducidad > fecha_renovacion
        )

);


-- Facilitar la localización de bloqueos caducados
CREATE INDEX bloqueos_cuentas_caducidad_idx
ON public.bloqueos_edicion_cuentas (
    fecha_caducidad
);


-- Facilitar las consultas por usuario editor
CREATE INDEX bloqueos_cuentas_editor_idx
ON public.bloqueos_edicion_cuentas (
    editor_id
);


-- Protección frente al acceso directo desde clientes.
-- Los bloqueos se gestionarán exclusivamente desde el backend autorizado.

ALTER TABLE public.bloqueos_edicion_cuentas
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bloqueos_edicion_cuentas
FROM PUBLIC, anon, authenticated;




-- ============================================================
-- 3. AUDITORÍA DE OPERACIONES SOBRE CUENTAS
-- ============================================================
--
-- Registra las operaciones realizadas sobre las cuentas.
--
-- Permite identificar:
-- - Qué cuenta se ha visto afectada.
-- - Quién ha realizado la operación.
-- - El rol del usuario que la ha realizado.
-- - Qué operación se ha intentado.
-- - Si se ha completado o rechazado.
-- - Qué campos se han modificado, sin guardar sus valores.
-- - La versión anterior y posterior de la cuenta.
-- - Cuándo ha ocurrido.
--
-- No almacena contraseñas, tokens, mensajes privados ni valores anteriores o nuevos de datos personales.
--
-- ============================================================

CREATE TABLE public.auditoria_operaciones_cuentas (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificador de la cuenta afectada.
    -- No se utiliza una clave foránea para permitir conservar temporalmente la auditoría aunque
    -- la cuenta haya sido eliminada.
    cuenta_afectada_id UUID NOT NULL,

    -- Identificador del usuario que realiza la operación.
    -- Puede ser NULL para operaciones automáticas.
    actor_id UUID,

    -- Rol del actor en el momento de la operación
    rol_actor VARCHAR(20) NOT NULL,

    -- Operación realizada o intentada
    accion VARCHAR(60) NOT NULL,

    -- Resultado de la operación
    resultado VARCHAR(20) NOT NULL,

    -- Nombres de los campos modificados.
    -- Nunca se almacenarán sus valores.
    campos_modificados TEXT[] NOT NULL DEFAULT '{}',

    -- Código identificativo de un rechazo o incidencia.
    -- Evita guardar mensajes libres con datos personales.
    motivo_codigo VARCHAR(60),

    -- Versiones utilizadas en el control de concurrencia
    version_anterior INTEGER,
    version_nueva INTEGER,

    -- Fecha de la operación
    fecha_evento TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT auditoria_cuentas_rol_valido
        CHECK (
            rol_actor IN (
                'administrador',
                'superadministrador',
                'sistema'
            )
        ),

    CONSTRAINT auditoria_cuentas_resultado_valido
        CHECK (
            resultado IN (
                'realizada',
                'rechazada',
                'error'
            )
        ),

    CONSTRAINT auditoria_cuentas_versiones_validas
        CHECK (
            (version_anterior IS NULL OR version_anterior >= 1)
            AND
            (version_nueva IS NULL OR version_nueva >= 1)
        ),

    CONSTRAINT auditoria_cuentas_actor_valido
        CHECK (
            (rol_actor = 'sistema' AND actor_id IS NULL)
            OR
            (rol_actor <> 'sistema' AND actor_id IS NOT NULL)
        )
);


-- Consultar el historial de una cuenta
CREATE INDEX auditoria_cuentas_cuenta_fecha_idx
ON public.auditoria_operaciones_cuentas (
    cuenta_afectada_id,
    fecha_evento DESC
);


-- Consultar las operaciones realizadas por un usuario
CREATE INDEX auditoria_cuentas_actor_fecha_idx
ON public.auditoria_operaciones_cuentas (
    actor_id,
    fecha_evento DESC
);


-- Facilitar la gestión de los plazos de conservación
CREATE INDEX auditoria_cuentas_fecha_idx
ON public.auditoria_operaciones_cuentas (
    fecha_evento
);


-- Impedir el acceso directo desde los clientes.
-- La auditoría será gestionada por Nest.

ALTER TABLE public.auditoria_operaciones_cuentas
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auditoria_operaciones_cuentas
FROM PUBLIC, anon, authenticated;


