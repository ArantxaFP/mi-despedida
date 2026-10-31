import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { obtenerUrlBackoffice } from '../configuracion/urls-backoffice';

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
        private readonly configService: ConfigService
    ) { }


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
                estado: true
            }
        });

        if (!cuenta) {
            throw new ForbiddenException(
                'No existe una cuenta operativa válida.'
            );
        }

        if (cuenta.estado !== 'activa') {
            throw new ForbiddenException(
                'Tu cuenta no está habilitada para realizar esta operación.'
            );
        }
    }


    // Actualizar los datos personales de una cuenta activa.
    // PostgreSQL almacena los datos operativos del administrador.
    async actualizarDatosPersonales(
        autorizacion: string | undefined,
        nombre: string,
        apellidos?: string
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

        const { data, error } =
            await this.supabaseService.verificarUsuario(token);

        if (
            error ||
            !data.user ||
            !data.user.email_confirmed_at
        ) {
            throw new UnauthorizedException(
                'La sesión no es válida.'
            );
        }

        await this.comprobarCuentaActiva(data.user.id);

        const nombreLimpio = nombre.trim();
        const apellidosLimpios = apellidos?.trim() || null;

        if (!nombreLimpio || nombreLimpio.length > 100) {
            throw new BadRequestException(
                'El nombre no es válido.'
            );
        }

        // Supabase Auth conserva los datos del perfil utilizados por el front
        const { error: errorAuth } =
            await this.supabaseService.obtenerCliente()
                .auth.admin.updateUserById(data.user.id, {
                    user_metadata: {
                        ...data.user.user_metadata,
                        nombre: nombreLimpio,
                        apellidos: apellidosLimpios ?? ''
                    }
                });

        if (errorAuth) {
            throw new ServiceUnavailableException(
                'No se han podido actualizar los datos personales.'
            );
        }

        // Actualizar también la cuenta propia en PostgreSQL.
        try {
            await this.prisma.cuentas.updateMany({
                where: {
                    id: data.user.id,
                    estado: 'activa'
                },
                data: {
                    nombre: nombreLimpio,
                    apellidos: apellidosLimpios
                }
            });
        } catch {
            throw new ServiceUnavailableException(
                'No se ha podido completar la actualización del perfil.'
            );
        }

        return {
            mensaje: 'Tus datos personales se han actualizado correctamente.'
        };
    }

    // Crear la identidad en Supabase Auth y la cuenta en PostgreSQL.
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

                // La actualización se ha realizado correctamente.
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


