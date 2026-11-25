import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { bloquearCuentaActiva, bloquearCuentas } from '../cuentas/bloqueo-cuentas';
import { CorreoService } from '../correo/correo.service';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';
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
                mensaje: 'La autorización se ha revocado correctamente.'
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
        mensaje: 'Si el correo tiene autorizaciones vigentes, recibirás un correo con las instrucciones.'
    };

    private readonly duracionCodigoAccesoMs = 10 * 60 * 1000;
    private readonly duracionSeleccionMs = 10 * 60 * 1000;
    private readonly duracionEnlaceAccesoMs = 7 * 24 * 60 * 60 * 1000;
    private readonly duracionSesionMs = 60 * 60 * 1000;

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
    async solicitarAccesoComoLanzador(correo: string, origen?: string) {
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
        const esUnaAutorizacion = autorizaciones.length === 1;
        const codigo = esUnaAutorizacion
            ? null
            : randomInt(0, 100_000_000).toString().padStart(8, '0');
        const token = esUnaAutorizacion ? randomBytes(32).toString('hex') : null;
        const credencialId = randomUUID();
        const finalidad = esUnaAutorizacion ? 'acceso_titular' : 'verificacion_correo';
        const caducaEn = new Date(ahora.getTime() + (
            esUnaAutorizacion ? this.duracionEnlaceAccesoMs : this.duracionCodigoAccesoMs
        ));

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


            await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    lanzador_id: lanzador.id,
                    finalidad,
                    utilizado_en: null,
                    invalidado_en: null
                },
                data: { invalidado_en: ahora }
            });

            await tx.credenciales_acceso_lanzadores.create({
                data: {
                    id: credencialId,
                    lanzador_id: lanzador.id,
                    asignacion_id: esUnaAutorizacion
                        ? autorizaciones[0].asignacionId : null,
                    finalidad,
                    codigo_hash: codigo ? this.hashCodigoAcceso(credencialId, codigo) : null,
                    token_hash: token ? this.hashTokenAcceso(token) : null,
                    creado_en: ahora,
                    caduca_en: caducaEn
                }
            });
            return true;
        });
        if (!emitida) return this.respuestaAccesoGenerica;

        try {
            if (esUnaAutorizacion && token) {
                const enlace = new URL('/acceso-lanzador', obtenerUrlBackoffice(this.config, origen));
                enlace.searchParams.set('token', token);
                await this.correoService.enviarEnlaceAccesoLanzador(
                    lanzador.correo, lanzador.nombre,
                    autorizaciones[0].administradorNombre, enlace.toString()
                );
            } else if (codigo) {
                await this.correoService.enviarCodigoAccesoLanzador(
                    lanzador.correo, lanzador.nombre, codigo
                );
            }
        } catch (error) {
            // Brevo podría haber recibido la solicitud.
            // Invalidar el secreto para impedir accesos con un envío incierto.
            await this.prisma.credenciales_acceso_lanzadores.updateMany({
                where: { id: credencialId, utilizado_en: null, invalidado_en: null },
                data: { invalidado_en: new Date() }
            });
            this.logger.error('Error al enviar acceso de lanzador por Brevo',
                error instanceof Error ? error.message : String(error));
        }
        return this.respuestaAccesoGenerica;
    }

    // Código de ocho dígitos que comprueba identidad para poder seleccionar un titular. 
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

    // La selección solo autoriza emitir un nuevo enlace de un solo uso
    async seleccionarAdministradorAccesoLanzador(tokenSeleccion: string, asignacionId: string) {
        if (!this.tokenValido(tokenSeleccion)) {
            throw new UnauthorizedException('La verificación ha caducado o no es válida.');
        }
        const credencial = await this.prisma.credenciales_acceso_lanzadores.findFirst({
            where: {
                token_hash: this.hashTokenAcceso(tokenSeleccion),
                finalidad: 'seleccion_titular',
                utilizado_en: null,
                invalidado_en: null,
                caduca_en: { gt: new Date() }
            }
        });
        if (!credencial) throw new UnauthorizedException('La verificación ha caducado o no es válida.');
        const habilitadas = await this.obtenerAutorizacionesHabilitadas(credencial.lanzador_id);
        const seleccionada = habilitadas.find(a => a.asignacionId === asignacionId);
        if (!seleccionada) throw new ForbiddenException('La autorización no está disponible.');

        const nuevoToken = randomBytes(32).toString('hex');
        const ahora = new Date();
        const creado = await this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM public.lanzadores WHERE id = ${credencial.lanzador_id}::uuid FOR UPDATE`;
            const consumo = await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    id: credencial.id, utilizado_en: null,
                    invalidado_en: null, caduca_en: { gt: ahora }
                },
                data: { utilizado_en: ahora }
            });
            if (consumo.count !== 1) return false;
            await tx.credenciales_acceso_lanzadores.updateMany({
                where: {
                    lanzador_id: credencial.lanzador_id,
                    asignacion_id: asignacionId,
                    finalidad: 'acceso_titular',
                    utilizado_en: null,
                    invalidado_en: null
                },
                data: { invalidado_en: ahora }
            });
            await tx.credenciales_acceso_lanzadores.create({
                data: {
                    lanzador_id: credencial.lanzador_id,
                    asignacion_id: asignacionId,
                    finalidad: 'acceso_titular',
                    token_hash: this.hashTokenAcceso(nuevoToken),
                    creado_en: ahora,
                    caduca_en: new Date(ahora.getTime() + this.duracionEnlaceAccesoMs)
                }
            });
            return true;
        });
        if (!creado) throw new UnauthorizedException('La verificación ya se ha utilizado.');

        const lanzador = await this.prisma.lanzadores.findUniqueOrThrow({
            where: { id: credencial.lanzador_id },
            select: { correo: true, nombre: true }
        });
        try {
            const enlace = new URL('/acceso-lanzador', obtenerUrlBackoffice(this.config));
            enlace.searchParams.set('token', nuevoToken);
            await this.correoService.enviarEnlaceAccesoLanzador(
                lanzador.correo, lanzador.nombre,
                seleccionada.administradorNombre, enlace.toString()
            );
        } catch (error) {
            await this.prisma.credenciales_acceso_lanzadores.updateMany({
                where: { token_hash: this.hashTokenAcceso(nuevoToken), invalidado_en: null, utilizado_en: null },
                data: { invalidado_en: new Date() }
            });
            this.logger.error('No se pudo solicitar correo de enlace lanzador',
                error instanceof Error ? error.message : String(error));
            // No revelar más datos al navegador que el resultado genérico
        }
        return { mensaje: 'Si la autorización continúa vigente, recibirás un enlace de acceso.' };
    }

    // Canje de un enlace de un solo uso por una sesión
    async canjearEnlaceAccesoLanzador(token: string) {
        if (!this.tokenValido(token)) {
            throw new UnauthorizedException('El enlace no es válido o ha caducado.');
        }
        const credencial = await this.prisma.credenciales_acceso_lanzadores.findFirst({
            where: {
                token_hash: this.hashTokenAcceso(token),
                finalidad: 'acceso_titular',
                invalidado_en: null,
                utilizado_en: null,
                caduca_en: { gt: new Date() }
            }
        });
        if (!credencial?.asignacion_id) {
            throw new UnauthorizedException('El enlace no es válido o ha caducado.');
        }
        const autorizaciones = await this.obtenerAutorizacionesHabilitadas(credencial.lanzador_id);
        const vigente = autorizaciones.find(a => a.asignacionId === credencial.asignacion_id);
        if (!vigente) throw new ForbiddenException('La autorización ya no está habilitada.');

        const ahora = new Date();
        const tokenSesion = randomBytes(32).toString('hex');
        const nuevaSesion = await this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM public.lanzadores WHERE id = ${credencial.lanzador_id}::uuid FOR UPDATE`;
            // Una revocación concurrente debe tener preferencia
            await tx.$queryRaw`SELECT id FROM public.asignaciones_lanzadores WHERE id = ${credencial.asignacion_id}::uuid FOR UPDATE`;
            const asignacion = await tx.asignaciones_lanzadores.findFirst({
                where: {
                    id: credencial.asignacion_id!,
                    lanzador_id: credencial.lanzador_id,
                    estado: 'aceptada'
                },
                select: { id: true }
            });
            if (!asignacion) return false;

            const consumo = await tx.credenciales_acceso_lanzadores.updateMany({
                where: { id: credencial.id, utilizado_en: null, invalidado_en: null, caduca_en: { gt: ahora } },
                data: { utilizado_en: ahora }
            });
            if (consumo.count !== 1) return false;

            await tx.sesiones_lanzadores.updateMany({
                where: { lanzador_id: credencial.lanzador_id, revocado_en: null },
                data: { revocado_en: ahora }
            });
            await tx.sesiones_lanzadores.create({
                data: {
                    lanzador_id: credencial.lanzador_id,
                    asignacion_id: asignacion.id,
                    token_hash: this.hashTokenAcceso(tokenSesion),
                    creado_en: ahora,
                    caduca_en: new Date(ahora.getTime() + this.duracionSesionMs)
                }
            });
            return true;
        });
        if (!nuevaSesion) throw new UnauthorizedException('El enlace no está disponible.');
        return {
            tokenSesion,
            caducaEn: new Date(ahora.getTime() + this.duracionSesionMs),
            administradorId: vigente.administradorId,
            administrador: vigente.administradorNombre
        };
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
        const estadosEnCurso = [
            'pendiente_validacion',
            'periodo_seguridad',
            'en_procesamiento',
            'con_incidencias'
        ];

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

        // Información orientativa para el frontend
        const accionOrientativa = !solicitud
            ? 'solicitar'
            : solicitud.estado === 'pendiente_validacion' && !esSolicitante
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
            accionOrientativa
        };
    }



}


