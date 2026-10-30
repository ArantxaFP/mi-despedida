import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CorreoService } from '../correo/correo.service';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';

@Injectable()
export class ContactosLanzadoresService {

    private readonly logger = new Logger(
        ContactosLanzadoresService.name
    );

    constructor(
        private readonly prisma: PrismaService,
        private readonly correoService: CorreoService,
        private readonly config: ConfigService
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

        const ahora = new Date();

        const nuevaCaducidad = new Date(
            ahora.getTime() + 7 * 24 * 60 * 60 * 1000
        );

        const token = randomBytes(32).toString('hex');

        const tokenHash = createHash('sha256')
            .update(token)
            .digest('hex');

        try {
            const resultado = await this.prisma.$transaction(
                async (tx) => {

                    // 1. Localizar o crear al lanzador
                    let lanzador = await tx.lanzadores.findFirst({
                        where: { correo }
                    });

                    if (!lanzador) {
                        lanzador = await tx.lanzadores.create({
                            data: {
                                nombre,
                                correo
                            }
                        });
                    }

                    // 2. Impedir que el titular sea su propio lanzador, incluso si ha cambiado de dirección de correo.
                    if (lanzador.usuario_id === administradorId) {
                        throw new BadRequestException(
                            'No puedes actuar como lanzador de tu propia cuenta.'
                        );
                    }

                    // 3. Buscar asignaciones pendientes o aceptadas
                    const asignacionExistente =
                        await tx.asignaciones_lanzadores.findFirst({
                            where: {
                                administrador_id: administradorId,
                                lanzador_id: lanzador.id,
                                estado: {
                                    in: ['pendiente', 'aceptada']
                                }
                            },
                            orderBy: {
                                fecha_invitacion: 'desc'
                            }
                        });

                    let asignacion = asignacionExistente;
                    let esReintento = false;

                    if (asignacion?.estado === 'aceptada') {
                        throw new ConflictException(
                            'Este lanzador ya tiene una autorización aceptada.'
                        );
                    }

                    if (asignacion?.estado === 'pendiente') {

                        // 4. Caducar una asignación que superó su plazo
                        if (asignacion.fecha_caducidad <= ahora) {

                            await tx.invitaciones_lanzadores.updateMany({
                                where: {
                                    asignacion_id: asignacion.id,
                                    fecha_utilizacion: null,
                                    fecha_invalidacion: null
                                },
                                data: {
                                    fecha_invalidacion: ahora
                                }
                            });

                            await tx.asignaciones_lanzadores.update({
                                where: { id: asignacion.id },
                                data: {
                                    estado: 'caducada',
                                    updated_at: ahora
                                }
                            });

                            await tx.historial_asignaciones.create({
                                data: {
                                    asignacion_id: asignacion.id,
                                    actor_usuario_id: null,
                                    evento: 'invitacion_caducada',
                                    estado_anterior: 'pendiente',
                                    estado_nuevo: 'caducada',
                                    descripcion:
                                        'La invitación ha superado su plazo de validez.'
                                }
                            });

                            asignacion = null;

                        } else {

                            // 5. Comprobar si ya existe un enlace activo
                            const tokenActivo =
                                await tx.invitaciones_lanzadores.findFirst({
                                    where: {
                                        asignacion_id: asignacion.id,
                                        fecha_utilizacion: null,
                                        fecha_invalidacion: null
                                    }
                                });

                            if (tokenActivo) {
                                throw new ConflictException(
                                    'Ya existe una invitación pendiente para este lanzador.'
                                );
                            }

                            // Si el enlace anterior fue invalidado tras un problema de envío, se reutiliza la asignación pendiente
                            esReintento = true;
                        }
                    }

                    // 6. Crear una asignación únicamente si hace falta
                    if (!asignacion) {
                        asignacion = await tx.asignaciones_lanzadores.create({
                            data: {
                                administrador_id: administradorId,
                                lanzador_id: lanzador.id,
                                estado: 'pendiente',
                                fecha_invitacion: ahora,
                                fecha_caducidad: nuevaCaducidad
                            }
                        });
                    }

                    // El reintento conserva la caducidad original
                    const fechaCaducidad = asignacion.fecha_caducidad;

                    // 7. Crear un nuevo enlace de un solo uso
                    const invitacion =
                        await tx.invitaciones_lanzadores.create({
                            data: {
                                asignacion_id: asignacion.id,
                                token_hash: tokenHash,
                                fecha_creacion: ahora,
                                fecha_caducidad: fechaCaducidad,
                                estado_envio: 'preparado'
                            }
                        });

                    // 8. Registrar la creación o el reintento
                    await tx.historial_asignaciones.create({
                        data: {
                            asignacion_id: asignacion.id,
                            actor_usuario_id: administradorId,
                            evento: esReintento
                                ? 'invitacion_reenviada'
                                : 'invitacion_creada',
                            estado_anterior: esReintento
                                ? 'pendiente'
                                : null,
                            estado_nuevo: 'pendiente',
                            descripcion: esReintento
                                ? 'Nuevo intento de envío de invitación.'
                                : 'Invitación preparada para su envío.'
                        }
                    });

                    return {
                        asignacionId: asignacion.id,
                        invitacionId: invitacion.id,
                        fechaCaducidad
                    };
                }
            );

            // No se almacena ni se envía al navegador el token original
            return {
                ...resultado,
                token,
                nombre,
                correo
            };

        } catch (error) {
            if (
                error instanceof BadRequestException ||
                error instanceof ConflictException
            ) {
                throw error;
            }

            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    'Ya existe una asignación o un lanzador con estos datos.'
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

    // --------------------------------------------------
    // 3. Crear y enviar una invitación mediante Brevo
    // --------------------------------------------------

    async crearYEnviarInvitacion(
        administradorId: string,
        correoAdministrador: string,
        datos: CrearInvitacionDto
    ) {
        // Impide crear invitaciones sin tener preparado el recorrido público de aceptación
        if (
            this.config.get<string>('HABILITAR_ENVIO_INVITACIONES')
            !== 'true'
        ) {
            throw new ServiceUnavailableException(
                'El envío de invitaciones todavía no está habilitado.'
            );
        }

        const frontendUrl =
            this.config.getOrThrow<string>('FRONTEND_URL');

        // Crea la asignación, el token y el historial
        const invitacion = await this.prepararInvitacion(
            administradorId,
            correoAdministrador,
            datos
        );

        // OJO URL de la futura pantalla pública de invitaciones
        const enlace = new URL(
            '/invitacion-lanzador',
            frontendUrl
        );

        enlace.searchParams.set('token', invitacion.token);

        let messageId: string;

        try {
            // Solicita el envío a Brevo
            messageId =
                await this.correoService.enviarInvitacionLanzador(
                    invitacion.correo,
                    invitacion.nombre,
                    enlace.toString()
                );

        } catch (error) {

            // Si Brevo no confirma el envío, se invalida el token.
            // Pero se conserva el historial para auditoría.
            // No se puede asegurar si Brevo recibió la petición.
            // Se invalida el enlace, pero se diferencia el resultado del correo con una revocación.
            try {
                await this.prisma.invitaciones_lanzadores.update({
                    where: {
                        id: invitacion.invitacionId
                    },
                    data: {
                        estado_envio: 'incierto',
                        fecha_invalidacion: new Date()
                    }
                });

            } catch (actualizacionError) {
                this.logger.error(
                    'No se ha podido invalidar el token tras un error de Brevo.',
                    actualizacionError instanceof Error
                        ? actualizacionError.stack
                        : String(actualizacionError)
                );
            }

            this.logger.error(
                'Brevo no ha confirmado el envío de la invitación.',
                error instanceof Error ? error.message : String(error)
            );

            throw new ServiceUnavailableException(
                'No se ha podido confirmar el envío de la invitación.'
            );
        }

        // Brevo ha aceptado la solicitud.
        // Esto todavía no confirma la entrega al destinatario.
        try {
            await this.prisma.invitaciones_lanzadores.update({
                where: {
                    id: invitacion.invitacionId
                },
                data: {
                    estado_envio: 'aceptado_por_brevo'
                }
            });

        } catch (error) {
            this.logger.error(
                'Brevo ha aceptado el correo, pero no se ha podido actualizar su estado.',
                error instanceof Error ? error.stack : String(error)
            );

            throw new InternalServerErrorException(
                'El correo se ha solicitado, pero no se ha podido confirmar su registro.'
            );
        }

        return {
            asignacionId: invitacion.asignacionId,
            estado: 'pendiente',
            correoSolicitado: true,
            mensaje: 'Brevo ha aceptado la solicitud de envío.',
            messageId
        };
    }

}


