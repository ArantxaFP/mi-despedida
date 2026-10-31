import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DatosDestinatarioDto } from './dto/datos-destinatario.dto';

@Injectable()
export class ContactosDestinatariosService {

    constructor(
        private readonly prisma: PrismaService
    ) { }

    private normalizar(datos: DatosDestinatarioDto) {
        const nombre = datos.nombre.trim();
        const correo = datos.correo.trim().toLowerCase();

        if (!nombre || !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(correo)) {
            throw new BadRequestException(
                'Introduce un nombre y una dirección de correo válidos.'
            );
        }

        return { nombre, correo };
    }

    private async comprobarPropiedad(
        administradorId: string,
        contactoId: string
    ) {
        const contacto =
            await this.prisma.contactos_destinatarios.findFirst({
                where: {
                    id: contactoId,
                    administrador_id: administradorId
                }
            });

        if (!contacto) {
            throw new NotFoundException(
                'No se ha encontrado el destinatario.'
            );
        }

        return contacto;
    }

    private gestionarError(error: unknown): never {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'P2002'
        ) {
            throw new ConflictException(
                'Ya existe un destinatario con ese correo en tu cuenta.'
            );
        }

        throw error;
    }

    async listar(administradorId: string) {
        const contactos =
            await this.prisma.contactos_destinatarios.findMany({
                where: {
                    administrador_id: administradorId
                },
                select: {
                    id: true,
                    nombre: true,
                    correo: true,
                    mensajes_destinatarios: {
                        select: {
                            id: true
                        }
                    }
                },
                orderBy: {
                    nombre: 'asc'
                }
            });

        // Nunca devolver el contenido de la carta en el listado
        return contactos.map(contacto => ({
            id: contacto.id,
            nombre: contacto.nombre,
            correo: contacto.correo,
            tieneMensaje: contacto.mensajes_destinatarios !== null
        }));
    }

    async obtenerFicha(
        administradorId: string,
        contactoId: string
    ) {
        const contacto =
            await this.prisma.contactos_destinatarios.findFirst({
                where: {
                    id: contactoId,
                    administrador_id: administradorId
                },
                include: {
                    mensajes_destinatarios: true
                }
            });

        if (!contacto) {
            throw new NotFoundException(
                'No se ha encontrado el destinatario.'
            );
        }

        return {
            id: contacto.id,
            nombre: contacto.nombre,
            correo: contacto.correo,
            tieneMensaje: contacto.mensajes_destinatarios !== null,
            mensaje: contacto.mensajes_destinatarios?.contenido ?? null
        };
    }

    async crear(
        administradorId: string,
        datos: DatosDestinatarioDto
    ) {
        const valores = this.normalizar(datos);

        try {
            const contacto =
                await this.prisma.contactos_destinatarios.create({
                    data: {
                        administrador_id: administradorId,
                        ...valores
                    }
                });

            return {
                id: contacto.id,
                nombre: contacto.nombre,
                correo: contacto.correo,
                tieneMensaje: false
            };

        } catch (error) {
            this.gestionarError(error);
        }
    }

    async actualizar(
        administradorId: string,
        contactoId: string,
        datos: DatosDestinatarioDto
    ) {
        const valores = this.normalizar(datos);

        try {
            const resultado =
                await this.prisma.contactos_destinatarios.updateMany({
                    where: {
                        id: contactoId,
                        administrador_id: administradorId
                    },
                    data: {
                        ...valores,
                        fecha_actualizacion: new Date()
                    }
                });

            if (resultado.count !== 1) {
                throw new NotFoundException(
                    'No se ha encontrado el destinatario.'
                );
            }

            return this.obtenerFicha(administradorId, contactoId);

        } catch (error) {
            this.gestionarError(error);
        }
    }

    async eliminar(
        administradorId: string,
        contactoId: string
    ): Promise<void> {
        const resultado =
            await this.prisma.contactos_destinatarios.deleteMany({
                where: {
                    id: contactoId,
                    administrador_id: administradorId
                }
            });

        if (resultado.count !== 1) {
            throw new NotFoundException(
                'No se ha encontrado el destinatario.'
            );
        }

        // PostgreSQL elimina también su mensaje personalizado
    }


    // --------------------------------------------------
    // Guardar o actualizar el mensaje personal
    // --------------------------------------------------

    async guardarMensaje(
        administradorId: string,
        contactoId: string,
        contenidoOriginal: string
    ) {
        const contenido = contenidoOriginal.trim();

        // Comprobar que el destinatario pertenece
        // al administrador que ha iniciado sesión.
        await this.comprobarPropiedad(
            administradorId,
            contactoId
        );

        // El mensaje es opcional.
        // Si no hay contenido, no se crea ninguna carta.
        if (!contenido) {
            return {
                mensaje: 'No se ha guardado ningún mensaje personal.'
            };
        }

        // Crear la carta o actualizarla si ya existe.
        await this.prisma.mensajes_destinatarios.upsert({
            where: {
                destinatario_id: contactoId
            },
            create: {
                destinatario_id: contactoId,
                contenido
            },
            update: {
                contenido,
                fecha_actualizacion: new Date()
            }
        });

        return {
            mensaje: 'El mensaje personal se ha guardado correctamente.'
        };
    }

    async eliminarMensaje(
        administradorId: string,
        contactoId: string
    ): Promise<void> {
        await this.comprobarPropiedad(administradorId, contactoId);

        await this.prisma.mensajes_destinatarios.deleteMany({
            where: {
                destinatario_id: contactoId
            }
        });
    }
}


