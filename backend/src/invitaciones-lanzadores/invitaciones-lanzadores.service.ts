import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CorreoService } from '../correo/correo.service';

type DecisionInvitacion = 'aceptada' | 'rechazada';

@Injectable()
export class InvitacionesLanzadoresService {

    private readonly logger = new Logger(
        InvitacionesLanzadoresService.name
    );

    private readonly duracionCodigoMinutos = 10;
    private readonly duracionCredencialMinutos = 15;
    private readonly maximoIntentos = 7;
    private readonly intervaloSolicitudSegundos = 60;
    private readonly maximoSolicitudesHora = 3;

    constructor(
        private readonly prisma: PrismaService,
        private readonly correoService: CorreoService,
        private readonly config: ConfigService
    ) { }

    // --------------------------------------------------
    // 1. Calcular el hash del token recibido
    // --------------------------------------------------

    private calcularHash(token: string): string {
        return createHash('sha256')
            .update(token)
            .digest('hex');
    }

    // --------------------------------------------------
    // 1.1. Calcular el hash protegido de un código de verificación de ocho dígitos
    // --------------------------------------------------

    private calcularHashCodigo(
        invitacionId: string,
        codigo: string
    ): string {

        const secreto = this.config.getOrThrow<string>(
            'CODIGOS_VERIFICACION_SECRET'
        );

        if (!/^[a-f0-9]{64}$/i.test(secreto)) {
            throw new InternalServerErrorException(
                'La configuración de verificación no es válida.'
            );
        }

        return createHmac(
            'sha256',
            Buffer.from(secreto, 'hex')
        )
            .update(`${invitacionId}:${codigo}`)
            .digest('hex');
    }

    // --------------------------------------------------
    // 1.2. Comprobar el formato del token
    // --------------------------------------------------

    private comprobarFormatoToken(token: string): void {

        if (!/^[a-f0-9]{64}$/.test(token)) {
            throw new BadRequestException(
                'El token de invitación no es válido.'
            );
        }
    }

    // --------------------------------------------------
    // 1.3. Consultar internamente la invitación vigente
    // --------------------------------------------------

    private async obtenerInvitacionVigente(token: string) {

        this.comprobarFormatoToken(token);

        const invitacion =
            await this.prisma.invitaciones_lanzadores.findUnique({
                where: {
                    token_hash: this.calcularHash(token)
                },
                include: {
                    asignaciones_lanzadores: {
                        include: {
                            lanzadores: true
                        }
                    }
                }
            });

        const ahora = new Date();

        if (
            !invitacion ||
            invitacion.fecha_utilizacion !== null ||
            invitacion.fecha_invalidacion !== null ||
            invitacion.fecha_caducidad <= ahora ||
            invitacion.estado_envio !== 'aceptado_por_brevo' ||
            invitacion.asignaciones_lanzadores.estado !== 'pendiente' ||
            invitacion.asignaciones_lanzadores.fecha_caducidad <= ahora
        ) {
            throw new ConflictException(
                'La invitación ha caducado, ya se ha utilizado o no está disponible.'
            );
        }

        const asignacion = invitacion.asignaciones_lanzadores;

        // El titular no puede actuar como lanzador de su propia cuenta
        if (
            asignacion.lanzadores.usuario_id !== null &&
            asignacion.lanzadores.usuario_id === asignacion.administrador_id
        ) {
            throw new ForbiddenException(
                'Esta invitación no está autorizada.'
            );
        }

        return invitacion;
    }

    // -------------------------------------------------------
    // 2. Consultar una invitación sin revelar datos privados
    // -------------------------------------------------------

    async consultarInvitacion(token: string) {

        if (!/^[a-f0-9]{64}$/.test(token)) {
            return {
                valida: false,
                estado: 'no_disponible'
            };
        }

        const invitacion =
            await this.prisma.invitaciones_lanzadores.findUnique({
                where: {
                    token_hash: this.calcularHash(token)
                },
                select: {
                    fecha_caducidad: true,
                    fecha_utilizacion: true,
                    fecha_invalidacion: true,
                    estado_envio: true,
                    asignaciones_lanzadores: {
                        select: {
                            estado: true,
                            fecha_caducidad: true
                        }
                    }
                }
            });

        const ahora = new Date();

        if (!invitacion) {
            return {
                valida: false,
                estado: 'no_disponible'
            };
        }

        // Distinguir un enlace caducado sin revelar información personal sobre la asignación
        if (
            invitacion.fecha_caducidad <= ahora ||
            invitacion.asignaciones_lanzadores.fecha_caducidad <= ahora ||
            invitacion.asignaciones_lanzadores.estado === 'caducada'
        ) {
            return {
                valida: false,
                estado: 'caducada'
            };
        }

        if (
            invitacion.fecha_utilizacion !== null ||
            invitacion.fecha_invalidacion !== null ||
            invitacion.asignaciones_lanzadores.estado !== 'pendiente' ||
            invitacion.estado_envio !== 'aceptado_por_brevo'
        ) {
            return {
                valida: false,
                estado: 'no_disponible'
            };
        }

        return {
            valida: true,
            estado: 'pendiente',
            fechaCaducidad: invitacion.fecha_caducidad
        };
    }



    // --------------------------------------------------
    // 3. Solicitar el código de verificación por correo
    // --------------------------------------------------

    async solicitarCodigo(token: string) {

        // Respuesta genérica para no revelar datos del destinatario.
        const respuesta = {
            mensaje:
                'Si la invitación sigue vigente, recibirás un código de verificación.'
        };

        if (!/^[a-f0-9]{64}$/.test(token)) {
            return respuesta;
        }

        const tokenHash = this.calcularHash(token);

        // Todas las comprobaciones y la creación del código se realizan dentro de una transacción
        // La invitación se bloquea para impedir que dos solicitudes simultáneas superen los límites

        const solicitud = await this.prisma.$transaction(
            async (tx) => {

                // Bloquear la fila de la invitación.
                // La segunda solicitud deberá esperar a que termine la primera antes de comprobar los límites.
                const filas = await tx.$queryRaw<
                    Array<{ id: string }>
                >`
                    SELECT id
                    FROM public.invitaciones_lanzadores
                    WHERE token_hash = ${tokenHash}
                    FOR UPDATE
                `;

                if (filas.length !== 1) {
                    return null;
                }

                // Recuperar la invitación y su asignación después de obtener el bloqueo
                const invitacion =
                    await tx.invitaciones_lanzadores.findUnique({
                        where: {
                            id: filas[0].id
                        },
                        include: {
                            asignaciones_lanzadores: {
                                include: {
                                    lanzadores: true
                                }
                            }
                        }
                    });

                const ahora = new Date();

                // Comprobar que la invitación sigue vigente
                if (
                    !invitacion ||
                    invitacion.fecha_utilizacion !== null ||
                    invitacion.fecha_invalidacion !== null ||
                    invitacion.fecha_caducidad <= ahora ||
                    invitacion.estado_envio !== 'aceptado_por_brevo' ||
                    invitacion.asignaciones_lanzadores.estado !== 'pendiente' ||
                    invitacion.asignaciones_lanzadores.fecha_caducidad <= ahora
                ) {
                    return null;
                }

                // El titular no puede actuar como lanzador de su propia cuenta
                const asignacion =
                    invitacion.asignaciones_lanzadores;

                if (
                    asignacion.lanzadores.usuario_id !== null &&
                    asignacion.lanzadores.usuario_id ===
                    asignacion.administrador_id
                ) {
                    return null;
                }

                // Comprobar los intentos acumulados de la invitación.
                // Solicitar un nuevo código no reinicia el contador.
                if (
                    invitacion.intentos_verificacion >=
                    this.maximoIntentos
                ) {
                    return null;
                }

                const inicioHora = new Date(
                    ahora.getTime() - 60 * 60 * 1000
                );

                // Comprobar la última solicitud mientras mantenemos bloqueada la invitación
                const ultimaSolicitud =
                    await tx.verificaciones_invitaciones_lanzadores.findFirst({
                        where: {
                            invitacion_id: invitacion.id
                        },
                        orderBy: {
                            fecha_creacion: 'desc'
                        }
                    });

                if (
                    ultimaSolicitud &&
                    ultimaSolicitud.fecha_creacion.getTime() >
                    ahora.getTime() -
                    this.intervaloSolicitudSegundos * 1000
                ) {
                    return null;
                }

                // Comprobar las solicitudes acumuladas durante la última hora
                const solicitudesHora =
                    await tx.verificaciones_invitaciones_lanzadores.count({
                        where: {
                            invitacion_id: invitacion.id,
                            fecha_creacion: {
                                gte: inicioHora
                            }
                        }
                    });

                if (
                    solicitudesHora >=
                    this.maximoSolicitudesHora
                ) {
                    return null;
                }

                // Código temporal de ocho dígitos
                const codigo = randomInt(
                    0,
                    100000000
                ).toString().padStart(8, '0');

                const codigoHash = this.calcularHashCodigo(
                    invitacion.id,
                    codigo
                );

                const fechaCaducidad = new Date(
                    ahora.getTime() +
                    this.duracionCodigoMinutos * 60 * 1000
                );

                // Invalidar códigos anteriores antes de crear una nueva solicitud de verificación
                await tx.verificaciones_invitaciones_lanzadores.updateMany({
                    where: {
                        invitacion_id: invitacion.id,
                        fecha_invalidacion: null,
                        fecha_utilizacion: null
                    },
                    data: {
                        fecha_invalidacion: ahora
                    }
                });

                // Crear el nuevo código dentro de la misma transacción
                const verificacion =
                    await tx.verificaciones_invitaciones_lanzadores.create({
                        data: {
                            invitacion_id: invitacion.id,
                            codigo_hash: codigoHash,
                            intentos_fallidos: 0,
                            fecha_creacion: ahora,
                            fecha_caducidad: fechaCaducidad
                        }
                    });

                // Estos datos solo se utilizan internamente para solicitar el envío mediante Brevo.
                return {
                    verificacionId: verificacion.id,
                    correo: asignacion.lanzadores.correo,
                    nombre: asignacion.lanzadores.nombre,
                    codigo
                };
            }
        );

        // Si la invitación no está disponible o se han
        // alcanzado los límites, conservar la respuesta genérica.
        if (!solicitud) {
            return respuesta;
        }

        // La transacción ha terminado.
        // No mantenemos bloqueada la base de datos mientras Brevo procesa la petición.

        try {
            // El código solo se envía al correo almacenado en la asignación, nunca a una dirección
            // proporcionada por el navegador.
            await this.correoService.enviarCodigoVerificacionLanzador(
                solicitud.correo,
                solicitud.nombre,
                solicitud.codigo
            );

        } catch {

            // Si Brevo no confirma el envío, el código deja de ser válido
            try {
                await this.prisma.verificaciones_invitaciones_lanzadores.updateMany({
                    where: {
                        id: solicitud.verificacionId,
                        fecha_invalidacion: null,
                        fecha_utilizacion: null
                    },
                    data: {
                        fecha_invalidacion: new Date()
                    }
                });

            } catch {
                this.logger.error(
                    'No se pudo invalidar el código tras un error de Brevo.'
                );
            }

            // No registrar el código ni el contenido del mensaje enviado al proveedor
            this.logger.error(
                'Brevo no confirmó el envío del código de verificación.'
            );
        }

        return respuesta;
    }









    // --------------------------------------------------
    // 4. Verificar el código recibido por correo
    // --------------------------------------------------

    async verificarCodigo(
        token: string,
        codigo: string
    ) {

        this.comprobarFormatoToken(token);

        if (!/^\d{8}$/.test(codigo)) {
            throw new BadRequestException(
                'El código debe contener ocho dígitos.'
            );
        }

        const invitacion =
            await this.obtenerInvitacionVigente(token);

        const ahora = new Date();

        return this.prisma.$transaction(async (tx) => {

            // Bloquear la fila de la invitación durante la comprobación.
            // Así los intentos simultáneos se contabilizan uno a uno.
            const controlIntentos = await tx.$queryRaw<
                Array<{ intentos_verificacion: number }>
            >`
                SELECT intentos_verificacion
                FROM public.invitaciones_lanzadores
                WHERE id = ${invitacion.id}::uuid
                FOR UPDATE
            `;

            if (
                controlIntentos.length !== 1 ||
                controlIntentos[0].intentos_verificacion >= this.maximoIntentos
            ) {
                throw new BadRequestException(
                    'Se ha alcanzado el límite de intentos de verificación.'
                );
            }

            const intentosAcumulados =
                controlIntentos[0].intentos_verificacion;

            const verificacion =
                await tx.verificaciones_invitaciones_lanzadores.findFirst({
                    where: {
                        invitacion_id: invitacion.id,
                        fecha_invalidacion: null,
                        fecha_utilizacion: null,
                        fecha_verificacion: null
                    },
                    orderBy: {
                        fecha_creacion: 'desc'
                    }
                });

            if (
                !verificacion ||
                verificacion.fecha_caducidad <= ahora ||
                verificacion.intentos_fallidos >= this.maximoIntentos
            ) {
                throw new BadRequestException(
                    'El código ha caducado o ya no está disponible.'
                );
            }

            const codigoHash = this.calcularHashCodigo(
                invitacion.id,
                codigo
            );

            const hashRecibido = Buffer.from(
                codigoHash,
                'hex'
            );

            const hashGuardado = Buffer.from(
                verificacion.codigo_hash,
                'hex'
            );

            const coincide =
                hashRecibido.length === hashGuardado.length &&
                timingSafeEqual(
                    hashRecibido,
                    hashGuardado
                );

            if (!coincide) {

                // Incrementar los intentos de forma condicionada para evitar que dos peticiones consuman
                // simultáneamente el mismo contador.
                const resultado =
                    await tx.verificaciones_invitaciones_lanzadores.updateMany({
                        where: {
                            id: verificacion.id,
                            intentos_fallidos: verificacion.intentos_fallidos,
                            fecha_invalidacion: null,
                            fecha_verificacion: null
                        },
                        data: {
                            intentos_fallidos: {
                                increment: 1
                            }
                        }
                    });

                if (resultado.count !== 1) {
                    throw new ConflictException(
                        'La verificación ha cambiado. Inténtalo de nuevo.'
                    );
                }

                // Este contador se conserva aunque se solicite otro código.
                await tx.invitaciones_lanzadores.update({
                    where: {
                        id: invitacion.id
                    },
                    data: {
                        intentos_verificacion: {
                            increment: 1
                        }
                    }
                });

                const nuevosIntentos = intentosAcumulados + 1;

                if (nuevosIntentos >= this.maximoIntentos) {
                    // Al alcanzar siete errores, invalidar el código activo.
                    await tx.verificaciones_invitaciones_lanzadores.updateMany({
                        where: {
                            invitacion_id: invitacion.id,
                            fecha_utilizacion: null,
                            fecha_invalidacion: null
                        },
                        data: {
                            fecha_invalidacion: ahora
                        }
                    });
                }

                return {
                    verificada: false,
                    mensaje: nuevosIntentos >= this.maximoIntentos
                        ? 'Se ha alcanzado el límite de intentos de verificación.'
                        : 'El código no es correcto o ya no está disponible.'
                };
            }

            // Generar una credencial de uso único para responder a esta invitación concreta
            const credencialVerificacion =
                randomBytes(32).toString('hex');

            const credencialHash =
                this.calcularHash(credencialVerificacion);

            const fechaCaducidadCredencial = new Date(
                ahora.getTime() +
                this.duracionCredencialMinutos * 60 * 1000
            );

            const actualizacion =
                await tx.verificaciones_invitaciones_lanzadores.updateMany({
                    where: {
                        id: verificacion.id,
                        intentos_fallidos: verificacion.intentos_fallidos,
                        fecha_invalidacion: null,
                        fecha_verificacion: null,
                        fecha_caducidad: {
                            gt: ahora
                        }
                    },
                    data: {
                        fecha_verificacion: ahora,
                        credencial_hash: credencialHash,
                        fecha_caducidad_credencial:
                            fechaCaducidadCredencial
                    }
                });

            if (actualizacion.count !== 1) {
                throw new ConflictException(
                    'La verificación ya ha sido utilizada.'
                );
            }

            return {
                verificada: true,
                credencialVerificacion
            };
        });
    }

    // --------------------------------------------------
    // 5. Aceptar o rechazar una invitación
    // --------------------------------------------------

    async decidirInvitacion(
        token: string,
        credencialVerificacion: string,
        decision: DecisionInvitacion
    ) {

        this.comprobarFormatoToken(token);

        if (!/^[a-f0-9]{64}$/.test(credencialVerificacion)) {
            throw new BadRequestException(
                'La credencial de verificación no es válida.'
            );
        }

        const tokenHash = this.calcularHash(token);

        const credencialHash =
            this.calcularHash(credencialVerificacion);

        // Todas las modificaciones se realizan dentro de una transacción para evitar estados parciales
        return this.prisma.$transaction(async (tx) => {

            const ahora = new Date();

            // 1. Recuperar el registro del token
            const invitacion =
                await tx.invitaciones_lanzadores.findUnique({
                    where: {
                        token_hash: tokenHash
                    }
                });

            if (!invitacion) {
                throw new BadRequestException(
                    'La invitación no está disponible.'
                );
            }

            // 2. Recuperar la asignación y el lanzador
            const asignacion =
                await tx.asignaciones_lanzadores.findUnique({
                    where: {
                        id: invitacion.asignacion_id
                    },
                    include: {
                        lanzadores: true
                    }
                });

            if (!asignacion) {
                throw new BadRequestException(
                    'La invitación no está disponible.'
                );
            }

            // 3. Comprobar identidad y titularidad
            // La verificación se vincula a la invitación y a su correo destinatario, sin exigir un
            // usuario registrado en Supabase Auth.
            if (
                asignacion.lanzadores.usuario_id !== null &&
                asignacion.lanzadores.usuario_id ===
                asignacion.administrador_id
            ) {
                throw new ForbiddenException(
                    'No puedes actuar como lanzador de tu propia cuenta.'
                );
            }

            // 4. Comprobar vigencia, estado y uso
            if (
                invitacion.fecha_utilizacion !== null ||
                invitacion.fecha_invalidacion !== null ||
                invitacion.fecha_caducidad <= ahora ||
                invitacion.estado_envio !== 'aceptado_por_brevo' ||
                asignacion.estado !== 'pendiente' ||
                asignacion.fecha_caducidad <= ahora
            ) {
                throw new ConflictException(
                    'La invitación ha caducado, ya se ha utilizado o no está disponible.'
                );
            }

            // Comprobar que el destinatario verificó previamente su correo con esta invitación
            const verificacion =
                await tx.verificaciones_invitaciones_lanzadores.findFirst({
                    where: {
                        invitacion_id: invitacion.id,
                        credencial_hash: credencialHash,
                        fecha_verificacion: {
                            not: null
                        },
                        fecha_invalidacion: null,
                        fecha_utilizacion: null,
                        fecha_caducidad_credencial: {
                            gt: ahora
                        }
                    }
                });

            if (!verificacion) {
                throw new ForbiddenException(
                    'Debes verificar tu correo antes de responder.'
                );
            }

            // 5. Reservar el token para esta operación.
            // Solo una petición podrá marcarlo como utilizado.
            const actualizacionToken =
                await tx.invitaciones_lanzadores.updateMany({
                    where: {
                        id: invitacion.id,
                        fecha_utilizacion: null,
                        fecha_invalidacion: null,
                        fecha_caducidad: {
                            gt: ahora
                        },
                        estado_envio: 'aceptado_por_brevo'
                    },
                    data: {
                        fecha_utilizacion: ahora
                    }
                });

            if (actualizacionToken.count !== 1) {
                throw new ConflictException(
                    'La invitación ya no está disponible.'
                );
            }

            // 6. Consumir la credencial de verificación
            const consumoCredencial =
                await tx.verificaciones_invitaciones_lanzadores.updateMany({
                    where: {
                        id: verificacion.id,
                        fecha_utilizacion: null,
                        fecha_invalidacion: null,
                        fecha_caducidad_credencial: {
                            gt: ahora
                        }
                    },
                    data: {
                        fecha_utilizacion: ahora
                    }
                });

            if (consumoCredencial.count !== 1) {
                throw new ConflictException(
                    'La verificación ya ha sido utilizada.'
                );
            }

            // 7. Actualizar la asignación
            const actualizacionAsignacion =
                await tx.asignaciones_lanzadores.updateMany({
                    where: {
                        id: asignacion.id,
                        estado: 'pendiente',
                        fecha_caducidad: {
                            gt: ahora
                        }
                    },
                    data: {
                        estado: decision,
                        fecha_aceptacion:
                            decision === 'aceptada' ? ahora : null,
                        updated_at: ahora
                    }
                });

            if (actualizacionAsignacion.count !== 1) {
                throw new ConflictException(
                    'La asignación ya no está pendiente.'
                );
            }

            // 8. Registrar la decisión en el historial
            // El lanzador puede no tener una cuenta propia, por eso actor_usuario_id puede ser NULL.
            await tx.historial_asignaciones.create({
                data: {
                    asignacion_id: asignacion.id,
                    actor_usuario_id: null,
                    evento: decision === 'aceptada'
                        ? 'invitacion_aceptada'
                        : 'invitacion_rechazada',
                    estado_anterior: 'pendiente',
                    estado_nuevo: decision,
                    descripcion: decision === 'aceptada'
                        ? 'El lanzador verificó su correo y aceptó expresamente la invitación.'
                        : 'El lanzador verificó su correo y rechazó expresamente la invitación.'
                }
            });

            return {
                estado: decision,
                mensaje: decision === 'aceptada'
                    ? 'Has aceptado la invitación correctamente.'
                    : 'Has rechazado la invitación correctamente.'
            };
        });
    }
}


