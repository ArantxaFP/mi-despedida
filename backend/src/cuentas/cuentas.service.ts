import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException, NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { obtenerUrlBackoffice } from '../configuracion/urls-backoffice';

import { EditarCuentaSuperadminDto } from './dto/editar-cuenta-superadmin.dto';
import { BloqueosEdicionCuentasService } from './bloqueos-edicion-cuentas.service';
import { bloquearFilasCuentas } from './bloqueo-cuentas';

import { CorreoService } from '../correo/correo.service';

import { CrearSuperadministradorDto } from './dto/crear-superadministrador.dto';
import { ActivarSuperadministradorDto } from './dto/activar-superadministrador.dto';

import { ActualizarDatosPerfilBloqueoDto } from './dto/actualizar-datos-perfil-bloqueo.dto';
import { SuspenderCuentaDto } from './dto/suspender-cuenta.dto';

export interface DatosRegistroCuenta {
    nombre: string;
    correo: string;
    contrasena: string;
}

@Injectable()
export class CuentasService {

    private readonly marcaRegistroPendiente =
        'mi_despedida_registro_pendiente';

    constructor(
        private readonly prisma: PrismaService,
        private readonly supabaseService: SupabaseService,
        private readonly configService: ConfigService,
        private readonly bloqueosEdicion: BloqueosEdicionCuentasService,
        private readonly correoService: CorreoService
    ) { }

    // Consulta el rol y el estado de la cuenta autenticada.
    // Se utilizará para determinar a qué panel puede acceder el usuario.
    async obtenerMiAcceso(
        autorizacion?: string
    ) {

        if (
            !autorizacion ||
            !/^Bearer\s+\S+$/i.test(autorizacion)
        ) {
            throw new UnauthorizedException(
                'Debes iniciar sesión.'
            );
        }

        const token = autorizacion.split(/\s+/)[1];

        // Verificar el token directamente con Supabase Auth
        const { data, error } =
            await this.supabaseService.verificarUsuario(
                token
            );

        const usuario = data?.user;

        if (error || !usuario) {
            throw new UnauthorizedException(
                'La sesión no es válida o ha caducado.'
            );
        }

        if (!usuario.email_confirmed_at) {
            throw new UnauthorizedException(
                'Debes verificar tu correo electrónico.'
            );
        }

        // Consulta el rol y estado reales almacenados en Postgre
        const cuenta = await this.prisma.cuentas.findUnique({
            where: {
                id: usuario.id
            },
            select: {
                rol: true,
                estado: true,
                nombre: true,
                apellidos: true
            }
        });

        if (!cuenta) {
            throw new ForbiddenException(
                'No existe una cuenta operativa válida.'
            );
        }

        return {
            rol: cuenta.rol,
            estado: cuenta.estado,
            nombre: cuenta.nombre,
            apellidos: cuenta.apellidos
        };
    }

    // Comprobar que el usuario autenticado es un superadministrador en estado activo.
    // Esta autorización se reutilizará en todas las operaciones del panel de superadministración.
    async comprobarSuperadministradorActivo(
        autorizacion?: string
    ): Promise<string> {

        if (
            !autorizacion ||
            !/^Bearer\s+\S+$/i.test(autorizacion)
        ) {
            throw new UnauthorizedException(
                'Debes iniciar sesión.'
            );
        }

        const token = autorizacion.split(/\s+/)[1];

        // Verificar la identidad mediante Supabase Auth
        const { data, error } =
            await this.supabaseService.verificarUsuario(token);

        const usuario = data?.user;

        if (
            error ||
            !usuario ||
            !usuario.email_confirmed_at
        ) {
            throw new UnauthorizedException(
                'La sesión no es válida o el correo no está verificado.'
            );
        }

        // Comprobar el rol y estado reales en Postgre
        const cuenta = await this.prisma.cuentas.findUnique({
            where: {
                id: usuario.id
            },
            select: {
                rol: true,
                estado: true
            }
        });

        if (
            !cuenta ||
            cuenta.rol !== 'superadministrador' ||
            cuenta.estado !== 'activa'
        ) {
            throw new ForbiddenException(
                'No tienes permisos para realizar esta operación.'
            );
        }

        // Identificador verificado del superadministrador
        return usuario.id;
    }

    // Consultar la auditoría de cuentas desde superadministración
    async listarAuditoriaCuentasSuperadministrador(
        autorizacion: string | undefined,
        pagina = 1
    ) {
        // Solo los superadministradores activos pueden consultar la auditoría
        await this.comprobarSuperadministradorActivo(autorizacion);

        const tamanoPagina = 50;

        if (
            !Number.isSafeInteger(pagina) ||
            pagina < 1 ||
            !Number.isSafeInteger((pagina - 1) * tamanoPagina)
        ) {
            throw new BadRequestException(
                'La página solicitada no es válida.'
            );
        }

        const [total, registros] = await Promise.all([
            this.prisma.auditoria_operaciones_cuentas.count(),

            this.prisma.auditoria_operaciones_cuentas.findMany({
                skip: (pagina - 1) * tamanoPagina,
                take: tamanoPagina,

                // Mostrar primero las operaciones más recientes
                orderBy: [
                    { fecha_evento: 'desc' },
                    { id: 'desc' }
                ],

                // Nunca devolver el contenido de los campos modificados
                select: {
                    id: true,
                    cuenta_afectada_id: true,
                    actor_id: true,
                    rol_actor: true,
                    accion: true,
                    resultado: true,
                    campos_modificados: true,
                    motivo_codigo: true,
                    version_anterior: true,
                    version_nueva: true,
                    fecha_evento: true
                }
            })
        ]);

        return {
            registros,
            total,
            pagina,
            tamanoPagina,
            totalPaginas: Math.ceil(total / tamanoPagina)
        };
    }


    // Consultar la auditoría individual de una cuenta desde el listado de cuentas del panel
    async listarAuditoriaCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string,
        pagina = 1
    ) {
        // Únicamente un superadministrador activo puede consultar estos registros
        await this.comprobarSuperadministradorActivo(autorizacion);

        const tamanoPagina = 50;
        const desplazamiento = (pagina - 1) * tamanoPagina;

        if (
            !Number.isSafeInteger(pagina) ||
            pagina < 1 ||
            !Number.isSafeInteger(desplazamiento)
        ) {
            throw new BadRequestException(
                'La página solicitada no es válida.'
            );
        }

        // Comprobar que la cuenta consultada pertenece a un administrador.
        // Permitir cuentas activas, suspendidas, dadas de baja o finalizadas.
        const cuenta = await this.prisma.cuentas.findFirst({
            where: {
                id: cuentaId,
                rol: 'administrador'
            },
            select: {
                id: true,
                nombre: true,
                apellidos: true,
                correo: true,
                estado: true
            }
        });

        if (!cuenta) {
            throw new NotFoundException(
                'No se ha encontrado esta cuenta de administrador.'
            );
        }

        // El filtro se aplica en Postgre.
        // No se descargan registros pertenecientes a otras cuentas.
        const filtroAuditoria = {
            cuenta_afectada_id: cuentaId
        };

        const [total, registros] = await Promise.all([
            this.prisma.auditoria_operaciones_cuentas.count({
                where: filtroAuditoria
            }),

            this.prisma.auditoria_operaciones_cuentas.findMany({
                where: filtroAuditoria,
                skip: desplazamiento,
                take: tamanoPagina,

                // Orden estable para la paginación
                orderBy: [
                    { fecha_evento: 'desc' },
                    { id: 'desc' }
                ],

                // No devolver contraseñas, tokens ni valores de datos personales
                select: {
                    id: true,
                    actor_id: true,
                    rol_actor: true,
                    accion: true,
                    resultado: true,
                    campos_modificados: true,
                    motivo_codigo: true,
                    version_anterior: true,
                    version_nueva: true,
                    fecha_evento: true
                }
            })
        ]);

        return {
            cuenta,
            registros,
            total,
            pagina,
            tamanoPagina,
            totalPaginas: Math.max(
                1,
                Math.ceil(total / tamanoPagina)
            )
        };
    }


    // Consultar los usuarios superadministradores
    async listarSuperadministradores(
        autorizacion?: string
    ) {
        // Solo un superadministrador activo puede consultar las identidades de otros superadministradores
        await this.comprobarSuperadministradorActivo(
            autorizacion
        );

        // No devolver contraseñas, tokens ni metadatos de autenticación.
        // No confundir con usuarios administradores que se consultan en otra sección.
        return this.prisma.cuentas.findMany({
            where: {
                rol: 'superadministrador'
            },
            select: {
                id: true,
                nombre: true,
                apellidos: true,
                correo: true,
                estado: true,
                fecha_registro: true
            },
            orderBy: [
                { nombre: 'asc' },
                { correo: 'asc' }
            ]
        });
    }


    // Crear un nuevo superadministrador desde el panel mediante invitación por mail
    async crearSuperadministrador(
        autorizacion: string | undefined,
        datos: CrearSuperadministradorDto,
        origen?: string
    ) {
        const actorId =
            await this.comprobarSuperadministradorActivo(autorizacion);

        const nombre = datos.nombre.trim();
        const apellidos = datos.apellidos?.trim() || null;
        const correo = datos.correo.trim().toLowerCase();

        if (!nombre || nombre.length > 100) {
            throw new BadRequestException(
                'El nombre no es válido.'
            );
        }

        if (apellidos && apellidos.length > 150) {
            throw new BadRequestException(
                'Los apellidos no son válidos.'
            );
        }

        // No convertir nunca una cuenta existente en superadministrador
        const existente = await this.prisma.cuentas.findUnique({
            where: { correo },
            select: { id: true }
        });

        if (existente) {
            throw new ConflictException(
                'Ya existe una cuenta registrada con ese correo.'
            );
        }

        // Las invitaciones de superadministradores siempre dirigen al backoffice publicado en Netlify, aunque se generen desde local.
        // La URL se obtiene de la configuración privada del backend.
        const urlBackoffice = this.configService
            .getOrThrow<string>('BACKOFFICE_URL_SUPERADMIN')
            .replace(/\/+$/, '');

        // Crear una invitación de Supabase sin utilizar su envío de correo.
        // Brevo será el único responsable de enviar el enlace.
        const { data, error } =
            await this.supabaseService.obtenerCliente()
                .auth.admin.generateLink({
                    type: 'invite',
                    email: correo,
                    options: {
                        data: {
                            nombre,
                            apellidos: apellidos ?? ''
                        },
                        redirectTo:
                            `${urlBackoffice}/activar-superadmin`
                    }
                });

        if (
            error ||
            !data?.user ||
            !data.properties?.action_link ||
            data.user.email?.toLowerCase() !== correo
        ) {
            throw new ConflictException(
                'No se ha podido preparar la invitación. ' +
                'Comprueba que el correo no pertenezca a una identidad existente.'
            );
        }

        const usuarioId = data.user.id;
        const enlace = data.properties.action_link;

        // La cuenta permanece sin acceso hasta que el invitado verifique el correo y establezca su contraseña
        try {
            await this.prisma.$transaction(async tx => {

                await tx.cuentas.create({
                    data: {
                        id: usuarioId,
                        nombre,
                        apellidos,
                        correo,
                        rol: 'superadministrador',
                        estado: 'pendiente_verificacion'
                    }
                });

                // Registrar que superadministrador ha autorizado la creación de la cuenta
                await tx.auditoria_operaciones_cuentas.create({
                    data: {
                        cuenta_afectada_id: usuarioId,
                        actor_id: actorId,
                        rol_actor: 'superadministrador',
                        accion: 'crear_superadministrador',
                        resultado: 'realizada',
                        campos_modificados: [
                            'nombre',
                            'apellidos',
                            'correo',
                            'rol',
                            'estado'
                        ],
                        version_anterior: null,
                        version_nueva: 1
                    }
                });
            });

        } catch {
            // Puede quedar una identidad pendiente en Supabase Auth.
            // Nunca se le conceden permisos sin su fila validada en cuentas.
            throw new ServiceUnavailableException(
                'No se ha podido completar el alta pendiente. ' +
                'La identidad puede requerir recuperación supervisada.'
            );
        }

        // Enviar el enlace únicamente después de registrar la cuenta.
        // No enviarlo ni devolverlo al frontend antes de este punto.
        try {
            await this.correoService.enviarInvitacionSuperadministrador(
                correo,
                nombre,
                enlace
            );

        } catch {
            // Conservar la cuenta pendiente para permitir gestionar el reenvío sin perder su identidad
            throw new ServiceUnavailableException(
                'La cuenta se ha creado pendiente de activación, ' +
                'pero no se ha podido enviar el correo.'
            );
        }

        return {
            id: usuarioId,
            estado: 'pendiente_verificacion',
            mensaje: 'La invitación se ha enviado correctamente.'
        };
    }



    // Activar la invitación y establecer la contraseña
    async activarSuperadministrador(
        autorizacion: string | undefined,
        datos: ActivarSuperadministradorDto
    ) {
        if (
            !autorizacion ||
            !/^Bearer\s+\S+$/i.test(autorizacion)
        ) {
            throw new UnauthorizedException(
                'Debes acceder desde una invitación válida.'
            );
        }

        const token = autorizacion.split(/\s+/)[1];

        // La identidad se obtiene del token verificado en Supabase
        const { data, error } =
            await this.supabaseService.verificarUsuario(token);

        const usuario = data?.user;

        if (
            error ||
            !usuario ||
            !usuario.email ||
            !usuario.email_confirmed_at
        ) {
            throw new UnauthorizedException(
                'La invitación no está verificada o la sesión ha caducado.'
            );
        }

        const cuenta = await this.prisma.cuentas.findUnique({
            where: { id: usuario.id },
            select: {
                rol: true,
                estado: true,
                correo: true
            }
        });

        if (
            !cuenta ||
            cuenta.rol !== 'superadministrador' ||
            cuenta.estado !== 'pendiente_verificacion' ||
            cuenta.correo.toLowerCase() !== usuario.email.toLowerCase()
        ) {
            throw new ForbiddenException(
                'No existe una invitación pendiente para esta identidad.'
            );
        }

        // Establecer la contraseña desde el backend con permisos de servicio
        const { error: errorContrasena } =
            await this.supabaseService.obtenerCliente()
                .auth.admin.updateUserById(
                    usuario.id,
                    { password: datos.contrasena }
                );

        if (errorContrasena) {
            throw new ServiceUnavailableException(
                'No se ha podido establecer la contraseña.'
            );
        }



        // Si la operación en Postgre falla, la cuenta continua pendiente y no recibe permisos de superadministración
        return this.prisma.$transaction(async tx => {

            const [actual] = await bloquearFilasCuentas(
                tx,
                usuario.id
            );

            if (
                !actual ||
                actual.rol !== 'superadministrador' ||
                actual.estado !== 'pendiente_verificacion'
            ) {
                throw new ConflictException(
                    'La invitación ya no está pendiente de activación.'
                );
            }

            const actualizada = await tx.cuentas.update({
                where: { id: usuario.id },
                data: {
                    estado: 'activa',
                    version: { increment: 1 }
                },
                select: { version: true }
            });

            // Registrar la activación por el propio invitado
            await tx.auditoria_operaciones_cuentas.create({
                data: {
                    cuenta_afectada_id: usuario.id,
                    actor_id: usuario.id,
                    rol_actor: 'superadministrador',
                    accion: 'activar_superadministrador',
                    resultado: 'realizada',
                    campos_modificados: ['estado'],
                    version_anterior: actual.version,
                    version_nueva: actualizada.version
                }
            });

            return {
                estado: 'activa',
                mensaje: 'Tu cuenta de superadministrador se ha activado.'
            };
        });
    }



    // Consultar las cuentas registradas en la plataforma.
    // Acceso exclusivo para superadministradores activos.
    // No devuelve contraseñas, tokens ni contenido privado.
    async listarCuentasSuperadministrador(
        autorizacion?: string
    ) {


        // Verificar que la operación la realiza un superadministrador con la cuenta activa
        await this.comprobarSuperadministradorActivo(
            autorizacion
        );



        // Devolver únicamente los campos autorizados.
        // Los superadmins se gestionan en una sección independiente.
        return this.prisma.cuentas.findMany({
            where: {
                rol: 'administrador'
            },

            select: {
                id: true,
                nombre: true,
                apellidos: true,
                correo: true,
                rol: true,
                estado: true
            },
            orderBy: {
                nombre: 'asc'
            }
        });
    }

    // Previsualiza los cambios solicitados por un superadministrador.
    // No realiza modificaciones en PostgreSQL ni Supabase Auth.
    async previsualizarEdicionCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string,
        datos: EditarCuentaSuperadminDto
    ) {

        // Solo un superadministrador activo puede realizar esta operación
        await this.comprobarSuperadministradorActivo(
            autorizacion
        );

        // Consultar únicamente los datos necesarios de la cuenta
        const cuenta = await this.prisma.cuentas.findUnique({
            where: {
                id: cuentaId
            },
            select: {
                id: true,
                nombre: true,
                apellidos: true,
                /*correo: true,*/
                rol: true,
                estado: true
            }
        });

        if (!cuenta) {
            throw new NotFoundException(
                'No se ha encontrado la cuenta.'
            );
        }

        // Esta sección solo permite gestionar cuentas de administradores.
        // Las cuentas de superadminis van aparte.
        if (cuenta.rol !== 'administrador') {
            throw new ForbiddenException(
                'Esta sección no permite gestionar cuentas de superadministradores.'
            );
        }


        // Normalizar los datos introducidos
        const propuesta = {
            nombre: datos.nombre.trim(),
            apellidos: datos.apellidos?.trim() || null,
            /*correo: datos.correo.trim().toLowerCase()*/
        };

        // Identificar qué campos han cambiado
        const cambios = {
            nombre: propuesta.nombre !== cuenta.nombre,
            apellidos: propuesta.apellidos !== cuenta.apellidos,
            /*correo: propuesta.correo !== cuenta.correo*/
        };

        return {
            cuentaId: cuenta.id,
            rol: cuenta.rol,
            estado: cuenta.estado,
            datosPropuestos: propuesta,
            camposModificados: cambios,
            /* requiereVerificacionCorreo: cambios.correo,*/
            guardado: false
        };
    }



    // Identificar al administrador titular que solicita una operación sobre el bloqueo de su propia cuenta
    private async verificarTitularEdicionPerfil(
        autorizacion: string | undefined,
        cuentaId?: string
    ): Promise<string> {

        if (
            !autorizacion ||
            !/^Bearer\s+\S+$/i.test(autorizacion)
        ) {
            throw new UnauthorizedException(
                'Debes iniciar sesión.'
            );
        }

        const token = autorizacion.split(/\s+/)[1];

        const { data, error } =
            await this.supabaseService.verificarUsuario(token);

        const usuario = data?.user;

        if (
            error ||
            !usuario ||
            !usuario.email_confirmed_at

        ) {
            throw new UnauthorizedException(
                'La sesión no es válida o el correo no está verificado.'
            );
        }

        // Impedir que un administrador gestione el bloqueo de la cuenta de otra persona
        if (cuentaId !== undefined && usuario.id !== cuentaId) {
            throw new ForbiddenException(
                'No puedes gestionar la edición de otra cuenta.'
            );
        }

        // Comprobar el rol y estado actuales en Postgre
        await this.comprobarCuentaActiva(usuario.id);

        return usuario.id;
    }

    // Leer los datos personales del administrador autenticado
    async obtenerDatosPerfil(autorizacion?: string) {
        const titularId = await this.verificarTitularEdicionPerfil(autorizacion);

        const cuenta = await this.prisma.cuentas.findFirst({
            where: {
                id: titularId,
                rol: 'administrador',
                estado: 'activa'
            },
            select: {
                nombre: true,
                apellidos: true
            }
        });

        if (!cuenta) {
            throw new ForbiddenException(
                'Tu cuenta no está habilitada para consultar el perfil.'
            );
        }

        return cuenta;
    }

    // Guardar los datos personales del titular con su bloqueo de edición
    async actualizarDatosPerfilConBloqueo(
        autorizacion: string | undefined,
        datos: ActualizarDatosPerfilBloqueoDto
    ) {
        const titularId = await this.verificarTitularEdicionPerfil(autorizacion);

        return this.bloqueosEdicion.guardarNombreYApellidosConBloqueo(
            titularId,
            titularId,
            datos.token,
            datos.versionEsperada,
            datos.nombre,
            datos.apellidos ?? null
        );
    }


    // Adquirir el bloqueo prioritario del administrador titular
    async adquirirBloqueoEdicionPerfil(
        autorizacion: string | undefined,
        cuentaId: string
    ) {

        const editorId = await this.verificarTitularEdicionPerfil(
            autorizacion,
            cuentaId
        );

        return this.bloqueosEdicion.adquirirBloqueo(
            cuentaId,
            editorId
        );
    }


    // Renovar el bloqueo prioritario del administrador titular
    async renovarBloqueoEdicionPerfil(
        autorizacion: string | undefined,
        cuentaId: string,
        token: string
    ) {

        const editorId = await this.verificarTitularEdicionPerfil(
            autorizacion,
            cuentaId
        );

        return this.bloqueosEdicion.renovarBloqueo(
            cuentaId,
            editorId,
            token
        );
    }


    // Liberar el bloqueo al cancelar o terminar la edición
    async liberarBloqueoEdicionPerfil(
        autorizacion: string | undefined,
        cuentaId: string,
        token: string
    ) {

        const editorId = await this.verificarTitularEdicionPerfil(
            autorizacion,
            cuentaId
        );

        return this.bloqueosEdicion.liberarBloqueo(
            cuentaId,
            editorId,
            token
        );
    }


    async adquirirBloqueoEdicionSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string
    ) {
        const editorId = await this.comprobarSuperadministradorActivo(autorizacion);

        return this.bloqueosEdicion.adquirirBloqueo(cuentaId, editorId);
    }

    async renovarBloqueoEdicionSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string,
        token: string
    ) {
        const editorId = await this.comprobarSuperadministradorActivo(autorizacion);

        return this.bloqueosEdicion.renovarBloqueo(cuentaId, editorId, token);
    }

    async liberarBloqueoEdicionSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string,
        token: string
    ) {
        const editorId = await this.comprobarSuperadministradorActivo(autorizacion);

        return this.bloqueosEdicion.liberarBloqueo(cuentaId, editorId, token);
    }

    // Guardar nombre y apellidos de la cuenta seleccionada por el superadministrador
    async actualizarDatosCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string,
        datos: ActualizarDatosPerfilBloqueoDto
    ) {
        const editorId = await this.comprobarSuperadministradorActivo(
            autorizacion
        );

        return this.bloqueosEdicion.guardarNombreYApellidosConBloqueo(
            cuentaId,
            editorId,
            datos.token,
            datos.versionEsperada,
            datos.nombre,
            datos.apellidos ?? null
        );
    }


    // Suspender una cuenta
    async suspenderCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string,
        datos: SuspenderCuentaDto
    ) {
        const editorId = await this.comprobarSuperadministradorActivo(
            autorizacion
        );
        const motivo = datos.motivo.trim();

        if (!motivo) {
            throw new BadRequestException('Indica el motivo de la suspensión.');
        }

        return this.prisma.$transaction(async tx => {
            const [cuenta] = await tx.$queryRaw<Array<{
                rol: string;
                estado: string;
                version: number;
            }>>`
                SELECT rol, estado, version
                FROM public.cuentas
                WHERE id = ${cuentaId}::uuid
                FOR UPDATE
            `;

            if (!cuenta || cuenta.rol !== 'administrador') {
                throw new NotFoundException(
                    'No se ha encontrado esta cuenta de administrador.'
                );
            }

            if (cuenta.estado === 'suspendida') {
                return { estado: 'suspendida', version: cuenta.version };
            }

            if (cuenta.estado !== 'activa') {
                throw new ConflictException(
                    'Solo se pueden suspender cuentas activas.'
                );
            }

            const [actualizada] = await tx.$queryRaw<Array<{ version: number }>>`
                UPDATE public.cuentas
                SET estado = 'suspendida',
                    fecha_suspension = clock_timestamp(),
                    motivo_suspension = ${motivo},
                    version = version + 1
                WHERE id = ${cuentaId}::uuid
                RETURNING version
            `;

            await tx.$executeRaw`
                DELETE FROM public.bloqueos_edicion_cuentas
                WHERE cuenta_id = ${cuentaId}::uuid
            `;

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
                    'superadministrador',
                    'suspender_cuenta',
                    'realizada',
                    ARRAY['estado', 'fecha_suspension', 'motivo_suspension']::text[],
                    ${cuenta.version},
                    ${actualizada.version}
                )
            `;

            return { estado: 'suspendida', version: actualizada.version };
        });
    }



    // Reactivar una cuenta de administrador suspendida
    async reactivarCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string
    ) {
        const editorId = await this.comprobarSuperadministradorActivo(
            autorizacion
        );

        return this.prisma.$transaction(async tx => {
            // Usar el mismo bloqueo de fila que la suspensión para ordenar los cambios de estado
            const [cuenta] = await tx.$queryRaw<Array<{
                rol: string;
                estado: string;
                version: number;
            }>>`
                SELECT rol, estado, version
                FROM public.cuentas
                WHERE id = ${cuentaId}::uuid
                FOR UPDATE
            `;

            if (!cuenta || cuenta.rol !== 'administrador') {
                throw new NotFoundException(
                    'No se ha encontrado esta cuenta de administrador.'
                );
            }

            // Si se repite una petición que ya se completó, devolver el estado actual
            if (cuenta.estado === 'activa') {
                return { estado: 'activa', version: cuenta.version };
            }

            if (cuenta.estado !== 'suspendida') {
                throw new ConflictException(
                    'Solo se pueden reactivar cuentas suspendidas.'
                );
            }

            // Conservar la fecha y el motivo de la última suspensión
            const [actualizada] = await tx.$queryRaw<Array<{ version: number }>>`
                UPDATE public.cuentas
                SET estado = 'activa',
                    version = version + 1
                WHERE id = ${cuentaId}::uuid
                RETURNING version
            `;

            // Confirmar el cambio de estado y su auditoría en la misma transacción
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
                    'superadministrador',
                    'reactivar_cuenta',
                    'realizada',
                    ARRAY['estado']::text[],
                    ${cuenta.version},
                    ${actualizada.version}
                )
            `;

            return { estado: 'activa', version: actualizada.version };
        });
    }


    // Dar de baja una cuenta desde superadministración y conservar su identidad
    async darDeBajaCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string
    ) {
        const actorId = await this.comprobarSuperadministradorActivo(autorizacion);

        return this.ejecutarBajaCuenta(
            actorId,
            cuentaId,
            'superadministrador'
        );
    }

    // Permitir al administrador solicitar la baja exclusivamente de su propia cuenta
    async darDeBajaMiCuenta(autorizacion?: string) {
        const titularId = await this.verificarTitularEdicionPerfil(autorizacion);

        return this.ejecutarBajaCuenta(
            titularId,
            titularId,
            'administrador'
        );
    }

    // Procedimiento compartido para la baja voluntaria y la baja administrativa
    private async ejecutarBajaCuenta(
        actorId: string,
        cuentaId: string,
        rolActor: 'administrador' | 'superadministrador'
    ) {
        return this.prisma.$transaction(async tx => {

            // Usar el mismo bloqueo de fila que la edición y la suspensión de cuentas
            const [cuenta] = await tx.$queryRaw<Array<{
                rol: string;
                estado: string;
                version: number;
            }>>`
                SELECT rol, estado, version
                FROM public.cuentas
                WHERE id = ${cuentaId}::uuid
                FOR UPDATE
            `;

            // La baja voluntaria solo puede tramitarla el titular con su cuenta activa.
            // El superadministrador también puede dar de baja una cuenta suspendida.
            if (
                rolActor === 'administrador' &&
                cuenta.estado !== 'activa'
            ) {
                throw new ForbiddenException(
                    'Tu cuenta no está habilitada para solicitar la baja.'
                );
            }


            // Una petición repetida devuelve la baja ya registrada
            if (cuenta.estado === 'baja') {
                return { estado: 'baja', version: cuenta.version };
            }

            if (cuenta.estado !== 'activa' && cuenta.estado !== 'suspendida') {
                throw new ConflictException(
                    'Solo se pueden dar de baja cuentas activas o suspendidas.'
                );
            }

            // Los reintentos y los envíos pendientes de resolución cuentan como proceso en curso
            const [activacion] = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT id
                FROM public.solicitudes_activacion
                WHERE administrador_id = ${cuentaId}::uuid
                  AND estado IN (
                      'pendiente_validacion',
                      'periodo_seguridad',
                      'en_procesamiento',
                      'con_incidencias'
                  )
                LIMIT 1
            `;

            if (activacion) {
                throw new ConflictException(
                    'La cuenta tiene una activación en curso y todavía no puede darse de baja.'
                );
            }

            // El borrado de los contactos elimina en cascada sus mensajes individuales
            await tx.contactos_destinatarios.deleteMany({
                where: { administrador_id: cuentaId }
            });

            // Retirar las copias de destinatarios y mensajes de las solicitudes canceladas
            await tx.$executeRaw`
                DELETE FROM public.comunicaciones_lote AS lote
                USING public.solicitudes_activacion AS solicitud
                WHERE lote.solicitud_id = solicitud.id
                  AND solicitud.administrador_id = ${cuentaId}::uuid
                  AND solicitud.estado = 'cancelada'
            `;

            // Conservar la solicitud cancelada y su historial, retirando el contenido preparado
            await tx.$executeRaw`
                UPDATE public.solicitudes_activacion
                SET mensaje_general = NULL,
                    informacion_ceremonia = NULL
                WHERE administrador_id = ${cuentaId}::uuid
                  AND estado = 'cancelada'
            `;

            // Revocar las asignaciones de esta cuenta e inhabilitar su actuación como lanzador en otras cuentas. 
            // Conservar el historial en ambos casos.
            const asignaciones = await tx.$queryRaw<Array<{ asignacion_id: string }>>`
                WITH anteriores AS (
                    SELECT
                        a.id,
                        a.estado,
                        CASE
                            WHEN a.administrador_id = ${cuentaId}::uuid THEN 'revocada'
                            ELSE 'inhabilitada'
                        END AS estado_nuevo
                    FROM public.asignaciones_lanzadores AS a
                    JOIN public.lanzadores AS l ON l.id = a.lanzador_id
                    WHERE a.estado IN ('pendiente', 'aceptada')
                      AND (
                          a.administrador_id = ${cuentaId}::uuid
                          OR l.usuario_id = ${cuentaId}::uuid
                      )
                    ORDER BY a.id
                    FOR UPDATE OF a
                ), cambios AS (
                    UPDATE public.asignaciones_lanzadores AS a
                    SET estado = anteriores.estado_nuevo,
                        fecha_revocacion = CASE
                            WHEN anteriores.estado_nuevo = 'revocada' THEN clock_timestamp()
                            ELSE a.fecha_revocacion
                        END,
                        updated_at = clock_timestamp()
                    FROM anteriores
                    WHERE a.id = anteriores.id
                    RETURNING a.id, anteriores.estado AS estado_anterior, a.estado AS estado_nuevo
                )
                INSERT INTO public.historial_asignaciones (
                    asignacion_id, actor_usuario_id, evento, estado_anterior, estado_nuevo
                )
                SELECT
                    id,
                    ${actorId}::uuid,
                    CASE
                        WHEN estado_nuevo = 'inhabilitada' THEN 'autorizacion_inhabilitada'
                        WHEN estado_anterior = 'pendiente' THEN 'invitacion_retirada'
                        ELSE 'autorizacion_revocada'
                    END,
                    estado_anterior,
                    estado_nuevo
                FROM cambios
                RETURNING asignacion_id
            `;

            if (asignaciones.length > 0) {
                const asignacionIds = asignaciones.map(fila => fila.asignacion_id);
                const fechaInvalidacion = new Date();

                // Invalidar los enlaces y verificaciones que siguen sin utilizarse
                await tx.invitaciones_lanzadores.updateMany({
                    where: {
                        asignacion_id: { in: asignacionIds },
                        fecha_utilizacion: null,
                        fecha_invalidacion: null
                    },
                    data: { fecha_invalidacion: fechaInvalidacion }
                });

                await tx.verificaciones_invitaciones_lanzadores.updateMany({
                    where: {
                        invitaciones_lanzadores: {
                            asignacion_id: { in: asignacionIds }
                        },
                        fecha_utilizacion: null,
                        fecha_invalidacion: null
                    },
                    data: { fecha_invalidacion: fechaInvalidacion }
                });
            }

            // Invalidar cualquier edición abierta de la cuenta
            await tx.bloqueos_edicion_cuentas.deleteMany({
                where: { cuenta_id: cuentaId }
            });

            // Mantener el nombre y el correo para que la cuenta siga identificable
            const actualizada = await tx.cuentas.update({
                where: { id: cuentaId },
                data: {
                    estado: 'baja',
                    apellidos: null,
                    fecha_suspension: null,
                    motivo_suspension: null,
                    version: { increment: 1 }
                },
                select: { version: true }
            });

            // Registrar la actuación administrativa en la misma transacción que el borrado
            await tx.auditoria_operaciones_cuentas.create({
                data: {
                    cuenta_afectada_id: cuentaId,
                    actor_id: actorId,

                    // Registrar quién ha solicitado la baja
                    rol_actor: rolActor,

                    accion: 'dar_de_baja_cuenta',
                    resultado: 'realizada',

                    // Distinguir una baja voluntaria de una administrativa
                    motivo_codigo: rolActor === 'administrador'
                        ? 'baja_voluntaria'
                        : 'baja_administrativa',

                    campos_modificados: [
                        'estado', 'apellidos', 'fecha_suspension', 'motivo_suspension'
                    ],
                    version_anterior: cuenta.version,
                    version_nueva: actualizada.version
                }
            });

            return { estado: 'baja', version: actualizada.version };
        });
    }


    // Recuperar el acceso de una cuenta de administrador dada de baja
    async recuperarCuentaSuperadministrador(
        autorizacion: string | undefined,
        cuentaId: string
    ) {
        const actorId = await this.comprobarSuperadministradorActivo(autorizacion);

        return this.prisma.$transaction(async tx => {
            // Coordinar la recuperación con cualquier otro cambio de estado
            const [cuenta] = await bloquearFilasCuentas(tx, cuentaId);

            if (!cuenta || cuenta.rol !== 'administrador') {
                throw new NotFoundException(
                    'No se ha encontrado esta cuenta de administrador.'
                );
            }

            if (cuenta.estado !== 'baja') {
                throw new ConflictException(
                    'Solo se pueden recuperar cuentas dadas de baja.'
                );
            }

            // Recuperar el acceso usando la identidad que se conservó al tramitar la baja
            const actualizada = await tx.cuentas.update({
                where: { id: cuentaId },
                data: {
                    estado: 'activa',
                    version: { increment: 1 }
                },
                select: { version: true }
            });

            // Registrar el cambio de estado y la auditoría en la misma transacción
            await tx.auditoria_operaciones_cuentas.create({
                data: {
                    cuenta_afectada_id: cuentaId,
                    actor_id: actorId,
                    rol_actor: 'superadministrador',
                    accion: 'recuperar_cuenta',
                    resultado: 'realizada',
                    campos_modificados: ['estado'],
                    version_anterior: cuenta.version,
                    version_nueva: actualizada.version
                }
            });

            return { estado: 'activa', version: actualizada.version };
        });
    }


    // Comprobar que el administrador tiene una cuenta activa.
    // Un token válido de Supabase Auth no es suficiente para autorizar operaciones privadas.
    async comprobarCuentaActiva(
        usuarioId: string
    ): Promise<void> {

        const cuenta = await this.prisma.cuentas.findUnique({
            where: {
                id: usuarioId
            },
            select: {
                estado: true,
                rol: true
            }
        });

        if (!cuenta) {
            throw new ForbiddenException(
                'No existe una cuenta operativa válida.'
            );
        }

        // Las operaciones de este método están reservadas a los administradores titulares.
        // Los superadministradores utilizan endpoints propios distintos por política de privacidad de datos.
        if (cuenta.rol !== 'administrador') {
            throw new ForbiddenException(
                'No tienes permisos para realizar esta operación.'
            );
        }


        if (cuenta.estado !== 'activa') {
            throw new ForbiddenException(
                'Tu cuenta no está habilitada para realizar esta operación.'
            );
        }
    }


    // Crear la identidad en Supabase Auth y la cuenta en Postgre
    async registrar(
        datos: DatosRegistroCuenta,
        origen?: string
    ) {

        if (
            !datos ||
            typeof datos.nombre !== 'string' ||
            typeof datos.correo !== 'string' ||
            typeof datos.contrasena !== 'string'
        ) {
            throw new BadRequestException(
                'Los datos del registro no son válidos.'
            );
        }

        const nombre = datos.nombre.trim();
        const correo = datos.correo.trim().toLowerCase();
        const contrasena = datos.contrasena;

        if (
            !nombre ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ||
            !contrasena
        ) {
            throw new BadRequestException(
                'Revisa los datos del formulario.'
            );
        }

        const urlBackoffice = obtenerUrlBackoffice(
            this.configService,
            origen
        );

        const { data, error } =
            await this.supabaseService
                .obtenerClienteRegistro()
                .auth.signUp({
                    email: correo,
                    password: contrasena,
                    options: {
                        data: {
                            nombre
                        },
                        emailRedirectTo:
                            `${urlBackoffice}/acceso`
                    }
                });

        if (error) {
            throw new BadRequestException(
                'No se ha podido iniciar el registro. ' +
                'Comprueba los datos introducidos.'
            );
        }

        const respuesta = {
            mensaje:
                'Si el registro se ha iniciado correctamente, ' +
                'revisa tu correo para verificar la cuenta.'
        };

        if (!data.user) {
            return respuesta;
        }

        const clientePrivado =
            this.supabaseService.obtenerCliente();

        // Comprobar que Supabase ha creado una identidad real.
        // signUp puede devolver una identidad ficticia cuando
        // alguien intenta registrarse con un correo existente.
        const { data: consulta, error: errorConsulta } =
            await clientePrivado.auth.admin.getUserById(
                data.user.id
            );

        const usuario = consulta?.user;

        if (
            errorConsulta ||
            !usuario ||
            usuario.email?.toLowerCase() !== correo
        ) {
            return respuesta;
        }

        // No reconstruir cuentas previamente existentes que ya tengan el correo confirmado
        if (usuario.email_confirmed_at) {
            return respuesta;
        }

        const cuentaExistente =
            await this.prisma.cuentas.findUnique({
                where: {
                    id: usuario.id
                }
            });

        if (cuentaExistente) {
            return respuesta;
        }

        // Marca modificable únicamente desde el servidor.
        // Permitirá reconocer un alta pendiente si falla Prisma.
        const { error: errorMarca } =
            await clientePrivado.auth.admin.updateUserById(
                usuario.id,
                {
                    app_metadata: {
                        ...usuario.app_metadata,
                        [this.marcaRegistroPendiente]: true
                    }
                }
            );


        // Aunque falle guardar la marca en Supabase Auth intentamos crear la cuenta en PostgreSQL.
        // Así evitamos dejar una identidad sin cuenta cuando la base de datos sí está disponible.
        const marcaPendienteGuardada = !errorMarca;

        try {
            await this.prisma.cuentas.create({
                data: {
                    id: usuario.id,
                    nombre,
                    correo,
                    rol: 'administrador',
                    estado: 'pendiente_verificacion'
                }
            });

        } catch {
            // Si tampoco se ha podido guardar la marca, no podemos acreditar automáticamente
            // que esta identidad corresponda a un alta pendiente.
            if (!marcaPendienteGuardada) {
                throw new ServiceUnavailableException(
                    'El registro no se ha podido completar. ' +
                    'La cuenta requiere una recuperación supervisada.'
                );
            }

            // Se conserva la identidad de Supabase Auth.
            // La marca permite recuperar el registro después de verificar el correo.
            throw new ServiceUnavailableException(
                'El registro está pendiente de completarse. ' +
                'No es necesario eliminar tu identidad.'
            );
        }


        return respuesta;
    }

    // Comprobar la identidad autenticada y el estado de la cuenta
    async sincronizar(autorizacion?: string) {

        if (
            !autorizacion ||
            !/^Bearer\s+\S+$/i.test(autorizacion)
        ) {
            throw new UnauthorizedException(
                'Debes iniciar sesión.'
            );
        }

        const token = autorizacion.split(/\s+/)[1];

        const { data, error } =
            await this.supabaseService.verificarUsuario(
                token
            );

        const usuario = data?.user;

        if (error || !usuario) {
            throw new UnauthorizedException(
                'La sesión no es válida o ha caducado.'
            );
        }

        if (!usuario.email || !usuario.email_confirmed_at) {
            throw new UnauthorizedException(
                'Debes verificar tu correo electrónico.'
            );
        }

        const cuenta =
            await this.prisma.cuentas.findUnique({
                where: {
                    id: usuario.id
                }
            });

        if (cuenta) {

            // Los superadministradores tienen un procedimiento de activación independiente mediante invitación.
            // Verificar el correo no activa automáticamente su cuenta.
            if (cuenta.rol === 'superadministrador') {
                return {
                    estado: cuenta.estado
                };
            }

            // Solo las cuentas pendientes pueden pasar automáticamente al estado activa
            if (cuenta.estado === 'pendiente_verificacion') {

                // Activar únicamente si la cuenta sigue pendiente.
                // Evita sobrescribir una suspensión o finalización realizada por otra petición simultánea.
                const resultado =
                    await this.prisma.cuentas.updateMany({
                        where: {
                            id: usuario.id,
                            estado: 'pendiente_verificacion'
                        },
                        data: {
                            estado: 'activa'
                        }
                    });


                if (resultado.count === 0) {
                    const cuentaActual =
                        await this.prisma.cuentas.findUnique({
                            where: {
                                id: usuario.id
                            },
                            select: {
                                estado: true
                            }
                        });

                    if (!cuentaActual) {
                        throw new ForbiddenException(
                            'No existe una cuenta operativa válida.'
                        );
                    }

                    // Otra operación ha cambiado el estado.
                    // Devuelve el estado real sin modificarlo.
                    return {
                        estado: cuentaActual.estado
                    };
                }

                // La actualización se ha realizado correctamente
                await this.retirarMarcaRegistro(usuario.id);

                return {
                    estado: 'activa'
                };

            }

            // No reactivar cuentas suspendidas o finalizadas
            return {
                estado: cuenta.estado
            };
        }

        // Si falta la cuenta, exigir una prueba creada por NestJS de que el alta está pendiente
        if (
            usuario.app_metadata?.[
            this.marcaRegistroPendiente
            ] !== true
        ) {
            throw new ForbiddenException(
                'No existe una cuenta operativa válida.'
            );
        }

        const nombre =
            typeof usuario.user_metadata?.nombre === 'string'
                ? usuario.user_metadata.nombre.trim()
                : '';

        if (!nombre) {
            throw new ServiceUnavailableException(
                'No se dispone de los datos necesarios ' +
                'para recuperar el registro.'
            );
        }

        // Recuperación de un registro pendiente acreditado
        try {
            await this.prisma.cuentas.create({
                data: {
                    id: usuario.id,
                    nombre,
                    correo: usuario.email.toLowerCase(),
                    rol: 'administrador',
                    estado: 'activa'
                }
            });
        } catch {
            // Si otra petición concurrente ya lo creó, no es necesario repetir la inserción
            const recuperada =
                await this.prisma.cuentas.findUnique({
                    where: {
                        id: usuario.id
                    }
                });

            if (!recuperada) {
                throw new ServiceUnavailableException(
                    'No se ha podido recuperar el registro.'
                );
            }

            await this.retirarMarcaRegistro(usuario.id);

            return {
                estado: recuperada.estado
            };
        }

        await this.retirarMarcaRegistro(usuario.id);

        return {
            estado: 'activa'
        };
    }

    // Limpiar la marca una vez completado el registro
    private async retirarMarcaRegistro(
        usuarioId: string
    ): Promise<void> {

        const clientePrivado =
            this.supabaseService.obtenerCliente();

        const { data, error } =
            await clientePrivado.auth.admin.getUserById(
                usuarioId
            );

        if (error || !data.user) {
            throw new ServiceUnavailableException(
                'No se ha podido finalizar la sincronización.'
            );
        }

        const { error: errorActualizacion } =
            await clientePrivado.auth.admin.updateUserById(
                usuarioId,
                {
                    app_metadata: {
                        ...data.user.app_metadata,
                        [this.marcaRegistroPendiente]: false
                    }
                }
            );

        if (errorActualizacion) {
            throw new ServiceUnavailableException(
                'No se ha podido finalizar la sincronización.'
            );
        }
    }
}


