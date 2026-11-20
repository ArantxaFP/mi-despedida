import { ConflictException, ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { bloquearFilasCuentas } from './bloqueo-cuentas';

@Injectable()
export class BloqueosEdicionCuentasService {

    constructor(
        private readonly prisma: PrismaService
    ) { }

    // Adquirir un bloqueo de edición sobre una cuenta
    async adquirirBloqueo(
        cuentaId: string,
        editorId: string
    ) {

        // Generar una credencial diferente para cada bloqueo
        const token = randomBytes(32).toString('hex');

        // La base de datos solo almacenará su hash
        const tokenHash = createHash('sha256')
            .update(token)
            .digest('hex');

        return this.prisma.$transaction(async (tx) => {

            // Bloquear temporalmente la fila de la cuenta
           const cuentas = await bloquearFilasCuentas(tx, cuentaId);

            const cuenta = cuentas[0];

            if (!cuenta) {
                throw new NotFoundException(
                    'No se ha encontrado la cuenta.'
                );
            }

            // Gestiona cuentas de administradores
            if (cuenta.rol !== 'administrador') {
                throw new ForbiddenException(
                    'Esta cuenta no puede editarse desde esta sección.'
                );
            }

            // Una suspensión o una baja impiden abrir y guardar ediciones del perfil
            if (cuenta.estado === 'suspendida' || cuenta.estado === 'baja') {
                throw new ForbiddenException(
                    'La cuenta está suspendida o dada de baja y no puede editarse.'
                );
            }

            // Consultar el rol y estado reales del editor
            const editor = await tx.cuentas.findUnique({
                where: {
                    id: editorId
                },
                select: {
                    rol: true,
                    estado: true
                }
            });

            if (
                !editor ||
                editor.estado !== 'activa'
            ) {
                throw new ForbiddenException(
                    'El editor no tiene una cuenta activa.'
                );
            }

            if (
                editor.rol !== 'administrador' &&
                editor.rol !== 'superadministrador'
            ) {
                throw new ForbiddenException(
                    'El usuario no tiene permisos de edición.'
                );
            }

            // Un administrador solo puede editar su propia cuenta
            if (
                editor.rol === 'administrador' &&
                editorId !== cuentaId
            ) {
                throw new ForbiddenException(
                    'No puedes editar una cuenta ajena.'
                );
            }

            // Consultar el bloqueo existente, si lo hay
            const bloqueos = await tx.$queryRaw<
                Array<{
                    editor_id: string;
                    rol_editor: string;
                    vigente: boolean;
                }>
            >`
                SELECT
                    editor_id,
                    rol_editor,
                    (fecha_caducidad > NOW()) AS vigente
                FROM public.bloqueos_edicion_cuentas
                WHERE cuenta_id = ${cuentaId}::uuid
            `;

            const bloqueo = bloqueos[0];

            // Un superadministrador no puede desplazar a otro editor que mantenga un bloqueo vigente
            if (
                bloqueo &&
                bloqueo.vigente &&
                editor.rol === 'superadministrador' &&
                bloqueo.editor_id !== editorId
            ) {
                throw new ConflictException(
                    'Esta cuenta está siendo editada por otro usuario.'
                );
            }

            // El administrador titular puede sustituir cualquier bloqueo previo sobre su propia cuenta.
            // Esto invalida el token anterior.
            const resultado = await tx.$queryRaw<
                Array<{
                    fecha_caducidad: Date;
                }>
            >`
                INSERT INTO public.bloqueos_edicion_cuentas (
                    cuenta_id,
                    editor_id,
                    rol_editor,
                    token_hash,
                    version_inicio,
                    fecha_inicio,
                    fecha_renovacion,
                    fecha_caducidad
                )
                VALUES (
                    ${cuentaId}::uuid,
                    ${editorId}::uuid,
                    ${editor.rol},
                    ${tokenHash},
                    ${cuenta.version},
                    NOW(),
                    NOW(),
                    NOW() + INTERVAL '5 minutes'
                )
                ON CONFLICT (cuenta_id)
                DO UPDATE SET
                    editor_id = EXCLUDED.editor_id,
                    rol_editor = EXCLUDED.rol_editor,
                    token_hash = EXCLUDED.token_hash,
                    version_inicio = EXCLUDED.version_inicio,
                    fecha_inicio = EXCLUDED.fecha_inicio,
                    fecha_renovacion = EXCLUDED.fecha_renovacion,
                    fecha_caducidad = EXCLUDED.fecha_caducidad
                RETURNING fecha_caducidad
            `;

            return {
                token,
                versionInicio: cuenta.version,
                fechaCaducidad: resultado[0].fecha_caducidad,
                datosActuales: {
                    nombre: cuenta.nombre,
                    apellidos: cuenta.apellidos
                }
            };
        });
    }

    // Renovar un bloqueo de edición durante cinco minutos
    async renovarBloqueo(
        cuentaId: string,
        editorId: string,
        token: string
    ) {

        if (
            typeof token !== 'string' ||
            !/^[a-f0-9]{64}$/.test(token)
        ) {
            throw new BadRequestException(
                'La credencial de edición no es válida.'
            );
        }

        const tokenHash = createHash('sha256')
            .update(token)
            .digest('hex');

        const resultado = await this.prisma.$queryRaw<
            Array<{ fecha_caducidad: Date }>
        >`
            UPDATE public.bloqueos_edicion_cuentas AS bloqueo
            SET
                fecha_renovacion = NOW(),
                fecha_caducidad = NOW() + INTERVAL '5 minutes'
            FROM
                public.cuentas AS editor,
                public.cuentas AS cuenta
            WHERE bloqueo.cuenta_id = ${cuentaId}::uuid
                AND bloqueo.editor_id = ${editorId}::uuid
                AND bloqueo.token_hash = ${tokenHash}
                AND bloqueo.fecha_caducidad > NOW()
                AND cuenta.id = bloqueo.cuenta_id
                AND cuenta.rol = 'administrador'
                AND cuenta.estado NOT IN ('suspendida', 'baja')
                AND editor.id = bloqueo.editor_id
                AND editor.estado = 'activa'
                AND editor.rol = bloqueo.rol_editor
                AND (
                    (
                        editor.rol = 'administrador'
                        AND editor.id = cuenta.id
                    )
                    OR editor.rol = 'superadministrador'
                )
            RETURNING bloqueo.fecha_caducidad
        `;

        if (resultado.length === 0) {
            throw new ConflictException(
                'El bloqueo ha caducado, ha sido sustituido ' +
                'o ya no tienes autorización para editar.'
            );
        }

        return {
            fechaCaducidad: resultado[0].fecha_caducidad
        };
    }


    // Liberar un bloqueo cuando el usuario termina o cancela
    async liberarBloqueo(
        cuentaId: string,
        editorId: string,
        token: string
    ) {

        if (
            typeof token !== 'string' ||
            !/^[a-f0-9]{64}$/.test(token)
        ) {
            throw new BadRequestException(
                'La credencial de edición no es válida.'
            );
        }

        const tokenHash = createHash('sha256')
            .update(token)
            .digest('hex');

        const resultado = await this.prisma.$queryRaw<
            Array<{ cuenta_id: string }>
        >`
            DELETE FROM public.bloqueos_edicion_cuentas
            WHERE cuenta_id = ${cuentaId}::uuid
                AND editor_id = ${editorId}::uuid
                AND token_hash = ${tokenHash}
            RETURNING cuenta_id
        `;

        return {
            liberado: resultado.length > 0
        };
    }


    // Comprobar el bloqueo y la versión antes de guardar
    async comprobarBloqueoYVersion(
        tx: Prisma.TransactionClient,
        cuentaId: string,
        editorId: string,
        token: string,
        versionEsperada: number
    ): Promise<void> {

        if (
            typeof token !== 'string' ||
            !/^[a-f0-9]{64}$/.test(token) ||
            !Number.isSafeInteger(versionEsperada) ||
            versionEsperada < 1
        ) {
            throw new BadRequestException(
                'Los datos de control de edición no son válidos.'
            );
        }

        const tokenHash = createHash('sha256')
            .update(token)
            .digest('hex');

        // Bloquear la fila de la cuenta hasta que termine la transacción que realizará el guardado
        const cuentas = await bloquearFilasCuentas(tx, cuentaId);

        const cuenta = cuentas[0];

        if (!cuenta) {
            throw new NotFoundException(
                'No se ha encontrado la cuenta.'
            );
        }

        if (cuenta.rol !== 'administrador') {
            throw new ForbiddenException(
                'Esta cuenta no puede editarse desde esta sección.'
            );
        }

        // Una suspensión o una baja impiden abrir y guardar ediciones del perfil
            if (cuenta.estado === 'suspendida' || cuenta.estado === 'baja') {
                throw new ForbiddenException(
                    'La cuenta está suspendida o dada de baja y no puede editarse.'
                );
            }

        // Comprobar que la cuenta no ha cambiado desde que comenzó la edición
        if (cuenta.version !== versionEsperada) {
            throw new ConflictException(
                'La cuenta ha sido modificada por otro usuario. ' +
                'Actualiza los datos antes de volver a editar.'
            );
        }

        // Verificar el rol y el estado actuales del edito
        const editor = await tx.cuentas.findUnique({
            where: {
                id: editorId
            },
            select: {
                rol: true,
                estado: true
            }
        });

        if (
            !editor ||
            editor.estado !== 'activa' ||
            (
                editor.rol !== 'administrador' &&
                editor.rol !== 'superadministrador'
            )
        ) {
            throw new ForbiddenException(
                'No tienes autorización para guardar los cambios.'
            );
        }

        // El administrador solo puede modificar su cuenta
        if (
            editor.rol === 'administrador' &&
            editorId !== cuentaId
        ) {
            throw new ForbiddenException(
                'No puedes modificar una cuenta ajena.'
            );
        }

        // Consultar y bloquear también el registro de edición
        const bloqueos = await tx.$queryRaw<
            Array<{
                editor_id: string;
                rol_editor: string;
                token_hash: string;
                version_inicio: number;
                vigente: boolean;
            }>
        >`
            SELECT
                editor_id,
                rol_editor,
                token_hash,
                version_inicio,
                (fecha_caducidad > clock_timestamp()) AS vigente
            FROM public.bloqueos_edicion_cuentas
            WHERE cuenta_id = ${cuentaId}::uuid
            FOR UPDATE
        `;

        const bloqueo = bloqueos[0];

        // Comprobar que el bloqueo pertenece al editor que conserva su credencial y que sigue vigente
        if (
            !bloqueo ||
            !bloqueo.vigente ||
            bloqueo.editor_id !== editorId ||
            bloqueo.rol_editor !== editor.rol ||
            bloqueo.token_hash !== tokenHash ||
            bloqueo.version_inicio !== versionEsperada
        ) {
            throw new ConflictException(
                'La autorización de edición ha caducado ' +
                'o ha sido sustituida. Actualiza la cuenta.'
            );
        }

    }


    // Guardar nombre y apellidos de una cuenta de administrador.
    // Respeta los bloqueos y las versiones compartidas entre el administrador titular y los superadministradores.
    async guardarNombreYApellidosConBloqueo(
        cuentaId: string,
        editorId: string,
        token: string,
        versionEsperada: number,
        nombre: string,
        apellidos: string | null
    ) {

        // Validar los datos antes de iniciar la transacción
        if (
            typeof nombre !== 'string' ||
            (
                apellidos !== null &&
                typeof apellidos !== 'string'
            )
        ) {
            throw new BadRequestException(
                'Los datos personales no son válidos.'
            );
        }

        const nombreLimpio = nombre.trim();
        const apellidosLimpios = apellidos?.trim() || null;

        if (
            !nombreLimpio ||
            nombreLimpio.length > 100 ||
            (
                apellidosLimpios !== null &&
                apellidosLimpios.length > 150
            )
        ) {
            throw new BadRequestException(
                'Revisa el nombre y los apellidos.'
            );
        }

        return this.prisma.$transaction(async (tx) => {

            // Comprobar los permisos, el bloqueo y la versión.
            // La fila de cuentas permanece bloqueada durante toda esta transacción.
            await this.comprobarBloqueoYVersion(
                tx,
                cuentaId,
                editorId,
                token,
                versionEsperada
            );

            // Consultar los datos originales para identificar qué campos se han modificado realmente
            const cuenta = await tx.cuentas.findUnique({
                where: {
                    id: cuentaId
                },
                select: {
                    nombre: true,
                    apellidos: true
                }
            });

            if (!cuenta) {
                throw new NotFoundException(
                    'No se ha encontrado la cuenta.'
                );
            }

            const camposModificados: string[] = [];

            if (cuenta.nombre !== nombreLimpio) {
                camposModificados.push('nombre');
            }

            if (cuenta.apellidos !== apellidosLimpios) {
                camposModificados.push('apellidos');
            }

            // Liberar únicamente el bloqueo que pertenece a esta edición, sin afectar a otros editores
            const tokenHash = createHash('sha256')
                .update(token)
                .digest('hex');

            await tx.$executeRaw`
                DELETE FROM public.bloqueos_edicion_cuentas
                WHERE cuenta_id = ${cuentaId}::uuid
                    AND editor_id = ${editorId}::uuid
                    AND token_hash = ${tokenHash}
                `;


            // No incrementar la versión si no hay cambios
            if (camposModificados.length === 0) {
                return {
                    guardado: false,
                    version: versionEsperada,
                    mensaje: 'No hay cambios que guardar.'
                };
            }

            // Obtener el rol real del editor para la auditoría
            const editor = await tx.cuentas.findUnique({
                where: {
                    id: editorId
                },
                select: {
                    rol: true
                }
            });

            if (!editor) {
                throw new ForbiddenException(
                    'No se ha encontrado al editor.'
                );
            }

            // Guardar los cambios e incrementar la versión
            const actualizacion = await tx.$queryRaw<
                Array<{ version: number }>
            >`
                UPDATE public.cuentas
                SET
                    nombre = ${nombreLimpio},
                    apellidos = ${apellidosLimpios},
                    version = version + 1
                WHERE id = ${cuentaId}::uuid
                    AND rol = 'administrador'
                    AND version = ${versionEsperada}
                RETURNING version
            `;

            if (actualizacion.length !== 1) {
                throw new ConflictException(
                    'La cuenta ha cambiado durante la edición.'
                );
            }

            const versionNueva = actualizacion[0].version;

            // Registrar la operación sin almacenar los valores personales anteriores ni nuevos
            await tx.$executeRaw`
                INSERT INTO public.auditoria_operaciones_cuentas (
                    cuenta_afectada_id,
                    actor_id,
                    rol_actor,
                    accion,
                    resultado,
                    campos_modificados,
                    version_anterior,
                    version_nueva
                )
                VALUES (
                    ${cuentaId}::uuid,
                    ${editorId}::uuid,
                    ${editor.rol},
                    'actualizar_datos_personales',
                    'realizada',
                    ${camposModificados}::text[],
                    ${versionEsperada},
                    ${versionNueva}
                )
            `;













            return {
                guardado: true,
                version: versionNueva,
                camposModificados,
                mensaje: 'Los cambios se han guardado correctamente.'
            };
        });
    }


}
