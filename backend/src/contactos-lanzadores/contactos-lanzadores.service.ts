import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';

@Injectable()
export class ContactosLanzadoresService {

    private readonly logger = new Logger(
        ContactosLanzadoresService.name
    );

    constructor(
        private readonly prisma: PrismaService
    ) { }

    // --------------------------------------------------
    // 1. Consultar las asignaciones del administrador
    // --------------------------------------------------

    async obtenerLanzadores(administradorId: string) {
        try {
            return await this.prisma.asignaciones_lanzadores.findMany({
                where: {
                    administrador_id: administradorId
                },
                select: {
                    id: true,
                    estado: true,
                    fecha_invitacion: true,
                    fecha_caducidad: true,
                    fecha_aceptacion: true,
                    lanzadores: {
                        select: {
                            id: true,
                            nombre: true,
                            correo: true
                        }
                    }
                },
                orderBy: {
                    fecha_invitacion: 'desc'
                }
            });
        } catch (error) {
            this.logger.error(
                'Error al consultar los lanzadores',
                error instanceof Error ? error.stack : String(error)
            );

            throw new InternalServerErrorException(
                'No se han podido consultar los lanzadores.'
            );
        }
    }

    // ----------------------------------------
    // 2. Prepara una invitación
    // El token original no se guarda en PostgreSQL
    // Se devolverá al servicio interno de correo conectado con Brevo
    // ----------------------------------------

    async prepararInvitacion(
        administradorId: string,
        correoAdministrador: string,
        datos: CrearInvitacionDto
    ) {

        const nombre = datos.nombre.trim();
        const correo = datos.correo.trim().toLowerCase();
        const correoTitular = correoAdministrador.trim().toLowerCase();

        if (!nombre || nombre.length > 100) {
            throw new BadRequestException(
                'El nombre del lanzador no es válido.'
            );
        }

        if (correo === correoTitular) {
            throw new BadRequestException(
                'No puedes invitarte como lanzador de tu propia cuenta.'
            );
        }

        // Token aleatorio de 32 bytes: 256 bits
        const token = randomBytes(32).toString('hex');

        // En la bbdd guardamos exclusivamente el hash
        const tokenHash = createHash('sha256')
            .update(token)
            .digest('hex');

        const ahora = new Date();

        const fechaCaducidad = new Date(
            ahora.getTime() + 7 * 24 * 60 * 60 * 1000
        );

        try {
            const resultado = await this.prisma.$transaction(
                async (tx) => {

                    // Buscar un lanzador existente por su correo
                    let lanzador = await tx.lanzadores.findFirst({
                        where: {
                            correo
                        }
                    });

                    if (!lanzador) {
                        lanzador = await tx.lanzadores.create({
                            data: {
                                nombre,
                                correo
                            }
                        });
                    }

                    // Comprobar si hay una asignación vigente
                    const asignacionExistente =
                        await tx.asignaciones_lanzadores.findFirst({
                            where: {
                                administrador_id: administradorId,
                                lanzador_id: lanzador.id,
                                estado: {
                                    in: ['pendiente', 'aceptada']
                                }
                            }
                        });

                    if (asignacionExistente) {
                        throw new ConflictException(
                            'Ya existe una invitación pendiente o una autorización aceptada para este lanzador.'
                        );
                    }

                    // Crear la asignación pendiente
                    const asignacion =
                        await tx.asignaciones_lanzadores.create({
                            data: {
                                administrador_id: administradorId,
                                lanzador_id: lanzador.id,
                                estado: 'pendiente',
                                fecha_invitacion: ahora,
                                fecha_caducidad: fechaCaducidad
                            }
                        });

                    // Crear el registro del token
                    const invitacion =
                        await tx.invitaciones_lanzadores.create({
                            data: {
                                asignacion_id: asignacion.id,
                                token_hash: tokenHash,
                                fecha_creacion: ahora,
                                fecha_caducidad: fechaCaducidad
                            }
                        });

                    // Registrar el evento en el historial
                    await tx.historial_asignaciones.create({
                        data: {
                            asignacion_id: asignacion.id,
                            actor_usuario_id: administradorId,
                            evento: 'invitacion_creada',
                            estado_anterior: null,
                            estado_nuevo: 'pendiente',
                            descripcion:
                                'Invitación preparada para su envío.'
                        }
                    });

                    return {
                        asignacionId: asignacion.id,
                        invitacionId: invitacion.id
                    };
                }
            );


            // El token solo sale de este método hacia el servicio de correo del backend
            return {
                ...resultado,
                token,
                nombre,
                correo,
                fechaCaducidad
            };

        } catch (error) {
            if (
                error instanceof BadRequestException ||
                error instanceof ConflictException
            ) {
                throw error;
            }

            // Conflictos de unicidad detectados por Postgre
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    'Ya existe una invitación o un lanzador con estos datos.'
                );
            }

            this.logger.error(
                'Error al preparar una invitación',
                error instanceof Error ? error.stack : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido preparar la invitación.'
            );
        }

    }
}
