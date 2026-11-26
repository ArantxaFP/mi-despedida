import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { bloquearCuentaActiva, bloquearCuentas } from '../cuentas/bloqueo-cuentas';
import { CorreoService } from '../correo/correo.service';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';
import { SolicitarActivacionDto } from './dto/solicitar-activacion.dto';
import type { Prisma } from '../generated/prisma/client';
import { obtenerUrlBackoffice } from '../configuracion/urls-backoffice';


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

        await this.actualizarCaducidades(administradorId);

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
        datos: CrearInvitacionDto,
        permitirReenvio = false
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

                    // Coordinar el alta o reenvío con la baja de cualquiera de las dos cuentas
                    const { titularActiva, estadoLanzador } = await bloquearCuentas(
                        tx,
                        administradorId,
                        lanzador?.usuario_id ?? null
                    );

                    if (!titularActiva) {
                        throw new ForbiddenException(
                            'Tu cuenta no está habilitada para realizar esta operación.'
                        );
                    }

                    if (
                        estadoLanzador === 'baja' ||
                        estadoLanzador === 'finalizada' ||
                        estadoLanzador === 'finalizada_con_incidencias'
                    ) {
                        throw new ConflictException(
                            'Esta persona no puede recibir una nueva invitación como lanzador.'
                        );
                    }

                    if (!lanzador) {
                        lanzador = await tx.lanzadores.create({
                            data: {
                                nombre,
                                correo
                            }
                        });
                    }

                    // 2. Impedir que el titular sea su propio lanzador, incluso si ha cambiado de dirección de correo
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

                                if (!permitirReenvio) {
                                    throw new ConflictException(
                                        'Ya existe una invitación pendiente para este lanzador.'
                                    );
                                }

                                // El enlace anterior deja de funcionar.
                                // También se invalidan sus verificaciones temporales.
                                await tx.verificaciones_invitaciones_lanzadores.updateMany({
                                    where: {
                                        invitacion_id: tokenActivo.id,
                                        fecha_utilizacion: null,
                                        fecha_invalidacion: null
                                    },
                                    data: {
                                        fecha_invalidacion: ahora
                                    }
                                });

                                await tx.invitaciones_lanzadores.updateMany({
                                    where: {
                                        id: tokenActivo.id,
                                        fecha_utilizacion: null,
                                        fecha_invalidacion: null
                                    },
                                    data: {
                                        fecha_invalidacion: ahora
                                    }
                                });
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
                error instanceof ConflictException ||
                error instanceof ForbiddenException
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
        datos: CrearInvitacionDto,
        origen?: string,
        permitirReenvio = false
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

        const frontendUrl = obtenerUrlBackoffice(
            this.config,
            origen
        );

        // Crea la asignación, el token y el historial
        const invitacion = await this.prepararInvitacion(
            administradorId,
            correoAdministrador,
            datos,
            permitirReenvio
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



    // --------------------------------------------------
    // 4. Retirar una invitación pendiente
    // --------------------------------------------------

    async retirarInvitacion(
        administradorId: string,
        asignacionId: string
    ) {
        return this.prisma.$transaction(async (tx) => {

            await bloquearCuentaActiva(tx, administradorId);

            const ahora = new Date();

            // Modificar exclusivamente una asignación pendiente que pertenezca al administrador
            const resultado =
                await tx.asignaciones_lanzadores.updateMany({
                    where: {
                        id: asignacionId,
                        administrador_id: administradorId,
                        estado: 'pendiente'
                    },
                    data: {
                        estado: 'revocada',
                        fecha_revocacion: ahora,
                        updated_at: ahora
                    }
                });

            if (resultado.count !== 1) {
                throw new ConflictException(
                    'La invitación ya no está pendiente o no existe.'
                );
            }

            // Localizar las invitaciones de esta asignación
            const invitaciones =
                await tx.invitaciones_lanzadores.findMany({
                    where: {
                        asignacion_id: asignacionId
                    },
                    select: {
                        id: true
                    }
                });

            const ids = invitaciones.map(
                invitacion => invitacion.id
            );

            // Invalidar los códigos y las credenciales temporales todavía disponibles
            if (ids.length > 0) {
                await tx.verificaciones_invitaciones_lanzadores.updateMany({
                    where: {
                        invitacion_id: {
                            in: ids
                        },
                        fecha_utilizacion: null,
                        fecha_invalidacion: null
                    },
                    data: {
                        fecha_invalidacion: ahora
                    }
                });
            }

            // Invalidar los enlaces pendientes de uso
            await tx.invitaciones_lanzadores.updateMany({
                where: {
                    asignacion_id: asignacionId,
                    fecha_utilizacion: null,
                    fecha_invalidacion: null
                },
                data: {
                    fecha_invalidacion: ahora
                }
            });

            // Conservar la trazabilidad de la retirada
            await tx.historial_asignaciones.create({
                data: {
                    asignacion_id: asignacionId,
                    actor_usuario_id: administradorId,
                    evento: 'invitacion_retirada',
                    estado_anterior: 'pendiente',
                    estado_nuevo: 'revocada',
                    descripcion:
                        'El administrador ha retirado la invitación.'
                }
            });

            return {
                estado: 'revocada',
                mensaje: 'La invitación se ha retirado correctamente.'
            };
        });
    }

    // --------------------------------------------------
    // 5. Revocar una autorización aceptada
    // --------------------------------------------------

    async revocarAutorizacion(
        administradorId: string,
        asignacionId: string
    ) {
        return this.prisma.$transaction(async (tx) => {

            await bloquearCuentaActiva(tx, administradorId);

            const ahora = new Date();

            // El administrador solo puede revocar autorizaciones aceptadas de su propia cuenta
            const resultado =
                await tx.asignaciones_lanzadores.updateMany({
                    where: {
                        id: asignacionId,
                        administrador_id: administradorId,
                        estado: 'aceptada'
                    },
                    data: {
                        estado: 'revocada',
                        fecha_revocacion: ahora,
                        updated_at: ahora
                    }
                });

            if (resultado.count !== 1) {
                throw new ConflictException(
                    'La autorización ya no está aceptada o no existe.'
                );
            }

            // Si el lanzador cuya autorización se revoca ha solicitado una activación que todavía no ha sido confirmada,
            // cancelar automáticamente dicha solicitud.


            // Conservar la solicitud cancelada para mantener su historial.
            const activacionesCanceladas =
                await tx.solicitudes_activacion.updateMany({
                    where: {
                        administrador_id: administradorId,
                        asignacion_solicitante_id: asignacionId,
                        estado: 'pendiente_validacion',
                        asignacion_validador_id: null,
                        validada_en: null
                    },
                    data: {
                        estado: 'cancelada',
                        cancelada_en: ahora,
                        cancelada_por_id: administradorId,
                        cancelada_por_tipo: 'administrador',
                        motivo_cancelacion:
                            'Cancelación automática por revocación de la autorización del contacto lanzador solicitante.'
                    }
                });

            // Invalidar los enlaces de acceso pendientes de esta autorización.
            // Los enlaces de otras asignaciones del lanzador no se modifican.
            await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    asignacion_id: asignacionId,
                    utilizado_en: null,
                    invalidado_en: null
                },
                data: {
                    invalidado_en: ahora
                }
            });

            // Revocar inmediatamente las sesiones de esta autorización.
            // No se revocan las sesiones pertenecientes a otras asignaciones.
            await tx.sesiones_lanzadores.updateMany({
                where: {
                    asignacion_id: asignacionId,
                    revocado_en: null
                },
                data: {
                    revocado_en: ahora
                }
            });

            // Registrar el cambio sin eliminar la asignación
            await tx.historial_asignaciones.create({
                data: {
                    asignacion_id: asignacionId,
                    actor_usuario_id: administradorId,
                    evento: 'autorizacion_revocada',
                    estado_anterior: 'aceptada',
                    estado_nuevo: 'revocada',
                    descripcion:
                        'El administrador ha revocado la autorización.'
                }
            });

            return {
                estado: 'revocada',

                // Informar al administrador si la revocación ha provocado la cancelación de una solicitud de activación
                activacionCancelada: activacionesCanceladas.count > 0,

                mensaje: activacionesCanceladas.count > 0
                    ? 'La autorización se ha revocado correctamente. ' +
                    'También se ha cancelado la solicitud de activación pendiente de validación.'
                    : 'La autorización se ha revocado correctamente.'
            };
        });
    }

    // --------------------------------------------------
    // 6. Reenviar una invitación pendiente o caducada
    // --------------------------------------------------

    async reenviarInvitacion(
        administradorId: string,
        correoAdministrador: string,
        asignacionId: string,
        origen?: string
    ) {
        const asignacion =
            await this.prisma.asignaciones_lanzadores.findFirst({
                where: {
                    id: asignacionId,
                    administrador_id: administradorId
                },
                select: {
                    estado: true,
                    fecha_caducidad: true,
                    lanzadores: {
                        select: {
                            nombre: true,
                            correo: true
                        }
                    }
                }
            });

        if (!asignacion) {
            throw new NotFoundException(
                'No se ha encontrado la asignación.'
            );
        }

        if (
            !['pendiente', 'caducada'].includes(asignacion.estado)
        ) {
            throw new ConflictException(
                'Esta asignación no permite reenviar invitaciones.'
            );
        }

        const permitirReenvio =
            asignacion.estado === 'pendiente' &&
            asignacion.fecha_caducidad > new Date();

        return this.crearYEnviarInvitacion(
            administradorId,
            correoAdministrador,
            {
                nombre: asignacion.lanzadores.nombre,
                correo: asignacion.lanzadores.correo
            },
            origen,
            permitirReenvio
        );
    }

    // --------------------------------------------------
    // 7. Actualizar invitaciones que han caducado
    // --------------------------------------------------

    private async actualizarCaducidades(
        administradorId: string
    ): Promise<void> {

        const ahora = new Date();

        const pendientesCaducadas =
            await this.prisma.asignaciones_lanzadores.findMany({
                where: {
                    administrador_id: administradorId,
                    estado: 'pendiente',
                    fecha_caducidad: {
                        lte: ahora
                    }
                },
                select: {
                    id: true
                }
            });

        for (const asignacion of pendientesCaducadas) {

            await this.prisma.$transaction(async (tx) => {

                await bloquearCuentaActiva(tx, administradorId);

                // Actualización condicionada para evitar registrar dos veces la misma caducidad
                const resultado =
                    await tx.asignaciones_lanzadores.updateMany({
                        where: {
                            id: asignacion.id,
                            administrador_id: administradorId,
                            estado: 'pendiente',
                            fecha_caducidad: {
                                lte: ahora
                            }
                        },
                        data: {
                            estado: 'caducada',
                            updated_at: ahora
                        }
                    });

                if (resultado.count !== 1) {
                    return;
                }

                const invitaciones =
                    await tx.invitaciones_lanzadores.findMany({
                        where: {
                            asignacion_id: asignacion.id
                        },
                        select: {
                            id: true
                        }
                    });

                const ids = invitaciones.map(
                    invitacion => invitacion.id
                );

                if (ids.length > 0) {
                    await tx.verificaciones_invitaciones_lanzadores.updateMany({
                        where: {
                            invitacion_id: { in: ids },
                            fecha_utilizacion: null,
                            fecha_invalidacion: null
                        },
                        data: {
                            fecha_invalidacion: ahora
                        }
                    });
                }

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

                await tx.historial_asignaciones.create({
                    data: {
                        asignacion_id: asignacion.id,
                        actor_usuario_id: null,
                        evento: 'invitacion_caducada',
                        estado_anterior: 'pendiente',
                        estado_nuevo: 'caducada',
                        descripcion:
                            'La invitación ha superado los siete días de validez.'
                    }
                });
            });
        }
    }



    // --------------------------------------------------
    // 8. Acceso temporal de lanzadores, separado de invitaciones
    // --------------------------------------------------

    private readonly respuestaAccesoGenerica = {
        mensaje: 'Si el correo tiene autorizaciones vigentes, recibirás un código de verificación de 8 dígitos.'
    };


    private readonly duracionCodigoAccesoMs = 10 * 60 * 1000;
    private readonly duracionSeleccionMs = 10 * 60 * 1000;
    private readonly duracionSesionMs = 60 * 60 * 1000;

    // Estados que impiden crear otra solicitud de activación
    private readonly estadosActivacionEnCurso = [
        'pendiente_validacion',
        'periodo_seguridad',
        'en_procesamiento',
        'con_incidencias'
    ];


    private hashTokenAcceso(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private hashCodigoAcceso(credencialId: string, codigo: string): string {
        const secreto = this.config.getOrThrow<string>('CODIGOS_VERIFICACION_SECRET');
        if (!/^[a-f0-9]{64}$/i.test(secreto)) {
            throw new InternalServerErrorException('Configuración de verificación incorrecta.');
        }
        return createHmac('sha256', Buffer.from(secreto, 'hex'))
            .update(`acceso-lanzador:${credencialId}:${codigo}`)
            .digest('hex');
    }

    private tokenValido(token: string | undefined): token is string {
        return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
    }

    // Se aplicará también a cada acción futura de solicitud y confirmación.
    // No comprobar fecha_caducidad de una asignación aceptada.
    // Esa fecha limita la invitación, no la autorización aceptada.
    private async obtenerAutorizacionesHabilitadas(lanzadorId: string) {
        const lanzador = await this.prisma.lanzadores.findUnique({
            where: { id: lanzadorId },
            select: { id: true, usuario_id: true }
        });
        if (!lanzador) return [];

        // Una persona con cuenta propia suspendida, de baja o finalizada no puede eludir ese estado accediendo como lanzador
        if (lanzador.usuario_id) {
            const cuentaPropia = await this.prisma.cuentas.findUnique({
                where: { id: lanzador.usuario_id },
                select: { estado: true }
            });
            if (!cuentaPropia || cuentaPropia.estado !== 'activa') return [];
        }

        const asignaciones = await this.prisma.asignaciones_lanzadores.findMany({
            where: { lanzador_id: lanzadorId, estado: 'aceptada' },
            select: { id: true, administrador_id: true }
        });
        if (asignaciones.length === 0) return [];

        const titulares = await this.prisma.cuentas.findMany({
            where: {
                id: { in: asignaciones.map(a => a.administrador_id) },
                rol: 'administrador',
                estado: 'activa'
            },
            select: { id: true, nombre: true, apellidos: true }
        });
        const titularesPorId = new Map(titulares.map(c => [c.id, c]));

        return asignaciones.flatMap(asignacion => {
            if (lanzador.usuario_id === asignacion.administrador_id) return [];
            const titular = titularesPorId.get(asignacion.administrador_id);
            return titular ? [{
                asignacionId: asignacion.id,
                administradorId: titular.id,
                administradorNombre: `${titular.nombre} ${titular.apellidos ?? ''}`.trim()
            }] : [];
        });
    }

    // Petición pública: nunca revelar si el correo está registrado por tema de privacidad de datos
    async solicitarAccesoComoLanzador(correo: string) {
        const correoNormalizado = correo.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(correoNormalizado)) {
            throw new BadRequestException('Introduce un correo electrónico válido.');
        }

        // Si hay identidades duplicadas con el mismo correo, no elegir una arbitrariamente
        const candidatos = await this.prisma.lanzadores.findMany({
            where: { correo: correoNormalizado },
            select: { id: true, correo: true, nombre: true },
            take: 2
        });
        if (candidatos.length !== 1) return this.respuestaAccesoGenerica;
        const lanzador = candidatos[0];

        const autorizaciones = await this.obtenerAutorizacionesHabilitadas(lanzador.id);
        if (autorizaciones.length === 0) return this.respuestaAccesoGenerica;

        const ahora = new Date();

        // Acceso mediante código de ocho dígitos, independientemente del número de administradores autorizados
        const codigo = randomInt(0, 100_000_000)
            .toString()
            .padStart(8, '0');

        const credencialId = randomUUID();
        const finalidad = 'verificacion_correo';

        // El código de acceso caduca a los diez minutos
        const caducaEn = new Date(
            ahora.getTime() + this.duracionCodigoAccesoMs
        );



        // Bloquear el registro del lanzador para serializar solicitudes concurrentes e impedir crear credenciales duplicadas
        const emitida = await this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM public.lanzadores WHERE id = ${lanzador.id}::uuid FOR UPDATE`;

            // Contabilizar solo las credenciales que generan un envío de correo
            const ultimaSolicitud = await tx.credenciales_acceso_lanzadores.findFirst({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad: {
                        in: ['verificacion_correo', 'acceso_titular']
                    }
                },
                orderBy: { creado_en: 'desc' },
                select: { creado_en: true }
            });

            // Limitar los envíos solicitados durante la última hora
            const solicitudesHora = await tx.credenciales_acceso_lanzadores.count({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad: {
                        in: ['verificacion_correo', 'acceso_titular']
                    },
                    creado_en: {
                        gte: new Date(ahora.getTime() - 60 * 60 * 1000)
                    }
                }
            });


            // Contar los intentos fallidos acumulados entre los códigos emitidos durante la última hora, aunque ya estén invalidados
            const intentosUltimaHora =
                await tx.credenciales_acceso_lanzadores.aggregate({
                    where: {
                        lanzador_id: lanzador.id,
                        finalidad: 'verificacion_correo',
                        creado_en: {
                            gte: new Date(ahora.getTime() - 60 * 60 * 1000)
                        }
                    },
                    _sum: {
                        intentos_fallidos: true
                    }
                });

            if (
                solicitudesHora >= 3 ||
                (intentosUltimaHora._sum.intentos_fallidos ?? 0) >= 7 ||
                (
                    ultimaSolicitud &&
                    ultimaSolicitud.creado_en.getTime() >
                    ahora.getTime() - 60_000
                )
            ) {
                return false;
            }

            // Invalidar los códigos anteriores, las credenciales de selección pendientes y los antiguos enlaces de acceso del lanzador.
            // No se modifican las invitaciones iniciales ni las sesiones activas.
            await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad: {
                        in: [
                            'verificacion_correo',
                            'seleccion_titular',
                            'acceso_titular'
                        ]
                    },
                    utilizado_en: null,
                    invalidado_en: null
                },
                data: { invalidado_en: ahora }
            });


            // La asignación se determinará después de verificar el correo.
            await tx.credenciales_acceso_lanzadores.create({
                data: {
                    id: credencialId,
                    lanzador_id: lanzador.id,
                    asignacion_id: null,
                    finalidad,
                    codigo_hash: this.hashCodigoAcceso(credencialId, codigo),
                    token_hash: null,
                    creado_en: ahora,
                    caduca_en: caducaEn
                }
            });
            return true;
        });
        if (!emitida) return this.respuestaAccesoGenerica;


        try {
            // Enviar siempre un código de acceso mediante Brevo.
            // No se envían enlaces para acceder como lanzador.
            await this.correoService.enviarCodigoAccesoLanzador(
                lanzador.correo,
                lanzador.nombre,
                codigo
            );

        } catch (error) {

            // Brevo podría haber recibido la solicitud
            await this.prisma.credenciales_acceso_lanzadores.updateMany({
                where: { id: credencialId, utilizado_en: null, invalidado_en: null },
                data: { invalidado_en: new Date() }
            });
            this.logger.error('Error al enviar acceso de lanzador por Brevo',
                error instanceof Error ? error.message : String(error));
        }
        return this.respuestaAccesoGenerica;
    }


    // Código de ocho dígitos que comprueba la identidad del lanzador.
    // Se utiliza independientemente del número de administradores autorizados.
    // No crea todavía una sesión de actuación.
    async verificarCodigoAccesoComoLanzador(correo: string, codigo: string) {
        if (!/^\d{8}$/.test(codigo)) {
            throw new BadRequestException('El código debe contener ocho dígitos.');
        }
        const candidatos = await this.prisma.lanzadores.findMany({
            where: { correo: correo.trim().toLowerCase() },
            select: { id: true },
            take: 2
        });
        if (candidatos.length !== 1) {
            throw new UnauthorizedException('Código incorrecto o caducado.');
        }
        const lanzador = candidatos[0];
        const ahora = new Date();
        let tokenSeleccion: string | null = null;

        await this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM public.lanzadores WHERE id = ${lanzador.id}::uuid FOR UPDATE`;

            // Bloquear la verificación si se han acumulado siete fallos entre los códigos emitidos durante la última hora
            const intentosUltimaHora =
                await tx.credenciales_acceso_lanzadores.aggregate({
                    where: {
                        lanzador_id: lanzador.id,
                        finalidad: 'verificacion_correo',
                        creado_en: {
                            gte: new Date(ahora.getTime() - 60 * 60 * 1000)
                        }
                    },
                    _sum: {
                        intentos_fallidos: true
                    }
                });

            if ((intentosUltimaHora._sum.intentos_fallidos ?? 0) >= 7) {
                throw new UnauthorizedException(
                    'Código incorrecto o caducado.'
                );
            }

            const credencial = await tx.credenciales_acceso_lanzadores.findFirst({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad: 'verificacion_correo',
                    utilizado_en: null,
                    invalidado_en: null
                },
                orderBy: { creado_en: 'desc' }
            });
            if (
                !credencial || credencial.caduca_en <= ahora ||
                credencial.intentos_fallidos >= 7 || !credencial.codigo_hash
            ) throw new UnauthorizedException('Código incorrecto o caducado.');

            const esperado = Buffer.from(credencial.codigo_hash, 'hex');
            const recibido = Buffer.from(this.hashCodigoAcceso(credencial.id, codigo), 'hex');
            if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) {
                const intentos = credencial.intentos_fallidos + 1;
                await tx.credenciales_acceso_lanzadores.update({
                    where: { id: credencial.id },
                    data: {
                        intentos_fallidos: intentos,
                        ...(intentos >= 7 ? { invalidado_en: ahora } : {})
                    }
                });

                return;
            }

            const resultado = await tx.credenciales_acceso_lanzadores.updateMany({
                where: { id: credencial.id, utilizado_en: null, invalidado_en: null },
                data: { utilizado_en: ahora, verificado_en: ahora }
            });
            if (resultado.count !== 1) return;

            await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad: 'seleccion_titular',
                    utilizado_en: null,
                    invalidado_en: null
                },
                data: { invalidado_en: ahora }
            });
            const nuevoToken = randomBytes(32).toString('hex');
            await tx.credenciales_acceso_lanzadores.create({
                data: {
                    lanzador_id: lanzador.id,
                    finalidad: 'seleccion_titular',
                    token_hash: this.hashTokenAcceso(nuevoToken),
                    creado_en: ahora,
                    caduca_en: new Date(ahora.getTime() + this.duracionSeleccionMs)
                }
            });
            tokenSeleccion = nuevoToken;
        });

        if (!tokenSeleccion) throw new UnauthorizedException('Código incorrecto o caducado.');
        const autorizaciones = await this.obtenerAutorizacionesHabilitadas(lanzador.id);
        if (autorizaciones.length === 0) {
            throw new ForbiddenException('No hay autorizaciones disponibles.');
        }
        return { tokenSeleccion, administradores: autorizaciones };
    }


    // Seleccionar el administrador con el que actuará el lanzador.
    // La selección será automática si solo tiene una autorización vigente.
    // Si tiene varias autorizaciones, deberá elegir un administrador.
    // No se envían enlaces adicionales por correo.
    // La selección crea una sesión, pero no inicia ni confirma activaciones.

    async seleccionarAdministradorAccesoLanzador(
        tokenSeleccion: string,
        asignacionId: string
    ) {

        if (!this.tokenValido(tokenSeleccion)) {
            throw new UnauthorizedException(
                'La verificación ha caducado o no es válida.'
            );
        }

        // Localizar la credencial temporal obtenida al verificar el código
        const credencial = await this.prisma.credenciales_acceso_lanzadores.findFirst({
            where: {
                token_hash: this.hashTokenAcceso(tokenSeleccion),
                finalidad: 'seleccion_titular',
                utilizado_en: null,
                invalidado_en: null,
                caduca_en: { gt: new Date() }
            }
        });

        if (!credencial) {
            throw new UnauthorizedException(
                'La verificación ha caducado o no es válida.'
            );
        }

        // Comprobar que el administrador seleccionado pertenece a las autorizaciones habilitadas del lanzador
        const habilitadas = await this.obtenerAutorizacionesHabilitadas(
            credencial.lanzador_id
        );

        const seleccionada = habilitadas.find(
            a => a.asignacionId === asignacionId
        );

        if (!seleccionada) {
            throw new ForbiddenException(
                'La autorización no está disponible.'
            );
        }

        // Generar el token original de la nueva sesión.
        // Postgre almacenará únicamente su hash.
        const tokenSesion = randomBytes(32).toString('hex');

        return this.prisma.$transaction(async tx => {

            // Bloquear el registro del lanzador para impedir la creación concurrente de varias sesiones
            await tx.$queryRaw`
            SELECT id
            FROM public.lanzadores
            WHERE id = ${credencial.lanzador_id}::uuid
            FOR UPDATE
        `;

            const lanzador = await tx.lanzadores.findUnique({
                where: {
                    id: credencial.lanzador_id
                },
                select: {
                    id: true,
                    usuario_id: true
                }
            });

            if (!lanzador) {
                throw new UnauthorizedException(
                    'El acceso ya no está disponible.'
                );
            }

            // Coordinar el inicio de sesión con los cambios de estado de la cuenta del titular y del lanzador
            const { titularActiva, estadoLanzador } = await bloquearCuentas(
                tx,
                seleccionada.administradorId,
                lanzador.usuario_id
            );

            if (
                !titularActiva ||
                (
                    lanzador.usuario_id !== null &&
                    estadoLanzador !== 'activa'
                ) ||
                lanzador.usuario_id === seleccionada.administradorId
            ) {
                throw new ForbiddenException(
                    'La autorización ya no está habilitada.'
                );
            }

            // Una revocación concurrente debe tener preferencia
            await tx.$queryRaw`
            SELECT id
            FROM public.asignaciones_lanzadores
            WHERE id = ${asignacionId}::uuid
            FOR UPDATE
        `;

            // Volver a comprobar la asignación dentro de la transacción
            const asignacion = await tx.asignaciones_lanzadores.findFirst({
                where: {
                    id: asignacionId,
                    lanzador_id: lanzador.id,
                    administrador_id: seleccionada.administradorId,
                    estado: 'aceptada'
                },
                select: {
                    id: true
                }
            });

            if (!asignacion) {
                throw new ForbiddenException(
                    'La autorización ya no está habilitada.'
                );
            }

            // Comprobar el estado y el rol actual del administrador
            const administrador = await tx.cuentas.findFirst({
                where: {
                    id: seleccionada.administradorId,
                    rol: 'administrador',
                    estado: 'activa'
                },
                select: {
                    id: true,
                    nombre: true,
                    apellidos: true
                }
            });

            if (!administrador) {
                throw new ForbiddenException(
                    'La cuenta ya no está habilitada.'
                );
            }

            // Calcular las fechas después de obtener los bloqueos
            const ahora = new Date();

            const caducaEn = new Date(
                ahora.getTime() + this.duracionSesionMs
            );

            // Consumir la credencial temporal de selección.
            // Solo puede utilizarse una vez y antes de su caducidad.
            const consumo = await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    id: credencial.id,
                    lanzador_id: lanzador.id,
                    finalidad: 'seleccion_titular',
                    utilizado_en: null,
                    invalidado_en: null,
                    caduca_en: { gt: ahora }
                },
                data: {
                    utilizado_en: ahora
                }
            });

            if (consumo.count !== 1) {
                throw new UnauthorizedException(
                    'La verificación ha caducado o ya se ha utilizado.'
                );
            }

            // Invalidar los antiguos enlaces de acceso pendientes.
            // No afecta a los enlaces de aceptación de invitaciones.
            await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad: 'acceso_titular',
                    utilizado_en: null,
                    invalidado_en: null
                },
                data: {
                    invalidado_en: ahora
                }
            });

            // Revocar las sesiones anteriores de este lanzador.
            // Solo puede mantener una sesión activa.
            await tx.sesiones_lanzadores.updateMany({
                where: {
                    lanzador_id: lanzador.id,
                    revocado_en: null
                },
                data: {
                    revocado_en: ahora
                }
            });

            // Crear la nueva sesión vinculada al administrador seleccionado
            await tx.sesiones_lanzadores.create({
                data: {
                    lanzador_id: lanzador.id,
                    asignacion_id: asignacion.id,
                    token_hash: this.hashTokenAcceso(tokenSesion),
                    creado_en: ahora,
                    caduca_en: caducaEn
                }
            });

            // Devolver únicamente la sesión y el administrador autorizado.
            // No se devuelven destinatarios ni mensajes privados por privacidad de datos.
            return {
                tokenSesion,
                caducaEn,
                administradorId: administrador.id,
                administradorNombre:
                    `${administrador.nombre} ${administrador.apellidos ?? ''}`.trim()
            };
        });
    }

    // OJO: antiguo acceso mediante enlace de un solo uso.
    // Se conserva temporalmente para rechazar enlaces de acceso anteriores por tema de seguridad.
    // El acceso del lanzador ahora se realiza mediante código de ocho dígitos.
    // No confundir con los enlaces de aceptación de invitaciones iniciales.
    // Quitarlo dentro de unos días que los enlaces ya no servirán

    async canjearEnlaceAccesoLanzador(_token: string) {

        throw new UnauthorizedException(
            'El acceso mediante enlace ya no está disponible. ' +
            'Solicita un código de verificación.'
        );
    }

    // Solo devuelve identidad y ámbito autorizados, pero ni contactos ni mensajes
    async obtenerSesionLanzador(tokenSesion?: string) {
        if (!this.tokenValido(tokenSesion)) throw new UnauthorizedException('Sesión de lanzador no válida.');
        const sesion = await this.prisma.sesiones_lanzadores.findUnique({
            where: { token_hash: this.hashTokenAcceso(tokenSesion) }
        });
        if (!sesion || sesion.revocado_en || sesion.caduca_en <= new Date()) {
            throw new UnauthorizedException('La sesión ha caducado o no está disponible.');
        }
        const habilitadas = await this.obtenerAutorizacionesHabilitadas(sesion.lanzador_id);
        const autorizacion = habilitadas.find(a => a.asignacionId === sesion.asignacion_id);
        if (!autorizacion) {
            await this.prisma.sesiones_lanzadores.updateMany({
                where: { id: sesion.id, revocado_en: null },
                data: { revocado_en: new Date() }
            });
            throw new UnauthorizedException('La autorización ya no está habilitada.');
        }
        const actualizacion = await this.prisma.sesiones_lanzadores.updateMany({
            where: { id: sesion.id, revocado_en: null, caduca_en: { gt: new Date() } },
            data: { ultimo_uso_en: new Date() }
        });
        if (actualizacion.count !== 1) throw new UnauthorizedException('Sesión no válida.');
        return {
            administradorId: autorizacion.administradorId,
            administradorNombre: autorizacion.administradorNombre,
            caducaEn: sesion.caduca_en
        };
    }

    async cerrarSesionLanzador(tokenSesion?: string) {
        if (!this.tokenValido(tokenSesion)) throw new UnauthorizedException('Sesión de lanzador no válida.');
        await this.prisma.sesiones_lanzadores.updateMany({
            where: { token_hash: this.hashTokenAcceso(tokenSesion), revocado_en: null },
            data: { revocado_en: new Date() }
        });
        return { mensaje: 'Sesión cerrada.' };
    }

    // Consultar los contactos lanzadores habilitados de un administrador.
    // Solo se aceptan las asignaciones que ya estaban validadas.
    // Si el lanzador tiene una cuenta propia, esta debe estar activa.
    // El titular no puede actuar como lanzador de su propia cuenta.

    private async obtenerLanzadoresHabilitadosAdministrador(
        administradorId: string,
        db: Pick<
            Prisma.TransactionClient,
            'asignaciones_lanzadores' | 'cuentas'
        > = this.prisma
    ) {

        const asignaciones =
            await db.asignaciones_lanzadores.findMany({
                where: {
                    administrador_id: administradorId,
                    estado: 'aceptada'
                },
                select: {
                    id: true,
                    lanzador_id: true,
                    lanzadores: {
                        select: {
                            usuario_id: true,
                            correo: true
                        }
                    }
                }
            });

        // Identificar los lanzadores que también tienen una cuenta propia
        const usuariosIds = asignaciones
            .map(asignacion => asignacion.lanzadores.usuario_id)
            .filter((id): id is string => id !== null);

        // Comprobar qué cuentas propias están activas
        const cuentasActivas =
            await db.cuentas.findMany({
                where: {
                    id: {
                        in: usuariosIds
                    },
                    estado: 'activa'
                },
                select: {
                    id: true
                }
            });

        const cuentasActivasIds = new Set(
            cuentasActivas.map(cuenta => cuenta.id)
        );

        // Excluir al titular y a los lanzadores cuya cuenta propia no esté habilitada para actuar
        return asignaciones.filter(asignacion => {

            const usuarioId = asignacion.lanzadores.usuario_id;

            if (usuarioId === administradorId) {
                return false;
            }

            if (
                usuarioId !== null &&
                !cuentasActivasIds.has(usuarioId)
            ) {
                return false;
            }

            return true;
        });
    }

    // --------------------------------------------------
    // 9. Consultar el estado de activación del administrador desde una sesión temporal de lanzador.
    // Solo devuelve información operativa autorizada.
    // --------------------------------------------------

    async consultarEstadoActivacionLanzador(tokenSesion?: string) {

        // Comprobar el formato del token
        if (!this.tokenValido(tokenSesion)) {
            throw new UnauthorizedException(
                'Sesión de lanzador no válida.'
            );
        }

        // Reutilizar la comprobación de sesión y autorización existente
        const contexto = await this.obtenerSesionLanzador(tokenSesion);

        // Identificar al lanzador para distinguirlo del segundo lanzador que podría confirmar la solicitud
        const sesion = await this.prisma.sesiones_lanzadores.findUnique({
            where: {
                token_hash: this.hashTokenAcceso(tokenSesion)
            },
            select: {
                lanzador_id: true,
                revocado_en: true,
                caduca_en: true
            }
        });

        if (
            !sesion ||
            sesion.revocado_en ||
            sesion.caduca_en <= new Date()
        ) {
            throw new UnauthorizedException(
                'La sesión ha caducado o no está disponible.'
            );
        }

        // Estados que representan una activación en curso.
        // Se corresponden con los estados contemplados por el índice de Postgre
        const estadosEnCurso = this.estadosActivacionEnCurso;

        // Consultar solo las solicitudes del administrador al que pertenece la sesión autorizada
        const solicitud = await this.prisma.solicitudes_activacion.findFirst({
            where: {
                administrador_id: contexto.administradorId,
                estado: {
                    in: estadosEnCurso
                }
            },
            select: {
                id: true,
                estado: true,
                solicitada_en: true,
                validada_en: true,
                procesar_desde: true,
                asignacion_solicitante: {
                    select: {
                        lanzador_id: true
                    }
                }
            },
            orderBy: {
                solicitada_en: 'desc'
            }
        });

        // Si no hay activación en curso, consultar solo el estado de la última solicitud histórica
        const ultimaSolicitud = solicitud
            ? null
            : await this.prisma.solicitudes_activacion.findFirst({
                where: {
                    administrador_id: contexto.administradorId
                },
                select: {
                    id: true,
                    estado: true,
                    solicitada_en: true,
                    finalizada_en: true
                },
                orderBy: {
                    solicitada_en: 'desc'
                }
            });

        // Comprobar la identidad del solicitante, no solo el identificador de su asignación
        const esSolicitante = solicitud
            ? solicitud.asignacion_solicitante.lanzador_id === sesion.lanzador_id
            : false;

        // Comprobar los contactos lanzadores habilitados del administrador
        const lanzadoresHabilitados =
            await this.obtenerLanzadoresHabilitadosAdministrador(
                contexto.administradorId
            );

        // Contabilizar personas distintas, no solo asignaciones
        const lanzadoresDistintos = new Set(
            lanzadoresHabilitados.map(
                asignacion => asignacion.lanzadores.correo.trim().toLowerCase()
            )
        );

        const numeroLanzadoresHabilitados = lanzadoresDistintos.size;

        const disponeLanzadoresNecesarios =
            numeroLanzadoresHabilitados >= 2;

        // Comprobar que la autorización del lanzador actual sigue habilitada
        const lanzadorActualHabilitado = lanzadoresHabilitados.some(
            asignacion => asignacion.lanzador_id === sesion.lanzador_id
        );

        // Comprobar que el solicitante original sigue autorizado
        const solicitanteHabilitado = solicitud
            ? lanzadoresHabilitados.some(
                asignacion =>
                    asignacion.lanzador_id ===
                    solicitud.asignacion_solicitante.lanzador_id
            )
            : false;

        // Información orientativa para el frontend.
        // Las comprobaciones deberán repetirse dentro de la transacción que solicite o confirme una activación.
        const accionOrientativa =
            !disponeLanzadoresNecesarios || !lanzadorActualHabilitado
                ? 'ninguna'
                : !solicitud
                    ? 'solicitar'
                    : solicitud.estado === 'pendiente_validacion' &&
                        !esSolicitante &&
                        solicitanteHabilitado
                        ? 'confirmar'
                        : 'ninguna';


        return {
            administradorId: contexto.administradorId,
            administradorNombre: contexto.administradorNombre,

            activacionEnCurso: solicitud !== null,
            estado: solicitud?.estado ?? 'sin_activacion',

            solicitud: solicitud
                ? {
                    id: solicitud.id,
                    solicitadaEn: solicitud.solicitada_en,
                    validadaEn: solicitud.validada_en,
                    procesarDesde: solicitud.procesar_desde
                }
                : null,

            ultimaSolicitud: ultimaSolicitud
                ? {
                    id: ultimaSolicitud.id,
                    estado: ultimaSolicitud.estado,
                    solicitadaEn: ultimaSolicitud.solicitada_en,
                    finalizadaEn: ultimaSolicitud.finalizada_en
                }
                : null,

            esSolicitante,

            // Información sobre los requisitos de activación
            numeroLanzadoresHabilitados,
            disponeLanzadoresNecesarios,

            accionOrientativa
        };
    }



    // --------------------------------------------------
    // 10. Comprobar la sesión del lanzador dentro de una transacción.
    // Se utilizará en las operaciones que modifican una activación.
    // --------------------------------------------------

    private async comprobarSesionParaActivacion(
        tx: Prisma.TransactionClient,
        tokenSesion: string
    ) {

        const tokenHash = this.hashTokenAcceso(tokenSesion);

        // Localizar la sesión para identificar su ámbito autorizado
        const sesionInicial = await tx.sesiones_lanzadores.findUnique({
            where: {
                token_hash: tokenHash
            },
            select: {
                id: true,
                lanzador_id: true,
                asignacion_id: true,
                revocado_en: true,
                caduca_en: true
            }
        });

        if (
            !sesionInicial ||
            sesionInicial.revocado_en ||
            sesionInicial.caduca_en <= new Date()
        ) {
            throw new UnauthorizedException(
                'La sesión ha caducado o no está disponible.'
            );
        }

        // Bloquear la identidad del lanzador siguiendo el orden utilizado en la creación de sesiones
        await tx.$queryRaw`
        SELECT id
        FROM public.lanzadores
        WHERE id = ${sesionInicial.lanzador_id}::uuid
        FOR UPDATE
    `;

        const lanzador = await tx.lanzadores.findUnique({
            where: {
                id: sesionInicial.lanzador_id
            },
            select: {
                id: true,
                usuario_id: true,
                correo: true
            }
        });

        const asignacionInicial =
            await tx.asignaciones_lanzadores.findUnique({
                where: {
                    id: sesionInicial.asignacion_id
                },
                select: {
                    id: true,
                    administrador_id: true,
                    lanzador_id: true
                }
            });

        if (
            !lanzador ||
            !asignacionInicial ||
            asignacionInicial.lanzador_id !== lanzador.id
        ) {
            throw new UnauthorizedException(
                'La autorización no está disponible.'
            );
        }

        // Coordinar la operación con las suspensiones y bajas del administrador y de la cuenta propia del lanzador
        const { titularActiva, estadoLanzador } =
            await bloquearCuentas(
                tx,
                asignacionInicial.administrador_id,
                lanzador.usuario_id
            );

        if (
            !titularActiva ||
            lanzador.usuario_id === asignacionInicial.administrador_id ||
            (
                lanzador.usuario_id !== null &&
                estadoLanzador !== 'activa'
            )
        ) {
            throw new ForbiddenException(
                'La autorización ya no está habilitada.'
            );
        }

        // Bloquear y comprobar otra vez la asignación
        await tx.$queryRaw`
        SELECT id
        FROM public.asignaciones_lanzadores
        WHERE id = ${asignacionInicial.id}::uuid
        FOR UPDATE
    `;

        const asignacion =
            await tx.asignaciones_lanzadores.findFirst({
                where: {
                    id: asignacionInicial.id,
                    lanzador_id: lanzador.id,
                    administrador_id: asignacionInicial.administrador_id,
                    estado: 'aceptada'
                },
                select: {
                    id: true,
                    administrador_id: true
                }
            });

        if (!asignacion) {
            throw new ForbiddenException(
                'La autorización ya no está habilitada.'
            );
        }

        // Bloquear la sesión para impedir utilizarla después de su revocación
        await tx.$queryRaw`
        SELECT id
        FROM public.sesiones_lanzadores
        WHERE id = ${sesionInicial.id}::uuid
        FOR UPDATE
    `;

        const ahora = new Date();

        const sesion = await tx.sesiones_lanzadores.findFirst({
            where: {
                id: sesionInicial.id,
                token_hash: tokenHash,
                lanzador_id: lanzador.id,
                asignacion_id: asignacion.id,
                revocado_en: null,
                caduca_en: {
                    gt: ahora
                }
            },
            select: {
                id: true
            }
        });

        if (!sesion) {
            throw new UnauthorizedException(
                'La sesión ha caducado o no está disponible.'
            );
        }

        // Registrar el uso de la sesión dentro de la misma transacción
        await tx.sesiones_lanzadores.update({
            where: {
                id: sesion.id
            },
            data: {
                ultimo_uso_en: ahora
            }
        });

        return {
            administradorId: asignacion.administrador_id,
            asignacionId: asignacion.id,
            lanzadorId: lanzador.id
        };
    }

    // --------------------------------------------------
    // 11. Solicitar una activación por parte del primer contacto lanzador.
    // La solicitud queda pendiente de validación por otro lanzador.
    // No inicia el periodo de seguridad ni el envío de comunicaciones.
    // OJO: pendiente integrar el registro persistente del aviso al administrador.
    // --------------------------------------------------

    async solicitarActivacionLanzador(
        datos: SolicitarActivacionDto,
        tokenSesion?: string
    ) {

        // Comprobar el formato del token de sesión
        if (!this.tokenValido(tokenSesion)) {
            throw new UnauthorizedException(
                'Sesión de lanzador no válida.'
            );
        }

        // La comunicación general es obligatoria
        const mensajeGeneral = datos.mensajeGeneral.trim();

        if (!mensajeGeneral || mensajeGeneral.length > 5000) {
            throw new BadRequestException(
                'Debes introducir una comunicación para que todos los destinatarios de esta despedida reciban la información necesaria.'
            );
        }

        // La información de la ceremonia es opcional
        const informacionCeremonia =
            datos.informacionCeremonia?.trim() || null;

        if (
            informacionCeremonia &&
            informacionCeremonia.length > 5000
        ) {
            throw new BadRequestException(
                'La información de la ceremonia supera la longitud permitida.'
            );
        }

        // Exigir la confirmación expresa del primer lanzador
        if (datos.confirmaSolicitud !== true) {
            throw new BadRequestException(
                'Debes confirmar expresamente la solicitud de activación.'
            );
        }

        try {

            return await this.prisma.$transaction(async tx => {

                // Comprobar y bloquear la sesión y las cuentas implicadas
                const contexto =
                    await this.comprobarSesionParaActivacion(
                        tx,
                        tokenSesion
                    );

                // Comprobar que no existe otra activación en curso
                const activacionExistente =
                    await tx.solicitudes_activacion.findFirst({
                        where: {
                            administrador_id: contexto.administradorId,
                            estado: {
                                in: this.estadosActivacionEnCurso
                            }
                        },
                        select: {
                            id: true
                        }
                    });

                if (activacionExistente) {
                    throw new ConflictException(
                        'Ya existe una activación en curso.'
                    );
                }

                // Consultar las autorizaciones dentro de la misma transacción
                const lanzadoresHabilitados =
                    await this.obtenerLanzadoresHabilitadosAdministrador(
                        contexto.administradorId,
                        tx
                    );

                // Comprobar que la asignación actual sigue habilitada
                const solicitante = lanzadoresHabilitados.find(
                    asignacion =>
                        asignacion.id === contexto.asignacionId &&
                        asignacion.lanzador_id === contexto.lanzadorId
                );

                if (!solicitante) {
                    throw new ForbiddenException(
                        'Tu autorización ya no está habilitada.'
                    );
                }

                // Comprobar que existe al menos otro lanzador distinto del solicitante y que está autorizado para el mismo administrador
                const segundoLanzadorDisponible =
                    lanzadoresHabilitados.find(asignacion =>

                        asignacion.lanzador_id !== contexto.lanzadorId &&

                        asignacion.lanzadores.correo.trim().toLowerCase() !==
                        solicitante.lanzadores.correo.trim().toLowerCase() &&

                        (
                            solicitante.lanzadores.usuario_id === null ||
                            asignacion.lanzadores.usuario_id !==
                            solicitante.lanzadores.usuario_id
                        )

                    );

                if (!segundoLanzadorDisponible) {
                    throw new ConflictException(
                        'El administrador no dispone de otro contacto lanzador habilitado, por lo que no será posible el envío de las comunicaciones de esta despedida.'
                    );
                }


                // Proteger la identidad del segundo lanzador frente a cambios concurrentes
                await tx.$queryRaw`
SELECT id
FROM public.lanzadores
WHERE id = ${segundoLanzadorDisponible.lanzador_id}::uuid
FOR UPDATE NOWAIT
`;

                // Si el segundo lanzador tiene una cuenta propia, impedir que cambie de estado durante el registro de la solicitud
                const usuarioSegundoLanzador =
                    segundoLanzadorDisponible.lanzadores.usuario_id;

                if (usuarioSegundoLanzador !== null) {

                    await tx.$queryRaw`
    SELECT id
    FROM public.cuentas
    WHERE id = ${usuarioSegundoLanzador}::uuid
    FOR UPDATE NOWAIT
`;
                }

                // Proteger la autorización del segundo lanzador frente a revocaciones
                await tx.$queryRaw`
SELECT id
FROM public.asignaciones_lanzadores
WHERE id = ${segundoLanzadorDisponible.id}::uuid
FOR UPDATE NOWAIT
`;

                // Comprobar otra vez que el segundo lanzador sigue estando habilitado
                const autorizacionesActualizadas =
                    await this.obtenerLanzadoresHabilitadosAdministrador(
                        contexto.administradorId,
                        tx
                    );

                const segundoLanzadorHabilitado =
                    autorizacionesActualizadas.some(
                        asignacion =>
                            asignacion.id === segundoLanzadorDisponible.id &&
                            asignacion.lanzador_id ===
                            segundoLanzadorDisponible.lanzador_id
                    );

                if (!segundoLanzadorHabilitado) {
                    throw new ConflictException(
                        'La autorización del segundo contacto lanzador ha cambiado. ' +
                        'Actualiza el estado de activación e inténtalo de nuevo.'
                    );
                }


                // No es obligatorio que el administrador tenga destinatarios.
                // Tampoco es obligatorio que los destinatarios tengan mensajes privados preparados.
                // Por privacidad de datos, si un lanzador solicita el envío, se gestionará como si los hubiese
                const ahora = new Date();

                // Registrar la solicitud pendiente de segunda validación
                const solicitud = await tx.solicitudes_activacion.create({
                    data: {
                        administrador_id: contexto.administradorId,
                        asignacion_solicitante_id: contexto.asignacionId,
                        mensaje_general: mensajeGeneral,
                        informacion_ceremonia: informacionCeremonia,
                        estado: 'pendiente_validacion',
                        solicitada_en: ahora
                    },
                    select: {
                        id: true,
                        estado: true,
                        solicitada_en: true
                    }
                });

                // OJO: pendiente registrar en esta misma transacción el aviso de solicitud de activación al administrador.
                // El envío mediante Brevo se realizará fuera de la transacción.

                return {
                    solicitudId: solicitud.id,
                    estado: solicitud.estado,
                    solicitadaEn: solicitud.solicitada_en,
                    mensaje:
                        'La solicitud de activación se ha registrado. ' +
                        'Está pendiente de confirmación por otro contacto lanzador.'
                };

            }, {
                isolationLevel: 'Serializable'
            });

        } catch (error) {

            if (
                error instanceof BadRequestException ||
                error instanceof UnauthorizedException ||
                error instanceof ForbiddenException ||
                error instanceof ConflictException
            ) {
                throw error;
            }

            // Evitar solicitudes duplicadas
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    'Ya existe una activación en curso.'
                );
            }

            // Gestionar conflictos entre transacciones 
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'P2034'
            ) {
                throw new ConflictException(
                    'Se ha producido un cambio simultáneo. ' +
                    'Actualiza el estado de activación e inténtalo de nuevo.'
                );
            }

            // Gestionar conflictos de bloqueo y concurrencia producidos por las consultas directas a Postgre
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'P2010' &&
                'meta' in error &&
                typeof error.meta === 'object' &&
                error.meta !== null &&
                'code' in error.meta &&
                (
                    error.meta.code === '55P03' ||
                    error.meta.code === '40001' ||
                    error.meta.code === '40P01'
                )
            ) {
                throw new ConflictException(
                    'Se ha producido un cambio simultáneo en las autorizaciones. ' +
                    'Actualiza el estado de activación e inténtalo de nuevo.'
                );
            }

            // No registrar mensajes privados ni comunicaciones de despedida por privacidad de datos
            this.logger.error(
                'Error al registrar una solicitud de activación.'
            );

            throw new InternalServerErrorException(
                'No se ha podido registrar la solicitud de activación de esta despedida.'
            );
        }
    }

}


