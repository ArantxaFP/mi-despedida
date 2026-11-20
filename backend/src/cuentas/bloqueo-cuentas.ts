import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

export type TransaccionCuentas = Pick<Prisma.TransactionClient, '$queryRaw'>;

// La fila permanece bloqueada hasta que termina la transacción.
// Si intervienen dos cuentas, se bloquean en orden de id.
export function bloquearFilasCuentas(
    tx: TransaccionCuentas,
    cuentaId: string,
    otraCuentaId: string | null = null
) {
    return tx.$queryRaw<Array<{
        id: string;
        rol: string;
        estado: string;
        version: number;
        nombre: string;
        apellidos: string | null;
    }>>`
        SELECT id, rol, estado, version, nombre, apellidos
        FROM public.cuentas
        WHERE id IN (${cuentaId}::uuid, ${otraCuentaId}::uuid)
        ORDER BY id
        FOR UPDATE
    `;
}

// Comprobar el titular y el estado de la cuenta del lanzador
export async function bloquearCuentas(
    tx: TransaccionCuentas,
    administradorId: string,
    usuarioLanzadorId: string | null = null
) {
    const cuentas = await bloquearFilasCuentas(tx, administradorId, usuarioLanzadorId);

    return {
        titularActiva: cuentas.some(cuenta =>
            cuenta.id === administradorId &&
            cuenta.rol === 'administrador' &&
            cuenta.estado === 'activa'
        ),
        estadoLanzador: cuentas.find(cuenta =>
            cuenta.id === usuarioLanzadorId
        )?.estado
    };
}

// Usar dentro de la misma transacción que realiza la escritura
export async function bloquearCuentaActiva(
    tx: TransaccionCuentas,
    administradorId: string
): Promise<void> {
    const { titularActiva } = await bloquearCuentas(tx, administradorId);

    if (!titularActiva) {
        throw new ForbiddenException(
            'Tu cuenta no está habilitada para realizar esta operación.'
        );
    }
}